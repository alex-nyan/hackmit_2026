"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { ExternalLink, Maximize2, Minimize2, Radio, RotateCw, X } from "lucide-react";
import styles from "./BroadcastDock.module.css";
import { BroadcastAudioAnalysis } from "./BroadcastAudioAnalysis";

const STORAGE_KEY = "paw-patrol-broadcast-view";
const PAIRING_KEY = "paw-patrol-broadcast-pairing";
const WORKSPACES = new Set(["/", "/dispatch", "/officer", "/hospital", "/capture", "/map"]);

type PhonePairing = { streamId: string; password: string };

function readPairing(raw: string | null): PhonePairing | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === "object" &&
      "streamId" in value &&
      "password" in value &&
      typeof value.streamId === "string" &&
      typeof value.password === "string" &&
      /^[a-f0-9]{32}$/.test(value.streamId) &&
      /^[a-f0-9]{32}$/.test(value.password)
    ) {
      return { streamId: value.streamId, password: value.password };
    }
  } catch {
    // Ignore stale or damaged storage; the user can create a fresh pairing.
  }
  return null;
}

function pairingLink(pairing: PhonePairing, mode: "push" | "view"): string {
  const link = new URL("https://vdo.ninja/");
  link.searchParams.set(mode, pairing.streamId);
  link.searchParams.set("password", pairing.password);
  if (mode === "push") {
    link.searchParams.set("webcam", "");
    link.searchParams.set("facing", "rear");
  }
  return link.href;
}

/** Only a single receiving stream; never embed a publishing or arbitrary URL. */
function viewerLink(input: string): string | null {
  try {
    const supplied = new URL(input.trim());
    const view = supplied.searchParams.get("view");
    if (
      supplied.origin !== "https://vdo.ninja" ||
      supplied.pathname !== "/" ||
      supplied.username ||
      supplied.password ||
      supplied.searchParams.has("push") ||
      !view ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(view)
    )
      return null;
    const link = new URL("https://vdo.ninja/");
    link.searchParams.set("view", view);
    // Preserve access information from password-protected streams. Other flags
    // could disable audio or change this from a viewer into a capture page.
    for (const key of ["password", "pw", "room", "audience"]) {
      const value = supplied.searchParams.get(key);
      if (value !== null) link.searchParams.set(key, value);
    }
    return link.href;
  } catch {
    return null;
  }
}

export function BroadcastDock() {
  const pathname = usePathname();
  // Unmount the viewer when leaving a workspace, including signing out.
  return WORKSPACES.has(pathname) ? <BroadcastControls /> : null;
}

