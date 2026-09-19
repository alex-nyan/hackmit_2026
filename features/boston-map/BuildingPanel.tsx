"use client";

import { X } from "lucide-react";

import { formatArea, formatHeight, type BuildingFacts } from "./buildingSelection";

interface BuildingPanelProps {
  building: BuildingFacts | null;
  onDismiss: () => void;
}

/**
 * Shows only what the vector tile actually carries. Missing values are reported
 * as not recorded rather than estimated, and floor counts are not inferred.
 */
export function BuildingPanel({ building, onDismiss }: BuildingPanelProps) {
  if (!building) return null;

  return (
    <aside className="building-card" role="status">
      <div className="panel-head">
        <span className="panel-label">Building</span>
        <button
          type="button"
          className="building-card__close"
          onClick={onDismiss}
          aria-label="Clear building selection"
        >
          <X size={14} />
        </button>
      </div>

      <dl className="panel-facts">
        <div>
          <dt>Height</dt>
          <dd>{formatHeight(building.heightM)}</dd>
        </div>
        {building.baseM !== null && (
          <div>
            <dt>Base</dt>
            <dd>{formatHeight(building.baseM)}</dd>
          </div>
        )}
        <div>
          <dt>Footprint</dt>
          <dd>{formatArea(building.footprintM2)}</dd>
        </div>
      </dl>

      <p className="panel-note">
        Footprint is measured from the loaded map tile, so a building crossing a tile edge reports
        only the part in view.
      </p>
    </aside>
  );
}
