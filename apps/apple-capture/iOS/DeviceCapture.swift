import AVFoundation
import CoreImage
import CoreLocation
import UIKit

/// All capture session mutations occur on sessionQueue. JPEG encoding is cadence-limited before allocation.
final class CameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    var onFrame: ((Data, Date) -> Void)?
    var onState: ((String, String) -> Void)?
    private let sessionQueue = DispatchQueue(label: "capture.camera")
    private let context = CIContext(options: [.cacheIntermediates: false])
    private var configured = false
    private var lastPTS: Double = -.infinity
    private var clock: CaptureClock?
    private var observers: [NSObjectProtocol] = []

    override init() {
        super.init()
        observers.append(NotificationCenter.default.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil) { [weak self] _ in
            self?.onState?("interrupted", "camera_interrupted")
        })
        observers.append(NotificationCenter.default.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) { [weak self] _ in
            self?.onState?("unavailable", "camera_runtime_error")
        })
    }

    func start() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            do {
                if !configured {
                    session.beginConfiguration()
                    defer { session.commitConfiguration() }
                    session.sessionPreset = .vga640x480
                    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { throw RelayError.invalidConfiguration }
                    let input = try AVCaptureDeviceInput(device: device)
                    let output = AVCaptureVideoDataOutput()
                    output.alwaysDiscardsLateVideoFrames = true
                    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
                    output.setSampleBufferDelegate(self, queue: sessionQueue)
                    guard session.canAddInput(input), session.canAddOutput(output) else { throw RelayError.invalidConfiguration }
                    session.addInput(input); session.addOutput(output)
                    // Physically rotate pixels; boxes refer to this exact portrait JPEG.
                    if let connection = output.connection(with: .video), connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
                    configured = true
                }
                clock = CaptureClock(wallAnchor: Date(), monotonicAnchor: CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())))
                lastPTS = -.infinity
                session.startRunning()
                // Available is sent only by an actual fresh frame callback.
            } catch { onState?("unavailable", "camera_configuration_failed") }
        }
    }

    func stop(reason: String) {
        onState?("unavailable", reason)
        sessionQueue.async { [weak self] in self?.session.stopRunning(); self?.clock = nil }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        guard pts.isFinite, pts - lastPTS >= 0.2, let clock,
              let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastPTS = pts
        let image = CIImage(cvPixelBuffer: buffer)
        guard let data = context.jpegRepresentation(of: image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.65]) else { return }
        onFrame?(data, clock.date(at: pts))
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver) }
}

final class MicrophoneCapture {
    var onAudio: ((Data, Date) -> Void)?
    var onState: ((String, String) -> Void)?
    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "capture.audio")
    private var samples: [Int16] = []
    private var startedAt: Date?
    private var sampleRate = 48_000
    private var running = false
    private var observers: [NSObjectProtocol] = []
    private var clock = CaptureClock()
    private let processingSlot = DispatchSemaphore(value: 1)
    private let gapLock = NSLock()
    private var pendingGap = false
    private var continuity = AudioContinuity()

    init() {
        for notification in [AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: notification, object: nil, queue: nil) { [weak self] _ in
                self?.stop(reason: "audio_interrupted_or_route_changed_restart_required")
            })
        }
    }
    func start() {
        queue.async { [weak self] in
            guard let self, !running else { return }
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker])
                try session.setActive(true)
                let input = engine.inputNode
                let format = input.outputFormat(forBus: 0)
                guard format.sampleRate > 0, format.channelCount > 0 else { throw CaptureError.invalidAudio }
                sampleRate = Int(format.sampleRate)
                clock = CaptureClock(wallAnchor: Date(), monotonicAnchor: AVAudioTime.seconds(forHostTime: mach_absolute_time()))
                samples.removeAll(); startedAt = nil
                continuity = AudioContinuity()
                input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, time in
                    // Copy on the tap callback; AVAudioPCMBuffer storage is only valid during this callback.
                    guard let self, let channels = buffer.floatChannelData else { return }
                    guard processingSlot.wait(timeout: .now()) == .success else {
                        gapLock.lock(); pendingGap = true; gapLock.unlock()
                        return
                    }
                    let count = Int(buffer.frameLength)
                    let channelCount = Int(buffer.format.channelCount)
                    var copied = [Int16](); copied.reserveCapacity(count)
                    for index in 0..<count {
                        var value: Float = 0
                        for channel in 0..<channelCount { value += channels[channel][index] }
                        value /= Float(channelCount)
                        copied.append(Int16(max(-1, min(1, value.isFinite ? value : 0)) * 32767))
                    }
                    let hostSeconds = time.isHostTimeValid ? AVAudioTime.seconds(forHostTime: time.hostTime) : nil
                    // The serial block handles <0.1 s of samples and does no network I/O.
                    queue.async { [weak self] in
                        guard let self else { return }
                        defer { processingSlot.signal() }
                        gapLock.lock(); let gap = pendingGap; pendingGap = false; gapLock.unlock()
                        if gap {
                            samples.removeAll(); startedAt = nil
                            onState?("interrupted", "audio_capture_overload_gap")
                        }
                        consume(copied, hostSeconds: hostSeconds)
                    }
                }
                engine.prepare(); try engine.start(); running = true
            } catch {
                engine.stop(); engine.inputNode.removeTap(onBus: 0)
                onState?("unavailable", "microphone_configuration_failed")
            }
        }
    }
    private func consume(_ newSamples: [Int16], hostSeconds: Double?) {
        guard running, let hostSeconds else { return }
        if !continuity.accept(hostSeconds: hostSeconds, sampleCount: newSamples.count, sampleRate: sampleRate) {
            samples.removeAll(); startedAt = nil
            onState?("interrupted", "audio_host_timestamp_gap")
        }
        if startedAt == nil { startedAt = clock.date(at: hostSeconds) }
        samples.append(contentsOf: newSamples)
        let chunkSize = sampleRate * 2
        while samples.count >= chunkSize {
            let chunk = Array(samples.prefix(chunkSize)); samples.removeFirst(chunkSize)
            if let startedAt, let wav = try? WAV.encode(samples: chunk, sampleRate: sampleRate) { onAudio?(wav, startedAt) }
            startedAt = startedAt?.addingTimeInterval(2)
        }
    }
    func stop(reason: String) {
        onState?("interrupted", reason)
        queue.async { [weak self] in
            guard let self, running else { return }
            engine.stop(); engine.inputNode.removeTap(onBus: 0); running = false
            samples.removeAll(); startedAt = nil
            continuity = AudioContinuity()
        }
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver) }
}

@MainActor
final class LocationCapture: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    var onFix: ((CLLocation, Bool) -> Void)?
    var onState: ((String, String) -> Void)?
    override init() {
        super.init(); manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.pausesLocationUpdatesAutomatically = true
    }
    func start() {
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
    }
    func stop() { manager.stopUpdatingLocation(); onState?("unavailable", "location_stopped") }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last, latest.horizontalAccuracy >= 0 else { return }
        onFix?(latest, manager.accuracyAuthorization == .reducedAccuracy)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        onState?("unavailable", "location_unavailable")
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            onState?("unavailable", "location_permission_denied")
        }
    }
}
