"use client";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useCaptureDevices } from "../camera-triage/useCaptureDevices";
import { useHeartRate } from "../heart-rate/useHeartRate";
import type { LiveTrackPayload, LiveDevice } from "../live-track/types";
import { api, ApiError, sendCommand, useInstance } from "./client";
import { Publisher } from "./publisher";
import type { Command, InstanceSnapshot, Ownership } from "./types";
import styles from "./Instance.module.css";

export function ControlFrame() {
  const { snapshot, error } = useInstance();
  const [name, setName] = useState("");
  const [owner, setOwner] = useState<Ownership | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = snapshot?.instance;
  const occupied = current && current.lifecycle !== "ended";
  async function create() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<InstanceSnapshot & { ownership: Ownership }>("", {
        displayName: name,
        ...(occupied ? { replaceId: current.id } : {}),
      });
      setOwner(result.ownership);
      setReplace(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create instance.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.controlPage}>
      <main className={styles.control}>
        <header>
          <span className={styles.brand}>Paw Patrol / Main frame</span>
          <h1>One officer. One broadcast.</h1>
          <p>Connect the sources here. Keep this page open while broadcasting.</p>
        </header>
        {(message || error) && (
          <p role="alert" className={styles.notice}>
            {message || error}
          </p>
        )}
        <section className={styles.identityForm} aria-label="Create officer instance">
          <label htmlFor="officer-name">Officer name</label>
          <div className={styles.inline}>
            <input
              id="officer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Officer’s name"
            />
            <button
              disabled={busy || !name.trim() || (!!occupied && !replace)}
              onClick={() => void create()}
            >
              {busy ? "Creating…" : "Create instance"}
            </button>
          </div>
          {occupied && (
            <label className={styles.replace}>
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              End {current.displayName}’s existing instance and replace it
            </label>
          )}
        </section>
        {owner && <ControlSession key={owner.id} owner={owner} current={current ?? null} />}
        {!owner && (
          <p className={styles.hint}>
            {occupied
              ? `${current.displayName} · ${current.lifecycle}`
              : "Create an instance to connect camera, audio, GPS, and heart rate."}
          </p>
        )}
        <footer className={styles.links}>
          <a href="/officer" target="_blank" rel="noreferrer">
            Officer ↗
          </a>
          <a href="/dispatch" target="_blank" rel="noreferrer">
            Dispatch ↗
          </a>
          <a href="/hospital" target="_blank" rel="noreferrer">
            Hospital ↗
          </a>
        </footer>
      </main>
    </div>
  );
}

