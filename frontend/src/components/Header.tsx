import { useState } from "react";
import type { ConnectionStatus, PerfStats } from "../types";

interface HeaderProps {
  status: ConnectionStatus;
  seed: number | null;
  revision: number;
  connectedSessions: number;
  perf: PerfStats | null;
  onStart: (seed: number) => void;
  onStop: () => void;
  isRunning: boolean;
  commandsBusy: boolean;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  open: "Live",
  closed: "Disconnected",
  error: "Connection error",
};

export function Header({
  status,
  seed,
  revision,
  connectedSessions,
  perf,
  onStart,
  onStop,
  isRunning,
  commandsBusy,
}: HeaderProps) {
  const [seedInput, setSeedInput] = useState("42");

  const p95 = perf?.p95_latency_ms ?? 0;
  const p95Class = p95 === 0 ? "" : p95 < 150 ? "stat__value--good" : p95 < 200 ? "stat__value--warn" : "stat__value--bad";
  const eventsPerSecond = perf?.events_per_second ?? 0;
  const throughputTarget = perf?.target_events_per_second ?? 500;
  const slaPass = isRunning && eventsPerSecond >= throughputTarget && p95 > 0 && p95 < 200;
  const slaWarming = isRunning && !slaPass && (perf?.accepted_events ?? 0) < throughputTarget * 2;
  const slaState = !isRunning ? "idle" : slaPass ? "pass" : slaWarming ? "warming" : "fail";
  const slaLabel = !isRunning ? "LOAD READY" : slaPass ? "SLA PASS" : slaWarming ? "WARMING UP" : "BELOW TARGET";

  return (
    <header className="header">
      <div className="header__brand">
        <div className="header__title">RuleMesh</div>
        <div className="header__subtitle">Graph-native automation · server-owned live simulation</div>
      </div>

      <div className="connection">
        <span className={`connection__dot connection__dot--${status}`} />
        {STATUS_LABEL[status]}
      </div>

      <div className={`sla-badge sla-badge--${slaState}`} aria-label="Live throughput and latency service level">
        <span>{slaLabel}</span>
        <span>{eventsPerSecond} / {throughputTarget} EPS · {p95} ms p95</span>
      </div>

      <div className="sim-controls">
        <input
          type="number"
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value)}
          disabled={isRunning || commandsBusy}
          aria-label="Simulation seed"
        />
        {isRunning ? (
          <button className="btn btn--danger" onClick={onStop} disabled={commandsBusy}>
            Stop simulation
          </button>
        ) : (
          <button
            className="btn btn--primary"
            onClick={() => onStart(Number(seedInput) || 0)}
            disabled={commandsBusy || status !== "open"}
          >
            Start simulation
          </button>
        )}
      </div>

      <div className="header__stats">
        <div className="stat">
          <span className="stat__label">Seed</span>
          <span className="stat__value">{seed ?? "—"}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Revision</span>
          <span className="stat__value">{revision}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Sessions</span>
          <span className="stat__value">{connectedSessions}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Events/s</span>
          <span className={`stat__value ${eventsPerSecond >= throughputTarget ? "stat__value--good" : ""}`}>
            {eventsPerSecond}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">p95 latency</span>
          <span className={`stat__value ${p95Class}`}>{p95} ms</span>
        </div>
      </div>
    </header>
  );
}
