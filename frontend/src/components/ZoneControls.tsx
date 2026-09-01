import type { DemoStage, EnvironmentState } from "../types";
import { ZONES } from "../mock/engine";

interface ZoneControlsProps {
  environment: EnvironmentState | null;
  selectedZone: (typeof ZONES)[number];
  onZoneChange: (zone: (typeof ZONES)[number]) => void;
  onSetManual: (variable: string, value: number | boolean) => void;
  onReset: () => void;
  onDemoStage: (stage: DemoStage) => void;
  commandsBusy: boolean;
}

const ZONE_LABELS: Record<string, string> = {
  laboratory: "Laboratory",
  server_room: "Server Room",
  lobby: "Lobby",
  warehouse: "Warehouse",
  office: "Office",
};

export function ZoneControls({
  environment,
  selectedZone,
  onZoneChange,
  onSetManual,
  onReset,
  onDemoStage,
  commandsBusy,
}: ZoneControlsProps) {
  const quietHours = Boolean(environment?.["building.quiet_hours"]);

  return (
    <div className="panel">
      <div className="panel__title">
        Environment controls
        <button className="btn btn--ghost btn--small" onClick={onReset} disabled={commandsBusy}>
          Reset demo
        </button>
      </div>

      <div className="guided-demo" aria-label="Guided judge demo">
        <div className="guided-demo__heading">
          <span>60-second judge path</span>
          <span>atomic stages</span>
        </div>
        <div className="guided-demo__buttons">
          <button className="btn btn--scenario" onClick={() => onDemoStage("normal")} disabled={commandsBusy}>
            1 · Normal
          </button>
          <button className="btn btn--scenario btn--scenario-heat" onClick={() => onDemoStage("heat")} disabled={commandsBusy}>
            2 · Heat
          </button>
          <button className="btn btn--scenario btn--scenario-fire" onClick={() => onDemoStage("fire")} disabled={commandsBusy}>
            3 · Fire
          </button>
          <button
            className="btn btn--scenario btn--scenario-safety"
            onClick={() => onDemoStage("safety_override")}
            disabled={commandsBusy}
          >
            4 · Safety override
          </button>
        </div>
        <div className="guided-demo__note">Safety rules outrank the quiet-hours silence request.</div>
      </div>

      <div className="control-row">
        <select
          value={selectedZone}
          onChange={(e) => onZoneChange(e.target.value as (typeof ZONES)[number])}
          style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 4, padding: "6px 8px" }}
        >
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {ZONE_LABELS[z]}
            </option>
          ))}
        </select>
      </div>

      <div className="zone-block">
        <div className="zone-block__name">{ZONE_LABELS[selectedZone]}</div>

        <Slider
          label="Smoke"
          unit="%"
          min={0}
          max={100}
          value={Number(environment?.[`${selectedZone}.smoke`] ?? 0)}
          onChange={(v) => onSetManual(`${selectedZone}.smoke`, v)}
        />
        <Slider
          label="Temperature"
          unit="°C"
          min={15}
          max={60}
          value={Number(environment?.[`${selectedZone}.temperature`] ?? 21)}
          onChange={(v) => onSetManual(`${selectedZone}.temperature`, v)}
        />
      </div>

      <div className="toggle-row">
        <span>Quiet hours (low-priority silence request)</span>
        <input
          type="checkbox"
          checked={quietHours}
          onChange={(e) => onSetManual("building.quiet_hours", e.target.checked)}
        />
      </div>
    </div>
  );
}

function Slider({
  label,
  unit,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="control-row">
      <div className="control-row__label">
        <span>{label}</span>
        <span>
          {Math.round(value)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
