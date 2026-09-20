import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapturePanel } from "../camera-triage";
import { triageFixture, transcriptFixture } from "../contracts/fixtures";
import { useLiveTrack } from "../live-track";
import * as heartRateHooks from "../heart-rate/useHeartRate";
import { PawPatrol } from "./PawPatrol";
import { OperationsMap, type OperationsMapProps } from "./OperationsMap";
import { PEOPLE, sampleHeartRate } from "./scenario";
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
  it.each(["officer", "dispatch", "hospital"] as const)(
    "opts only Officer into liquid glass in the fixed %s workspace",
    (workspace) => {
      const ui = render(<PawPatrol workspace={workspace} />);
      const officer = workspace === "officer";
      expect(vi.mocked(OperationsMap).mock.calls.at(-1)![0].appearance).toBe(
        officer ? "glass" : "default",
      );
      expect(ui.container.querySelector('[data-officer-glass="true"]') !== null).toBe(officer);
      expect(ui.container.querySelectorAll("[data-liquid-glass]").length > 0).toBe(officer);
      expect(ui.queryByRole("button", { name: "Officer overview" }) !== null).toBe(officer);
      expect(bus.publish).not.toHaveBeenCalled();
      expect(bus.clear).not.toHaveBeenCalled();
    },
  );

  it("removes the glass opt-in when navigating away from Officer", () => {
    const ui = render(<PawPatrol />);
    const navigate = (name: string) =>
      fireEvent.click(
        within(ui.getByRole("navigation", { name: "Workspace" })).getByRole("button", { name }),
      );

    for (const name of ["Officer", "Hospital", "Officer", "Command"]) {
      navigate(name);
      const officer = name === "Officer";
      expect(vi.mocked(OperationsMap).mock.calls.at(-1)![0].appearance).toBe(
        officer ? "glass" : "default",
      );
      expect(ui.container.querySelector('[data-officer-glass="true"]') !== null).toBe(officer);
      expect(ui.container.querySelectorAll("[data-liquid-glass]").length > 0).toBe(officer);
      expect(ui.queryByRole("button", { name: "Officer overview" }) !== null).toBe(officer);
    }
    expect(bus.publish).not.toHaveBeenCalled();
    expect(bus.clear).not.toHaveBeenCalled();
  });

  it("switches Officer glass themes without resetting selection or closing its overview", () => {
    const ui = render(<PawPatrol />);
    const navigate = (name: string) =>
      fireEvent.click(
        within(ui.getByRole("navigation", { name: "Workspace" })).getByRole("button", { name }),
      );
    navigate("Officer");
    fireEvent.click(ui.getByRole("button", { name: "Officer overview" }));
    const overview = ui.getByRole("region", { name: "Officer overview" });
    const selection = within(overview).getByRole("combobox", {
      name: "Overview officer",
    }) as HTMLSelectElement;
    fireEvent.change(selection, { target: { value: "P-04" } });
    const root = ui.container.querySelector('[data-officer-glass="true"]');
    expect(root?.getAttribute("data-officer-theme")).toBe("light");

    for (const theme of ["dark", "light"]) {
      fireEvent.click(ui.getByRole("button", { name: "Toggle map theme" }));
      expect(root?.getAttribute("data-officer-theme")).toBe(theme);
      expect(ui.getByTestId("map-selection").getAttribute("data-theme")).toBe(theme);
      expect(ui.getByTestId("map-selection").textContent).toBe("P-04");
      expect(ui.getByRole("region", { name: "Officer overview" })).toBe(overview);
      expect(selection.value).toBe("P-04");
      expect(
        ui.getByRole("button", { name: "Officer overview" }).getAttribute("aria-expanded"),
      ).toBe("true");
    }

    for (const role of ["Hospital", "Command"]) {
      navigate(role);
      expect(ui.container.querySelector("[data-officer-theme], [data-officer-glass]")).toBeNull();
      expect(ui.container.querySelector("[data-liquid-glass]")).toBeNull();
      expect(vi.mocked(OperationsMap).mock.calls.at(-1)![0].appearance).toBe("default");
    }
    expect(bus.publish).not.toHaveBeenCalled();
    expect(bus.clear).not.toHaveBeenCalled();
  });

  it("preserves switching roles in the detailed standalone demonstration", () => {
    const ui = render(<PawPatrol presentation="detailed" />);
    const nav = within(ui.getByRole("navigation", { name: "Workspace" }));
    expect(nav.getAllByRole("button")).toHaveLength(3);
    fireEvent.click(nav.getByRole("button", { name: "Officer" }));
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Officer workspace");
    fireEvent.click(nav.getByRole("button", { name: "Hospital" }));
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Ready before arrival.");
  });

  it.each([
    ["officer", "Officer", "Officer workspace"],
    ["hospital", "Hospital", "Ready before arrival."],
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
});

