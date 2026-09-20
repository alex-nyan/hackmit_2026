import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapturePanel } from "../camera-triage";
import { triageFixture, transcriptFixture } from "../contracts/fixtures";
import { useLiveTrack } from "../live-track";
import { PawPatrol } from "./PawPatrol";
import { PEOPLE } from "./scenario";
import { useIncidentBus } from "./useIncidentBus";

vi.mock("./useIncidentBus", () => ({ useIncidentBus: vi.fn() }));
vi.mock("@/features/live-track", () => ({
  useLiveTrack: vi.fn(),
  LiveTrackPanel: () => <div>Live tracking panel</div>,
}));
vi.mock("@/features/camera-triage", () => ({
  CapturePanel: vi.fn(({ sourceId }: { sourceId: string }) => (
    <div data-testid="capture-source">{sourceId}</div>
  )),
}));

vi.mock("./OperationsMap", () => ({
  OperationsMap: ({ selectedId }: { selectedId: string }) => (
    <div data-testid="map-selection">{selectedId}</div>
  ),
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function AnatomyPlaceholder() {
      return <div>Body viewer</div>;
    },
}));

let bus: ReturnType<typeof useIncidentBus>;

beforeEach(() => {
  bus = {
    events: [],
    status: "live",
    publish: vi.fn(async () => true),
    clear: vi.fn(async () => {}),
  };
  vi.mocked(useIncidentBus).mockReturnValue(bus);
  vi.mocked(useLiveTrack).mockReturnValue({ state: "idle" });
});
afterEach(cleanup);

describe("workspace entry points", () => {
  it("preserves switching roles in the standalone demonstration", () => {
    const ui = render(<PawPatrol />);
    const nav = within(ui.getByRole("navigation", { name: "Workspace" }));
    expect(nav.getAllByRole("button")).toHaveLength(3);
    fireEvent.click(nav.getByRole("button", { name: "Officer" }));
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Never out there alone.");
    fireEvent.click(nav.getByRole("button", { name: "Hospital" }));
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Ready before arrival.");
  });

  it.each([
    ["officer", "Officer", "Never out there alone."],
    ["hospital", "Hospital", "Ready before arrival."],
  ] as const)(
    "opens the fixed %s workspace without role switching controls",
    (workspace, label, heading) => {
      const ui = render(<PawPatrol workspace={workspace} />);
      const nav = ui.getByRole("navigation", { name: "Workspace" });
      expect(nav.textContent).toBe(label);
      expect(within(nav).queryAllByRole("button")).toHaveLength(0);
      expect(ui.getByRole("heading", { level: 1 }).textContent).toBe(heading);
      fireEvent.change(ui.getByRole("combobox", { name: /^Selected person$/ }), {
        target: { value: "P-02" },
      });
      fireEvent.click(ui.getByRole("button", { name: "Reset demo" }));
      expect(ui.getByRole("heading", { level: 1 }).textContent).toBe(heading);
      expect(bus.clear).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps unit selection in dispatch without changing the workspace", () => {
    const ui = render(<PawPatrol workspace="dispatch" />);
    const nav = ui.getByRole("navigation", { name: "Workspace" });
    expect(nav.textContent).toBe("Dispatch");
    expect(within(nav).queryAllByRole("button")).toHaveLength(0);
    expect(ui.queryByRole("button", { name: /Open officer & body view/ })).toBeNull();
    expect(ui.queryByRole("button", { name: /View hospital handoff/ })).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: new RegExp(`${PEOPLE[1].name}.*P-02`) }));
    expect(ui.getByTestId("map-selection").textContent).toBe("P-02");
    expect(ui.getByRole("heading", { name: "On the ground" })).toBeTruthy();
    expect(ui.queryByRole("heading", { name: "Never out there alone." })).toBeNull();
  });
});

