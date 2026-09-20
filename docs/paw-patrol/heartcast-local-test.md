# HeartCast local heart-rate test

HeartCast is an optional Bluetooth source for testing a fictional officer in the
demo workspace. Device readings stay in the browser tab that connects. This is
not an Apple Health integration, remote monitoring service, or clinical assessment.
The local device reading never triggers panic, injury, an ambulance request, or
another scenario action.

This feature is separate from the authenticated `PAW_PATROL_DATA_MODE=live`
dashboard and its server telemetry. It does not authenticate the wearer, upload
readings, add a backend contract, or populate live-mode telemetry. A real Bluetooth
reading in a demo workspace does not turn that workspace into a live operational
dashboard. Other app features retain their existing data flows.

## Start and connect

1. From the repository root, use the root pnpm scripts. Run
   `PAW_PATROL_DATA_MODE=demo pnpm run dev` for all three workspaces, or
   `PAW_PATROL_DATA_MODE=demo pnpm run dev:officer` for just the officer view.
   Do not start a second server on an occupied port. If dependencies are missing,
   run `pnpm install --frozen-lockfile` first.
2. Open **Google Chrome on the Mac or Windows laptop**, then visit
   `http://localhost:5177`. The control is also available in the demo Dispatch
   workspace on 5176 and Hospital workspace on 5178. Use localhost or HTTPS; a
   plain HTTP LAN address may not be a secure context. Safari and embedded
   previews may not expose Web Bluetooth.
3. Use your own device for this test. Wear the Apple Watch, open HeartCast on
   the Watch and paired iPhone, and start the HeartCast session on the Watch.
   Follow HeartCast's Health permissions guidance. Keep the iPhone app visible
   and Bluetooth enabled on both the iPhone and laptop.
4. Select the fictional officer profile that will display your test reading.
   This association is made by you; it does not verify the wearer's identity.
5. In the heart-rate panel, click **Connect Heart Rate**. In Chrome's chooser,
   select your HeartCast device and confirm. This requests only the standard
   Bluetooth Heart Rate service, not unrelated Bluetooth devices.
6. The number remains `--` until a usable reading arrives. Once received, the
   source identifies a live device reading, and the trend uses only received
   samples. The receipt time is the laptop's time, not a verified Watch measurement
   time.

## Connection behavior

- **No synthetic fallback:** after starting a connection attempt, missing or
  disconnected device data displays `--`. Choose **Use demo heart rate** to
  deliberately restore the synthetic scenario.
- **Freshness:** no usable updates for 30 seconds marks the feed stale and
  removes the current BPM. Any remaining trend represents past received data.
  A stream of repeated values cannot prove that HeartCast has a fresh Watch
  measurement; this UI measures notification freshness only.
- **Person changes:** changing the selected person disconnects the device and
  clears the previous person's readings. Reconnect explicitly for the new profile.
- **Demo reset:** resetting the scenario clears the device session. Pausing the
  scripted demo does not pause an active Bluetooth stream.
- **Disconnect/retry:** use Disconnect to stop the current connection. Reconnect
  asks Chrome to select the device again and retrieves fresh GATT objects.
- **Local only:** device readings are held in this tab's memory. They are not
  uploaded, logged, written to local storage, included in copied MIST, added to
  the shared incident bus, or sent to another dashboard. Reloading or closing
  the tab discards them.
- **Separate ports are separate sessions:** connecting on 5177 does not update
  5176 or 5178. Use one tab for the hardware test; cross-dashboard transport is
  not implemented, and some BLE peripherals allow only one connection.
- **MIST remains separate:** simulated handoffs keep their scripted vital signs,
  and source-labelled MIST drafts retain their existing inputs. HeartCast data
  is never mixed into either record.

## Troubleshooting

- **HeartCast not listed:** first confirm that the iPhone HeartCast screen shows
  the Watch's reading. Keep it in the foreground and disconnect competing BLE
  receiver apps. Reopen the browser chooser. HeartCast broadcasts from the
  iPhone; the Watch alone is not this connection's BLE peripheral.
- **Not supported / insecure context:** use desktop Chrome at the localhost URL
  above. Do not disable browser security or enable experimental flags.
- **Permission denied:** check Chrome site Bluetooth permissions and the Mac's
  Bluetooth permission for Chrome. No OS permission is changed by the app.
- **Connected but no reading / contact missing:** check the Watch session,
  fit, and HeartCast permissions. Waiting for data is not a confirmed live measurement.
- **Other errors:** disconnect and retry. The UI does not automatically reconnect
  or silently switch to simulated values.
- **Authenticated live dashboard:** return to a server started with
  `PAW_PATROL_DATA_MODE=demo` to use this test. The authenticated dashboard does
  not expose the local HeartCast connection.

## Verification

From the repository root:

```sh
pnpm exec vitest run features/heart-rate features/paw-patrol/PawPatrol.test.tsx
pnpm run verify
```

Automated tests use mock Bluetooth objects; they do **not** establish physical
HeartCast compatibility. The real-device acceptance test is: pair your device,
compare the displayed BPM against HeartCast, observe updates, stop the broadcast,
verify stale/disconnected states, reconnect, then change the selected person and
verify the previous reading is cleared. Also confirm that the other dashboard
ports and copied MIST do not receive the reading. No diagnosis or physiological
accuracy claim follows from successful transport.

## References

- [Chrome Web Bluetooth connection and notification guide](https://developer.chrome.com/docs/capabilities/bluetooth)
- [HeartCast setup and troubleshooting](https://www.heartcast.app/faq-help-support-issues/)
