import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeartRatePanel } from "./HeartRatePanel";
import type { HeartRateConnection } from "./useHeartRate";

function connection(overrides: Partial<HeartRateConnection> = {}): HeartRateConnection {
  return {
    mode: "demo",
    status: "idle",
    bpm: null,
    receivedAt: null,
    deviceName: null,
    message: "Demo heart rate. Connect your device to test.",
    history: [],
    supported: true,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    useDemo: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("HeartRatePanel", () => {
  it("provides a named region, selected test profile and explicit connection action", () => {
    const source = connection();
    const ui = render(
      <HeartRatePanel connection={source} personId="P-01" personName="Alex Morgan" />,
    );
    expect(ui.getByRole("region", { name: "Heart rate connection" })).toBeTruthy();
    expect(ui.getByText("P-01 · Alex Morgan")).toBeTruthy();
    expect(ui.getByText("Demo")).toBeTruthy();
    expect(ui.getByText(/fictional profile/)).toBeTruthy();
    expect(ui.getByText(/no upload, saving, cross-port sharing, or automatic alerts/)).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Connect Heart Rate" }));
    expect(source.connect).toHaveBeenCalledOnce();
    expect(ui.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(ui.queryByRole("button", { name: "Use demo heart rate" })).toBeNull();
  });

  it.each(["requesting", "connecting"] as const)(
    "disables repeated connection attempts while %s",
    (status) => {
      const source = connection({ mode: "device", status });
      const ui = render(
        <HeartRatePanel connection={source} personId="P-01" personName="Alex Morgan" />,
      );
      const connect = ui.getByRole("button", {
        name: status === "requesting" ? "Choose a device…" : "Connecting…",
      });
      expect((connect as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(connect);
      expect(source.connect).not.toHaveBeenCalled();
      fireEvent.click(ui.getByRole("button", { name: "Use demo heart rate" }));
      expect(source.useDemo).toHaveBeenCalledOnce();
    },
  );

  it.each(["waiting", "receiving", "stale"] as const)(
    "offers disconnect and demo recovery while %s",
    (status) => {
      const source = connection({ mode: "device", status, deviceName: "HeartCast" });
      const ui = render(
        <HeartRatePanel connection={source} personId="P-02" personName="Jamie Lee" compact />,
      );
      expect(ui.getByText("P-02 · Jamie Lee")).toBeTruthy();
      expect(ui.getByText("Device · HeartCast")).toBeTruthy();
      expect(ui.queryByRole("button", { name: "Connect Heart Rate" })).toBeNull();
      fireEvent.click(ui.getByRole("button", { name: "Disconnect" }));
      expect(source.disconnect).toHaveBeenCalledOnce();
      fireEvent.click(ui.getByRole("button", { name: "Use demo heart rate" }));
      expect(source.useDemo).toHaveBeenCalledOnce();
    },
  );

  it.each(["disconnected", "error"] as const)(
    "offers reconnect after %s without inventing a reading",
    (status) => {
      const source = connection({ mode: "device", status, message: "No reading available." });
      const ui = render(
        <HeartRatePanel connection={source} personId="P-01" personName="Alex Morgan" />,
      );
      fireEvent.click(ui.getByRole("button", { name: "Reconnect Heart Rate" }));
      expect(source.connect).toHaveBeenCalledOnce();
      expect(ui.getByRole("status").textContent).toBe("No reading available.");
      expect(ui.container.querySelector("time")).toBeNull();
    },
  );

  it("keeps unsupported browser guidance visible and the first connection action usable", () => {
    const source = connection({ status: "unsupported", supported: false });
    const ui = render(
      <HeartRatePanel connection={source} personId="P-01" personName="Alex Morgan" />,
    );
    expect(ui.getByText(/Web Bluetooth is unavailable here/)).toBeTruthy();
    const button = ui.getByRole("button", { name: "Connect Heart Rate" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(source.connect).toHaveBeenCalledOnce();
  });

  it("labels local receipt time without announcing every updated beat", () => {
    const source = connection({
      mode: "device",
      status: "receiving",
      bpm: 75,
      receivedAt: 1_784_000_000_000,
      message: "Receiving live heart rate.",
    });
    const ui = render(
      <HeartRatePanel connection={source} personId="P-01" personName="Alex Morgan" />,
    );
    const status = ui.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Receiving live heart rate.");
    expect(status.querySelector("time")).toBeNull();
    expect(ui.container.querySelector("time")?.getAttribute("datetime")).toBe(
      new Date(source.receivedAt!).toISOString(),
    );
    expect(ui.getByText(/Received ·/)).toBeTruthy();
    expect(ui.getByText("Live device")).toBeTruthy();
    ui.rerender(
      <HeartRatePanel
        connection={{ ...source, bpm: 76, receivedAt: source.receivedAt! + 1_000 }}
        personId="P-01"
        personName="Alex Morgan"
      />,
    );
    expect(status.textContent).toBe("Receiving live heart rate.");
  });

  it("does not render locale-dependent receipt time during server rendering", () => {
    const source = connection({
      mode: "device",
      status: "receiving",
      receivedAt: 1_784_000_000_000,
    });
    const html = renderToString(
      <HeartRatePanel connection={source} personId="P-01" personName="Alex Morgan" />,
    );
    expect(html).not.toContain("<time");
  });

  it("does not render an invalid receipt date", () => {
    const source = connection({ mode: "device", status: "receiving", receivedAt: Number.NaN });
    const ui = render(
      <HeartRatePanel connection={source} personId="P-01" personName="Alex Morgan" />,
    );
    expect(ui.container.querySelector("time")).toBeNull();
  });

  it("includes keyboard-accessible setup and explicitly explains tab isolation", () => {
    const ui = render(
      <HeartRatePanel connection={connection()} personId="P-01" personName="Alex Morgan" />,
    );
    expect(ui.getByText("HeartCast setup & privacy").tagName).toBe("SUMMARY");
    expect(ui.getByText(/Apple Watch → iPhone HeartCast → laptop Chrome/)).toBeTruthy();
    expect(ui.getByText(/other dashboard ports do not/)).toBeTruthy();
    expect(ui.getByText(/not the sensor measurement time/)).toBeTruthy();
    expect(ui.container.querySelectorAll("a")).toHaveLength(0);
  });
});