function ControlSession({
  owner,
  current,
}: {
  owner: Ownership;
  current: InstanceSnapshot["instance"];
}) {
  const devices = useCaptureDevices();
  const heart = useHeartRate(owner.id);
  const publisher = useMemo(() => new Publisher(owner), [owner]);
  const media = useSyncExternalStore(
    publisher.subscribe,
    publisher.getSnapshot,
    publisher.getServerSnapshot,
  );
  const [broadcasting, setBroadcasting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [gpsDevices, setGpsDevices] = useState<LiveDevice[]>([]);
  const [gpsId, setGpsId] = useState<string | null>(null);
  const [gpsMessage, setGpsMessage] = useState("Choose a tracked device.");
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [output, setOutput] = useState("");
  const [outputSupported, setOutputSupported] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sequence = useRef(0);
  const running = useRef(false);
  const generation = useRef(0);
  const lastHeartbeat = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const relinquish = useEffectEvent(() => {
    generation.current++;
    running.current = false;
    publisher.stop();
    heart.disconnect();
    setBroadcasting(false);
    setEnded(true);
  });
  useEffect(() => {
    if (
      current &&
      ((current.id !== owner.id && current.createdAt >= owner.createdAt) ||
        (current.id === owner.id && current.lifecycle === "ended"))
    ) {
      const timer = setTimeout(() => relinquish(), 0);
      return () => clearTimeout(timer);
    }
  }, [current, owner.id, owner.createdAt]);
  useEffect(
    () => () => {
      generation.current++;
      running.current = false;
      publisher.stop();
      void audioContext.current?.close();
    },
    [publisher],
  );
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = media.stream;
    void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [media.stream]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices?.enumerateDevices();
        if (active) {
          setOutputs(list?.filter((d) => d.kind === "audiooutput") ?? []);
          setOutputSupported("setSinkId" in HTMLMediaElement.prototype);
        }
      } catch {
        /* System default remains usable. */
      }
    };
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
    };
  }, [media.stream]);
  async function send(command: Command) {
    return sendCommand(owner, command, ++sequence.current);
  }
  const heartbeat = useEffectEvent(async () => {
    if (ended) return;
    try {
      await send({ type: "heartbeat" });
      lastHeartbeat.current = Date.now();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code !== "stale_update") {
        relinquish();
        setMessage(error.message);
      } else if (lastHeartbeat.current && Date.now() - lastHeartbeat.current >= 15_000) {
        relinquish();
        setMessage("Controller connection lost. Create a new instance to resume.");
      }
    }
  });
  useEffect(() => {
    const initial = setTimeout(() => void heartbeat(), 0);
    const timer = setInterval(() => void heartbeat(), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, []);
  const publishTelemetry = useEffectEvent(async () => {
    const sample =
      heart.mode === "device" &&
      heart.status === "receiving" &&
      heart.bpm !== null &&
      heart.receivedAt !== null
        ? { bpm: heart.bpm, receivedAt: heart.receivedAt }
        : undefined;
    try {
      await send({
        type: "telemetry",
        camera: media.cameraRef,
        audio: media.audioRef,
        sources: {
          camera: media.camera,
          audio: media.audio,
          heart: sample ? "live" : heart.status === "stale" ? "stale" : "unavailable",
        },
        ...(sample ? { heart: sample } : {}),
      });
    } catch (error) {
      if (
        running.current &&
        error instanceof ApiError &&
        error.status === 409 &&
        error.code !== "stale_update"
      ) {
        relinquish();
        setMessage(error.message);
      }
    }
  });
  const publishGps = useEffectEvent(async () => {
    try {
      await send({ type: "gps", deviceId: gpsId });
    } catch (error) {
      if (
        running.current &&
        error instanceof ApiError &&
        error.status === 409 &&
        error.code !== "stale_update"
      ) {
        relinquish();
        setMessage(error.message);
      }
    }
  });
  useEffect(() => {
    if (!broadcasting) return;
    let telemetryBusy = false;
    let gpsBusy = false;
    const telemetry = async () => {
      if (telemetryBusy || !running.current) return;
      telemetryBusy = true;
      try {
        await publishTelemetry();
      } finally {
        telemetryBusy = false;
      }
    };
    const gps = async () => {
      if (gpsBusy || !running.current) return;
      gpsBusy = true;
      try {
        await publishGps();
      } finally {
        gpsBusy = false;
      }
    };
    void gps();
    const t = setInterval(() => void telemetry(), 1000);
    const g = setInterval(() => void gps(), 5000);
    return () => {
      clearInterval(t);
      clearInterval(g);
    };
  }, [broadcasting]);
  async function capture(kind: "camera" | "audio") {
    await publisher.capture(kind, kind === "camera" ? devices.cameraId : devices.microphoneId);
    await devices.refreshDevices();
  }
  async function start() {
    setBusy(true);
    setMessage(null);
    const run = ++generation.current;
    try {
      await send({ type: "start" });
      if (run !== generation.current) return;
      running.current = true;
      setBroadcasting(true);
      if (cameraEnabled) void capture("camera");
      if (audioEnabled) void capture("audio");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start broadcast.");
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    generation.current++;
    running.current = false;
    publisher.stop();
    heart.disconnect();
    void audioContext.current?.close();
    audioContext.current = null;
    setBroadcasting(false);
    setEnded(true);
    setBusy(true);
    try {
      await send({ type: "stop" });
      setMessage("Broadcast ended. All local sources released.");
    } catch (error) {
      setMessage(
        `${error instanceof Error ? error.message : "Stop could not reach the service."} Local sources are released; retry Stop to finish room cleanup.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshGps() {
    try {
      const response = await fetch("/api/instances/gps", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      const result: LiveTrackPayload = await response.json();
      if (result.state === "tracking") {
        setGpsDevices(result.devices);
        setGpsMessage(
          result.devices.length
            ? "Select the officer’s tracked device."
            : "No tracked devices available.",
        );
      } else {
        setGpsDevices([]);
        setGpsMessage(
          result.state === "not-configured"
            ? "Configure the Traccar connection on the server."
            : "Tracked devices unavailable. Retry the connection.",
        );
      }
    } catch {
      setGpsMessage("Unable to reach Traccar. Retry the connection.");
    }
  }
  async function chooseOutput(id: string) {
    try {
      await videoRef.current?.setSinkId(id);
      setOutput(id);
    } catch {
      setMessage("This output is unavailable. Using the system default.");
      setOutput("");
      await videoRef.current?.setSinkId("").catch(() => {});
    }
  }
  async function testOutput() {
    void audioContext.current?.close();
    const context = new AudioContext();
    audioContext.current = context;
    try {
      if (output && "setSinkId" in context)
        await (context as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(
          output,
        );
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.08;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.25);
      oscillator.onended = () => {
        void context.close();
        if (audioContext.current === context) audioContext.current = null;
      };
    } catch {
      void context.close();
      setMessage("Unable to play the output test.");
    }
  }
  return (
    <section aria-label="Instance sources" className={styles.sources}>
      <div className={styles.sessionHeading}>
        <div>
          <h2>{current?.id === owner.id ? current.displayName : "Officer instance"}</h2>
          <code>{owner.id}</code>
        </div>
        <span>{ended ? "Ended" : broadcasting ? "Broadcasting" : "Ready"}</span>
      </div>
      <div className={styles.actions}>
        <button disabled={broadcasting || ended || busy} onClick={() => void start()}>
          Start broadcast
        </button>
        <button disabled={busy} onClick={() => void stop()}>
          Stop broadcast
        </button>
      </div>
      {(message || media.error) && (
        <p role="status" className={styles.notice}>
          {message || media.error}
        </p>
      )}
      <div className={styles.captureGrid}>
        <div className={styles.preview}>
          <video ref={videoRef} muted playsInline autoPlay aria-label="Silent camera preview" />
          {!media.stream && <span>Camera preview</span>}
        </div>
        <div>
          {(["camera", "audio"] as const).map((kind) => (
            <div className={styles.sourceRow} key={kind}>
              <div className={styles.rowHeading}>
                <label htmlFor={`device-${kind}`}>
                  {kind === "camera" ? "Camera" : "Microphone"}
                </label>
                <span>{media[kind]}</span>
              </div>
              <select
                id={`device-${kind}`}
                disabled={ended}
                value={(kind === "camera" ? devices.cameraId : devices.microphoneId) ?? ""}
                onChange={(e) =>
                  (kind === "camera" ? devices.setCameraId : devices.setMicrophoneId)(
                    e.target.value || null,
                  )
                }
              >
                <option value="">System default</option>
                {(kind === "camera" ? devices.devices.cameras : devices.devices.microphones).map(
                  (d, index) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `${kind === "camera" ? "Camera" : "Microphone"} ${index + 1}`}
                    </option>
                  ),
                )}
              </select>
              <div className={styles.inline}>
                <label className={styles.replace}>
                  <input
                    type="checkbox"
                    disabled={broadcasting || ended}
                    checked={kind === "camera" ? cameraEnabled : audioEnabled}
                    onChange={(e) =>
                      (kind === "camera" ? setCameraEnabled : setAudioEnabled)(e.target.checked)
                    }
                  />
                  Use on start
                </label>
                <button
                  disabled={!broadcasting || ended || media[kind] === "connecting"}
                  onClick={() => void capture(kind)}
                >
                  Reconnect {kind === "camera" ? "camera" : "microphone"}
                </button>
              </div>
            </div>
          ))}
          <button className={styles.textButton} onClick={() => void devices.refreshDevices()}>
            Refresh camera & microphone list
          </button>
          <p className={styles.hint}>
            Microphone preview stays silent. iPhone appears when available through Continuity
            Camera.
          </p>
        </div>
      </div>
      <div className={styles.sourceRow}>
        <div className={styles.rowHeading}>
          <label htmlFor="local-output">Local speaker / headphones</label>
          <span>Local playback only</span>
        </div>
        <div className={styles.inline}>
          <select
            id="local-output"
            value={output}
            disabled={!outputSupported}
            onChange={(e) => void chooseOutput(e.target.value)}
          >
            <option value="">System default</option>
            {outputs
              .filter((d) => d.deviceId !== "default")
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Output ${i + 1}`}
                </option>
              ))}
          </select>
          <button onClick={() => void testOutput()}>Test output</button>
        </div>
        {!outputSupported && (
          <p className={styles.hint}>This browser uses the system audio output.</p>
        )}
      </div>
      <div className={styles.sourceRow}>
        <div className={styles.rowHeading}>
          <label htmlFor="gps-device">GPS / Traccar</label>
          <span>{current?.id === owner.id ? current.sources.gps.state : "unavailable"}</span>
        </div>
        <div className={styles.inline}>
          <select
            id="gps-device"
            disabled={ended}
            value={gpsId ?? ""}
            onChange={(e) => setGpsId(e.target.value || null)}
          >
            <option value="">No device selected</option>
            {gpsDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button disabled={ended} onClick={() => void refreshGps()}>
            Reconnect GPS / refresh devices
          </button>
        </div>
        <p className={styles.hint}>{gpsMessage}</p>
        {current?.id === owner.id && current.gps?.fix && (
          <p className={styles.hint}>
            {current.gps.fix.latitude.toFixed(5)}, {current.gps.fix.longitude.toFixed(5)} · accuracy{" "}
            {current.gps.fix.accuracyMeters ?? "unknown"} m · measured{" "}
            {new Date(current.gps.fix.fixedAt).toLocaleTimeString()} · {current.gps.fix.freshness}
          </p>
        )}
      </div>
      <div className={styles.sourceRow}>
        <div className={styles.rowHeading}>
          <h3>Heart rate / HeartCast</h3>
          <span>{heart.status === "receiving" ? `${heart.bpm} bpm` : heart.status}</span>
        </div>
        <div className={styles.actions}>
          <button
            disabled={ended || heart.status === "requesting" || heart.status === "connecting"}
            onClick={() => {
              heart.disconnect();
              void heart.connect();
            }}
          >
            Connect / reconnect watch
          </button>
          <button onClick={heart.disconnect}>Disconnect watch</button>
        </div>
        <p className={styles.hint}>
          {heart.mode === "device"
            ? heart.message
            : "Open HeartCast on the watch and connect from Chrome on this Mac."}
        </p>
      </div>
    </section>
  );
}
