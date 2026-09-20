import Foundation
import Security
import Combine

struct CaptureConfiguration: Codable, Equatable {
    var endpoint = ""
    var incidentID = "incident-demo"
    var sourcePrefix = "iphone-01"
    var watchSourceID = "watch-01"
    func source(_ component: String) -> String { "\(sourcePrefix)-\(component)" }
    func validate() throws {
        _ = try Endpoint.validate(endpoint)
        let pattern = "^[A-Za-z0-9_.:-]{1,100}$"
        guard [incidentID, sourcePrefix, watchSourceID].allSatisfy({ $0.range(of: pattern, options: .regularExpression) != nil }) else {
            throw RelayError.invalidConfiguration
        }
    }
}

enum RelayError: LocalizedError {
    case invalidConfiguration, missingToken, status(Int), invalidReceipt, pendingAssistance, watchBindingLocked
    var errorDescription: String? {
        switch self {
        case .invalidConfiguration: return "Use an HTTPS origin and valid enrolled incident/source IDs."
        case .missingToken: return "Enter the source credential."
        case .status(let code): return "Server rejected the request (HTTP \(code))."
        case .invalidReceipt: return "Server receipt could not be verified."
        case .pendingAssistance: return "Retry the pending assistance request before changing its destination."
        case .watchBindingLocked: return "End the existing Watch workout before changing the enrolled destination or Watch association."
        }
    }
}

