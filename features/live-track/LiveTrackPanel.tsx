"use client";

import { LoaderCircle } from "lucide-react";

import { formatAccuracy, formatAge, freshnessLabel } from "./format";
import { FRESHNESS_COLOR } from "./liveLayer";
import type { LiveDevice, LiveTrackState } from "./types";

interface LiveTrackPanelProps {
  state: LiveTrackState;
  onFocusDevice: (device: LiveDevice) => void;
}

function DeviceRow({
  device,
  onFocusDevice,
}: {
  device: LiveDevice;
  onFocusDevice: (device: LiveDevice) => void;
}) {
  const { fix } = device;

  return (
    <li>
      <button
        type="button"
        className="fleet-row"
        onClick={() => onFocusDevice(device)}
        disabled={!fix}
        title={fix ? `Centre the map on ${device.name}` : `${device.name} has no fix to centre on`}
      >
        <span
          className="fleet-row__dot"
          style={{ background: fix ? FRESHNESS_COLOR[fix.freshness] : FRESHNESS_COLOR.lost }}
          aria-hidden="true"
        />
        <span className="fleet-row__name">{device.name}</span>
        <span className="fleet-row__state">
          {fix ? (
            <>
              {freshnessLabel(fix.freshness)}
              <small>
                {formatAge(fix.ageSeconds)} · {formatAccuracy(fix)}
              </small>
            </>
          ) : (
            <>
              No fix yet
              <small>{device.online ? "connected" : "not reporting"}</small>
            </>
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * Reports what the server actually knows about every tracked unit. Stale and
 * lost positions are labelled as such instead of being presented as current.
 */
export function LiveTrackPanel({ state, onFocusDevice }: LiveTrackPanelProps) {
  if (state.state === "idle") return null;

  if (state.state === "connecting") {
    return (
      <aside className="live-card" role="status">
        <span className="panel-label">
          <LoaderCircle className="live-card__spinner" size={12} /> Connecting
        </span>
        <p>Waiting for the first positions from the tracking server.</p>
      </aside>
    );
  }

  if (state.state === "not-configured") {
    return (
      <aside className="live-card" role="status">
        <span className="panel-label">Tracking not configured</span>
        <p>
          This deployment has nowhere to put a position. Set <code>BLOB_READ_WRITE_TOKEN</code> so
          phones can publish from <code>/capture</code>, or configure <code>TRACCAR_URL</code>,{" "}
          <code>TRACCAR_EMAIL</code> and <code>TRACCAR_PASSWORD</code> for a tracking server.
        </p>
      </aside>
    );
  }

  if (state.state === "unavailable") {
    return (
      <aside className="live-card" role="alert">
        <span className="panel-label">Tracking unavailable</span>
        <p>{state.reason}</p>
      </aside>
    );
  }

  if (state.state === "no-devices") {
    return (
      <aside className="live-card" role="status">
        <span className="panel-label">No units</span>
        <p>
          Nobody is publishing a position. Open <code>/capture</code> on a phone, name the unit and
          share its location — it appears here within a few seconds.
        </p>
      </aside>
    );
  }

  const { devices } = state;
  const liveCount = devices.filter((device) => device.fix?.freshness === "live").length;

  return (
    <aside className="live-card" role="status">
      <div className="panel-head">
        <span className="panel-label">Units</span>
        <span className="live-card__count">
          {liveCount} of {devices.length} live
        </span>
      </div>

      <ul className="fleet-list">
        {devices.map((device) => (
          <DeviceRow key={device.id} device={device} onFocusDevice={onFocusDevice} />
        ))}
      </ul>

      {liveCount < devices.length && (
        <p className="panel-note">
          Green units reported in the last 90 seconds. Amber and grey markers show where a unit was
          last seen, not where it is now.
        </p>
      )}
    </aside>
  );
}
