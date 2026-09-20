# iPhone + Apple Watch capture

Concrete native capture clients for the authenticated v2 incident pipeline. Local inference runs on the configured laptop/vehicle host; neither app contains or downloads an ML model.

## What is implemented

- iOS 17+: foreground AVFoundation camera (portrait pixels, 640×480 capture, JPEG, at most 5 frames/s), microphone (complete 2-second mono PCM16 WAV chunks at the actual input sample rate), Core Location fixes with original times and accuracy, and device availability.
- watchOS 10+: explicitly started **walking workout**, HealthKit live heart-rate statistics with their actual sample interval, and workout-session mirroring to the paired iPhone. The wearer must really be walking for exercise; this is not an all-shift monitoring workaround. The app saves the chosen walking workout to HealthKit.
- A mirrored sample carries a Watch session boot ID, monotonic sequence, sample ID and measurement time. Phone-generated health records use a separate boot stream. The backend enrollment, never a client-selected face or patient, owns wearer identity.
- Separate HTTPS upload lanes for latest video, bounded audio and telemetry, plus a separate assistance connection. System certificate verification is retained and all redirects are refused. The source token is stored in Keychain with `AfterFirstUnlockThisDeviceOnly`; it is never logged or embedded in this project.
- Explicit stale/unavailable/disconnected states and measurement age. Lock/background or **Stop capture** stops new camera, audio, GPS and Watch sample sharing and clears pending sample uploads. Availability reports can finish; an already received server upload cannot be recalled. The Watch workout remains independently controlled on the Watch. The operator explicitly resumes sharing after returning to the foreground.
- An assistance button uses a stable idempotency key while a request is pending. Destination and credential changes are blocked until that request is resolved. Only a validated server receipt is labeled received. Team acknowledgment is separate. This button does not invoke emergency services or Apple Emergency SOS.

## Open and enroll

1. Install full Xcode 16 or newer with iOS/watchOS SDKs. Open `SafetyCapture.xcodeproj`. Its two shared schemes are `SafetyCapture` and `SafetyWatch`. The project is checked in; no XcodeGen install is needed. Regenerate it after adding/removing Swift files with `python3 scripts/generate_project.py`.
2. Select your signing team on **both targets**. Change `PRODUCT_BUNDLE_IDENTIFIER` values to your registered IDs and change `WKCompanionAppBundleIdentifier` in `Config/Watch-Info.plist` to the iPhone ID. Enable HealthKit on the two registered app IDs. Pair an iPhone and Apple Watch; select the phone for the `SafetyCapture` scheme, build/install, and install the companion Watch target as needed. Provisioning and device pairing require the operator's Apple development account.
3. Put an HTTPS endpoint in front of the Python service with a certificate trusted by the iPhone. A local hostname works when the device trusts its issuing CA. There is intentionally no arbitrary HTTP/ATS bypass or disabled certificate validation. Browser proxy cookies are not used by this app.
4. Configure the backend source principal with an incident and explicit source scopes. With the default fields, enroll `iphone-01-camera` as `camera`, `iphone-01-microphone` as `microphone`, `iphone-01-gps` as `gps`, `iphone-01-device` as `device`, and `watch-01` as `watch`. The Watch enrollment requires the consenting `wearer_id` and `wearer_role` (`responder` or `patient`). A patient Watch additionally requires an explicit `live_patients` enrollment whose `patient_id` matches `wearer_id` and whose `incident_id` matches the Watch incident; unmatched enrollment is rejected. Hospital access requires both the Watch `source_id` grant and the matching `patient_ids` grant; an empty patient grant exposes no patients. Put all five source IDs in the source principal's scope. The configured token must be ASCII without whitespace and at least 32 characters.
5. In the iPhone app, enter the HTTPS **origin**, incident ID, phone source prefix, Watch source ID and source token. Start foreground capture and grant camera, microphone, location and local-network permissions. Denied channels remain unavailable; missing data never becomes demo data.
6. On the Watch, read the purpose text and choose **Start walking workout** while actually doing that activity. Grant heart-rate read/workout write permissions. End the workout when the activity ends. HealthKit does not tell the app whether absent read data means denied access; the display correctly remains “No sample available.”
7. Open the live incident dashboard and verify each enrolled source, wearer, evidence and receipt. An HTTP admission receipt does not establish that inference completed; inference status belongs to the dashboard/service.

The app does not disable phone auto-lock. A mounted foreground phone must remain unlocked to preserve sharing. There is no background audio or location mode in the iPhone target. Watch workout mirroring may wake a suspended phone periodically and deliver old batches; this is not guaranteed continuous transport. Samples arriving while sharing is paused are not forwarded; old samples delivered after resuming retain their original times. The enrolled destination/Watch association is locked for the active mirrored workout, including reconnections. End the workout and let the phone receive its ended state before changing the destination; callbacks from replaced sessions cannot release that lock or forward samples.

## Wire and bounds

`Sources/CaptureCore/WireModels.swift` matches `services/triage/triage/live_schemas.py` and the v2 media envelope. The transport sends JSON, not multipart. JPEG/WAV media is base64 only inside the bounded ingest request; it is never placed in an SSE message.