enum CredentialStore {
    private static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "org.hackmit.capture.relay",
        kSecAttrAccount as String: "source-token"
    ]
    static func save(_ token: String) throws {
        guard token.count >= 32, token.utf8.allSatisfy({ $0 > 32 && $0 < 127 }) else { throw RelayError.missingToken }
        var item = base
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let update = SecItemUpdate(base as CFDictionary, [kSecValueData as String: Data(token.utf8)] as CFDictionary)
        let status = update == errSecItemNotFound ? SecItemAdd(item as CFDictionary, nil) : update
        guard status == errSecSuccess else { throw RelayError.missingToken }
    }
    static func read() -> String? {
        var query = base; query[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// Refuse redirects and stop reading after 64 KiB: only small receipts belong on this channel.
final class CappedHTTPClient: NSObject, URLSessionDataDelegate {
    private final class Cancellation: @unchecked Sendable {
        private let lock = NSLock()
        private var task: URLSessionDataTask?
        private var cancelled = false
        func install(_ task: URLSessionDataTask) {
            lock.lock(); self.task = task; let shouldCancel = cancelled; lock.unlock()
            if shouldCancel { task.cancel() }
        }
        func cancel() {
            lock.lock(); cancelled = true; let task = task; lock.unlock()
            task?.cancel()
        }
    }
    private struct Pending {
        let continuation: CheckedContinuation<Data, Error>
        var data = Data()
        var response: HTTPURLResponse?
    }
    private let lock = NSLock()
    private var pending: [Int: Pending] = [:]
    private let maximumReceiptBytes = 65_536
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 5
        config.timeoutIntervalForResource = 8
        config.httpMaximumConnectionsPerHost = 1
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    func send(_ request: URLRequest) async throws -> Data {
        let cancellation = Cancellation()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let task = session.dataTask(with: request)
                lock.lock(); pending[task.taskIdentifier] = Pending(continuation: continuation); lock.unlock()
                cancellation.install(task)
                task.resume()
            }
        } onCancel: { cancellation.cancel() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse,
              response.expectedContentLength <= maximumReceiptBytes else { completionHandler(.cancel); return }
        lock.lock(); pending[dataTask.taskIdentifier]?.response = response; lock.unlock()
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let size = (pending[dataTask.taskIdentifier]?.data.count ?? 0) + data.count
        if size <= maximumReceiptBytes { pending[dataTask.taskIdentifier]?.data.append(data) }
        lock.unlock()
        if size > maximumReceiptBytes { dataTask.cancel() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock(); let result = pending.removeValue(forKey: task.taskIdentifier); lock.unlock()
        guard let result else { return }
        if let error { result.continuation.resume(throwing: error) }
        else if let response = result.response, (200..<300).contains(response.statusCode) { result.continuation.resume(returning: result.data) }
        else { result.continuation.resume(throwing: RelayError.status(result.response?.statusCode ?? 0)) }
    }
}

@MainActor
final class RelayClient: ObservableObject {
    enum Lane: String, CaseIterable { case video, audio, telemetry }
    struct Packet {
        let data: Data
        let path: String
        let capturedAt: Date
        let id: UUID
    }
    @Published private(set) var status = "Not connected — AI coverage unavailable"
    @Published private(set) var assistanceStatus = "No assistance request sent"
    @Published private(set) var droppedVideo = 0
    @Published private(set) var droppedAudio = 0
    @Published private(set) var droppedTelemetry = 0
    @Published private(set) var lastReceiptAt: Date?
    private(set) var configuration: CaptureConfiguration?
    private var queues: [Lane: BoundedQueue<Packet>] = [
        .video: BoundedQueue(capacity: 1), .audio: BoundedQueue(capacity: 3), .telemetry: BoundedQueue(capacity: 64)
    ]
    private var workers: [Lane: Task<Void, Never>] = [:]
    private var sessions: [Lane: CappedHTTPClient] = Dictionary(uniqueKeysWithValues: Lane.allCases.map { ($0, CappedHTTPClient()) })
    private let commandSession = CappedHTTPClient()
    private var pendingAssistance: (id: UUID, body: Data)?
    private var assistanceInFlight = false
    private var generation = UUID()

    func validateConfigurationChange(_ configuration: CaptureConfiguration, token: String) throws {
        guard pendingAssistance == nil || self.configuration == configuration,
              RelaySafety.mayReplaceCredential(pendingAssistance: pendingAssistance != nil,
                                               proposed: token, stored: CredentialStore.read()) else {
            throw RelayError.pendingAssistance
        }
    }

    func configure(_ configuration: CaptureConfiguration) throws {
        try configuration.validate()
        guard CredentialStore.read() != nil else { throw RelayError.missingToken }
        guard pendingAssistance == nil || self.configuration == configuration else { throw RelayError.pendingAssistance }
        stop()
        self.configuration = configuration
        status = "Configured — awaiting server receipt"
    }

    func stop() {
        generation = UUID()
        workers.values.forEach { $0.cancel() }; workers.removeAll()
        for lane in Lane.allCases { queues[lane]?.removeAll() }
        status = "Capture stopped — AI coverage unavailable"
    }

    func pauseMedia() {
        // Cancel current uploads and drop all pre-pause samples, including queued Watch readings.
        // New unavailable-health reports and assistance remain independent.
        generation = UUID()
        workers.values.forEach { $0.cancel() }; workers.removeAll()
        queues[.video]?.removeAll(); queues[.audio]?.removeAll(); queues[.telemetry]?.removeAll()
        let currentGeneration = generation
        workers[.telemetry] = Task { await drain(.telemetry, generation: currentGeneration) }
        status = "Capture paused — AI visual/audio coverage unavailable"
    }

    func enqueue<T: Encodable>(_ body: T, lane: Lane, capturedAt: Date) {
        guard configuration != nil else { return }
        do {
            let data = try Wire.encoder().encode(body)
            let packet = Packet(data: data, path: lane == .telemetry ? "/v2/ingest/telemetry" : "/v2/ingest/media",
                                capturedAt: capturedAt, id: UUID())
            queues[lane]?.append(packet)
            updateDrops()
            if workers[lane] == nil {
                let currentGeneration = generation
                workers[lane] = Task { await drain(lane, generation: currentGeneration) }
            }
        } catch { status = "Invalid sample — not uploaded" }
    }

    private func updateDrops() {
        droppedVideo = queues[.video]?.dropped ?? 0
        droppedAudio = queues[.audio]?.dropped ?? 0
        droppedTelemetry = queues[.telemetry]?.dropped ?? 0
    }

    private func drain(_ lane: Lane, generation: UUID) async {
        defer { if self.generation == generation { workers[lane] = nil } }
        while !Task.isCancelled, self.generation == generation, let packet = queues[lane]?.popFirst() {
            // Outage backfill remains bounded. Expired media is never replayed as live inference.
            let maxAge: TimeInterval = lane == .telemetry ? 120 : lane == .video ? 2 : 8
            if Date().timeIntervalSince(packet.capturedAt) > maxAge { continue }
            do {
                let receipt = try await send(packet, session: sessions[lane]!)
                if lane == .telemetry {
                    let parsed = try Wire.decoder().decode(TelemetryReceipt.self, from: receipt)
                    let submitted = try Wire.decoder().decode(TelemetryIdentity.self, from: packet.data)
                    guard parsed.validates(incidentID: submitted.incident_id, sampleIDs: Set(submitted.samples.map(\.sample_id))) else { throw RelayError.invalidReceipt }
                } else {
                    let parsed = try Wire.decoder().decode(MediaReceipt.self, from: receipt)
                    guard let configuration, parsed.validates(incidentID: configuration.incidentID,
                        sourceID: configuration.source(lane == .video ? "camera" : "microphone"),
                        kind: lane == .video ? "frame" : "audio") else { throw RelayError.invalidReceipt }
                }
                guard self.generation == generation, !Task.isCancelled else { return }
                lastReceiptAt = Date()
                status = "Host receiving data — inference availability shown on dashboard"
            } catch {
                guard !Task.isCancelled else { return }
                status = "Uploader disconnected/rejected — AI coverage unavailable"
                // No unbounded retry or silent storage. Sequence gaps expose lost audio/samples.
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private func send(_ packet: Packet, session: CappedHTTPClient) async throws -> Data {
        guard let configuration, let token = CredentialStore.read() else { throw RelayError.missingToken }
        let endpoint = try Endpoint.validate(configuration.endpoint)
        var request = URLRequest(url: endpoint.appendingPathComponent(packet.path))
        request.httpMethod = "POST"; request.httpBody = packet.data
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(packet.id.uuidString, forHTTPHeaderField: "Idempotency-Key")
        return try await session.send(request)
    }

    func requestAssistance() async {
        guard !assistanceInFlight, let configuration else { return }
        assistanceInFlight = true
        defer { assistanceInFlight = false }
        do {
            // Preserve the same id/body after an uncertain response: a retry cannot duplicate the command.
            if pendingAssistance == nil {
                pendingAssistance = (UUID(), try Wire.encoder().encode(AssistanceCommand(
                    sourceID: configuration.source("device"), note: "Assistance requested by the iPhone capture operator")))
            }
            guard let pendingAssistance else { return }
            assistanceStatus = "Sending — no server acknowledgment yet"
            let data = try await send(Packet(data: pendingAssistance.body,
                path: "/v2/incidents/\(configuration.incidentID)/commands", capturedAt: Date(), id: pendingAssistance.id), session: commandSession)
            let receipt = try Wire.decoder().decode(AssistanceReceipt.self, from: data)
            guard receipt.validates(incidentID: configuration.incidentID) else { throw RelayError.invalidReceipt }
            assistanceStatus = "Server received request (revision \(receipt.revision)); responder acknowledgment is separate"
            self.pendingAssistance = nil
        } catch {
            assistanceStatus = "Receipt unknown/failed. Tap again to retry the same request. Use established emergency channels."
        }
    }
}
