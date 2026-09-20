"use client";
import { useEffect, useState } from "react";
import type { InstanceSnapshot, Ownership, Command } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  data?: unknown,
  secret?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/instances${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-publisher-secret": secret } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(result.error ?? "Shared service unavailable.", response.status, result.code);
  return result as T;
}
export function sendCommand(owner: Ownership, command: Command, sequence: number) {
  return api<InstanceSnapshot>("/command", { ...command, id: owner.id, sequence }, owner.secret);
}
export function useInstance(hospital = false) {
  const [state, setState] = useState<{ snapshot: InstanceSnapshot | null; error: string | null }>({
    snapshot: null,
    error: null,
  });
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const snapshot = await api<InstanceSnapshot>(
          hospital ? "?role=hospital" : "",
          undefined,
          undefined,
          AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        );
        if (!disposed)
          setState((old) =>
            old.snapshot &&
            snapshot.instance &&
            old.snapshot.instance?.id === snapshot.instance.id &&
            old.snapshot.instance.revision > snapshot.instance.revision
              ? old
              : { snapshot, error: null },
          );
      } catch (error) {
        // Drop the snapshot on transport failure: no old safety/telemetry appears live.
        if (!disposed)
          setState({
            snapshot: null,
            error: error instanceof Error ? error.message : "Connection unavailable.",
          });
      }
      if (!disposed) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [hospital]);
  return state;
}