function BroadcastControls() {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relay, setRelay] = useState(false);
  const [stats, setStats] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pairing, setPairing] = useState<PhonePairing | null>(null);
  const [showQr, setShowQr] = useState(true);

  function show() {
    try {
      setDraft(sessionStorage.getItem(STORAGE_KEY) ?? "");
      const saved = readPairing(sessionStorage.getItem(PAIRING_KEY));
      if (saved) {
        setPairing(saved);
        setActive(pairingLink(saved, "view"));
      }
    } catch {
      // Viewing still works when browser storage is disabled.
    }
    setOpen(true);
  }

  function receive(link: string) {
    setDraft(link);
    setActive(link);
    setError(null);
    setAttempt((value) => value + 1);
    try {
      sessionStorage.setItem(STORAGE_KEY, link);
    } catch {
      // Saving is optional; never prevent a connection.
    }
  }

  function pairPhone() {
    try {
      const next = {
        streamId: crypto.randomUUID().replaceAll("-", ""),
        password: crypto.randomUUID().replaceAll("-", ""),
      };
      setPairing(next);
      setShowQr(true);
      receive(pairingLink(next, "view"));
      try {
        sessionStorage.setItem(PAIRING_KEY, JSON.stringify(next));
      } catch {
        // The current session still works without storage.
      }
    } catch {
      setError("Could not create a pairing. Open this dashboard over HTTPS and try again.");
    }
  }

  function close() {
    setActive(null);
    setOpen(false);
    setError(null);
    trigger.current?.focus();
  }

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const link = viewerLink(draft);
    if (!link) {
      setError("Paste the VDO.Ninja VIEW link, starting with https://vdo.ninja/?view=.");
      return;
    }
    receive(link);
    setPairing(null);
    try {
      sessionStorage.removeItem(PAIRING_KEY);
    } catch {
      // Manual links still work without storage.
    }
  }

  const embed = active ? new URL(active) : null;
  if (relay) embed?.searchParams.set("relay", "");
  if (stats) embed?.searchParams.set("stats", "");

  return (
    <div className={styles.dock}>
      {open && (
        <section
          className={styles.panel}
          data-expanded={expanded}
          aria-labelledby={`${id}-title`}
          id={`${id}-panel`}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <header className={styles.heading}>
            <div>
              <h2 id={`${id}-title`}>Camera &amp; audio</h2>
              <p>One shared feed · VDO.Ninja</p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-label={expanded ? "Shrink camera panel" : "Expand camera panel"}
            >
              {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button type="button" onClick={close} aria-label="Disconnect and close camera panel">
              <X size={18} />
            </button>
          </header>

          <div className={styles.pairing}>
            {!pairing ? (
              <>
                <h3>Connect a body camera</h3>
                <p>Scan a QR code on the iPhone to send its camera and sound straight here.</p>
                <button type="button" onClick={pairPhone} className={styles.pairButton}>
                  Pair iPhone
                </button>
              </>
            ) : (
              <>
                <div className={styles.pairingHeading}>
                  <h3>{showQr ? "Scan with your iPhone" : "iPhone pairing"}</h3>
                  <button
                    type="button"
                    aria-expanded={showQr}
                    onClick={() => setShowQr((value) => !value)}
                  >
                    {showQr ? "Hide QR code" : "Show QR code"}
                  </button>
                </div>
                {showQr && (
                  <PhonePairingCode key={pairing.streamId} link={pairingLink(pairing, "push")} />
                )}
                {!active && (
                  <button type="button" onClick={() => receive(pairingLink(pairing, "view"))}>
                    Resume paired camera
                  </button>
                )}
              </>
            )}
          </div>

          {embed && (
            <div className={styles.stage}>
              <iframe
                key={`${active}-${relay}-${stats}-${attempt}`}
                src={embed.href}
                title="Shared camera video and audio"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                referrerPolicy="no-referrer"
              />
            </div>
          )}

          <div className={styles.body}>
            {error && (
              <p id={`${id}-error`} role="alert" className={styles.error}>
                {error}
              </p>
            )}

            {active && (
              <>
                <p className={styles.note}>
                  Click Play or enable sound inside the player if prompted. Use headphones on the
                  receiving Mac to avoid feedback.
                </p>
                <div className={styles.actions}>
                  <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                    <RotateCw size={14} /> Reconnect
                  </button>
                  <button type="button" onClick={() => setActive(null)}>
                    Disconnect
                  </button>
                  <a href={embed?.href} target="_blank" rel="noreferrer">
                    Open player <ExternalLink size={14} />
                  </a>
                </div>
                <BroadcastAudioAnalysis
                  key={`${active}-${relay}-${attempt}`}
                  viewUrl={active}
                  relay={relay}
                />
              </>
            )}

            <label className={styles.relay}>
              <input
                type="checkbox"
                checked={relay}
                onChange={(event) => setRelay(event.target.checked)}
              />
              Try relay if venue Wi-Fi blocks the connection
            </label>
            {relay && (
              <p className={styles.note}>Relay reconnects through a server and may add delay.</p>
            )}
            <label className={styles.relay}>
              <input
                type="checkbox"
                checked={stats}
                onChange={(event) => setStats(event.target.checked)}
              />
              Show stream statistics (reconnects)
            </label>

            {pairing && (
              <details className={styles.instructions}>
                <summary>Pair another phone</summary>
                <p className={styles.note}>
                  A new code switches this dashboard to a new session. Stop the old broadcast on the
                  phone before switching.
                </p>
                <button type="button" onClick={pairPhone}>
                  Create new pairing
                </button>
              </details>
            )}

            <details className={styles.instructions}>
              <summary>Use an existing viewing link</summary>
              <form onSubmit={connect}>
                <label htmlFor={`${id}-link`}>VDO.Ninja viewing link</label>
                <div className={styles.inputRow}>
                  <input
                    id={`${id}-link`}
                    type="url"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="https://vdo.ninja/?view=…"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    aria-invalid={!!error}
                    aria-describedby={error ? `${id}-error` : undefined}
                  />
                  <button type="submit">{active ? "Load link" : "Connect"}</button>
                </div>
              </form>
              <p className={styles.note}>
                A phone or Mac can also publish from VDO.Ninja and share its VIEW link here.
              </p>
            </details>
            <p className={styles.note}>
              Start “Analyze broadcast audio” to send this feed’s sound through speech recognition
              and dispatch review. Video remains viewing only. Keep the QR code and links within
              your team.
            </p>
          </div>
        </section>
      )}
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={open ? close : show}
      >
        <Radio size={17} aria-hidden="true" />
        {open ? "Close camera & audio" : "Camera & audio"}
      </button>
    </div>
  );
}

function PhonePairingCode({ link }: { link: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode")
      .then((module) =>
        module.default.toString(link, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 4,
          color: { dark: "#000000ff", light: "#ffffffff" },
        }),
      )
      .then((code) => {
        if (!cancelled) setSvg(code);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  return (
    <div className={styles.pairingGrid}>
      {svg ? (
        <div
          className={styles.qr}
          role="img"
          aria-label="QR code to start this iPhone camera broadcast"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <p role="status">
          {failed ? "QR unavailable. Open the phone setup link instead." : "Preparing QR code…"}
        </p>
      )}
      <div>
        <ol>
          <li>Scan with the iPhone Camera app and open in Safari.</li>
          <li>
            Allow camera and microphone. Select the rear camera and microphone, then tap{" "}
            <strong>Start</strong>.
          </li>
          <li>The feed appears here automatically. Hide this code to make room for the video.</li>
        </ol>
        <p className={styles.note}>Keep Safari open and the phone unlocked while wearing it.</p>
        <a href={link} target="_blank" rel="noreferrer">
          Open phone setup <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