describe("default map-only workspace shells", () => {
  it.each([
    ["dispatch", "Dispatch", "Dispatch workspace"],
    ["hospital", "Medic", "Medic workspace"],
  ] as const)(
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
      expect(useLiveTrack).toHaveBeenLastCalledWith(false);
      expect(bus.publish).not.toHaveBeenCalled();
      expect(bus.clear).not.toHaveBeenCalled();
    },
  );

  it.each(["dispatch", "hospital"] as const)(
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
      expect(useLiveTrack).toHaveBeenLastCalledWith(false);
      expect(bus.publish).not.toHaveBeenCalled();
      expect(bus.clear).not.toHaveBeenCalled();
    },
  );

  it("keeps standalone role navigation while Dispatch and Medic remain map-only", () => {
    const ui = render(<PawPatrol />);
    const nav = within(ui.getByRole("navigation", { name: "Workspace" }));
    expect(nav.getAllByRole("button")).toHaveLength(3);
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Dispatch workspace");

    fireEvent.click(nav.getByRole("button", { name: "Hospital" }));
    expect(ui.getByRole("heading", { level: 1 }).textContent).toBe("Medic workspace");
    expect(ui.getAllByRole("region", { name: "Operations map" })).toHaveLength(1);
    expect(CapturePanel).not.toHaveBeenCalled();
    fireEvent.click(nav.getByRole("button", { name: "Officer" }));
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
  it("keeps the Officer overview selection, map, vitals and capture identity synchronized", () => {
    const ui = render(<PawPatrol workspace="officer" />);
    expect(ui.queryByRole("region", { name: "Officer overview" })).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Officer overview" }));
    const panel = ui.getByRole("region", { name: "Officer overview" });
    const overview = within(panel);
    const roster = overview.getByRole("list", { name: "Officer roster" });
    expect(within(roster).getAllByRole("button")).toHaveLength(PEOPLE.length);
    const row = (id: string) => roster.querySelector<HTMLElement>(`[data-officer-id="${id}"]`)!;
    const overlay = ui.container.querySelector(".map-overlay");
    expect(ui.container.querySelectorAll(".map-overlay")).toHaveLength(1);
    expect(overlay?.parentElement).toBe(panel.parentElement?.parentElement);
    expect(overlay?.textContent).toContain("Live tracking panel");
    const overviewSelect = overview.getByRole("combobox", {
      name: "Overview officer",
    }) as HTMLSelectElement;
    const mapSelect = ui.getByRole("combobox", {
      name: /^Selected person$/,
    }) as HTMLSelectElement;

    fireEvent.change(overviewSelect, { target: { value: "P-02" } });
    expect(overviewSelect.value).toBe("P-02");
    expect(mapSelect.value).toBe("P-02");
    expect(ui.getByTestId("map-selection").textContent).toBe("P-02");
    expect(row("P-02").getAttribute("aria-pressed")).toBe("true");
    expect(row("P-01").getAttribute("aria-pressed")).toBe("false");
    expect(within(row("P-02")).getByText(PEOPLE[1].name)).toBeTruthy();
    expect(within(row("P-02")).getByText(String(sampleHeartRate("P-02", 0)))).toBeTruthy();
    expect(within(row("P-02")).getByText("Simulated")).toBeTruthy();

    fireEvent.change(mapSelect, { target: { value: "P-03" } });
    expect(overviewSelect.value).toBe("P-03");
    expect(row("P-03").getAttribute("aria-pressed")).toBe("true");
    expect(row("P-02").getAttribute("aria-pressed")).toBe("false");
    expect(ui.getByTestId("map-selection").textContent).toBe("P-03");

    fireEvent.click(row("P-04"));
    expect(row("P-04").getAttribute("aria-pressed")).toBe("true");
    expect(row("P-03").getAttribute("aria-pressed")).toBe("false");
    expect(overviewSelect.value).toBe("P-04");
    expect(mapSelect.value).toBe("P-04");
    expect(ui.getByTestId("map-selection").textContent).toBe("P-04");
    expect(bus.publish).not.toHaveBeenCalled();
    expect(bus.clear).not.toHaveBeenCalled();

    fireEvent.click(ui.getByRole("button", { name: "Camera" }));
    expect(ui.getByTestId("capture-source").textContent).toBe("officer-P-04");
    const capture = vi.mocked(CapturePanel).mock.calls.at(-1)![0];
    capture.onResult!(triageFixture({ source_id: "officer-P-04" }));
    expect(bus.publish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: "hazard",
        personId: "P-04",
        origin: "model",
        source: "Officer body camera",
        provenance: { provider: "ultralytics", model: "yolo26n", confidence: 0.75 },
        requiresHumanReview: true,
      }),
    );
  });

  it.each(["waiting", "stale", "disconnected", "error"] as const)(
    "does not label an old device BPM as current in the Officer overview while %s",
    (status) => {
      vi.spyOn(heartRateHooks, "useHeartRate").mockReturnValue({
        mode: "device",
        status,
        bpm: 123,
        receivedAt: 1_000,
        deviceName: "HeartCast",
        message: "No current device reading.",
        history: [
          { bpm: 117, receivedAt: 500 },
          { bpm: 123, receivedAt: 1_000 },
        ],
        supported: true,
        connect: vi.fn(async () => {}),
        disconnect: vi.fn(),
        useDemo: vi.fn(),
      });
      const ui = render(<PawPatrol workspace="officer" />);
      fireEvent.click(ui.getByRole("button", { name: "Officer overview" }));
      const panel = ui.getByRole("region", { name: "Officer overview" });
      const overview = within(panel);
      const selectedRow = panel.querySelector<HTMLElement>('[data-officer-id="P-01"]')!;
      const readout = within(selectedRow);
      expect(selectedRow.getAttribute("aria-pressed")).toBe("true");
      expect(selectedRow.getAttribute("data-source")).toBe("device");
      expect(readout.getByText("--")).toBeTruthy();
      expect(readout.queryByText("123")).toBeNull();
      expect(readout.queryByText("Live device")).toBeNull();
      expect(readout.getByText(`${status} · no current reading`)).toBeTruthy();
      expect(readout.queryByText("Simulated")).toBeNull();
      expect(readout.getByText("Past received BPM · not ECG")).toBeTruthy();
      expect(selectedRow.querySelector("svg[data-running]")).toBeNull();
      expect(overview.getAllByText("Simulated")).toHaveLength(PEOPLE.length - 1);
      expect(overview.getByText(/not verified officer identity/)).toBeTruthy();
      expect(bus.publish).not.toHaveBeenCalled();
      expect(bus.clear).not.toHaveBeenCalled();
    },
  );

  it.each(["dispatch", "hospital"] as const)("keeps live tracking opt-in in %s", (workspace) => {
    const ui = render(<PawPatrol workspace={workspace} />);
    expect(useLiveTrack).toHaveBeenLastCalledWith(false);

    fireEvent.click(ui.getByRole("button", { name: "Show real tracked units" }));
    expect(useLiveTrack).toHaveBeenLastCalledWith(true);

    fireEvent.click(ui.getByRole("button", { name: "Stop live tracking" }));
    expect(useLiveTrack).toHaveBeenLastCalledWith(false);
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
