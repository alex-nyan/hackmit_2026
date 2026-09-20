# iPhone body camera: scan, start, watch

Use the **Camera & audio** button at the bottom right of the dashboard. It embeds
the hosted VDO.Ninja receiving player. This workflow needs no LiveKit, Redis,
Blob, or TURN credentials and does not depend on PR #20. It still uses WebRTC;
WebRTC supports audio and video. The legacy implementation in this repository
explicitly publishes video only and mutes its receiving video element.

## Recommended demo: pair the iPhone directly

1. On the receiving Mac, open the dashboard and click **Camera & audio → Pair iPhone**.
2. Scan the QR code with the iPhone Camera app and open it in Safari. The link
   already identifies the session this dashboard is receiving; no copying or
   pasting is required.
3. Allow camera and microphone access. Confirm the rear camera and select a
   microphone (not **No Audio**), then tap **Start**.
4. Video and sound appear in the dashboard automatically. Enable sound in the
   embedded player if prompted. Click **Hide QR code** and expand the panel for
   the demo. Use headphones on the receiving Mac.
5. Strap the phone on with its rear camera facing outward and microphone clear.
   Keep Safari in the foreground and the phone unlocked and awake. This direct
   broadcasting mode does not use Continuity Camera or require a publishing Mac.

Pairing creates a random stream ID and password, embedded in both the sender
and viewer links. The QR points directly to HTTPS VDO.Ninja, so even a dashboard
running on localhost can pair a phone without exposing a local development port.
Keep the QR and links within the team; they grant access to the broadcast.

The pairing is remembered in this dashboard tab's session storage when storage
is available. After refreshing, opening **Camera & audio** resumes its receiver
without rescanning. **Disconnect** stops receiving; **Resume paired camera**
starts receiving the same session again. Closing the panel also stops receiving,
and reopening resumes it. These controls do not stop the phone's broadcaster.
End the broadcast on the phone when finished.

To switch phones, stop the old broadcaster, then choose **Pair another phone →
Create new pairing** and scan the new QR. This switches the dashboard to a new
session; it does not remotely revoke or stop an old broadcast. Pairings are not
synchronized across dashboard tabs, browsers, or different Macs.

## Optional: publish through a Mac with Continuity Camera

1. Connect the iPhone by USB, trust the Mac, and lock the phone. Continuity Camera
   requires compatible devices signed into the same Apple Account. Start with
   other camera capture pages stopped to isolate the broadcast.
2. In Chrome, open <https://vdo.ninja/> and choose **Add your Camera to OBS**.
   OBS is not required.
3. Select the **iPhone camera** and **iPhone microphone** separately. Confirm the
   picture and microphone meter before starting. If the microphone is absent,
   check macOS System Settings > Sound > Input and Chrome microphone permission.
4. Press **Start**. Copy the generated **VIEW** link to the receiving Mac. Keep
   this publisher tab open and the Mac awake.

## Optional: use an existing VIEW link

1. Open the deployed dashboard containing this change and click **Camera & audio**.
2. Expand **Use an existing viewing link**, paste the VIEW link and press
   **Connect** or **Load link**. Publishing links are rejected. This replaces any
   remembered QR pairing in the dashboard tab.
3. If prompted, click Play or enable sound in the embedded player. Use headphones
   if both Macs are in the same room.
4. Expand the panel for the demo. Reconnect reloads the receiving player without
   stopping the publisher. Disconnect or closing the panel removes the player
   and stops this viewer's video/audio.

Manually pasted links are remembered only in this tab's session storage, and
require Connect again after reloading. They are not synchronized with officer identities or other
devices. Do not use a real feed as synthetic demo footage; identify whose camera
you connected. Keep viewing links within the team.

## If it fails

- Good local preview, black receiving player: confirm the complete VIEW link and
  that the sender remains open. Try **Reconnect**, then **Try relay**. Relay can
  establish a route on networks that block direct peers, but can add latency and
  is not guaranteed on every network. Compare an available Ethernet connection
  or another permitted network if necessary.
- Video but no sound: verify the selected microphone and moving meter on the
  publisher, then the player's unmute/play control and receiving Mac's output.
  The publisher can default to **No Audio**; explicitly select the microphone.
- Frozen video: check the publishing preview first. If that is frozen too,
  bring Safari back to the foreground and wake the phone for a direct iPhone
  broadcast, or reconnect Continuity Camera for a Mac publisher. Use a lower camera
  resolution/frame rate in VDO.Ninja's source settings if capture/encoding struggles.
- **Show stream statistics** reloads the viewer with VDO.Ninja's media diagnostics.

This is a live viewing path only. It does not submit audio/video to the AI
pipeline. Any simultaneous use of the existing analysis capture must be checked
on the actual devices for camera contention and extra CPU/network load.

## Verification boundary

The dashboard controls and embedded hosted player were exercised locally and on
the deployed PR preview using VDO.Ninja's generated test media. The embedded
statistics showed VP8 video and Opus audio (about 31–32 kbps, nonzero audio level),
with a working TURN relay route and zero reported packet loss in the observed
sample. Reconnect and page reload recovered playback; disconnect and closing
the panel removed the iframe. Typecheck and targeted ESLint passed; the test suite was skipped under
the repository's hackathon rule. This is not a measurement of Continuity Camera
or direct iPhone capture. Before the demo, run the actual iPhone and receiving Mac
for at least five minutes while walking and speaking, reload the viewer, and verify reconnection
and clear audio. A visible clock and a spoken clap help expose accumulating delay
and audio/video mismatch. Do not infer latency from a successful connection alone.

## References

- [VDO.Ninja setup](https://docs.vdo.ninja/getting-started/vdo.ninja-basics)
- [Embedding and audio autoplay](https://docs.vdo.ninja/guides/how-to-use-vdo.ninja-on-a-website)
- [Relay mode](https://docs.vdo.ninja/advanced-settings/turn-and-stun-parameters/and-relay)
- [Synthetic media](https://docs.vdo.ninja/advanced-settings/settings-parameters/and-testmedia)
- [Reusable paired stream IDs](https://docs.vdo.ninja/advanced-settings/setup-parameters/push)
- [Rear camera selection](https://docs.vdo.ninja/advanced-settings/mobile-parameters/and-facing)
- [iPhone guidance](https://docs.vdo.ninja/platform-specific-issues/ios)
- [Apple Continuity Camera and microphone](https://support.apple.com/en-us/102546)
