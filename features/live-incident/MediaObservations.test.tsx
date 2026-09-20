import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidencePreview } from "./MediaObservations";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("capture evidence", () => {
  it("labels expired evidence and never substitutes another capture", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    render(<EvidencePreview evidenceId="capture-original" />);
    fireEvent.click(screen.getByText("Review capture"));
    await screen.findByText("Evidence expired or unavailable. This capture cannot be reviewed.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/live/evidence/capture-original");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("releases the evidence object when the operator closes it", async () => {
    const create = vi.fn().mockReturnValue("blob:test-capture");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Blob(["jpeg"]), { headers: { "Content-Type": "image/jpeg" } }),
        ),
    );
    render(<EvidencePreview evidenceId="frame-1" />);
    fireEvent.click(screen.getByText("Review capture"));
    await screen.findByRole("img");
    fireEvent.click(screen.getByText("Close evidence"));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:test-capture"));
    expect(screen.queryByRole("img")).toBeNull();
  });
});
