import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlassEffect } from "./liquid-glass";

afterEach(cleanup);

describe("GlassEffect", () => {
  it("keeps decorative effects out of the accessibility and interaction tree", () => {
    const onClick = vi.fn();
    const ui = render(
      <button onClick={onClick}>
        <GlassEffect />
        Follow officer
      </button>,
    );
    const effect = ui.container.querySelector("[data-liquid-glass]");
    expect(effect?.getAttribute("aria-hidden")).toBe("true");
    expect(effect?.querySelector("svg")?.getAttribute("focusable")).toBe("false");
    expect(
      effect?.querySelector("button, a, input, select, textarea, [tabindex], [role]"),
    ).toBeNull();
    expect(ui.getAllByRole("button")).toHaveLength(1);
    expect(ui.queryByRole("img")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Follow officer" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("gives every mounted effect a unique stable local SVG filter reference", () => {
    const effects = (
      <>
        <GlassEffect />
        <GlassEffect />
        <GlassEffect />
      </>
    );
    const ui = render(effects);
    const ids = Array.from(ui.container.querySelectorAll("filter"), (filter) => filter.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const effect of ui.container.querySelectorAll("[data-liquid-glass]")) {
      const filter = effect.querySelector("filter")!;
      expect(filter.id).not.toBe("");
      const refraction = effect.querySelector<HTMLElement>("span[style]");
      expect(refraction?.style.filter).toBe(`url("#${filter.id}")`);
    }
    ui.rerender(effects);
    expect(Array.from(ui.container.querySelectorAll("filter"), (filter) => filter.id)).toEqual(ids);
  });
});
