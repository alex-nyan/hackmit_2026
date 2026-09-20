import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWakeLock } from "./useWakeLock";

function sentinel() {
  const target = new EventTarget();
  return Object.assign(target, {
    release: vi.fn(async () => target.dispatchEvent(new Event("release"))),
  });
}

const request = vi.fn();
let hidden = false;

beforeEach(() => {
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  request.mockReset().mockImplementation(async () => sentinel());
  vi.stubGlobal("navigator", { wakeLock: { request } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("holding the screen awake", () => {
  it("takes a lock only while a capture is running", async () => {
    const { rerender } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: false },
    });
    await settle();
    expect(request).not.toHaveBeenCalled();

    rerender({ active: true });
    await settle();
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("releases it when the capture stops", async () => {
    const held = sentinel();
    request.mockResolvedValue(held);
    const { rerender } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    });
    await settle();

    rerender({ active: false });
    await settle();
    expect(held.release).toHaveBeenCalledOnce();
  });

  it("takes it again on returning to visibility, because the browser drops it", async () => {
    renderHook(() => useWakeLock(true));
    await settle();
    expect(request).toHaveBeenCalledOnce();

    await act(async () => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Nothing to ask for while hidden: the request would only be refused.
    expect(request).toHaveBeenCalledOnce();

    await act(async () => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("survives a browser that refuses or does not implement it", async () => {
    request.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
    await settle();

    vi.stubGlobal("navigator", {});
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });

  it("releases a lock granted after the capture already stopped", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof sentinel>>();
    request.mockReturnValue(pending.promise);
    const { unmount } = renderHook(() => useWakeLock(true));
    unmount();

    const late = sentinel();
    await act(async () => {
      pending.resolve(late);
      await pending.promise;
    });
    await settle();
    expect(late.release).toHaveBeenCalledOnce();
  });
});
