import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapturePanel } from "../camera-triage";
import { triageFixture, transcriptFixture } from "../contracts/fixtures";
import { useLiveTrack } from "../live-track";
import { PawPatrol } from "./PawPatrol";
import { OperationsMap, type OperationsMapProps } from "./OperationsMap";
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
  OperationsMap: vi.fn(({ selectedId, following, theme, focus }: OperationsMapProps) => (
    <div
      data-testid="map-selection"
      data-following={following}
      data-theme={theme}
      data-focus={focus}
    >
      {selectedId}
    </div>
  )),
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
  it("preserves switching roles in the detailed standalone demonstration", () => {
    const ui = render(<PawPatrol presentation="detailed" />);
    const nav = within(ui.getByRole("navigation", { name: "Workspace" }));
    expect(nav.getAllByRole("button")).toHaveLength(3);
    fireEvent.click(nav.getByRole("button", { name: "Officer" }));
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Officer workspace");
    fireEvent.click(nav.getByRole("button", { name: "Hospital" }));
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Officer care");
  });

  it.each([
    ["officer", "Officer", "Officer workspace"],
    ["hospital", "Hospital", "Officer care"],
  ] as const)(
    "opens the fixed %s workspace without role switching controls",
    (workspace, label, heading) => {
      const ui = render(<PawPatrol workspace={workspace} presentation="detailed" />);
      const nav = ui.getByRole("navigation", { name: "Workspace" });
      expect(nav.textContent?.trim()).toBe(label);
      expect(within(nav).queryAllByRole("button")).toHaveLength(0);
      expect(ui.getByRole("heading", { level: 1 }).textContent).toBe(heading);
      fireEvent.change(ui.getByRole("combobox", { name: /^Selected person$/ }), {
        target: { value: "P-02" },
      });
      if (workspace === "hospital")
        fireEvent.click(ui.getByText("Connections", { selector: "summary span" }));
      fireEvent.click(ui.getByRole("button", { name: "Reset demo" }));
      expect(ui.getByRole("heading", { level: 1 }).textContent).toBe(heading);
      expect(bus.clear).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps officer selection and map controls while removing the overview panels", () => {
    const ui = render(<PawPatrol workspace="officer" />);
    expect(ui.queryByText("Body viewer")).toBeNull();
    expect(ui.queryByRole("heading", { name: "Heart rate" })).toBeNull();
    expect(ui.queryByText("INCIDENT RESPONSE UNITS")).toBeNull();
    expect(ui.queryByText(/Synthetic people and signals/)).toBeNull();
    fireEvent.change(ui.getByLabelText("Selected person"), { target: { value: "P-03" } });
    expect(ui.getByTestId("map-selection").textContent).toBe("P-03");
    fireEvent.click(ui.getByRole("button", { name: "Follow P-03" }));
    expect(ui.getByRole("button", { name: "Stop following" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(ui.getByRole("button", { name: "Camera" }));
    expect(ui.getByRole("heading", { name: "Camera & audio" })).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Close camera" }));
    expect(ui.queryByRole("heading", { name: "Camera & audio" })).toBeNull();
  });

  // Hospital has its own shell with a camera overlay now, so the shared map is
  // a claim about the two workspaces that still show one.
  it("gives dispatch and officer the same operations map", () => {
    for (const workspace of ["dispatch", "officer"] as const) {
      const ui = render(<PawPatrol workspace={workspace} />);
      const map = ui.getByRole("region", { name: "Operations map" });
      expect(within(map).getByTestId("map-selection").textContent).toBe("P-01");
      cleanup();
    }
  });

  it("keeps unit selection in dispatch without changing the workspace", () => {
    const ui = render(<PawPatrol workspace="dispatch" presentation="detailed" />);
    const nav = ui.getByRole("navigation", { name: "Workspace" });
    expect(nav.textContent).toBe("Dispatch");
    expect(within(nav).queryAllByRole("button")).toHaveLength(0);
    expect(ui.queryByRole("button", { name: /Open officer & body view/ })).toBeNull();
    expect(ui.queryByRole("button", { name: /View hospital handoff/ })).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: new RegExp(`${PEOPLE[1].name}.*P-02`) }));
    expect(ui.getByTestId("map-selection").textContent).toBe("P-02");
    expect(ui.getByRole("heading", { name: "On the ground" })).toBeTruthy();
    expect(ui.queryByRole("heading", { name: "Officer workspace" })).toBeNull();
  });

  it("prioritizes hospital media and heart rate, with setup below the main view", () => {
    const ui = render(<PawPatrol workspace="hospital" />);
    expect(ui.getByRole("region", { name: "Officer camera and audio" })).toBeTruthy();
    expect(ui.getByRole("region", { name: "Heart monitor" })).toBeTruthy();
    expect(ui.queryByText("Body viewer")).toBeNull();
    expect(
      ui.queryByText(
        /Awaiting a handoff|Context, not conclusions|Demo heart rate|Connect your own device/,
      ),
    ).toBeNull();
    const connectionControls = ui
      .getByRole("button", { name: "Connect Heart Rate" })
      .closest("details");
    expect(connectionControls?.open).toBe(false);
    fireEvent.click(ui.getByText("Connections", { selector: "summary span" }));
    expect(ui.getByRole("button", { name: "Connect Heart Rate" })).toBeTruthy();
  });

  it("shows only the selected officer's latest audio report without converting it into clearance", () => {
    const event = {
      seq: 1,
      id: "transcript-one",
      kind: "transcript" as const,
      origin: "model" as const,
      at: "2026-09-20T01:00:00Z",
      scenarioAt: 15,
      personId: "P-01",
      title: "Audio concern",
      detail: "First officer audio report",
      source: "Officer body camera",
      provenance: { provider: "faster_whisper", model: "whisper", confidence: 0.98 },
      requiresHumanReview: true,
    };
    bus.events = [
      event,
      {
        ...event,
        seq: 2,
        id: "transcript-two",
        personId: "P-02",
        detail: "Second officer audio report",
      },
    ];
    const ui = render(<PawPatrol workspace="hospital" />);
    fireEvent.click(ui.getByText("Activity & source details", { selector: "summary" }));
    const media = within(ui.getByRole("region", { name: "Latest audio report" }));
    expect(media.getByText("First officer audio report")).toBeTruthy();
    expect(media.queryByText("Second officer audio report")).toBeNull();
    expect(ui.getByText("Hold · Clearance unconfirmed")).toBeTruthy();
    fireEvent.change(ui.getByLabelText("Selected person"), { target: { value: "P-02" } });
    expect(media.getByText("Second officer audio report")).toBeTruthy();
    expect(media.queryByText("First officer audio report")).toBeNull();
    expect(media.getByText("Machine transcript · unverified")).toBeTruthy();
  });
});

