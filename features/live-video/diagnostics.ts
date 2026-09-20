"use client";

/** Local-only, bounded diagnostics. Never retain SDP, IPs, credentials or media. */
export interface PeerSample {
  /** Monotonic milliseconds, compatible with performance.now(). */
  timestamp: number;
  videoKbps?: number;
  audioKbps?: number;
  fps?: number;
  framesDecoded?: number;
  framesEncoded?: number;
  framesDropped?: number;
  freezeCount?: number;
  encodeMs?: number;
  decodeMs?: number;
  sendQueueMs?: number;
  jitterBufferMs?: number;
  jitterMs?: number;
  lossPercent?: number;
  rttMs?: number;
  route?: string;
  codec?: string;
  qualityLimitationReason?: string;
  maxBitrate?: number;
  maxFramerate?: number;
  scaleResolutionDownBy?: number;
}

export interface PeerDiagnostic {
  sourceId: string;
  peerId: string;
  role: "publisher" | "watcher";
  connectionState: RTCPeerConnectionState;
  active: boolean;
  issue?: string;
  sample?: PeerSample;
  history: PeerSample[];
}

export interface PlaybackDiagnostic {
  sourceId: string;
  streamId: string;
  lastFrameAt: number;
  firstFrameMs: number;
  /** Browser estimate; not the upstream iPhone-to-Mac capture latency. */
  frameAgeMs?: number;
  renderDelayMs?: number;
}

interface DiagnosticSnapshot {
  peers: PeerDiagnostic[];
  playback: PlaybackDiagnostic[];
}

const SAMPLE_MS = 1_000;
const HISTORY_SIZE = 60;
const MAX_PEERS = 32;
const empty: DiagnosticSnapshot = { peers: [], playback: [] };
let snapshot = empty;
const peers = new Map<string, PeerDiagnostic>();
const playback = new Map<string, PlaybackDiagnostic>();
const listeners = new Set<() => void>();

function publish() {
  snapshot = { peers: [...peers.values()], playback: [...playback.values()] };
  listeners.forEach((listener) => listener());
}

export function subscribeDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getDiagnostics = () => snapshot;
export const getServerDiagnostics = () => empty;

export function reportPeerIssue(peerId: string, issue: string, role?: PeerDiagnostic["role"]) {
  for (const [key, peer] of peers) {
    if (peer.peerId === peerId && (!role || peer.role === role)) {
      peers.set(key, { ...peer, issue });
    }
  }
  publish();
}

export function recordPlayback(value: PlaybackDiagnostic) {
  playback.set(value.streamId, value);
  // Ordinarily one entry per visible tile; keep diagnostics bounded even if
  // an embedding component forgets to unregister its stream.
  if (playback.size > MAX_PEERS) playback.delete(playback.keys().next().value!);
  publish();
}

export function removePlayback(streamId: string) {
  playback.delete(streamId);
  publish();
}

type Stat = Record<string, unknown> & { id: string; type: string; timestamp: number };

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sum(rows: Stat[], key: string): number | undefined {
  const values = rows.map((row) => number(row[key])).filter((n) => n !== undefined);
  return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
}

/** Counter deltas skip newly appearing/reset SSRCs rather than spike the rate. */
function delta(rows: Stat[], previous: Map<string, Stat>, key: string): number | undefined {
  const values = rows.flatMap((row) => {
    const before = number(previous.get(row.id)?.[key]);
    const after = number(row[key]);
    return before !== undefined && after !== undefined && after >= before ? [after - before] : [];
  });
  return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
}

function ratio(numerator: number | undefined, denominator: number | undefined, scale = 1) {
  return numerator !== undefined && denominator !== undefined && denominator > 0
    ? (numerator / denominator) * scale
    : undefined;
}

