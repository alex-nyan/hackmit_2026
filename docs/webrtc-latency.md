# Live video and audio: implementation and deployment

The target is one Mac publisher and one remote viewer. Continue using the existing
iPhone Continuity camera. Vercel hosts the application and connection setup;
WebRTC sends media directly between the browsers, or through TURN when necessary.
No SFU account, media server, or new package is required for this change.

## What changed

- Camera discovery now uses a five-second publisher heartbeat independent of AI
  snapshots. Expired snapshots and slow inference no longer remove a healthy live
  connection. Presence expires after 20 seconds; the camera wall additionally
  preserves arriving media and tolerates brief discovery gaps.
- SDP is sent after at most a short host-candidate grace. Further ICE candidates
  are batched and sequenced while gathering continues, including slow TURN
  candidates that the old 1.5-second cutoff could lose.
- Every negotiation owns its peer ID, requests, candidate queues and timers.
  Setup expires after 15 seconds, temporary disconnects get a five-second grace,
  and stalled frames trigger recovery. Separate viewers can connect concurrently.
- Video retains its 720p/30 fps and 2 Mbps per-viewer ceilings. Multiple peers share
  a total 4 Mbps video payload budget. One viewer keeps the original 2 Mbps ceiling.
  Actual browser-applied limits and any failures are visible in diagnostics.
- The existing microphone can be shared live by explicitly enabling **Share live
  audio** after camera and audio transcription start. Sharing defaults off, resets
  after either capture session restarts, and does not create another microphone
  capture. Viewers enable **Listen to shared audio**. Changing audio sharing uses
  the negotiated audio sender without restarting video.
- **Stream diagnostics** reports route, video/audio bitrate, frame rate, RTT,
  buffering, encode/decode timings, limits and optional frame timing. Its copy
  button exports the last 60 samples per connection, kept only in the browser.
  It does not send diagnostics to a service. Missing browser fields are reported
  as unavailable. Network RTT and receiver buffering are not end-to-end latency.

Snapshots remain explicitly labelled as stills. Transcription still collects
3-second urgent or 10-second normal clips; live audio bypasses those clips. The
existing policy stops capture when its tab is backgrounded, so keep the publishing
tab visible during the comparison.

## Vercel handoff

1. Deploy the repository changes together, then reload both publisher and viewer
   pages so they use the same signaling protocol. There are no new dependencies
   or database migrations. Presence uses the existing private Blob store.
2. Verify **BLOB_READ_WRITE_TOKEN** exists in the Vercel environment being used
   (Preview and Production have separate settings). The existing frame and
   signaling features already require it. The new `/api/streams` response should
   contain `publishers`, `frames`, and availability flags. A 503
   `discovery-unavailable` means both shared storage reads failed.
3. Keep both browsers on the same deployed origin and retain the existing access
   gate. Public STUN is configured by default. If the two networks do not allow a
   direct route, configure `PAW_PATROL_TURN_URLS`, `PAW_PATROL_TURN_USERNAME`, and
   `PAW_PATROL_TURN_CREDENTIAL` in that deployment. Use a real reachable TURN
   service; Vercel's Next.js routes do not act as the media relay. The existing
   `.env.example` documents the URL formats.
4. Start the Continuity camera. Open its stream on the second laptop and confirm
   the tile says **LIVE**, not **Still**, **CONNECTING**, or **NO LIVE VIDEO**.
   Open diagnostics on both sides and confirm frame rate and bitrate advance.
5. If audio is wanted, start audio transcription, enable publisher sharing, then
   enable listening on the viewer. Turning sharing off must silence the remote
   track without stopping video or transcription. A capture restart must leave
   sharing off.

## Final device verification

Compare the same moving clock or flashing source against the receiving screen.
Record first-picture time separately from ongoing delay. Run the single viewer
for ten minutes and check that delay does not accumulate. Temporarily delay AI
responses beyond 20 seconds and verify the live video stays connected. Exercise
viewer reload, a brief network interruption, publisher stop/restart and audio
sharing on/off. Use diagnostics to distinguish a direct route from a relay and
copy both reports if delay remains.

The implementation was reviewed against the primary-source patterns linked in
[the research plan](webrtc-latency-plan.md). This is original integration code;
it does not vendor LiveKit or mediasoup source. Those projects' larger SFU
architectures remain unnecessary for the requested one-viewer setup.

Local verification covers type checking, scoped lint/format checks, browser UI
and unavailable-storage behavior. The local development app has no working
shared Blob configuration, so actual Continuity-to-remote-laptop latency and TURN
connectivity still require verification on the configured deployment. No latency
number is claimed from the local preview. Test suites were not authored or run,
following the repository's active hackathon instructions.
