# Hospital media input

The demo hospital workspace fills the first viewport with officer video/audio. A transparent heart-rate graph is drawn directly over the top right of the footage, and a red or green perimeter reflects the existing scene-access state. The officer name appears directly on the footage. Officer selection, connections, activity details and workspace navigation sit below the video. With no camera attached it renders an empty feed. It does not request the hospital browser's camera or microphone.

`PawPatrol` accepts an optional `officerMedia` prop. A future receiving adapter (for example, a WebRTC receiver) supplies the remote stream from a client component:

```tsx
<PawPatrol
  workspace="hospital"
  officerMedia={{ personId: selectedOfficerId, stream: remoteStream }}
/>
```

The `OfficerMediaInput` type is exported from `features/paw-patrol/OfficerFeed.tsx`. Input is rendered only when its `personId` matches the selected officer. Pass `null` on a transport disconnect; supply a new stream when reconnecting. A stream may contain video, audio, or both. Video and audio play together, without a separate audio toggle. If the browser blocks audible autoplay, an unboxed Play feed control starts playback. The player handles ended/muted/removed tracks and detaches old media on selection changes and unmount. The adapter owns track cleanup; the player never stops a shared stream's tracks.

This is the display connection point, not a transport or signaling server. No raw video/audio is presently relayed by the demo incident bus. The existing camera-triage pipeline remains unchanged; its selected-officer audio concern reports appear below the player, with provenance retained in Activity & source details. These reports are selective model output, not a complete live transcript.

The access indicator consumes the existing demo bus's latest operator scene report. It is green only for an explicit `Scene reported cleared` event while the bus is connected. Model results cannot clear access; a disconnected bus returns to unconfirmed. This demo bus is not an authenticated operational clearance channel. The separate authenticated live-incident workspace is unchanged.

HeartCast/Bluetooth controls remain local and opt-in under Connections at the page bottom. Device readings retain the existing stale-data handling and are not sent to the incident bus. Preview readings are labeled Preview and are never mixed into received device history.

The monitor refreshes its rolling 60-second window every second, independently of patrol playback. Preview mode uses an explicitly labeled display-only series. In device mode only received samples are plotted, old points age out, and gaps longer than five seconds remain disconnected; the display never invents watch measurements. Switching officer or resetting the session remounts the monitor clock.
