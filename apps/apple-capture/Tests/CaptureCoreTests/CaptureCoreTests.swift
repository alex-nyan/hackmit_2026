import XCTest
@testable import CaptureCore

final class CaptureCoreTests: XCTestCase {
    func testDelayedWatchDataRetainsMeasurementAgeAndOrigin() throws {
        let original = Date(timeIntervalSince1970: 1_720_000_000.123)
        let reading = WatchReading(sampleID: "sample-1", bootID: "watch-boot", sequence: 12,
                                   measuredAt: original, endedAt: original.addingTimeInterval(1), bpm: 83)
        let roundTrip = try Wire.decoder().decode(WatchReading.self, from: Wire.encoder().encode(reading))
        XCTAssertEqual(roundTrip.measuredAt.timeIntervalSince1970, original.timeIntervalSince1970, accuracy: 0.001)
        XCTAssertEqual(Freshness.classify(measuredAt: roundTrip.measuredAt,
                                         now: original.addingTimeInterval(90), maxAge: 30), .stale)
        XCTAssertEqual(roundTrip.provenance, "healthkit_live_workout_statistics")
        XCTAssertTrue(roundTrip.valid)
    }

    func testMissingAndFutureMeasurementsDoNotAppearCurrent() {
        let now = Date()
        XCTAssertEqual(Freshness.classify(measuredAt: nil, now: now, maxAge: 30), .unavailable)
        XCTAssertEqual(Freshness.classify(measuredAt: now.addingTimeInterval(10), now: now, maxAge: 30), .futureClock)
        XCTAssertFalse(WatchReading(sampleID: "a", bootID: "b", sequence: 0, measuredAt: now,
                                    endedAt: now, bpm: .nan).valid)
    }

    func testOverloadKeepsLatestFrameAndCountsAudioGaps() {
        var latest = BoundedQueue<Int>(capacity: 1)
        latest.append(1); latest.append(2); latest.append(3)
        XCTAssertEqual(latest.popFirst(), 3)
        XCTAssertEqual(latest.dropped, 2)
        var audio = BoundedQueue<Int>(capacity: 3)
        (0..<6).forEach { audio.append($0) }
        XCTAssertEqual(audio.dropped, 3)
        XCTAssertEqual([audio.popFirst(), audio.popFirst(), audio.popFirst()], [3, 4, 5])
        XCTAssertNil(audio.popFirst())
    }

    func testEndpointCannotSendCredentialsOverHTTPOrToEmbeddedCredentials() throws {
        XCTAssertEqual(try Endpoint.validate("https://inference.example:8443").host, "inference.example")
        for invalid in ["http://localhost:8000", "https://user:secret@host", "https://host/path", "https://host?token=x"] {
            XCTAssertThrowsError(try Endpoint.validate(invalid))
        }
    }

    func testIndependentWAVHasCorrectLengthRateAndSignedLittleEndianSamples() throws {
        let wav = try WAV.encode(samples: [-32768, 0, 32767], sampleRate: 16_000)
        XCTAssertEqual(wav.count, 50)
        XCTAssertEqual(String(data: wav.prefix(4), encoding: .utf8), "RIFF")
        XCTAssertEqual(Array(wav[24..<28]), [0x80, 0x3e, 0, 0])
        XCTAssertEqual(Array(wav.suffix(6)), [0, 0x80, 0, 0, 0xff, 0x7f])
    }

    func testWireContractUsesServerKeysAndNeverSuppliesWearerIdentity() throws {
        let date = Date(timeIntervalSince1970: 1_720_000_000)
        let request = TelemetryRequest(incidentID: "incident-1", sourceID: "watch-1", samples: [
            TelemetrySample(bootID: "boot-1", sequence: 1, measuredAt: date, kind: "heart_rate", value: HeartRateValue(bpm: 81))
        ])
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Wire.encoder().encode(request)) as? [String: Any])
        XCTAssertEqual(json["schema_version"] as? String, "2.0")
        XCTAssertEqual(json["source_id"] as? String, "watch-1")
        let sample = try XCTUnwrap((json["samples"] as? [[String: Any]])?.first)
        XCTAssertEqual(sample["measured_at"] as? String, "2024-07-03T09:46:40.000Z")
        XCTAssertNil(sample["subject_id"])
        XCTAssertNil(json["wearer_id"])
    }

    func testCaptureClockUsesOriginalTimestamp() {
        let clock = CaptureClock(wallAnchor: Date(timeIntervalSince1970: 1000), monotonicAnchor: 500)
        XCTAssertEqual(clock.date(at: 497).timeIntervalSince1970, 997)
    }

    func testPausedOrReboundMirrorCannotForwardReadings() {
        var guardrail = MirrorBindingGuard<String>()
        guardrail.begin(sessionID: "session-a", currentBinding: "incident-a:watch-a")
        XCTAssertTrue(guardrail.allowConfiguration("incident-a:watch-a"))
        XCTAssertFalse(guardrail.allowConfiguration("incident-b:watch-b"))
        XCTAssertFalse(guardrail.allowsSample(sessionID: "session-a", sharing: false))
        guardrail.begin(sessionID: "reconnected-a", currentBinding: "incident-a:watch-a")
        XCTAssertFalse(guardrail.allowsSample(sessionID: "session-a", sharing: true))
        guardrail.end(sessionID: "session-a")
        XCTAssertFalse(guardrail.allowConfiguration("incident-b:watch-b"))
        guardrail.end(sessionID: "reconnected-a")
        XCTAssertTrue(guardrail.allowConfiguration("incident-b:watch-b"))
    }

    func testWatchReadingRejectsWrongOriginAndInvalidBounds() {
        let now = Date()
        for reading in [
            WatchReading(sampleID: "a", bootID: "b", sequence: 0, measuredAt: now, endedAt: now, bpm: 401),
            WatchReading(sampleID: "a/b", bootID: "b", sequence: 0, measuredAt: now, endedAt: now, bpm: 80),
            WatchReading(sampleID: "a", bootID: "b", sequence: -1, measuredAt: now, endedAt: now, bpm: 80),
            WatchReading(sampleID: "a", bootID: "b", sequence: 0, measuredAt: now, endedAt: now, bpm: 80, provenance: "manually_entered")
        ] { XCTAssertFalse(reading.valid) }
    }

    func testMissingAudioBufferBreaksChunkContinuity() {
        var continuity = AudioContinuity()
        XCTAssertTrue(continuity.accept(hostSeconds: 10, sampleCount: 1600, sampleRate: 16000))
        XCTAssertFalse(continuity.accept(hostSeconds: 10.2, sampleCount: 1600, sampleRate: 16000))
        XCTAssertTrue(continuity.accept(hostSeconds: 10.3, sampleCount: 1600, sampleRate: 16000))
    }

    func testPendingAssistanceCannotChangeCredentialAndBackfillCannotRestoreCoverage() {
        XCTAssertFalse(RelaySafety.mayReplaceCredential(pendingAssistance: true, proposed: "new", stored: "old"))
        XCTAssertTrue(RelaySafety.mayReplaceCredential(pendingAssistance: true, proposed: "", stored: "old"))
        let time = Date()
        let reading = WatchReading(sampleID: "a", bootID: "b", sequence: 1, measuredAt: time, endedAt: time, bpm: 81)
        XCTAssertTrue(RelaySafety.canRestoreWatchCoverage(reading, now: time.addingTimeInterval(1)))
        XCTAssertFalse(RelaySafety.canRestoreWatchCoverage(reading, now: time.addingTimeInterval(60)))
    }
}
