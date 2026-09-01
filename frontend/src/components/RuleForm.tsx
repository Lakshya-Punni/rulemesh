import { useState } from "react";
import type { Operator, RuleDraft } from "../types";

interface RuleFormProps {
  onSubmit: (rule: RuleDraft) => void;
  lastRejectionMessage: string | null;
  /** Every variable/target key seen in the live environment or actuator state,
   * offered as autocomplete so a judge (or you, live) can't typo a chain key —
   * while still allowing a genuinely new key for chaining onto a not-yet-created rule. */
  knownKeys: string[];
}

const OPERATORS: Operator[] = ["==", "!=", ">", ">=", "<", "<="];

export function RuleForm({ onSubmit, lastRejectionMessage, knownKeys }: RuleFormProps) {
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(50);
  const [variable, setVariable] = useState("laboratory.smoke");
  const [operator, setOperator] = useState<Operator>(">");
  const [condValue, setCondValue] = useState("70");
  const [target, setTarget] = useState("laboratory.alarm");
  const [actionValue, setActionValue] = useState("true");
  const [localError, setLocalError] = useState<string | null>(null);

  function parseValue(raw: string): number | boolean | string {
    if (raw === "true") return true;
    if (raw === "false") return false;
    const num = Number(raw);
    return Number.isNaN(num) ? raw : num;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !variable.trim() || !target.trim()) {
      setLocalError("Name, condition variable, and action target are required.");
      return;
    }
    if (variable.trim() === target.trim()) {
      setLocalError("Condition variable and action target are the same key — that's a self-cycle.");
      return;
    }
    setLocalError(null);
    onSubmit({
      name: name.trim(),
      enabled: true,
      priority,
      conditions: [{ variable: variable.trim(), operator, value: parseValue(condValue) }],
      action: { target: target.trim(), value: parseValue(actionValue) },
    });
    setName("");
  }

  return (
    <form className="rule-form" onSubmit={handleSubmit}>
      <div className="rule-form__row">
        <label htmlFor="rule-name">Rule name</label>
        <input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lobby smoke -> alarm" />
      </div>

      <div className="rule-form__row">
        <label htmlFor="rule-priority">Priority (higher wins ties)</label>
        <input
          id="rule-priority"
          type="number"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
        />
      </div>

      <div className="rule-form__row">
        <label>Condition</label>
        <div className="rule-form__condition">
          <input
            value={variable}
            onChange={(e) => setVariable(e.target.value)}
            placeholder="zone.variable"
            list="rulemesh-known-keys"
          />
          <select value={operator} onChange={(e) => setOperator(e.target.value as Operator)}>
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          <input value={condValue} onChange={(e) => setCondValue(e.target.value)} placeholder="value" />
        </div>
      </div>

      <div className="rule-form__row">
        <label>Action</label>
        <div className="rule-form__action">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="zone.actuator"
            list="rulemesh-known-keys"
          />
          <input value={actionValue} onChange={(e) => setActionValue(e.target.value)} placeholder="value" />
        </div>
      </div>

      <datalist id="rulemesh-known-keys">
        {knownKeys.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>

      {(localError || lastRejectionMessage) && (
        <div className="rule-form__error">{localError ?? lastRejectionMessage}</div>
      )}

      <div className="rule-form__footer">
        <button type="submit" className="btn btn--primary">
          Add rule
        </button>
      </div>
    </form>
  );
}
