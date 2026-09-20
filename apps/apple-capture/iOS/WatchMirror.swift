import HealthKit
import Combine

@MainActor
final class WatchMirror: NSObject, ObservableObject, HKWorkoutSessionDelegate {
    @Published private(set) var state = "No mirrored workout — heart rate unavailable"
    @Published private(set) var latest: WatchReading?
    var onReading: ((WatchReading, String) -> Void)?
    var onSessionBegan: ((String) -> Void)?
    var onSessionEnded: ((String) -> Void)?
    var onUnavailable: ((String) -> Void)?
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var sessionID: String?

    override init() {
        super.init()
        // Install at launch, including launches caused by workout mirroring.
        store.workoutSessionMirroringStartHandler = { [weak self] session in
            Task { @MainActor in
                guard let self else { return }
                self.session = session; session.delegate = self
                self.sessionID = UUID().uuidString; self.latest = nil
                self.onSessionBegan?(self.sessionID!)
                self.state = "Watch connected — waiting for a measured sample"
            }
        }
    }
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        Task { @MainActor in
            guard self.session === workoutSession else { return }
            if toState == .ended || toState == .stopped || toState == .paused {
                self.state = "Workout paused/ended — no continuous heart-rate coverage"
                self.onUnavailable?("watch_workout_paused_or_ended")
                if toState == .ended || toState == .stopped, let sessionID = self.sessionID {
                    self.onSessionEnded?(sessionID)
                    self.session = nil; self.sessionID = nil
                }
            }
        }
    }
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in
            guard self.session === workoutSession else { return }
            self.state = "Watch session failed"; self.onUnavailable?("watch_session_failed")
            // Keep the binding locked until the primary Watch workout explicitly ends.
        }
    }
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didDisconnectFromRemoteDeviceWithError error: Error?) {
        Task { @MainActor in
            guard self.session === workoutSession else { return }
            self.state = "Watch disconnected — previous readings may be stale"; self.onUnavailable?("watch_disconnected")
        }
    }
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didReceiveDataFromRemoteWorkoutSession data: [Data]) {
        // iOS may batch minutes of old data after suspension; retain the original times.
        for payload in data.suffix(64) where payload.count <= 4096 {
            guard let reading = try? Wire.decoder().decode(WatchReading.self, from: payload), reading.valid else { continue }
            Task { @MainActor in
                guard self.session === workoutSession, let sessionID = self.sessionID,
                      workoutSession.state == .running else { return }
                if self.latest == nil || reading.measuredAt > self.latest!.measuredAt { self.latest = reading }
                self.state = "Watch connected — measurement age shown below"
                self.onReading?(reading, sessionID)
            }
        }
    }
}
