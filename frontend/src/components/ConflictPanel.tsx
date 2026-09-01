import type { ConflictInfo } from "../types";

interface ConflictPanelProps {
  conflicts: ConflictInfo[];
}

export function ConflictPanel({ conflicts }: ConflictPanelProps) {
  return (
    <div className="panel">
      <div className="panel__title">
        Conflict arbitration
        {conflicts.length > 0 && <span className="panel__title-badge">{conflicts.length} active</span>}
      </div>
      {conflicts.length === 0 ? (
        <div className="empty-note">No contradictory proposals right now.</div>
      ) : (
        conflicts.map((c) => (
          <div className="conflict-card" key={c.target}>
            <div className="conflict-card__target">Target: {c.target}</div>
            {c.proposals.map((p) => (
              <div
                key={p.rule_id}
                className={`conflict-proposal ${p.won ? "conflict-proposal--won" : "conflict-proposal--lost"}`}
              >
                <span className="conflict-proposal__name">
                  {p.rule_name} → {String(p.value)}
                </span>
                <span className="conflict-proposal__meta">
                  priority {p.priority} · {p.reason}
                </span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