describe("default map-only workspace shells", () => {
  it.each([["dispatch", "Dispatch", "Dispatch workspace"]] as const)(
    "opens a fixed %s shell with no legacy feature panels mounted",
    (workspace, label, heading) => {
      const ui = render(<PawPatrol workspace={workspace} />);
      const nav = ui.getByRole("navigation", { name: "Workspace" });

      expect(ui.getByRole("link", { name: "Paw Patrol home" })).toBeTruthy();
      expect(nav.textContent?.trim()).toBe(label);
      expect(within(nav).queryAllByRole("button")).toHaveLength(0);
      expect(ui.getByRole("heading", { level: 1 }).textContent).toBe(heading);
      expect(ui.getAllByRole("region", { name: "Operations map" })).toHaveLength(1);
      expect(ui.getAllByTestId("map-selection")).toHaveLength(1);
      expect(ui.getByRole("combobox", { name: /^Selected person$/ })).toBeTruthy();
      expect(
        ui.queryByRole("button", {
          name: /Devices|Camera|Audio|Run demo|Pause demo|Reset demo|Demo panic/,
          hidden: true,
        }),
      ).toBeNull();
      expect(ui.queryByRole("region", { name: "Heart rate connection", hidden: true })).toBeNull();
      expect(ui.queryByRole("region", { name: "MIST clinical handoff", hidden: true })).toBeNull();
      expect(ui.queryByText("Body viewer")).toBeNull();
      expect(ui.queryByText("Camera & audio")).toBeNull();
      expect(ui.queryByText("Hardware readiness")).toBeNull();
      expect(ui.queryByText("Shared incident log")).toBeNull();
      expect(ui.queryByText("INCIDENT RESPONSE UNITS")).toBeNull();
      expect(ui.queryByText("Awaiting a handoff.")).toBeNull();
      expect(ui.queryByLabelText("Selected person heart rate")).toBeNull();
      expect(
        ui.container.querySelector(
          ".command-grid, .hospital-grid, .hardware-panel, .evidence-panel, #officer-camera",
        ),
      ).toBeNull();
      expect(CapturePanel).not.toHaveBeenCalled();
      expect(useIncidentBus).toHaveBeenCalled();
      expect(useLiveTrack).toHaveBeenLastCalledWith(true);
      expect(bus.publish).not.toHaveBeenCalled();
      expect(bus.clear).not.toHaveBeenCalled();
    },
  );

  it.each(["dispatch"] as const)(
    "keeps selection, follow, recenter and theme controls local in the %s shell",
    (workspace) => {
      const ui = render(<PawPatrol workspace={workspace} />);
      const map = ui.getByTestId("map-selection");
      expect(vi.mocked(OperationsMap).mock.calls.at(-1)![0]).toEqual(
        expect.objectContaining({
          selectedId: "P-01",
          following: false,
          theme: "light",
          focus: "all",
          recenterKey: 0,
          liveDevices: [],
          fixRequest: null,
          readClock: expect.any(Function),
          onSelect: expect.any(Function),
        }),
      );

      fireEvent.change(ui.getByRole("combobox", { name: /^Selected person$/ }), {
        target: { value: "P-03" },
      });
      expect(map.textContent).toBe("P-03");
      fireEvent.click(ui.getByRole("button", { name: "Follow P-03" }));
      expect(map.getAttribute("data-following")).toBe("true");
      expect(ui.getByRole("button", { name: "Stop following" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      fireEvent.click(ui.getByRole("button", { name: "Stop following" }));
      expect(map.getAttribute("data-following")).toBe("false");
      fireEvent.click(ui.getByRole("button", { name: "Toggle map theme" }));
      expect(map.getAttribute("data-theme")).toBe("dark");
      fireEvent.click(ui.getByRole("button", { name: "Centre selected officer" }));
      expect(vi.mocked(OperationsMap).mock.calls.at(-1)![0].recenterKey).toBe(1);
      expect(CapturePanel).not.toHaveBeenCalled();
      expect(useLiveTrack).toHaveBeenLastCalledWith(true);
      expect(bus.publish).not.toHaveBeenCalled();
      expect(bus.clear).not.toHaveBeenCalled();
    },
  );

  it("keeps standalone role navigation while Dispatch stays map-only and Hospital keeps its camera overlay", () => {
    const ui = render(<PawPatrol />);
    const nav = within(ui.getByRole("navigation", { name: "Workspace" }));
    expect(nav.getAllByRole("button")).toHaveLength(3);
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Dispatch workspace");

    fireEvent.click(nav.getByRole("button", { name: "Hospital" }));
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Officer care");
    expect(ui.queryByRole("region", { name: "Operations map" })).toBeNull();
    expect(ui.getByRole("region", { name: "Officer camera and audio" })).toBeTruthy();
    expect(ui.getByRole("region", { name: "Heart monitor" })).toBeTruthy();
    expect(CapturePanel).not.toHaveBeenCalled();
    fireEvent.click(
      within(ui.getByRole("navigation", { name: "Workspace" })).getByRole("button", {
        name: "Officer",
      }),
    );
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Officer workspace");
    expect(ui.getByRole("button", { name: "Camera" })).toBeTruthy();
    fireEvent.click(
      within(ui.getByRole("navigation", { name: "Workspace" })).getByRole("button", {
        name: "Command",
      }),
    );
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Dispatch workspace");
    expect(ui.queryByTestId("capture-source")).toBeNull();
    expect(ui.queryByRole("button", { name: "Camera" })).toBeNull();
    expect(bus.publish).not.toHaveBeenCalled();
    expect(bus.clear).not.toHaveBeenCalled();
  });
});

describe("existing workspace integrations", () => {
  it.each(["dispatch"] as const)("draws tracked units until told not to in %s", (workspace) => {
    // On by default: a phone that scans the join code and publishes has to
    // appear without anybody first finding a switch in the map header.
    const ui = render(<PawPatrol workspace={workspace} />);
    expect(useLiveTrack).toHaveBeenLastCalledWith(true);

    fireEvent.click(ui.getByRole("button", { name: "Stop live tracking" }));
    expect(useLiveTrack).toHaveBeenLastCalledWith(false);

    fireEvent.click(ui.getByRole("button", { name: "Show real tracked units" }));
    expect(useLiveTrack).toHaveBeenLastCalledWith(true);
  });

  it("publishes officer camera and audio reports with the selected identity and provenance", () => {
    const ui = render(<PawPatrol workspace="officer" />);
    fireEvent.click(ui.getByRole("button", { name: "Camera" }));
    expect(ui.getByRole("heading", { name: "Camera & audio" })).toBeTruthy();
    expect(ui.getByTestId("capture-source").textContent).toBe("officer-P-01");
    expect(bus.publish).not.toHaveBeenCalled();

    fireEvent.change(ui.getByRole("combobox", { name: /^Selected person$/ }), {
      target: { value: "P-02" },
    });
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
        scenarioAt: 0,
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
        scenarioAt: 0,
        detail: expect.stringContaining("model hypothesis"),
        provenance: { provider: "faster_whisper", model: "whisper", confidence: 0.98 },
        requiresHumanReview: true,
      }),
    );
  });

  it.each(["dispatch", "hospital"] as const)(
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
      const ui = render(<PawPatrol workspace={workspace} presentation="detailed" />);

      if (workspace === "hospital")
        fireEvent.click(ui.getByText("Activity & source details", { selector: "summary" }));
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
    const ui = render(<PawPatrol workspace="dispatch" presentation="detailed" />);
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
