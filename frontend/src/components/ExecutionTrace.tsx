export type TraceKind = "activated" | "deactivated" | "conflict" | "resolved" | "cycle" | "rule";

export interface TraceEntry {
  id: string;
  kind: TraceKind;
  text: string;
  atMs: number; // Date.now() when it happened
}

interface ExecutionTraceProps {
  entries: TraceEntry[];
}

const KIND_COLOR: Record<TraceKind, string> = {
  activated: "var(--accent-cyan)",
  deactivated: "var(--text-faint)",
  conflict: "var(--accent-amber)",
  resolved: "var(--accent-green)",
  cycle: "var(--accent-red)",
  rule: "var(--text-muted)",
};

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

// Plan hours 13-15 (Person B): "Execution trace" — a scrollback of what the
// engine has just done, so a judge who glances away can see the causal
// history rather than only the current snapshot. Purely derived client-side
// from consecutive state messages (see App.tsx) — no backend contract change.
export function ExecutionTrace({ entries }: ExecutionTraceProps) {
  return (
    <div className="panel">
      <div className="panel__title">
        Execution trace
        <span className="panel__title-badge">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="empty-note">Nothing has happened yet.</div>
      ) : (
        <div className="trace-list">
          {entries.map((e) => (
            <div key={e.id} className="trace-row">
              <span className="trace-row__time">{formatTime(e.atMs)}</span>
              <span className="trace-row__dot" style={{ background: KIND_COLOR[e.kind] }} />
              <span className="trace-row__text">{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