/** Stats definitions: https://www.w3.org/TR/webrtc-stats/ . All rates use deltas. */
export function monitorPeer(
  pc: RTCPeerConnection,
  options: {
    sourceId: string;
    peerId: string;
    role: "publisher" | "watcher";
    onSample?: (sample: PeerSample) => void;
  },
): () => void {
  const { sourceId, peerId, role, onSample } = options;
  const key = `${role}/${sourceId}/${peerId}`;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = new Map<string, Stat>();
  let previousAt: number | undefined;
  const entry: PeerDiagnostic = {
    sourceId,
    peerId,
    role,
    active: true,
    connectionState: pc.connectionState,
    history: [],
  };
  peers.set(key, entry);
  while (peers.size > MAX_PEERS) {
    const old = [...peers].find(([, value]) => !value.active)?.[0] ?? peers.keys().next().value!;
    peers.delete(old);
  }
  publish();

  async function sample() {
    try {
      const report = await pc.getStats();
      if (stopped) return;
      const now = performance.now();
      const elapsed = previousAt === undefined ? undefined : now - previousAt;
      const all = new Map<string, Stat>();
      report.forEach((value) => all.set(value.id, value as Stat));
      const type = role === "publisher" ? "outbound-rtp" : "inbound-rtp";
      const media = [...all.values()].filter((row) => row.type === type && !row.isRemote);
      const video = media.filter((row) => (row.kind ?? row.mediaType) === "video");
      const audio = media.filter((row) => (row.kind ?? row.mediaType) === "audio");
      const sending = role === "publisher";
      const frames = sending ? "framesEncoded" : "framesDecoded";
      const frameDelta = delta(video, previous, frames);
      const transport = [...all.values()].find(
        (row) => row.type === "transport" && row.selectedCandidatePairId,
      );
      const pair = transport ? all.get(String(transport.selectedCandidatePairId)) : undefined;
      const local = pair ? all.get(String(pair.localCandidateId)) : undefined;
      const remote = pair ? all.get(String(pair.remoteCandidateId)) : undefined;
      const protocol = local?.relayProtocol ?? local?.protocol;
      const route =
        local && remote
          ? `${local.candidateType === "relay" || remote.candidateType === "relay" ? "relay" : "direct"}${typeof protocol === "string" ? ` / ${protocol}` : ""}`
          : undefined;
      const codec = video[0] ? all.get(String(video[0].codecId))?.mimeType : undefined;
      const sender = pc.getSenders().find((item) => item.track?.kind === "video");
      const encoding = sender?.getParameters().encodings?.[0];
      const lost = delta(video, previous, "packetsLost");
      const received = delta(video, previous, "packetsReceived");
      const reason =
        video.find(
          (row) =>
            row.qualityLimitationReason !== undefined && row.qualityLimitationReason !== "none",
        )?.qualityLimitationReason ?? video[0]?.qualityLimitationReason;
      const value: PeerSample = {
        timestamp: now,
        videoKbps: ratio(
          delta(video, previous, sending ? "bytesSent" : "bytesReceived"),
          elapsed,
          8,
        ),
        audioKbps: ratio(
          delta(audio, previous, sending ? "bytesSent" : "bytesReceived"),
          elapsed,
          8,
        ),
        fps: ratio(frameDelta, elapsed, 1_000),
        framesDecoded: sum(video, "framesDecoded"),
        framesEncoded: sum(video, "framesEncoded"),
        framesDropped: delta(video, previous, "framesDropped"),
        freezeCount: sum(video, "freezeCount"),
        encodeMs: ratio(delta(video, previous, "totalEncodeTime"), frameDelta, 1_000),
        decodeMs: ratio(delta(video, previous, "totalDecodeTime"), frameDelta, 1_000),
        sendQueueMs: ratio(
          delta(video, previous, "totalPacketSendDelay"),
          delta(video, previous, "packetsSent"),
          1_000,
        ),
        jitterBufferMs: ratio(
          delta(video, previous, "jitterBufferDelay"),
          delta(video, previous, "jitterBufferEmittedCount"),
          1_000,
        ),
        jitterMs:
          number(video[0]?.jitter) === undefined ? undefined : Number(video[0].jitter) * 1_000,
        lossPercent: ratio(
          lost,
          lost === undefined || received === undefined ? undefined : lost + received,
          100,
        ),
        rttMs:
          number(pair?.currentRoundTripTime) === undefined
            ? undefined
            : Number(pair?.currentRoundTripTime) * 1_000,
        route,
        codec: typeof codec === "string" ? codec : undefined,
        qualityLimitationReason: typeof reason === "string" ? reason : undefined,
        maxBitrate: encoding?.maxBitrate,
        maxFramerate: encoding?.maxFramerate,
        scaleResolutionDownBy: encoding?.scaleResolutionDownBy,
      };
      previous = all;
      previousAt = now;
      const current = peers.get(key);
      if (current)
        peers.set(key, {
          ...current,
          connectionState: pc.connectionState,
          sample: value,
          history: [...current.history.slice(-(HISTORY_SIZE - 1)), value],
        });
      publish();
      onSample?.(value);
    } catch {
      if (!stopped) reportPeerIssue(peerId, "Browser stream statistics are unavailable.", role);
    } finally {
      if (!stopped && pc.connectionState !== "closed")
        timer = setTimeout(() => void sample(), SAMPLE_MS);
    }
  }

  void sample();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    const current = peers.get(key);
    if (current) peers.set(key, { ...current, active: false, connectionState: "closed" });
    publish();
  };
}
