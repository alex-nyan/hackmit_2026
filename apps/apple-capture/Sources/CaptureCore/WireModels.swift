import Foundation

public struct TelemetrySample<Value: Encodable>: Encodable {
    public let sample_id: String
    public let boot_id: String
    public let sequence: Int
    public let measured_at: Date
    public let kind: String
    public let value: Value
    public init(sampleID: String = UUID().uuidString, bootID: String, sequence: Int,
                measuredAt: Date, kind: String, value: Value) {
        sample_id = sampleID; boot_id = bootID; self.sequence = sequence
        measured_at = measuredAt; self.kind = kind; self.value = value
    }
}

public struct TelemetryRequest<Value: Encodable>: Encodable {
    public let schema_version = "2.0"
    public let incident_id: String
    public let source_id: String
    public let samples: [TelemetrySample<Value>]
    public init(incidentID: String, sourceID: String, samples: [TelemetrySample<Value>]) {
        incident_id = incidentID; source_id = sourceID; self.samples = samples
    }
}

public struct HeartRateValue: Encodable {
    public let bpm: Double
    public let unit = "bpm"
    public let measurement_origin = "watch_healthkit"
    public let signal_quality = "unknown"
    public let measured_until: Date?
    public let session_mode = "user_started_walking_workout"
    public let sample_origin = "healthkit_live_workout_statistics"
    public init(bpm: Double, measuredUntil: Date? = nil) { self.bpm = bpm; measured_until = measuredUntil }
}

public struct LocationValue: Encodable {
    public let latitude: Double
    public let longitude: Double
    public let horizontal_accuracy_m: Double
    public let speed_mps: Double?
    public let course_degrees: Double?
    public init(latitude: Double, longitude: Double, accuracy: Double, speed: Double?, course: Double?) {
        self.latitude = latitude; self.longitude = longitude; horizontal_accuracy_m = accuracy
        speed_mps = speed; course_degrees = course
    }
}

public struct SourceHealthValue: Encodable {
    public let availability: String
    public let reason: String?
    public let battery_fraction: Double?
    public init(availability: String, reason: String?, battery: Double? = nil) {
        self.availability = availability; self.reason = reason; battery_fraction = battery
    }
}

public struct MediaRequest: Encodable {
    public let schema_version = "2.0"
    public let incident_id: String
    public let source_id: String
    public let boot_id: String
    public let sequence: Int
    public let captured_at: Date
    public let media_type: String
    public let kind: String
    public let data_base64: String
    public init(incidentID: String, sourceID: String, bootID: String, sequence: Int,
                capturedAt: Date, mediaType: String, kind: String, data: Data) {
        incident_id = incidentID; source_id = sourceID; boot_id = bootID; self.sequence = sequence
        captured_at = capturedAt; media_type = mediaType; self.kind = kind
        data_base64 = data.base64EncodedString()
    }
}

public struct AssistanceCommand: Encodable {
    public let kind = "assistance"
    public let source_id: String
    public let note: String
    public init(sourceID: String, note: String) { source_id = sourceID; self.note = note }
}

public struct TelemetryReceipt: Decodable {
    public struct Result: Decodable {
        public let sample_id: String
        public let status: String
        public let observation_id: String
        public let warnings: [String]
    }
    public let schema_version: String
    public let incident_id: String
    public let revision: Int
    public let results: [Result]
    public func validates(incidentID: String, sampleIDs: Set<String>) -> Bool {
        schema_version == "2.0" && incident_id == incidentID && revision >= 0
            && results.count == sampleIDs.count && Set(results.map(\.sample_id)) == sampleIDs
            && results.allSatisfy { ["accepted", "historical", "duplicate"].contains($0.status) && !$0.observation_id.isEmpty }
    }
}

public struct TelemetryIdentity: Decodable {
    public struct Sample: Decodable { public let sample_id: String }
    public let incident_id: String
    public let samples: [Sample]
}

public struct MediaReceipt: Decodable {
    public let schema_version: String
    public let incident_id: String
    public let media_id: String
    public let source_id: String
    public let kind: String
    public let status: String
    public let processing_semantics: String
    public func validates(incidentID: String, sourceID: String, kind: String) -> Bool {
        schema_version == "2.0" && incident_id == incidentID && source_id == sourceID
            && self.kind == kind && !media_id.isEmpty && ["accepted", "replaced", "duplicate"].contains(status)
            && processing_semantics == "admitted_not_processed"
    }
}

public struct AssistanceReceipt: Decodable {
    public let schema_version: String
    public let incident_id: String
    public let command_id: String
    public let revision: Int
    public let alert_id: String?
    public func validates(incidentID: String) -> Bool {
        schema_version == "2.0" && incident_id == incidentID && !command_id.isEmpty
            && (0...9_007_199_254_740_991).contains(revision) && alert_id?.isEmpty == false
    }
}
