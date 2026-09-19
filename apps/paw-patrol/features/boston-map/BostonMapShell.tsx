"use client";

import { Building2, Check, LoaderCircle, MapPin, Moon, Sun } from "lucide-react";
import { useCallback, useState } from "react";

import { BostonMap } from "./BostonMap";
import { MAP_FOCUS, type MapFocus, type MapTheme, type MapStatus } from "./types";

export function BostonMapShell() {
  const [focus, setFocus] = useState<MapFocus>("mit");
  const [theme, setTheme] = useState<MapTheme>("light");
  const [status, setStatus] = useState<MapStatus>("loading");
  const handleStatusChange = useCallback((nextStatus: MapStatus) => setStatus(nextStatus), []);

  return (
    <main className={`map-app map-app--${theme}`}>
      <header className="map-header">
        <div className="map-brand">
          <span className="map-brand__mark" aria-hidden="true">
            <Building2 size={19} strokeWidth={2.2} />
          </span>
          <span>
            <strong>GridLens</strong>
            <small>MIT · Harvard · Boston building map</small>
          </span>
        </div>

        <button
          type="button"
          className="icon-button"
          onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} map`}
        >
          {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
        </button>
      </header>

      <nav className="area-picker" aria-label="Map area">
        {(Object.keys(MAP_FOCUS) as MapFocus[]).map((area) => (
          <button
            type="button"
            key={area}
            className={focus === area ? "area-picker__button is-active" : "area-picker__button"}
            onClick={() => setFocus(area)}
            aria-pressed={focus === area}
          >
            {focus === area && <Check size={13} strokeWidth={2.7} />}
            {MAP_FOCUS[area].label}
          </button>
        ))}
      </nav>

      <section className="map-stage" aria-label="Boston building map">
        <BostonMap focus={focus} theme={theme} onStatusChange={handleStatusChange} />

        {status === "loading" && (
          <div className="map-status" role="status">
            <LoaderCircle className="map-status__spinner" size={18} />
            Loading the map…
          </div>
        )}

        {status === "error" && (
          <div className="map-status map-status--error" role="alert">
            The map could not finish loading. Check your connection or Mapbox token, then refresh.
          </div>
        )}

        {status === "missing-token" && (
          <div className="map-config-error" role="alert">
            <strong>Mapbox public token required</strong>
            <p>
              Add <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> to <code>.env.local</code>,
              then restart the local server. See the repository README for setup.
            </p>
          </div>
        )}

        {status === "ready" && <aside className="foundation-card">
          <span className="foundation-card__eyebrow">
            <MapPin size={13} /> 3D campus view
          </span>
          <strong>Explore the buildings</strong>
          <p>Zoom in for building heights. Right-drag to tilt and rotate the map.</p>
        </aside>}
      </section>
    </main>
  );
}
