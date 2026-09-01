import type { EnvironmentState } from "../types";

interface ActuatorGridProps {
  actuators: EnvironmentState | null;
}

const LABELS: Record<string, string> = {
  alarm: "Alarm",
  hvac: "HVAC",
  exit_locked: "Exit lock",
  sprinkler: "Sprinkler",
  emergency_lights: "Emergency lights",
  evacuation: "Evacuation",
};

function isEngaged(key: string, value: unknown): boolean {
  if (key.endsWith("hvac")) return value !== "idle" && value !== "off";
  if (key.endsWith("exit_locked")) return value === false; // unlocked is the notable state
  return value === true;
}

function isAlarming(key: string, value: unknown): boolean {
  return (key.endsWith("alarm") || key.endsWith("evacuation") || key.endsWith("sprinkler")) && value === true;
}

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  return String(value);
}

function friendlyLabel(key: string): string {
  const parts = key.split(".");
  const kind = parts[parts.length - 1];
  const zone = parts.length > 1 ? parts[0] : null;
  const label = LABELS[kind] ?? kind;
  return zone ? `${zone.replace("_", " ")} · ${label}` : label;
}

export function ActuatorGrid({ actuators }: ActuatorGridProps) {
  const entries = actuators ? Object.entries(actuators) : [];

  return (
    <div className="panel">
      <div className="panel__title">Actuators</div>
      {entries.length === 0 ? (
        <div className="empty-note">Waiting for state…</div>
      ) : (
        <div className="actuator-grid">
          {entries.map(([key, value]) => {
            const alarming = isAlarming(key, value);
            const engaged = !alarming && isEngaged(key, value);
            return (
              <div
                key={key}
                className={`actuator-card ${alarming ? "actuator-card--active" : engaged ? "actuator-card--engaged" : ""}`}
              >
                <div className="actuator-card__label">{friendlyLabel(key)}</div>
                <div className="actuator-card__value">{formatValue(value)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