describe("existing workspace integrations", () => {
  it("keeps live tracking opt-in", () => {
    const ui = render(<PawPatrol workspace="dispatch" />);
    expect(useLiveTrack).toHaveBeenLastCalledWith(false);

    fireEvent.click(ui.getByRole("button", { name: "Show real tracked units" }));
    expect(useLiveTrack).toHaveBeenLastCalledWith(true);

    fireEvent.click(ui.getByRole("button", { name: "Stop live tracking" }));
    expect(useLiveTrack).toHaveBeenLastCalledWith(false);
  });

  it("publishes officer camera and audio reports with the selected identity and provenance", () => {
    const ui = render(<PawPatrol workspace="officer" />);
    expect(ui.getByRole("heading", { name: "Body camera · live" })).toBeTruthy();
    expect(ui.getByTestId("capture-source").textContent).toBe("officer-P-01");
    expect(bus.publish).not.toHaveBeenCalled();

    fireEvent.change(ui.getByRole("combobox", { name: /^Selected person$/ }), {
      target: { value: "P-02" },
    });
    fireEvent.click(ui.getByRole("button", { name: /Next stage/ }));
    expect(ui.getByTestId("capture-source").textContent).toBe("officer-P-02");

    const capture = vi.mocked(CapturePanel).mock.calls.at(-1)![0];
    expect(capture.onResult).toBeTypeOf("function");
    expect(capture.onTranscript).toBeTypeOf("function");
    capture.onResult!(triageFixture({ source_id: "officer-P-02" }));
    capture.onTranscript!(transcriptFixture({ source_id: "officer-P-02" }));

    expect(bus.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "hazard",
        origin: "model",
        personId: "P-02",
        scenarioAt: 15,
        title: "Possible weapon · unverified · P-02",
        source: "Officer body camera",
        provenance: { provider: "ultralytics", model: "yolo26n", confidence: 0.75 },
        requiresHumanReview: true,
      }),
    );
    expect(bus.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "transcript",
        origin: "model",
        personId: "P-02",
        scenarioAt: 15,
        detail: expect.stringContaining("model hypothesis"),
        provenance: { provider: "faster_whisper", model: "whisper", confidence: 0.98 },
        requiresHumanReview: true,
      }),
    );
  });

  it.each(["dispatch", "officer", "hospital"] as const)(
    "retains shared incident provenance in the %s workspace",
    (workspace) => {
      bus.events = [
        {
          seq: 1,
          id: "hazard-request-1",
          kind: "hazard",
          origin: "model",
          at: "2026-09-20T01:00:00Z",
          scenarioAt: 15,
          personId: "P-01",
          title: "Possible weapon · unverified · P-01",
          detail: "A partially obscured object requires review.",
          source: "Officer body camera",
          provenance: { provider: "ultralytics", model: "yolo26n", confidence: 0.75 },
          requiresHumanReview: true,
        },
      ];
      const ui = render(<PawPatrol workspace={workspace} />);

      expect(ui.getByRole("heading", { name: "Shared incident log" })).toBeTruthy();
      expect(ui.getByText("Workspaces in sync")).toBeTruthy();
      expect(ui.getByText("1 shared event")).toBeTruthy();
      expect(ui.getByText("Possible weapon · unverified · P-01")).toBeTruthy();
      expect(ui.getByText("Model output · unreviewed")).toBeTruthy();
      expect(ui.getByText("ultralytics/yolo26n")).toBeTruthy();
      expect(ui.getByTitle("Uncalibrated model score, not a probability").textContent).toBe("0.75");
    },
  );

  it("keeps manual assistance publication and shared-log reset working", () => {
    const ui = render(<PawPatrol workspace="officer" />);
    fireEvent.click(ui.getByRole("button", { name: "Demo panic · P-01" }));

    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "panic",
        origin: "operator",
        personId: "P-01",
        provenance: null,
      }),
    );
    expect(ui.getByText(/P-01 · assistance requested at/)).toBeTruthy();

    fireEvent.click(ui.getByRole("button", { name: "Reset demo" }));
    expect(bus.clear).toHaveBeenCalledTimes(1);
    expect(ui.queryByText(/P-01 · assistance requested at/)).toBeNull();
  });
});
