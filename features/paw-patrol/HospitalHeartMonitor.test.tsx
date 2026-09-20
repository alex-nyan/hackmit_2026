import { act, cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HospitalHeartMonitor } from "./HospitalHeartMonitor";
import type { HeartRateConnection } from "../heart-rate/useHeartRate";

const connection = (overrides: Partial<HeartRateConnection> = {}): HeartRateConnection => ({
  mode: "demo",
  status: "idle",
  bpm: null,
  receivedAt: null,
  deviceName: null,
  message: "",
  history: [],
  supported: true,
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(),
  useDemo: vi.fn(),
  ...overrides,
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("hospital rolling heart-rate chart", () => {
  it("advances the preview once a second without patrol playback and stops on unmount", () => {
    vi.useFakeTimers();
    const ui = render(<HospitalHeartMonitor personId="P-01" connection={connection()} />);
    const chart = ui.getByRole("img", { name: "Synthetic heart rate trend" });
    const before = chart.querySelector("polyline")!.getAttribute("points");
    act(() => vi.advanceTimersByTime(999));
    expect(chart.querySelector("polyline")!.getAttribute("points")).toBe(before);
    act(() => vi.advanceTimersByTime(1));
    expect(chart.querySelector("polyline")!.getAttribute("points")).not.toBe(before);
    const second = chart.querySelector("polyline")!.getAttribute("points");
    act(() => vi.advanceTimersByTime(1000));
    expect(chart.querySelector("polyline")!.getAttribute("points")).not.toBe(second);
    ui.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("scrolls actual samples without manufacturing measurements, then ages them out", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const history = [
      { bpm: 115, receivedAt: 99_000 },
      { bpm: 123, receivedAt: 100_000 },
    ];
    const feed = connection({ mode: "device", status: "receiving", bpm: 123, history });
    const ui = render(<HospitalHeartMonitor personId="P-01" connection={feed} />);
    const chart = ui.getByRole("img", { name: "Received heart rate trend" });
    const line = chart.querySelector("polyline")!;
    const before = line.getAttribute("points");
    act(() => vi.advanceTimersByTime(1000));
    expect(line.getAttribute("points")).not.toBe(before);
    expect(line.getAttribute("points")!.split(" ")).toHaveLength(2);
    expect(history).toHaveLength(2);
    expect(within(ui.getByLabelText("Selected person heart rate")).getByText("123")).toBeTruthy();
    ui.rerender(
      <HospitalHeartMonitor personId="P-01" connection={{ ...feed, status: "stale", bpm: null }} />,
    );
    expect(within(ui.getByLabelText("Selected person heart rate")).getByText("--")).toBeTruthy();
    expect(ui.queryByRole("img", { name: "Synthetic heart rate trend" })).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(chart.querySelector("polyline")).toBeNull();
    expect(ui.getByText("Waiting for readings")).toBeTruthy();
  });

  it("leaves gaps in device history rather than drawing through a missing interval", () => {
    const feed = connection({
      mode: "device",
      status: "receiving",
      bpm: 80,
      history: [
        { bpm: 75, receivedAt: 1000 },
        { bpm: 80, receivedAt: 15000 },
      ],
    });
    const ui = render(<HospitalHeartMonitor personId="P-01" connection={feed} />);
    const segments = ui
      .getByRole("img", { name: "Received heart rate trend" })
      .querySelectorAll("polyline");
    expect(segments).toHaveLength(2);
    for (const segment of segments)
      expect(segment.getAttribute("points")!.split(" ")).toHaveLength(1);
  });
});
