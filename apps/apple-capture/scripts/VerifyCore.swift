import Foundation

// CLT-only runner: uses the same production core when XCTest/SwiftPM are unavailable.
@main
struct VerifyCore {
    static func main() throws {
        var checks = 0
        func check(_ condition: @autoclosure () -> Bool, _ description: String) {
            precondition(condition(), description); checks += 1
        }
        let measured = Date(timeIntervalSince1970: 1_720_000_000.123)
        let reading = WatchReading(sampleID: "sample-1", bootID: "watch-boot", sequence: 12,
            measuredAt: measured, endedAt: measured.addingTimeInterval(1), bpm: 83)
        let copy = try Wire.decoder().decode(WatchReading.self, from: Wire.encoder().encode(reading))
        check(abs(copy.measuredAt.timeIntervalSince(measured)) < 0.001, "Preserve measurement time")
        check(copy.valid, "Valid Watch sample")
        check(Freshness.classify(measuredAt: copy.measuredAt, now: measured.addingTimeInterval(90), maxAge: 30) == .stale, "Delayed relay must remain stale")
        check(Freshness.classify(measuredAt: nil, now: measured, maxAge: 30) == .unavailable, "Missing data is unavailable")
        check(Freshness.classify(measuredAt: measured.addingTimeInterval(10), now: measured, maxAge: 30) == .futureClock, "Future clocks are uncertain")
        var frames = BoundedQueue<Int>(capacity: 1)
        (1...5).forEach { frames.append($0) }
        check(frames.popFirst() == 5 && frames.dropped == 4, "Latest-only frame buffer")
        var audio = BoundedQueue<Int>(capacity: 3)
        (1...5).forEach { audio.append($0) }
        check(audio.dropped == 2 && audio.popFirst() == 3, "Bounded audio eviction")
        for invalid in ["http://localhost", "https://a:b@host", "https://host?secret=1", "https://host/path"] {
            do { _ = try Endpoint.validate(invalid); preconditionFailure("Unsafe endpoint accepted") }
            catch { checks += 1 }
        }
        let endpoint = try Endpoint.validate("https://inference.example:8443")
        check(endpoint.host == "inference.example", "Valid HTTPS origin")
        let wav = try WAV.encode(samples: [-32768, 0, 32767], sampleRate: 16_000)
        check(wav.count == 50, "Complete WAV length")
        check(Array(wav[24..<28]) == [0x80, 0x3e, 0, 0], "WAV actual sample rate")
        check(Array(wav.suffix(6)) == [0, 0x80, 0, 0, 0xff, 0x7f], "Little endian PCM16")
        let request = TelemetryRequest(incidentID: "incident-demo", sourceID: "watch-01", samples: [
            TelemetrySample(sampleID: "sample-1", bootID: "watch-boot", sequence: 12, measuredAt: measured,
                kind: "heart_rate", value: HeartRateValue(bpm: 83, measuredUntil: measured.addingTimeInterval(1)))
        ])
        let data = try Wire.encoder().encode(request)
        let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        check(object["schema_version"] as? String == "2.0", "v2 envelope")
        check(object["subject_id"] == nil && object["wearer_id"] == nil, "No client-selected wearer")
        let sample = (object["samples"] as! [[String: Any]])[0]
        check(sample["measured_at"] as? String == "2024-07-03T09:46:40.123Z", "Canonical measurement timestamp")
        let clock = CaptureClock(wallAnchor: measured, monotonicAnchor: 500)
        check(clock.date(at: 497) == measured.addingTimeInterval(-3), "Capture host clock mapping")
        var binding = MirrorBindingGuard<String>()
        binding.begin(sessionID: "watch-session-a", currentBinding: "incident-a:watch-a")
        check(!binding.allowsSample(sessionID: "watch-session-a", sharing: false), "Stop sharing blocks Watch samples")
        check(!binding.allowConfiguration("incident-b:watch-b"), "Active Watch cannot be rebound")
        check(binding.allowConfiguration("incident-a:watch-a"), "Same destination may resume")
        binding.begin(sessionID: "reconnect-a", currentBinding: "incident-a:watch-a")
        check(!binding.allowsSample(sessionID: "watch-session-a", sharing: true), "Old mirrored session callback rejected")
        binding.end(sessionID: "watch-session-a")
        check(!binding.allowConfiguration("incident-b:watch-b"), "Old callback cannot release current binding")
        binding.end(sessionID: "reconnect-a")
        check(binding.allowConfiguration("incident-b:watch-b"), "Ended session releases binding")
        check(!WatchReading(sampleID: "a", bootID: "b", sequence: 0, measuredAt: measured, endedAt: measured, bpm: 401).valid, "Out-of-range HR rejected")
        check(!WatchReading(sampleID: "a/b", bootID: "b", sequence: 0, measuredAt: measured, endedAt: measured, bpm: 80).valid, "Invalid identity rejected")
        check(!WatchReading(sampleID: "a", bootID: "b", sequence: -1, measuredAt: measured, endedAt: measured, bpm: 80).valid, "Invalid sequence rejected")
        check(!WatchReading(sampleID: "a", bootID: "b", sequence: 0, measuredAt: measured, endedAt: measured, bpm: 80, provenance: "manual_entry").valid, "Unknown origin rejected")
        var continuity = AudioContinuity()
        check(continuity.accept(hostSeconds: 1, sampleCount: 1600, sampleRate: 16000), "First audio buffer")
        check(!continuity.accept(hostSeconds: 1.2, sampleCount: 1600, sampleRate: 16000), "Dropped buffer cannot become continuous WAV")
        check(continuity.accept(hostSeconds: 1.3, sampleCount: 1600, sampleRate: 16000), "New continuous segment after gap")
        check(!RelaySafety.mayReplaceCredential(pendingAssistance: true, proposed: "new", stored: "old"), "Pending assistance locks credential")
        check(RelaySafety.mayReplaceCredential(pendingAssistance: true, proposed: "", stored: "old"), "Pending assistance permits unchanged credential resume")
        check(RelaySafety.canRestoreWatchCoverage(reading, now: measured.addingTimeInterval(2)), "Fresh Watch sample restores coverage")
        check(!RelaySafety.canRestoreWatchCoverage(reading, now: measured.addingTimeInterval(60)), "Old Watch backfill cannot restore coverage")
        let receiptData = Data(#"{"schema_version":"2.0","incident_id":"case-a","revision":1,"results":[{"sample_id":"sample-a","status":"accepted","observation_id":"obs-a","warnings":[]}]}"#.utf8)
        let receipt = try Wire.decoder().decode(TelemetryReceipt.self, from: receiptData)
        check(receipt.validates(incidentID: "case-a", sampleIDs: ["sample-a"]), "Telemetry receipt identity accepted")
        check(!receipt.validates(incidentID: "case-a", sampleIDs: ["other-sample"]), "Mismatched sample receipt rejected")
        let badAssistance = try Wire.decoder().decode(AssistanceReceipt.self, from: Data(#"{"schema_version":"2.0","incident_id":"case-a","revision":-1,"command_id":"","alert_id":"alert-a"}"#.utf8))
        check(!badAssistance.validates(incidentID: "case-a"), "Invalid command acknowledgment rejected")
        if CommandLine.arguments.count > 1 { try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1])) }
        print("CaptureCore: \(checks) checks passed (wire, bounded buffers, stale data, endpoint security, WAV, clock).")
    }
}