| Path                               | Body                                                                              | Bound / failure behavior                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v2/ingest/media`            | schema, incident/source/boot IDs, sequence, capture time, kind, MIME type, base64 | Latest pending frame; ≤2-second frame age. Three pending 2-second audio clips; ≤8-second audio age. Independent workers. Admission failure discards that packet; later captures retain sequence gaps. |
| `POST /v2/ingest/telemetry`        | incident/source and one typed sample                                              | 64 pending packets, ≤120-second replay age. Old Watch samples stay historical. Queue evictions are displayed; sequence gaps remain visible.                                                           |
| `POST /v2/incidents/{id}/commands` | `kind: assistance`, enrolled device source ID, note                               | Independent request/connection; stable pending idempotency key on an uncertain receipt. No speculative success.                                                                                       |

Every HTTP request has a 5-second request timeout and 8-second resource timeout; receipt bodies are streamed with a hard 64 KiB cap. The client never accumulates infinite offline media. Pending media is memory-only and cleared when capture pauses; raw media is not written to Photos, app files or logs. The Watch retains at most 16 pending samples and allows one remote send at a time. There is no invented optical-quality score, clinical alarm rule, diagnosis, facial identity, intent inference, blood pressure, ECG or oxygen saturation channel.

The 30-second heart-rate “stale” label is a display freshness choice, not a clinical threshold or promise of Apple sampling cadence. Only a fresh sample from the current running workout restores interrupted Watch availability. Audio buffers also check host-time continuity so omitted buffers cannot be joined into an apparently continuous WAV. Device clocks are preserved but this implementation does not claim calibrated cross-device synchronization; do not derive precise simultaneous audiovisual/physiological conclusions from these clocks. The backend never uses Watch readings to infer threat or medical stability.

## Validation and build status

Run the normal platform-independent tests with a working Xcode Swift toolchain:

```sh
swift test --package-path apps/apple-capture
```

On a host with only Command Line Tools, the runnable verification fallback compiles the **production** core and checks wire keys, preserved measurement time, stale/future/missing readings, bounded eviction, HTTPS endpoint restrictions, WAV encoding and host-clock mapping:

```sh
apps/apple-capture/scripts/verify-core.sh
# Optional: write a real Swift-encoded telemetry fixture for backend contract verification
apps/apple-capture/scripts/verify-core.sh /tmp/watch-wire.json
```

Project and syntax checks:

```sh
python3 apps/apple-capture/scripts/generate_project.py
plutil -lint apps/apple-capture/SafetyCapture.xcodeproj/project.pbxproj
swiftc -frontend -parse apps/apple-capture/iOS/*.swift apps/apple-capture/Watch/*.swift apps/apple-capture/Sources/CaptureCore/*.swift
xcodebuild -project apps/apple-capture/SafetyCapture.xcodeproj -scheme SafetyCapture -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apps/apple-capture/SafetyCapture.xcodeproj -scheme SafetyWatch -destination 'generic/platform=watchOS' CODE_SIGNING_ALLOWED=NO build
```

**Current host limitation:** only `/Library/Developer/CommandLineTools` is selected; iOS/watchOS SDKs and XCTest are absent. This host's SwiftPM PackageDescription binary also fails to link a package manifest. The core can be compiled directly. Native source syntax and plist validity can be checked here, but iOS/watchOS SDK type checking, code signing, installation and on-device behavior must be verified with full Xcode and the actual paired hardware. Do not treat a parser-only check as a successful native build.

Before operational use, record paired-device results for permission denial/revocation, phone lock/app switch, incoming call/route changes, Watch disconnect/paused workout, clock changes, stale batches, source reassignment, malformed credentials, untrusted TLS, network loss/reconnect, thermal load, backend queue rejection and uncertain assistance responses. Verify a responder's Watch can never populate a patient record. Measure capture-to-render latency on the actual phone/host before claiming performance. App Store privacy disclosures and the declared required-reason API purposes need review for the final distribution and deployment.

## Apple primary references checked during implementation

- [Mirrored workout start handler](https://developer.apple.com/documentation/healthkit/hkhealthstore/workoutsessionmirroringstarthandler): install at launch and retain each provided session; reconnection can supply a new instance.
- [Send to remote workout session](<https://developer.apple.com/documentation/healthkit/hkworkoutsession/sendtoremoteworkoutsession(data:completion:)>): current Swift API is `sendToRemoteWorkoutSession(data:)`, not the informal label in the earlier architecture plan.
- [Receive remote data](<https://developer.apple.com/documentation/healthkit/hkworkoutsessiondelegate/workoutsession(_:didreceivedatafromremoteworkoutsession:)>): iOS suspension can delay delivery by minutes.
- [Most recent measurement interval](<https://developer.apple.com/documentation/healthkit/hkstatistics/mostrecentquantitydateinterval()>): use the measured interval, not delegate or upload time.
- [Background camera interruption](https://developer.apple.com/documentation/avfoundation/avcapturesession/interruptionreason/videodevicenotavailableinbackground).
- [Building a multidevice workout app](https://developer.apple.com/documentation/healthkit/building-a-multidevice-workout-app).
