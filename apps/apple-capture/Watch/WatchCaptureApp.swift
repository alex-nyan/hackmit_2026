import SwiftUI
import HealthKit

@main
struct WatchCaptureApp: App {
    @StateObject private var workout = WalkingWorkout()
    var body: some Scene {
        WindowGroup {
            ScrollView {
                VStack(spacing: 10) {
                    Text("Walking capture").font(.headline)
                    Text(workout.state).font(.caption)
                    TimelineView(.periodic(from: .now, by: 1)) { timeline in
                        if let reading = workout.latest {
                            Text("\(reading.bpm, specifier: "%.0f") bpm")
                            Text("\(Freshness.classify(measuredAt: reading.measuredAt, now: timeline.date, maxAge: 30).rawValue) · \(max(0, Int(timeline.date.timeIntervalSince(reading.measuredAt)))) s old").font(.caption)
                        } else { Text("No sample available") }
                    }
                    if workout.running || workout.stopping {
                        Button(workout.stopping ? "Ending workout…" : "End walking workout") { Task { await workout.stop() } }.tint(.red).disabled(workout.stopping)
                    } else {
                        Text("Start only during an actual walking workout. This records a Health workout and relays heart rate to your enrolled iPhone incident.").font(.caption)
                        Button(workout.startInFlight ? "Starting…" : "Start walking workout") { Task { await workout.start() } }.disabled(workout.startInFlight)
                    }
                    Text("Heart-rate cadence varies. Not a clinical monitor or Emergency SOS.").font(.caption2)
                }.padding()
            }
        }
    }
}

@MainActor
final class WalkingWorkout: NSObject, ObservableObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    @Published private(set) var state = "Stopped"
    @Published private(set) var running = false
    @Published private(set) var latest: WatchReading?
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var bootID = UUID().uuidString
    private var sequence = 0
    private var lastInterval: DateInterval?
    private var pending = BoundedQueue<WatchReading>(capacity: 16)
    private var sending = false
    @Published private(set) var startInFlight = false
    @Published private(set) var stopping = false
    private var sendEpoch = UUID()

    func start() async {
        guard !running, !startInFlight, !stopping else { return }
        startInFlight = true; defer { startInFlight = false }
        do {
            guard HKHealthStore.isHealthDataAvailable(), let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
                state = "HealthKit unavailable"; return
            }
            // HealthKit intentionally does not disclose whether reads were denied. No samples remains unavailable.
            try await store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [heartRate])
            let config = HKWorkoutConfiguration(); config.activityType = .walking; config.locationType = .unknown
            let session = try HKWorkoutSession(healthStore: store, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            self.session = session; self.builder = builder
            session.delegate = self; builder.delegate = self
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            bootID = UUID().uuidString; sequence = 0; lastInterval = nil; latest = nil; pending.removeAll()
            sendEpoch = UUID(); sending = false
            try await session.startMirroringToCompanionDevice()
            let start = Date(); session.startActivity(with: start)
            try await builder.beginCollection(at: start)
            running = true; state = "Walking; awaiting heart-rate sample"
        } catch {
            session?.end(); session = nil; builder = nil
            running = false; state = "Unable to start: \(error.localizedDescription)"
        }
    }
    func stop() async {
        guard !stopping, let session, let builder else { return }
        stopping = true
        defer { stopping = false }
        running = false; session.end()
        sendEpoch = UUID(); sending = false
        do {
            try await builder.endCollection(at: Date())
            _ = try await builder.finishWorkout()
            try await session.stopMirroringToCompanionDevice()
            state = "Workout saved; capture stopped"
        } catch { state = "Stopped; workout save/mirroring error" }
        if self.session === session { self.session = nil }
        if self.builder === builder { self.builder = nil }
        pending.removeAll()
    }
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate), collectedTypes.contains(type),
              let statistics = workoutBuilder.statistics(for: type),
              let quantity = statistics.mostRecentQuantity(), let interval = statistics.mostRecentQuantityDateInterval() else { return }
        let bpm = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        Task { @MainActor in
            guard self.builder === workoutBuilder else { return }
            self.collect(bpm: bpm, interval: interval)
        }
    }
    private func collect(bpm: Double, interval: DateInterval) {
        guard running, interval != lastInterval, bpm.isFinite, bpm > 0 else { return }
        lastInterval = interval
        let reading = WatchReading(sampleID: UUID().uuidString, bootID: bootID, sequence: sequence,
            measuredAt: interval.start, endedAt: interval.end, bpm: bpm)
        sequence += 1; latest = reading; pending.append(reading)
        sendNext()
    }
    private func sendNext() {
        guard !sending, let session, let reading = pending.popFirst(),
              let data = try? Wire.encoder().encode(reading) else { return }
        sending = true
        state = "Sending sample to iPhone"
        let epoch = sendEpoch
        // One outstanding send bounds memory even when the system transport stalls.
        session.sendToRemoteWorkoutSession(data: data) { [weak self] success, error in
            Task { @MainActor in
                guard let self else { return }
                guard self.sendEpoch == epoch else { return }
                self.sending = false
                self.state = success ? "Relayed to iPhone · queued drops \(self.pending.dropped)" : "iPhone relay disconnected; data may be lost"
                self.sendNext()
            }
        }
    }
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        Task { @MainActor in
            guard self.session === workoutSession else { return }
            if toState == .ended || toState == .stopped { self.running = false }
            if toState == .paused { self.state = "Paused — data unavailable" }
        }
    }
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in
            guard self.session === workoutSession else { return }
            self.running = false; self.state = "Workout failed: \(error.localizedDescription)"
        }
    }
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didDisconnectFromRemoteDeviceWithError error: Error?) {
        Task { @MainActor in
            guard self.session === workoutSession else { return }
            self.state = "iPhone disconnected; samples remain bounded"
        }
    }
}
