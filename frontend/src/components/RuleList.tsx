import { useEffect, useState } from "react";
import type { Rule } from "../types";

interface RuleListProps {
  rules: Rule[];
  /** Names of rules whose condition is currently true (from state.active_chains).
   * Matched by name, same convention DependencyGraph already uses, since
   * active_chains carries rule names rather than ids. */
  activeRuleNames: Set<string>;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onUpdatePriority: (id: string, priority: number) => void;
  commandsBusy: boolean;
}

function describe(rule: Rule): string {
  const conds = rule.conditions.map((c) => `${c.variable} ${c.operator} ${String(c.value)}`).join(" AND ");
  return `${conds}  =>  ${rule.action.target} = ${String(rule.action.value)}`;
}

export function RuleList({ rules, activeRuleNames, onToggle, onDelete, onUpdatePriority, commandsBusy }: RuleListProps) {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);

  return (
    <div>
      {sorted.length === 0 && <div className="empty-note">No rules yet.</div>}
      {sorted.map((rule) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          isActive={activeRuleNames.has(rule.name)}
          onToggle={onToggle}
          onDelete={onDelete}
          onUpdatePriority={onUpdatePriority}
          commandsBusy={commandsBusy}
        />
      ))}
    </div>
  );
}

interface RuleCardProps {
  rule: Rule;
  isActive: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onUpdatePriority: (id: string, priority: number) => void;
  commandsBusy: boolean;
}

function RuleCard({ rule, isActive, onToggle, onDelete, onUpdatePriority, commandsBusy }: RuleCardProps) {
  // Local draft so keystrokes don't fire a command per character — we only
  // send update_rule on blur/Enter, and only if the value actually changed.
  // This matters for the two-session sync test in the plan (hours 11-13):
  // the server's echoed revision is the only thing that ever finalizes the
  // displayed priority, so if the prop value drifts (e.g. the other session
  // edited it first) the draft below simply re-derives from it on the next
  // render because React remounts nothing — the input just shows rule.priority
  // again once the user isn't actively editing.
  const [draft, setDraft] = useState(String(rule.priority));

  // Resync the draft whenever the server-confirmed priority changes — either
  // from our own committed edit round-tripping back, or from the *other*
  // session editing the same rule. We deliberately don't guard this on
  // "is the input focused" because the plan documents last-write-wins for
  // concurrent same-rule edits; the server's value is always authoritative.
  useEffect(() => {
    setDraft(String(rule.priority));
  }, [rule.priority]);

  function commit() {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed !== rule.priority) {
      onUpdatePriority(rule.id, parsed);
    } else {
      setDraft(String(rule.priority));
    }
  }

  return (
    <div className={`rule-card ${rule.enabled ? "" : "rule-card--disabled"} ${isActive ? "rule-card--active" : ""}`}>
      <div className="rule-card__top">
        <span className="rule-card__name">
          {isActive && <span className="rule-card__active-dot" title="Currently firing" />}
          {rule.name}
        </span>
        <input
          className="rule-card__priority-input"
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          disabled={commandsBusy}
          aria-label={`Priority for ${rule.name}`}
        />
      </div>
      <div className="rule-card__expr">{describe(rule)}</div>
      <div className="rule-card__actions">
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => onToggle(rule.id, e.target.checked)}
            disabled={commandsBusy}
          />
          Enabled
        </label>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => onDelete(rule.id)}
          style={{ marginLeft: "auto" }}
          disabled={commandsBusy}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
