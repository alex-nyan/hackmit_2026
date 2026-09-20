import SwiftUI

@main
struct CaptureApp: App {
    @StateObject private var capture = CaptureCoordinator()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            CaptureView(capture: capture, relay: capture.relay, watch: capture.watch)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background || (phase == .inactive && capture.active) {
                        capture.stop(reason: "camera_paused_background_or_lock")
                    }
                }
        }
    }
}

struct CaptureView: View {
    @ObservedObject var capture: CaptureCoordinator
    @ObservedObject var relay: RelayClient
    @ObservedObject var watch: WatchMirror
    @State private var configuration: CaptureConfiguration = {
        guard let data = UserDefaults.standard.data(forKey: "captureConfiguration"),
              let config = try? JSONDecoder().decode(CaptureConfiguration.self, from: data) else { return CaptureConfiguration() }
        return config
    }()
    @State private var token = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Enrolled destination") {
                    TextField("HTTPS inference host", text: $configuration.endpoint)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    TextField("Incident ID", text: $configuration.incidentID)
                    TextField("iPhone source prefix", text: $configuration.sourcePrefix)
                    TextField("Enrolled Watch source ID", text: $configuration.watchSourceID)
                    SecureField("Source token (stored in Keychain)", text: $token)
                    Text("The server enrollment identifies the consenting Watch wearer. Responder readings are never patient measurements.")
                        .font(.caption)
                }.disabled(capture.active)
                Section("Capture") {
                    Button(capture.active ? "Stop capture" : "Start foreground capture") {
                        if capture.active { capture.stop() }
                        else {
                            if let data = try? JSONEncoder().encode(configuration) { UserDefaults.standard.set(data, forKey: "captureConfiguration") }
                            Task { await capture.start(configuration: configuration, token: token); token = "" }
                        }
                    }.buttonStyle(.borderedProminent)
                    if let error = capture.error { Text(error).foregroundStyle(.red) }
                    Text("Keep the phone mounted, unlocked, and this app visible. Locking or switching apps stops camera and microphone capture. Resume explicitly.")
                    TimelineView(.periodic(from: .now, by: 1)) { timeline in
                        VStack(alignment: .leading, spacing: 8) {
                            ageRow("Camera", state: capture.cameraState, date: capture.lastFrameAt, now: timeline.date, maxAge: 2)
                            ageRow("Microphone", state: capture.audioState, date: capture.lastAudioAt, now: timeline.date, maxAge: 6)
                            ageRow("GPS", state: capture.locationState, date: capture.lastLocationAt, now: timeline.date, maxAge: 30)
                            ageRow("Host receipt", state: relay.status, date: relay.lastReceiptAt, now: timeline.date, maxAge: 10)
                        }
                    }
                    Text("Dropped/superseded: video \(relay.droppedVideo), audio \(relay.droppedAudio), telemetry \(relay.droppedTelemetry)").font(.caption)
                }
                Section("Watch wearer heart rate") {
                    Text(watch.state)
                    TimelineView(.periodic(from: .now, by: 1)) { timeline in
                        if let reading = watch.latest {
                            Text("\(reading.bpm, specifier: "%.0f") bpm · \(Freshness.classify(measuredAt: reading.measuredAt, now: timeline.date, maxAge: 30).rawValue) · \(max(0, Int(timeline.date.timeIntervalSince(reading.measuredAt)))) s old")
                        } else { Text("No measured data") }
                    }
                    Text("Consumer HealthKit reading; signal quality unknown. Start a walking workout on the Watch only while actually walking for exercise. No continuous all-shift monitoring is promised.").font(.caption)
                }
                Section("Incident-team assistance") {
                    Button("Request assistance / retry pending request") { Task { await relay.requestAssistance() } }
                        .buttonStyle(.borderedProminent).tint(.red).disabled(relay.configuration == nil)
                    Text(relay.assistanceStatus)
                    Text("This sends a request to your incident team. It does not call emergency services or Apple Emergency SOS.").font(.caption)
                }
            }.navigationTitle("Safety Capture")
        }
    }
    private func ageRow(_ name: String, state: String, date: Date?, now: Date, maxAge: Double) -> some View {
        VStack(alignment: .leading) {
            Text("\(name): \(state)")
            Text("\(Freshness.classify(measuredAt: date, now: now, maxAge: maxAge).rawValue)\(date.map { " · \(max(0, Int(now.timeIntervalSince($0)))) s old" } ?? "")")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}
