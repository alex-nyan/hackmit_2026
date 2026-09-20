import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HeartRateConnection } from "../heart-rate/useHeartRate";
import { OfficerOverview } from "./OfficerOverview";
import { PEOPLE, sampleHeartRate } from "./scenario";

afterEach(cleanup);

function heartRate(overrides: Partial<HeartRateConnection> = {}): HeartRateConnection {
  return {
    mode: "demo",
    status: "idle",
    bpm: null,
    receivedAt: null,
    deviceName: null,
    message: "Demo",
    history: [],
    supported: true,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    useDemo: vi.fn(),
    ...overrides,
  };
}

function overview(overrides: Partial<React.ComponentProps<typeof OfficerOverview>> = {}) {
  return {
    person: PEOPLE[0],
    onSelect: vi.fn(),
    time: 0,
    running: true,
    heartRate: heartRate(),
    ...overrides,
  };
}

function openOverview(props = overview()) {
  const ui = render(<OfficerOverview {...props} />);
  fireEvent.click(ui.getByRole("button", { name: "Officer overview" }));
  return ui;
}

describe("OfficerOverview", () => {
  it("starts closed and exposes a labelled, non-modal roster of all demo officers", () => {
    const ui = render(<OfficerOverview {...overview()} />);
    const toggle = ui.getByRole("button", { name: "Officer overview" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(ui.queryByRole("region", { name: "Officer overview" })).toBeNull();
    fireEvent.click(toggle);
    const panel = ui.getByRole("region", { name: "Officer overview" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
    expect(ui.queryByRole("dialog")).toBeNull();
    expect(ui.getByText("15 demo units · select an officer")).toBeTruthy();
    const roster = within(ui.getByRole("list", { name: "Officer roster" }));
    expect(roster.getAllByRole("listitem")).toHaveLength(PEOPLE.length);
    PEOPLE.forEach((person) => {
      const row = roster.getByRole("button", { name: new RegExp(person.name) });
      expect(row.getAttribute("aria-pressed")).toBe(String(person.id === PEOPLE[0].id));
      expect(row.textContent).toContain(person.id);
      expect(row.textContent).toContain("On patrol");
      expect(within(row).getByText(String(sampleHeartRate(person.id, 0)))).toBeTruthy();
      expect(within(row).getByText("Simulated")).toBeTruthy();
    });
  });

  it("delegates dropdown and row selection without creating a separate selected officer", () => {
    const props = overview();
    const ui = openOverview(props);
    const select = ui.getByRole("combobox", { name: "Overview officer" }) as HTMLSelectElement;
    expect(select.value).toBe(PEOPLE[0].id);
    expect(within(select).getAllByRole("option")).toHaveLength(PEOPLE.length);
    fireEvent.change(select, { target: { value: PEOPLE[1].id } });
    expect(props.onSelect).toHaveBeenLastCalledWith(PEOPLE[1].id);
    fireEvent.click(ui.getByRole("button", { name: new RegExp(PEOPLE[2].name) }));
    expect(props.onSelect).toHaveBeenLastCalledWith(PEOPLE[2].id);
    ui.rerender(<OfficerOverview {...props} person={PEOPLE[2]} />);
    expect(select.value).toBe(PEOPLE[2].id);
    expect(
      ui.getByRole("button", { name: new RegExp(PEOPLE[2].name) }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it.each(["close button", "Escape"])("returns focus to the side tab after %s", (method) => {
    const ui = openOverview();
    const toggle = ui.getByRole("button", { name: "Officer overview" });
    const select = ui.getByRole("combobox", { name: "Overview officer" });
    select.focus();
    if (method === "Escape") fireEvent.keyDown(select, { key: "Escape" });
    else fireEvent.click(ui.getByRole("button", { name: "Close officer overview" }));
    expect(ui.queryByRole("region", { name: "Officer overview" })).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("labels illustrative traces, pauses with the scenario, and supports reduced motion", () => {
    const props = overview();
    const ui = openOverview(props);
    expect(ui.getByText(/not measured ECGs/)).toBeTruthy();
    expect(ui.getAllByText("Illustrative pulse · not ECG")).toHaveLength(PEOPLE.length);
    const traces = [...ui.container.querySelectorAll<SVGElement>("svg[data-running]")];
    expect(traces).toHaveLength(PEOPLE.length);
    expect(traces[0].style.getPropertyValue("--pulse-duration")).toBe(`${(60 / 78) * 3}s`);
    expect(traces.every((trace) => trace.closest('[aria-hidden="true"]'))).toBe(true);
    ui.rerender(<OfficerOverview {...props} running={false} />);
    expect(
      [...ui.container.querySelectorAll("svg[data-running]")].every(
        (trace) => trace.getAttribute("data-running") === "false",
      ),
    ).toBe(true);
    const css = readFileSync("features/paw-patrol/OfficerOverview.module.css", "utf8");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("animation: none");
    expect(css).toContain("animation-play-state: paused");
  });

  it("shows real received BPM/history only for the connected selected row", () => {
    const source = heartRate({
      mode: "device",
      status: "receiving",
      bpm: 123,
      history: [
        { bpm: 119, receivedAt: 1000 },
        { bpm: 123, receivedAt: 2000 },
      ],
    });
    const ui = openOverview(overview({ heartRate: source }));
    const row = within(ui.getByRole("button", { name: new RegExp(PEOPLE[0].name) }));
    expect(row.getByText("123")).toBeTruthy();
    expect(row.getByText("Live device")).toBeTruthy();
    expect(row.queryByText("Simulated")).toBeNull();
    expect(row.getByRole("img", { name: "Received heart rate trend" })).toBeTruthy();
    expect(ui.container.querySelectorAll("svg[data-running]")).toHaveLength(PEOPLE.length - 1);
    expect(ui.getAllByText("Simulated")).toHaveLength(PEOPLE.length - 1);
    expect(ui.getByText(/not verified officer identity/)).toBeTruthy();
    expect(source.connect).not.toHaveBeenCalled();
    expect(source.disconnect).not.toHaveBeenCalled();
    expect(source.useDemo).not.toHaveBeenCalled();
  });

  it.each(["waiting", "stale", "disconnected", "error"] as const)(
    "never invents a current device reading or ECG while %s",
    (status) => {
      const ui = openOverview(
        overview({ heartRate: heartRate({ mode: "device", status, bpm: 123 }) }),
      );
      const button = ui.getByRole("button", { name: new RegExp(PEOPLE[0].name) });
      const row = within(button);
      expect(row.getByText("--")).toBeTruthy();
      expect(row.queryByText("123")).toBeNull();
      expect(row.getByText(`${status} · no current reading`)).toBeTruthy();
      expect(row.getByText("Waiting for received trend")).toBeTruthy();
      expect(button.querySelector("svg[data-running]")).toBeNull();
    },
  );

  it("keeps stale device history visibly historical and never substitutes a demo waveform", () => {
    const ui = openOverview(
      overview({
        heartRate: heartRate({
          mode: "device",
          status: "stale",
          bpm: 123,
          history: [
            { bpm: 121, receivedAt: 1000 },
            { bpm: 123, receivedAt: 2000 },
          ],
        }),
      }),
    );
    const button = ui.getByRole("button", { name: new RegExp(PEOPLE[0].name) });
    expect(within(button).getByText("--")).toBeTruthy();
    expect(within(button).getByText("Past received BPM · not ECG")).toBeTruthy();
    expect(within(button).getByRole("img", { name: "Received heart rate trend" })).toBeTruthy();
    expect(button.querySelector("svg[data-running]")).toBeNull();
  });
});
