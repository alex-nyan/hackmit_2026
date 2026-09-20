import AVFoundation
import CoreLocation
import SwiftUI

@MainActor
final class CaptureCoordinator: ObservableObject {
    let relay = RelayClient()
    let watch = WatchMirror()
    let camera = CameraCapture()
    let microphone = MicrophoneCapture()
    let location = LocationCapture()
    @Published private(set) var active = false
    @Published private(set) var cameraState = "unavailable"
    @Published private(set) var audioState = "unavailable"
    @Published private(set) var locationState = "unavailable"
    @Published private(set) var lastFrameAt: Date?
    @Published private(set) var lastAudioAt: Date?
    @Published private(set) var lastLocationAt: Date?
    @Published var error: String?
    private let bootID = UUID().uuidString
    private var sequence: [String: Int] = [:]
    private var lastHealth: [String: (String, Date)] = [:]
    private var heartbeat: Task<Void, Never>?
    private var starting = false
    private var mirrorBinding = MirrorBindingGuard<CaptureConfiguration>()
    private var startGeneration = UUID()

    init() {
        camera.onFrame = { [weak self] data, date in Task { @MainActor in self?.frame(data, date: date) } }
        microphone.onAudio = { [weak self] data, date in Task { @MainActor in self?.audio(data, date: date) } }
        camera.onState = { [weak self] state, reason in Task { @MainActor in self?.health("camera", state, reason) } }
        microphone.onState = { [weak self] state, reason in Task { @MainActor in self?.health("microphone", state, reason) } }
        location.onState = { [weak self] state, reason in self?.health("gps", state, reason) }
        location.onFix = { [weak self] fix, reduced in self?.fix(fix, reduced: reduced) }
        watch.onReading = { [weak self] reading, sessionID in self?.reading(reading, sessionID: sessionID) }
        watch.onSessionBegan = { [weak self] sessionID in
            guard let self else { return }
            self.mirrorBinding.begin(sessionID: sessionID, currentBinding: self.relay.configuration)
        }
        watch.onSessionEnded = { [weak self] sessionID in self?.mirrorBinding.end(sessionID: sessionID) }
        watch.onUnavailable = { [weak self] reason in self?.health("watch", "unavailable", reason) }
    }
    func start(configuration: CaptureConfiguration, token: String) async {
        guard !active, !starting else { return }
        starting = true
        defer { starting = false }
        let generation = startGeneration
        do {
            guard mirrorBinding.allowConfiguration(configuration) else { throw RelayError.watchBindingLocked }
            try relay.validateConfigurationChange(configuration, token: token)
            if !token.isEmpty { try CredentialStore.save(token) }
            try relay.configure(configuration)
            mirrorBinding.bind(configuration)
            let cameraAllowed = await AVCaptureDevice.requestAccess(for: .video)
            guard generation == startGeneration else { return }
            let audioAllowed = await AVAudioApplication.requestRecordPermission()
            guard generation == startGeneration, UIApplication.shared.applicationState == .active else { return }
            active = true; error = nil
            UIDevice.current.isBatteryMonitoringEnabled = true
            if cameraAllowed { camera.start() } else { health("camera", "unavailable", "camera_permission_denied") }
            if audioAllowed { microphone.start() } else { health("microphone", "unavailable", "microphone_permission_denied") }
            location.start()
            heartbeat = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    guard let self, self.active, !Task.isCancelled else { return }
                    self.health("device", "available", "foreground_capture; thermal_\(ProcessInfo.processInfo.thermalState.rawValue)")
                }
            }
        } catch { self.error = error.localizedDescription }
    }
    func stop(reason: String = "operator_stopped") {
        startGeneration = UUID()
        active = false; heartbeat?.cancel(); heartbeat = nil
        relay.pauseMedia()
        camera.stop(reason: reason); microphone.stop(reason: reason); location.stop()
        // Health packets can finish with normal bounded network timeouts; no background camera mode.
        health("camera", "unavailable", reason)
        health("microphone", "unavailable", reason)
    }
    private func source(_ component: String) -> String? {
        guard let config = relay.configuration else { return nil }
        return component == "watch" ? config.watchSourceID : config.source(component)
    }
    private func next(_ sourceID: String) -> Int {
        let value = (sequence[sourceID] ?? -1) + 1; sequence[sourceID] = value; return value
    }
    private func send<V: Encodable>(_ component: String, kind: String, measuredAt: Date, value: V) {
        guard let config = relay.configuration, let sourceID = source(component) else { return }
        relay.enqueue(TelemetryRequest(incidentID: config.incidentID, sourceID: sourceID, samples: [
            TelemetrySample(bootID: bootID, sequence: next(sourceID), measuredAt: measuredAt, kind: kind, value: value)
        ]), lane: .telemetry, capturedAt: measuredAt)
    }
    private func health(_ component: String, _ availability: String, _ reason: String) {
        switch component {
        case "camera": cameraState = "\(availability): \(reason)"
        case "microphone": audioState = "\(availability): \(reason)"
        case "gps": locationState = "\(availability): \(reason)"
        default: break
        }
        let key = "\(availability):\(reason)"
        if let last = lastHealth[component], last.0 == key, Date().timeIntervalSince(last.1) < 10 { return }
        lastHealth[component] = (key, Date())
        let battery = UIDevice.current.batteryLevel
        send(component, kind: "source_health", measuredAt: Date(), value: SourceHealthValue(
            availability: availability, reason: reason, battery: battery >= 0 ? Double(battery) : nil))
    }
    private func frame(_ data: Data, date: Date) {
        guard active, let config = relay.configuration, let sourceID = source("camera") else { return }
        lastFrameAt = date; health("camera", "available", "fresh_frames_received")
        relay.enqueue(MediaRequest(incidentID: config.incidentID, sourceID: sourceID, bootID: bootID,
            sequence: next(sourceID), capturedAt: date, mediaType: "image/jpeg", kind: "frame", data: data), lane: .video, capturedAt: date)
    }
    private func audio(_ data: Data, date: Date) {
        guard active, let config = relay.configuration, let sourceID = source("microphone") else { return }
        lastAudioAt = date; health("microphone", "available", "audio_chunks_received")
        relay.enqueue(MediaRequest(incidentID: config.incidentID, sourceID: sourceID, bootID: bootID,
            sequence: next(sourceID), capturedAt: date, mediaType: "audio/wav", kind: "audio", data: data), lane: .audio, capturedAt: date)
    }
    private func fix(_ fix: CLLocation, reduced: Bool) {
        guard active else { return }
        lastLocationAt = fix.timestamp
        health("gps", "available", reduced ? "reduced_accuracy" : "full_accuracy_authorized")
        send("gps", kind: "location", measuredAt: fix.timestamp, value: LocationValue(latitude: fix.coordinate.latitude,
            longitude: fix.coordinate.longitude, accuracy: fix.horizontalAccuracy,
            speed: fix.speed >= 0 ? fix.speed : nil, course: fix.course >= 0 ? fix.course : nil))
    }
    private func reading(_ reading: WatchReading, sessionID: String) {
        guard reading.valid, mirrorBinding.allowsSample(sessionID: sessionID, sharing: active),
              let config = relay.configuration else { return }
        if RelaySafety.canRestoreWatchCoverage(reading, now: Date()) {
            health("watch", "available", "fresh_running_workout_sample")
        }
        // Preserve Watch sequence and measurement times. Phone health has its own boot stream.
        relay.enqueue(TelemetryRequest(incidentID: config.incidentID, sourceID: config.watchSourceID, samples: [
            TelemetrySample(sampleID: reading.sampleID, bootID: reading.bootID, sequence: reading.sequence,
                measuredAt: reading.measuredAt, kind: "heart_rate", value: HeartRateValue(bpm: reading.bpm, measuredUntil: reading.endedAt))
        ]), lane: .telemetry, capturedAt: reading.measuredAt)
    }
}
