"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { ExternalLink, Maximize2, Minimize2, Radio, RotateCw, X } from "lucide-react";
import styles from "./BroadcastDock.module.css";

const STORAGE_KEY = "paw-patrol-broadcast-view";
const WORKSPACES = new Set(["/", "/dispatch", "/officer", "/hospital", "/capture", "/map"]);

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

  function show() {
    try {
      setDraft(sessionStorage.getItem(STORAGE_KEY) ?? "");
    } catch {
      // Viewing still works when browser storage is disabled.
    }
    setOpen(true);
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
    setError(null);
    setActive(link);
    setAttempt((value) => value + 1);
    try {
      sessionStorage.setItem(STORAGE_KEY, link);
    } catch {
      // Saving the link is optional; never prevent a connection.
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
            <form onSubmit={connect}>
              <label htmlFor={`${id}-link`}>Viewing link from the publishing Mac</label>
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
              {error && (
                <p id={`${id}-error`} role="alert" className={styles.error}>
                  {error}
                </p>
              )}
            </form>

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

            <details open={!active} className={styles.instructions}>
              <summary>Set up the publishing Mac</summary>
              <ol>
                <li>Connect the iPhone to the Mac by USB, trust the Mac, then lock the iPhone.</li>
                <li>
                  Open{" "}
                  <a href="https://vdo.ninja/" target="_blank" rel="noreferrer">
                    VDO.Ninja <ExternalLink size={12} />
                  </a>{" "}
                  in Chrome and choose <strong>Add your Camera to OBS</strong>. OBS is not required.
                </li>
                <li>Select the iPhone camera and its microphone separately, then press Start.</li>
                <li>
                  Copy the VIEW link to the receiving Mac and paste it above. Keep the publisher tab
                  open.
                </li>
              </ol>
              <p className={styles.note}>
                This feed carries video and sound. It does not submit media for AI analysis. Keep
                the viewing link within your team.
              </p>
            </details>
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
