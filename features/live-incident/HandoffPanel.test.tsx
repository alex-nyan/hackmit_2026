import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HumanHandoff, IncidentSnapshot } from "../../shared/contracts";
import { HandoffPanel } from "./HandoffPanel";

afterEach(cleanup);
const snapshot: IncidentSnapshot = {
  schema_version: "2.0",
  incident_id: "test-incident",
  revision: 8,
  generated_at: "2026-09-20T00:00:00Z",
  sources: [],
  observations: [],
  alerts: [],
  scene_reports: [],
  patients: [
    { patient_id: "test-patient", incident_id: "test-incident", display_name: "Training patient" },
  ],
  handoffs: [],
};
const handoff: HumanHandoff = {
  handoff_id: "handoff-one",
  incident_id: "test-incident",
  patient_id: "test-patient",
  handoff_revision: 1,
  mechanism: "Training report",
  injuries: null,
  signs: null,
  treatments: null,
  recorded_by: {
    principal_id: "human-operator",
    role: "dispatch",
    at: "2026-09-20T00:00:00Z",
    note: null,
  },
  provenance: "human_reported",
  delivery_status: "recorded_locally_not_transmitted",
};

describe("human patient handoff", () => {
  it("keeps unknown fields empty and attributes a deliberate patient-specific submission", async () => {
    const command = vi.fn().mockResolvedValue(true);
    render(<HandoffPanel snapshot={snapshot} current pending={false} command={command} />);
    expect(
      (screen.getByLabelText("Measured or reported clinical signs") as HTMLTextAreaElement).value,
    ).toBe("");
    fireEvent.change(screen.getByLabelText("Mechanism / reported event"), {
      target: { value: "Training-only reported event" },
    });
    fireEvent.click(screen.getByText("Record reviewed handoff"));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith({
        kind: "submit_handoff",
        expected_revision: 8,
        patient_id: "test-patient",
        mechanism: "Training-only reported event",
        injuries: null,
        signs: null,
        treatments: null,
      }),
    );
    await screen.findByText("Human handoff recorded locally. No external delivery was requested.");
  });
  it("blocks an old draft after another operator records a newer handoff", () => {
    const command = vi.fn();
    const props = { current: true, pending: false, command };
    const view = render(
      <HandoffPanel {...props} snapshot={{ ...snapshot, handoffs: [handoff] }} />,
    );
    fireEvent.change(screen.getByLabelText("Reported injuries"), {
      target: { value: "Draft under review" },
    });
    view.rerender(
      <HandoffPanel
        {...props}
        snapshot={{ ...snapshot, revision: 9, handoffs: [{ ...handoff, handoff_revision: 2 }] }}
      />,
    );
    expect((screen.getByText("Record reviewed handoff") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("newer handoff");
    fireEvent.click(screen.getByText("Record reviewed handoff"));
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Use latest human report as draft"));
    expect((screen.getByText("Record reviewed handoff") as HTMLButtonElement).disabled).toBe(false);
  });
});
