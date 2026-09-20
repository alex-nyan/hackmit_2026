"use client";

import { sendSignal } from "./peer";
import {
  MAX_CANDIDATES_PER_BATCH,
  MAX_CANDIDATE_CHARS,
  MAX_CANDIDATES_PER_PEER,
  type SignalMessage,
} from "./signal";

const BATCH_MS = 150;
const MAX_SEND_ATTEMPTS = 3;

/** Batches trickle ICE without turning the blob mailbox into one write per route. */
export function createIceExchange(
  pc: RTCPeerConnection,
  options: {
    sourceId: string;
    from: string;
    to: () => string;
    signal: AbortSignal;
    onIssue: (message: string) => void;
    onFailure: () => void;
  },
) {
  const outgoing: RTCIceCandidateInit[] = [];
  const incoming: RTCIceCandidateInit[] = [];
  const received = new Set<string>();
  const remoteBatches = new Map<number, SignalMessage>();
  let outgoingBatch = 0;
  let nextRemoteBatch = 0;
  let gathered = false;
  let sentComplete = false;
  let remoteComplete = false;
  let appliedComplete = false;
  let localCount = 0;
  let enabled = false;
  let disposed = false;
  let sending = false;
  let sendAttempts = 0;
  // A timed-out HTTP request may already have been stored. Retrying that batch
  // must repeat the exact payload, even if more candidates arrived meanwhile.
  let pendingBatch: { candidates: RTCIceCandidateInit[]; complete: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let applying = Promise.resolve();

  function schedule(delay = BATCH_MS) {
    if (disposed || !enabled || sending || timer || !options.to()) return;
    if (!outgoing.length && (!gathered || sentComplete)) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  }

  async function flush() {
    if (disposed || sending || !options.to()) return;
    sending = true;
    pendingBatch ??= {
      candidates: outgoing.slice(0, MAX_CANDIDATES_PER_BATCH),
      complete: gathered && outgoing.length <= MAX_CANDIDATES_PER_BATCH,
    };
    const { candidates, complete } = pendingBatch;
    const success = await sendSignal(
      options.sourceId,
      {
        kind: "candidates",
        from: options.from,
        to: options.to(),
        candidates,
        complete,
        batch: outgoingBatch,
      },
      options.signal,
    );
    sending = false;
    if (disposed) return;
    if (success) {
      outgoing.splice(0, candidates.length);
      pendingBatch = null;
      outgoingBatch++;
      sentComplete = complete;
      sendAttempts = 0;
    } else if (++sendAttempts >= MAX_SEND_ATTEMPTS) {
      options.onIssue("ICE candidate delivery failed after three attempts.");
      options.onFailure();
      return;
    }
    schedule(success ? BATCH_MS : 500 * sendAttempts);
  }

  function onCandidate(event: RTCPeerConnectionIceEvent) {
    if (disposed) return;
    if (event.candidate) {
      // Browsers may also emit a per-generation empty candidate before the
      // final null event. The explicit complete flag carries that terminator.
      if (!event.candidate.candidate) return;
      if (event.candidate.candidate.length > MAX_CANDIDATE_CHARS) {
        options.onIssue("An oversized ICE candidate was omitted.");
        return;
      }
      if (localCount++ >= MAX_CANDIDATES_PER_PEER) {
        if (localCount === MAX_CANDIDATES_PER_PEER + 1) {
          options.onIssue("ICE candidate limit reached; additional local routes were omitted.");
        }
        return;
      }
      outgoing.push(event.candidate.toJSON());
    } else {
      gathered = true;
    }
    schedule();
  }

  function applyIncoming() {
    applying = applying.then(async () => {
      if (disposed || !pc.remoteDescription) return;
      while (incoming.length && !disposed) {
        const candidate = incoming.shift()!;
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          if (!disposed) options.onIssue(`ICE route rejected: ${String(error)}`);
        }
      }
      if (remoteComplete && !appliedComplete && !disposed) {
        appliedComplete = true;
        try {
          await pc.addIceCandidate(null);
        } catch (error) {
          if (!disposed) options.onIssue(`ICE completion hint rejected: ${String(error)}`);
        }
      }
    });
    return applying;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer) clearTimeout(timer);
    pc.removeEventListener("icecandidate", onCandidate);
    options.signal.removeEventListener("abort", dispose);
    outgoing.length = 0;
    pendingBatch = null;
    incoming.length = 0;
    remoteBatches.clear();
  }

  pc.addEventListener("icecandidate", onCandidate);
  options.signal.addEventListener("abort", dispose, { once: true });

  return {
    start() {
      enabled = true;
      gathered ||= pc.iceGatheringState === "complete";
      schedule();
    },
    receive(message: SignalMessage) {
      const batch = message.batch;
      if (batch === undefined || batch < nextRemoteBatch || remoteBatches.has(batch))
        return applying;
      remoteBatches.set(batch, message);
      // In particular, do not apply end-of-candidates before a preceding batch
      // that has not become visible in blob storage yet.
      while (remoteBatches.has(nextRemoteBatch)) {
        const next = remoteBatches.get(nextRemoteBatch)!;
        remoteBatches.delete(nextRemoteBatch++);
        for (const candidate of next.candidates ?? []) {
          const key = JSON.stringify(candidate);
          if (received.has(key) || received.size >= MAX_CANDIDATES_PER_PEER) continue;
          received.add(key);
          incoming.push(candidate);
        }
        remoteComplete ||= next.complete === true;
      }
      return applyIncoming();
    },
    remoteDescriptionReady: applyIncoming,
    get complete() {
      return sentComplete && remoteComplete;
    },
    dispose,
  };
}
