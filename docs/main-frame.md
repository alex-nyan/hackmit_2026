# Shared officer main frame

`/control` owns one named officer and all device connections. `/officer` and
`/dispatch` show the shared instance beside the simulated patrol cars. `/hospital`
subscribes only after Dispatch requests medical assistance. All three roles work
on one deployment, and the existing localhost roots retain their pinned roles.

## Configuration

Use the existing Vercel Git project for this repository. Configure these variables
in both Preview and Production, then redeploy. Never use `NEXT_PUBLIC_` for service
credentials.

| Variable                            | Value                                                  |
| ----------------------------------- | ------------------------------------------------------ |
| `INSTANCE_NAMESPACE`                | A unique project name, for example `paw-patrol`        |
| `UPSTASH_REDIS_REST_URL`            | Upstash Redis REST endpoint                            |
| `UPSTASH_REDIS_REST_TOKEN`          | Upstash Redis REST token with GET/EVAL/SET access      |
| `LIVEKIT_URL`                       | LiveKit Cloud project's `wss://…livekit.cloud` URL     |
| `LIVEKIT_API_KEY`                   | LiveKit server API key                                 |
| `LIVEKIT_API_SECRET`                | LiveKit server API secret                              |
| `TRACCAR_URL`                       | Publicly reachable **HTTPS** Traccar base URL          |
| `TRACCAR_EMAIL`, `TRACCAR_PASSWORD` | Server-side Traccar credentials                        |
| `TRACCAR_DEVICE_IDS`                | Optional allowlist of tracked device IDs               |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`   | Existing public Mapbox token; allow the preview domain |

Copy the same service configuration into `.env.local` for all local role servers.
`INSTANCE_NAMESPACE` is required. Keys include the Vercel environment and preview
branch (deployment URL as fallback). Local processes share the `development` key;
they do not share Production state. Different preview branches are isolated.
Multiple local checkouts needing separate instances should use different names.

The new workflow is the default. `PAW_PATROL_BROADCAST_ENABLED=false` restores the
legacy demo screens, including their existing capture/join controls. The separate
`PAW_PATROL_DATA_MODE=live` root continues to use the authenticated incident system.
The new workflow never uses the legacy Blob or in-process incident stores for its
instance, GPS, scene clearance, heart readings, or media.

`/control` is unlisted and `noindex`, and intentionally does not require login.
The instance API is also accessible without the legacy shared passphrase so this
control page works as requested. Anyone knowing these URLs can read state, create
or explicitly replace an instance, and set coordination status. This is a demo
access model, not an authorization boundary. Existing unrelated routes keep
their access rules. A randomly generated controller secret is needed to publish
telemetry and obtain a publisher media token. It is held only by the creating tab
and stored hashed in Redis; snapshots never expose it.

## Demo flow

1. In Chrome on the Mac, open `/control`, enter a name, and **Create instance**.
2. Select camera and microphone. An iPhone appears when macOS makes it available
   through Continuity Camera. Device labels populate after capture permission;
   refresh the list or use Reconnect after making a new selection.
3. Refresh GPS devices and choose the officer's Traccar device. This inventory is
   Traccar-only; the Mac's geolocation and browser-published phone positions are
   never substituted. Start HeartCast and connect the watch on this controller.
4. **Start broadcast**. Camera and microphone request permission independently.
   You can uncheck either before starting. Missing sources do not block the rest.
   The controller's camera preview is always muted. Output selection and its test
   tone affect only local playback; unsupported browsers use system output.
5. Open `/officer` and `/dispatch` in other browsers. The named officer is separate
   from the patrol demo selector. Click the name or real GPS marker to view the
   feed and received heart samples. No GPS marker is invented if there is no fix.
6. In Dispatch, choose **Request medical assistance**. Hospital displays the same
   ID/name, video/audio, and 60-second heart trend. Scene access remains on Hold
   until a human explicitly reports clearance. Clear the request to empty Hospital.
7. **Stop broadcast** releases local tracks, Bluetooth, polling, and the media
   connection, ends the Redis instance, deletes its room, and clears Hospital.
   A failed room deletion can be retried with Stop. Replacement ends/revokes the
   previous instance before creating another.

Keep the controller open and the Mac awake. Refreshing or closing the controller
releases its browser resources and loses its ownership secret. Create an explicit
replacement to resume after a refresh. Viewers can refresh or join late without
changing the ID. Autoplay policies may require **Play feed** on a viewer before
camera/audio playback begins.

## State and transport

- Redis holds one bounded JSON record per namespace. Compare-and-set Lua scripts
  serialize concurrent requests across Vercel functions. No production memory
  fallback is used. Each instance expires 24 hours after creation, including when
  its controller continues sending heartbeats.
- Revision numbers come from the server. Per-command publisher sequences reject
  delayed writes while letting GPS requests run independently of heartbeat and
  watch updates. A replaced ID/secret cannot update the new instance.
- The controller sends a heartbeat every five seconds; snapshots derive Offline
  after 15 seconds without one. Viewers poll every second. Network failure removes
  the live display instead of treating cached safety/telemetry as current.
- Actual watch samples publish at most once per second, retain measurement receipt
  timestamps, age out after 60 seconds, and become stale after 30 seconds without
  a new sample. No synthetic samples or ECG traces are generated for an instance.
- Traccar is polled every five seconds. GPS retains coordinates, accuracy, and device
  fix time, using existing 90-second Live / 600-second Stale / Lost rules. Buffered
  older fixes cannot replace newer fixes. Selecting no device clears the source.
- Camera/audio go directly through LiveKit Cloud. Tokens are server-signed, last
  60 seconds for initial connection, and are restricted to the active room and
  publisher/viewer role. Hospital token requests require an active assignment.
  Viewer clients disconnect when assignment is removed or the instance ends.
  This version does not record media or request LiveKit recording/egress grants.

## Verification

The implementation includes lifecycle/concurrency tests, API ownership and token
checks, device permission/hot-unplug/late-capture cleanup tests, and role/scene
integration tests. Run the user-requested full repository verification with
`pnpm run verify` (this task's explicit validation request takes precedence over
the repository's temporary skip-tests guidance).

Before judging, exercise the hardware flow on the actual Vercel Preview:

- Mac camera and iPhone Continuity Camera, microphone, local output, HeartCast,
  and the selected Traccar device; deny one permission and unplug/reconnect a source.
- Two separate browsers and localhost role servers using the same development
  namespace; confirm identical IDs/names, late join, refresh, and partial inputs.
- Explicit replacement from a second controller; confirm the old controller stops.
- Hospital request/cancellation, and explicit unsafe/cleared reports independently.
- Close the controller and confirm Offline within 15 seconds plus one viewer poll.
- Confirm watch graph samples match received measurements and age out without fallback.

Provider-backed media and physical-device behavior require real configured services
and hardware; unit fixtures do not establish that those external systems are working.
