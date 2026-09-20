import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHeartRate } from "../heart-rate/useHeartRate";
import { PawPatrol } from "./PawPatrol";
import { PEOPLE, sampleHeartRate } from "./scenario";
import { useIncidentBus } from "./useIncidentBus";

vi.mock("../heart-rate/useHeartRate", () => ({ useHeartRate: vi.fn() }));
vi.mock("./useIncidentBus", () => ({ useIncidentBus: vi.fn() }));
vi.mock("@/features/live-track", () => ({
  useLiveTrack: () => ({ state: "idle" }),
  LiveTrackPanel: () => <div>Live tracking panel</div>,
}));
vi.mock("@/features/camera-triage", () => ({
  CapturePanel: () => <div>Camera capture</div>,
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

type HeartRate = ReturnType<typeof useHeartRate>;
const mockUseHeartRate = vi.mocked(useHeartRate);
let bus: ReturnType<typeof useIncidentBus>;

function heartRate(overrides: Partial<HeartRate> = {}): HeartRate {
  return {
    mode: "demo",
    status: "idle",
    bpm: null,
    receivedAt: null,
    deviceName: null,
    message: "Not connected",
    history: [],
    supported: true,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    useDemo: vi.fn(),
    ...overrides,
  };
}

function receiving(): HeartRate {
  return heartRate({
    mode: "device",
    status: "receiving",
    bpm: 123,
    receivedAt: 1_000,
    deviceName: "HeartCast",
    message: "Receiving heart rate from HeartCast",
    history: [
      { bpm: 117, receivedAt: 500 },
      { bpm: 123, receivedAt: 1_000 },
    ],
  });
}

beforeEach(() => {
  mockUseHeartRate.mockReturnValue(heartRate());
  bus = {
    events: [],
    status: "live",
    publish: vi.fn(async () => true),
    clear: vi.fn(async () => {}),
  };
  vi.mocked(useIncidentBus).mockReturnValue(bus);
});
afterEach(cleanup);

describe("dashboard heart-rate integration", () => {
  it.each(["dispatch", "officer", "hospital"] as const)(
    "offers an explicit local connection in the %s workspace",
    (workspace) => {
      const feed = heartRate();
      mockUseHeartRate.mockReturnValue(feed);
      const ui = render(<PawPatrol workspace={workspace} />);

      expect(feed.connect).not.toHaveBeenCalled();
      fireEvent.click(ui.getByRole("button", { name: /connect heart rate/i }));

      expect(feed.connect).toHaveBeenCalledTimes(1);
      expect(mockUseHeartRate).toHaveBeenLastCalledWith("P-01", 0);
      expect(
        within(ui.getByLabelText("Selected person heart rate")).getByText(
          String(sampleHeartRate("P-01", 0)),
        ),
      ).toBeTruthy();
      expect(bus.publish).not.toHaveBeenCalled();
    },
  );

  it.each(["dispatch", "officer", "hospital"] as const)(
    "replaces the %s selected-person reading with the received BPM without publishing it",
    (workspace) => {
      mockUseHeartRate.mockReturnValue(receiving());
      const ui = render(<PawPatrol workspace={workspace} />);
      const reading = within(ui.getByLabelText("Selected person heart rate"));

      expect(reading.getByText("123")).toBeTruthy();
      expect(reading.queryByText(String(sampleHeartRate("P-01", 0)))).toBeNull();
      expect(ui.queryByRole("img", { name: "Synthetic heart rate trend" })).toBeNull();

      mockUseHeartRate.mockReturnValue({ ...receiving(), bpm: 129 });
      ui.rerender(<PawPatrol workspace={workspace} />);
      expect(reading.getByText("129")).toBeTruthy();
      expect(reading.queryByText("123")).toBeNull();
      expect(bus.publish).not.toHaveBeenCalled();
    },
  );

  it.each(["officer", "hospital"] as const)(
    "shows received history instead of an invented trend in %s",
    (workspace) => {
      mockUseHeartRate.mockReturnValue(receiving());
      const ui = render(<PawPatrol workspace={workspace} />);

      expect(ui.getByRole("img", { name: "Received heart rate trend" })).toBeTruthy();
      expect(ui.queryByRole("img", { name: "Synthetic heart rate trend" })).toBeNull();
      fireEvent.click(ui.getByRole("button", { name: /Next stage/ }));
      expect(within(ui.getByLabelText("Selected person heart rate")).getByText("123")).toBeTruthy();
      expect(bus.publish).not.toHaveBeenCalled();
    },
  );

  describe.each(["dispatch", "officer", "hospital"] as const)(
    "%s unavailable measurements",
    (workspace) => {
      it.each([
        "idle",
        "unsupported",
        "requesting",
        "connecting",
        "waiting",
        "stale",
        "disconnected",
        "error",
      ] as const)(
        "does not present a previous or synthetic measurement as current while %s",
        (status) => {
          // Retain the old number deliberately: current readings are gated by status.
          mockUseHeartRate.mockReturnValue({ ...receiving(), status });
          const ui = render(<PawPatrol workspace={workspace} />);
          const reading = within(ui.getByLabelText("Selected person heart rate"));

          expect(reading.getByText("--")).toBeTruthy();
          expect(reading.queryByText("123")).toBeNull();
          expect(reading.queryByText(String(sampleHeartRate("P-01", 0)))).toBeNull();
          expect(ui.queryByRole("img", { name: "Synthetic heart rate trend" })).toBeNull();
          expect(bus.publish).not.toHaveBeenCalled();
        },
      );
    },
  );

  it.each(["officer", "hospital"] as const)(
    "retains the clearly named synthetic chart only in %s demo mode",
    (workspace) => {
      const ui = render(<PawPatrol workspace={workspace} />);
      expect(ui.getByRole("img", { name: "Synthetic heart rate trend" })).toBeTruthy();
      expect(ui.queryByRole("img", { name: "Received heart rate trend" })).toBeNull();
    },
  );

  it.each(["officer", "hospital"] as const)(
    "binds the connection to the %s selected identity and resets its session",
    (workspace) => {
      const ui = render(<PawPatrol workspace={workspace} />);
      fireEvent.change(ui.getByRole("combobox", { name: /^Selected person$/ }), {
        target: { value: "P-02" },
      });
      expect(mockUseHeartRate).toHaveBeenLastCalledWith("P-02", 0);

      fireEvent.click(ui.getByRole("button", { name: "Reset demo" }));
      expect(mockUseHeartRate).toHaveBeenLastCalledWith("P-01", 1);
      expect(bus.clear).toHaveBeenCalledTimes(1);
    },
  );

  it("updates the connection identity when a different dispatch unit is selected", () => {
    const ui = render(<PawPatrol workspace="dispatch" />);
    fireEvent.click(ui.getByRole("button", { name: new RegExp(`${PEOPLE[1].name}.*P-02`) }));
    expect(mockUseHeartRate).toHaveBeenLastCalledWith("P-02", 0);
    expect(ui.getByTestId("map-selection").textContent).toBe("P-02");

    fireEvent.click(ui.getByRole("button", { name: "Reset demo" }));
    expect(mockUseHeartRate).toHaveBeenLastCalledWith("P-01", 1);
  });

  it("keeps the same selected-person session when switching standalone views", () => {
    mockUseHeartRate.mockReturnValue(receiving());
    const ui = render(<PawPatrol />);
    const navigation = within(ui.getByRole("navigation", { name: "Workspace" }));
    for (const name of ["Officer", "Hospital", "Command"]) {
      fireEvent.click(navigation.getByRole("button", { name }));
      expect(mockUseHeartRate).toHaveBeenLastCalledWith("P-01", 0);
      expect(within(ui.getByLabelText("Selected person heart rate")).getByText("123")).toBeTruthy();
    }
  });

  it("does not attach local device data to a shared assistance request", () => {
    mockUseHeartRate.mockReturnValue(receiving());
    const ui = render(<PawPatrol workspace="officer" />);
    fireEvent.click(ui.getByRole("button", { name: "Demo panic · P-01" }));

    expect(bus.publish).toHaveBeenCalledTimes(1);
    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "panic", origin: "operator", personId: "P-01" }),
    );
    const published = JSON.stringify(vi.mocked(bus.publish).mock.calls[0][0]);
    expect(published).not.toContain("123");
    expect(published).not.toMatch(/HeartCast|bpm|receivedAt|history/);
  });

  it("does not copy local device readings into the fictional MIST handoff", async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      mockUseHeartRate.mockReturnValue(receiving());
      const ui = render(<PawPatrol workspace="hospital" />);
      for (let stage = 0; stage < 3; stage += 1) {
        fireEvent.click(ui.getByRole("button", { name: /Next stage/ }));
      }
      const handoff = within(ui.getByRole("region", { name: "MIST clinical handoff" }));
      expect(handoff.getByText(/SIMULATED MIST/)).toBeTruthy();
      expect(handoff.getByText(`${sampleHeartRate("P-01", 45)} bpm · synthetic`)).toBeTruthy();
      expect(handoff.queryByText(/HeartCast|123 bpm/)).toBeNull();
      fireEvent.click(handoff.getByRole("button", { name: "Copy demo MIST" }));

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const copied = writeText.mock.calls[0][0];
      expect(copied).toContain("SIMULATED MIST");
      expect(copied).toContain(`HR ${sampleHeartRate("P-01", 45)} bpm (synthetic`);
      expect(copied).not.toContain("HR 123 bpm");
      expect(copied).not.toContain("HeartCast");
      expect(bus.publish).not.toHaveBeenCalled();
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });
});
