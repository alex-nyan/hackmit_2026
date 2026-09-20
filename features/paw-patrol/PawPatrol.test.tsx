import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PawPatrol } from "./PawPatrol";
import { PEOPLE } from "./scenario";

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
      fireEvent.change(ui.getByLabelText(/Selected person/), { target: { value: "P-02" } });
      fireEvent.click(ui.getByRole("button", { name: "Reset demo" }));
      expect(ui.getByRole("heading", { level: 1 }).textContent).toBe(heading);
    },
  );

  it("gives all three workspaces the same operations map", () => {
    for (const workspace of ["dispatch", "officer", "hospital"] as const) {
      const ui = render(<PawPatrol workspace={workspace} />);
      const map = ui.getByRole("region", { name: "Operations map" });
      expect(within(map).getByTestId("map-selection").textContent).toBe("P-01");
      expect(within(map).getByText(/reported, unverified|none reported yet/)).toBeTruthy();
      cleanup();
    }
  });

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
