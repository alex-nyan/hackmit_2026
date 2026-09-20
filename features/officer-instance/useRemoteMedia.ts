"use client";
import { useEffect, useState } from "react";
import { Room, RoomEvent } from "livekit-client";
import type { OfficerMediaInput } from "../paw-patrol/OfficerFeed";
import { api } from "./client";

export function useRemoteMedia(
  id: string | null,
  publisher: string | undefined,
  hospital: boolean,
) {
  const [media, setMedia] = useState<OfficerMediaInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout>;
    let room: Room | null = null;
    const controller = new AbortController();
    async function connect() {
      const current = new Room();
      room = current;
      const sync = () => {
        if (disposed || room !== current) return;
        const tracks = [...current.remoteParticipants.values()]
          .filter((p) => p.identity === publisher)
          .flatMap((p) =>
            [...p.trackPublications.values()].flatMap((t) =>
              t.track && !t.isMuted ? [t.track.mediaStreamTrack] : [],
            ),
          );
        setMedia(tracks.length ? { personId: id!, stream: new MediaStream(tracks) } : null);
      };
      current
        .on(RoomEvent.TrackSubscribed, sync)
        .on(RoomEvent.TrackUnsubscribed, sync)
        .on(RoomEvent.TrackMuted, sync)
        .on(RoomEvent.TrackUnmuted, sync)
        .on(RoomEvent.ParticipantDisconnected, sync);
      current.on(RoomEvent.Reconnecting, () => {
        if (!disposed) {
          setMedia(null);
          setError("Reconnecting officer feed…");
        }
      });
      current.on(RoomEvent.Reconnected, () => {
        if (!disposed) {
          setError(null);
          sync();
        }
      });
      current.on(RoomEvent.Disconnected, () => {
        if (!disposed && room === current) {
          room = null;
          setMedia(null);
          setError("Officer feed disconnected. Reconnecting…");
          retry = setTimeout(connect, 3000);
        }
      });
      try {
        const credentials = await api<{ url: string; token: string }>(
          "/token",
          { id, role: hospital ? "hospital" : "viewer" },
          undefined,
          AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        );
        if (disposed) return;
        await current.connect(credentials.url, credentials.token);
        if (disposed) {
          await current.disconnect();
          return;
        }
        setError(null);
        sync();
      } catch (error) {
        if (room === current) room = null;
        void current.disconnect();
        if (!disposed) {
          setMedia(null);
          setError(error instanceof Error ? error.message : "Media unavailable.");
          retry = setTimeout(connect, 3000);
        }
      }
    }
    void connect();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(retry);
      void room?.disconnect();
    };
  }, [id, publisher, hospital]);
  return { media: media?.personId === id ? media : null, error: id ? error : null };
}
