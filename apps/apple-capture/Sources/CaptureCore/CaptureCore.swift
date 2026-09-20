import Foundation

public enum Wire {
    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(timestamp(date))
        }
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: value) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid timestamp")
            }
            return date
        }
        return decoder
    }

    public static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

/// A transport record, not an authoritative patient/wearer assignment.
public struct WatchReading: Codable, Equatable, Sendable {
    public let sampleID: String
    public let bootID: String
    public let sequence: Int
    public let measuredAt: Date
    public let endedAt: Date
    public let bpm: Double
    public let sessionMode: String
    public let provenance: String

    public init(sampleID: String, bootID: String, sequence: Int, measuredAt: Date, endedAt: Date,
                bpm: Double, sessionMode: String = "user_started_walking_workout",
                provenance: String = "healthkit_live_workout_statistics") {
        self.sampleID = sampleID; self.bootID = bootID; self.sequence = sequence
        self.measuredAt = measuredAt; self.endedAt = endedAt; self.bpm = bpm
        self.sessionMode = sessionMode; self.provenance = provenance
    }

    public var valid: Bool {
        let identifier = "^[A-Za-z0-9_.:-]{1,128}$"
        return bpm.isFinite && (1...400).contains(bpm)
            && measuredAt.timeIntervalSince1970.isFinite && endedAt.timeIntervalSince1970.isFinite
            && endedAt >= measuredAt && (0...9_007_199_254_740_991).contains(sequence)
            && sampleID.range(of: identifier, options: .regularExpression) != nil
            && bootID.range(of: identifier, options: .regularExpression) != nil
            && sessionMode == "user_started_walking_workout"
            && provenance == "healthkit_live_workout_statistics"
    }
}

/// Prevent a mirrored session from being rebound to a different incident/source after a local pause.
public struct MirrorBindingGuard<Binding: Equatable> {
    public private(set) var activeSession: String?
    private var binding: Binding?
    public init() {}
    public mutating func begin(sessionID: String, currentBinding: Binding?) {
        activeSession = sessionID
        // Reconnection may create a new HKWorkoutSession object for the same workout.
        if binding == nil { binding = currentBinding }
    }
    public mutating func end(sessionID: String) {
        guard activeSession == sessionID else { return }
        activeSession = nil; binding = nil
    }
    public func allowConfiguration(_ proposed: Binding) -> Bool {
        guard activeSession != nil else { return true }
        if let binding { return binding == proposed }
        return true
    }
    public mutating func bind(_ proposed: Binding) {
        if activeSession != nil, binding == nil { binding = proposed }
    }
    public func allowsSample(sessionID: String, sharing: Bool) -> Bool {
        sharing && activeSession == sessionID
    }
}

/// In-memory bounded FIFO. Owners serialize access; eviction is counted explicitly.
public struct BoundedQueue<Element> {
    public let capacity: Int
    public private(set) var dropped = 0
    private var elements: [Element] = []
    public var count: Int { elements.count }

    public init(capacity: Int) { precondition(capacity > 0); self.capacity = capacity }
    public mutating func append(_ element: Element) {
        if elements.count == capacity { elements.removeFirst(); dropped += 1 }
        elements.append(element)
    }
    public mutating func popFirst() -> Element? {
        elements.isEmpty ? nil : elements.removeFirst()
    }
    public mutating func removeAll() { elements.removeAll(keepingCapacity: true) }
}

public enum Freshness: String, Sendable {
    case current, stale, unavailable, futureClock = "clock_uncertain"
    public static func classify(measuredAt: Date?, now: Date, maxAge: TimeInterval) -> Freshness {
        guard let measuredAt else { return .unavailable }
        let age = now.timeIntervalSince(measuredAt)
        if age < -2 { return .futureClock }
        return age <= maxAge ? .current : .stale
    }
}

/// Maps capture host-clock timestamps to wall clock without substituting upload time.
public struct CaptureClock: Sendable {
    public let wallAnchor: Date
    public let monotonicAnchor: TimeInterval
    public init(wallAnchor: Date = Date(), monotonicAnchor: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        self.wallAnchor = wallAnchor; self.monotonicAnchor = monotonicAnchor
    }
    public func date(at monotonicSeconds: TimeInterval) -> Date {
        wallAnchor.addingTimeInterval(monotonicSeconds - monotonicAnchor)
    }
}

public enum CaptureError: Error { case invalidEndpoint, invalidAudio }

public struct AudioContinuity {
    private var expectedNext: Double?
    public init() {}
    /// Returns false across a missing/overlapping host-time buffer, even if an earlier gap flag raced.
    public mutating func accept(hostSeconds: Double, sampleCount: Int, sampleRate: Int) -> Bool {
        guard hostSeconds.isFinite, sampleCount >= 0, sampleRate > 0 else { expectedNext = nil; return false }
        let continuous = expectedNext.map { abs(hostSeconds - $0) <= 0.005 } ?? true
        expectedNext = hostSeconds + Double(sampleCount) / Double(sampleRate)
        return continuous
    }
}

public enum RelaySafety {
    public static func mayReplaceCredential(pendingAssistance: Bool, proposed: String, stored: String?) -> Bool {
        !pendingAssistance || proposed.isEmpty || proposed == stored
    }
    public static func canRestoreWatchCoverage(_ reading: WatchReading, now: Date) -> Bool {
        reading.valid && Freshness.classify(measuredAt: reading.measuredAt, now: now, maxAge: 30) == .current
            && reading.endedAt <= now.addingTimeInterval(2)
    }
}

public enum Endpoint {
    public static func validate(_ text: String) throws -> URL {
        guard let url = URL(string: text), url.scheme?.lowercased() == "https",
              url.host != nil, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { throw CaptureError.invalidEndpoint }
        return url
    }
}

/// Every upload is an independently decodable PCM16 mono WAV; no dangling audio fragments.
public enum WAV {
    public static func encode(samples: [Int16], sampleRate: Int) throws -> Data {
        guard sampleRate > 0, sampleRate <= 192_000, samples.count <= 1_000_000 else {
            throw CaptureError.invalidAudio
        }
        var result = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            var little = value.littleEndian
            withUnsafeBytes(of: &little) { result.append(contentsOf: $0) }
        }
        let byteCount = UInt32(samples.count * 2)
        result.append(contentsOf: "RIFF".utf8); append(byteCount + 36)
        result.append(contentsOf: "WAVEfmt ".utf8); append(UInt32(16))
        append(UInt16(1)); append(UInt16(1)); append(UInt32(sampleRate))
        append(UInt32(sampleRate * 2)); append(UInt16(2)); append(UInt16(16))
        result.append(contentsOf: "data".utf8); append(byteCount)
        samples.forEach { append($0) }
        return result
    }
}
