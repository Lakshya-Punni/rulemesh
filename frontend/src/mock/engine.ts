// Standalone re-implementation of the RuleMesh evaluation algorithm (plan section 4),
// used only by the mock socket so the frontend can be built/demoed before Person A's
// backend is ready. NOT the source of truth once the real backend exists — swap it out
// via VITE_WS_URL, see src/hooks/useRuleMeshSocket.ts.

import type {
  Rule,
  RuleDraft,
  Condition,
  EnvironmentState,
  ConflictInfo,
  ProposalResult,
  ActiveChain,
  CycleError,
} from "../types";

export const ZONES = ["laboratory"] as const;

export const GLOBAL_KEYS = ["building.evacuation", "building.quiet_hours"] as const;

function defaultEnvironment(): EnvironmentState {
  return {
    "laboratory.smoke": 0,
    "laboratory.temperature": 24,
    "building.quiet_hours": false,
  };
}

function defaultActuatorDefaults(): EnvironmentState {
  return {
    "laboratory.alarm": false,
    "laboratory.hvac": "off",
    "laboratory.exit_locked": true,
    "laboratory.emergency_lights": false,
    "building.evacuation": false,
  };
}

export function starterRules(): Rule[] {
  const rules: Omit<Rule, "id" | "created_sequence">[] = [
    {
      name: "Fire alarm",
      enabled: true,
      priority: 90,
      conditions: [{ variable: "laboratory.smoke", operator: ">", value: 70 }],
      action: { target: "laboratory.alarm", value: true },
    },
    {
      name: "Evacuate",
      enabled: true,
      priority: 90,
      conditions: [{ variable: "laboratory.alarm", operator: "==", value: true }],
      action: { target: "building.evacuation", value: true },
    },
    {
      name: "Unlock exits",
      enabled: true,
      priority: 100,
      conditions: [{ variable: "building.evacuation", operator: "==", value: true }],
      action: { target: "laboratory.exit_locked", value: false },
    },
    {
      name: "Emergency lights",
      enabled: true,
      priority: 80,
      conditions: [{ variable: "building.evacuation", operator: "==", value: true }],
      action: { target: "laboratory.emergency_lights", value: true },
    },
    {
      name: "Smoke shutdown",
      enabled: true,
      priority: 90,
      conditions: [{ variable: "laboratory.smoke", operator: ">", value: 60 }],
      action: { target: "laboratory.hvac", value: "off" },
    },
    {
      name: "Temperature cooling",
      enabled: true,
      priority: 40,
      conditions: [{ variable: "laboratory.temperature", operator: ">", value: 32 }],
      action: { target: "laboratory.hvac", value: "cool" },
    },
    {
      name: "Quiet hours",
      enabled: true,
      priority: 10,
      conditions: [{ variable: "building.quiet_hours", operator: "==", value: true }],
      action: { target: "laboratory.alarm", value: false },
    },
  ];
  return rules.map((rule, index) => ({
    ...rule,
    id: `rule-${index + 1}`,
    created_sequence: index + 1,
  }));
}

function evalCondition(cond: Condition, env: EnvironmentState): boolean {
  const actual = env[cond.variable];
  if (actual === undefined) return false;
  switch (cond.operator) {
    case "==":
      return actual === cond.value;
    case "!=":
      return actual !== cond.value;
    case ">":
      return Number(actual) > Number(cond.value);
    case ">=":
      return Number(actual) >= Number(cond.value);
    case "<":
      return Number(actual) < Number(cond.value);
    case "<=":
      return Number(actual) <= Number(cond.value);
    default:
      return false;
  }
}

/** Detect a cycle among condition-variable -> rule -> action-target edges,
 * including a proposed extra rule. Returns the exact cycle path, or null. */
export function findCycle(rules: Rule[] | RuleDraft[], proposed?: RuleDraft): string[] | null {
  const all: (Rule | RuleDraft)[] = proposed ? [...rules, proposed] : rules;
  const adj = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  all.forEach((r, i) => {
    const ruleNode = `rule::${"id" in r ? r.id : `draft-${i}`}::${r.name}`;
    for (const c of r.conditions) addEdge(c.variable, ruleNode);
    addEdge(ruleNode, r.action.target);
  });

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const path: string[] = [];

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);
    path.push(node);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === WHITE) {
        const found = dfs(next);
        if (found) return found;
      } else if (c === GRAY) {
        const cycleStart = path.indexOf(next);
        return [...path.slice(cycleStart), next];
      }
    }
    path.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const node of adj.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      const found = dfs(node);
      if (found) return found.filter((n) => !n.startsWith("rule::"));
    }
  }
  return null;
}

export interface EvalResult {
  actuators: EnvironmentState;
  conflicts: ConflictInfo[];
  active_chains: ActiveChain[];
}

export function evaluate(env: EnvironmentState, rules: Rule[]): EvalResult {
  let actuators = defaultActuatorDefaults();
  let proposalsByTarget = new Map<string, ProposalResult[]>();
  let activeRuleNames: { name: string; target: string; variable: string }[] = [];

  // Start each recomputation from manual sensor/global state plus default
  // actuators, then repeatedly let winning actuator proposals feed later rule
  // conditions. Because rule creation rejects structural cycles, this reaches a
  // stable chained result quickly while still retracting inactive proposals.
  const maxPasses = rules.length + 2;
  for (let pass = 0; pass < maxPasses; pass++) {
    const workingState: EnvironmentState = { ...env, ...actuators };
    const nextProposalsByTarget = new Map<string, ProposalResult[]>();
    const nextActiveRuleNames: { name: string; target: string; variable: string }[] = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;
      const active = rule.conditions.every((c) => evalCondition(c, workingState));
      if (!active) continue;
      const list = nextProposalsByTarget.get(rule.action.target) ?? [];
      list.push({
        rule_id: rule.id,
        rule_name: rule.name,
        value: rule.action.value,
        priority: rule.priority,
        created_sequence: rule.created_sequence,
        won: false,
        reason: "",
      });
      nextProposalsByTarget.set(rule.action.target, list);
      nextActiveRuleNames.push({
        name: rule.name,
        target: rule.action.target,
        variable: rule.conditions[0]?.variable ?? "",
      });
    }

    const nextActuators = arbitrateActuators(nextProposalsByTarget);
    proposalsByTarget = nextProposalsByTarget;
    activeRuleNames = nextActiveRuleNames;

    if (sameState(actuators, nextActuators)) {
      actuators = nextActuators;
      break;
    }
    actuators = nextActuators;
  }

  const conflicts = buildConflicts(proposalsByTarget);

  // Build simple active chains: variable -> rule -> target for currently active rules.
  const active_chains: ActiveChain[] = activeRuleNames
    .filter((r) => r.variable)
    .map((r) => ({ nodes: [r.variable, r.name, r.target] }));

  return { actuators, conflicts, active_chains };
}

function arbitrateActuators(proposalsByTarget: Map<string, ProposalResult[]>): EnvironmentState {
  const actuators = defaultActuatorDefaults();
  for (const [target, proposals] of proposalsByTarget) {
    proposals.sort((a, b) =>
      b.priority !== a.priority ? b.priority - a.priority : a.created_sequence - b.created_sequence,
    );
    actuators[target] = proposals[0].value;
  }
  return actuators;
}

function buildConflicts(proposalsByTarget: Map<string, ProposalResult[]>): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];

  for (const [target, proposals] of proposalsByTarget) {
    proposals.sort((a, b) =>
      b.priority !== a.priority ? b.priority - a.priority : a.created_sequence - b.created_sequence,
    );
    const winner = proposals[0];
    proposals.forEach((p, i) => {
      p.won = i === 0;
      if (i === 0) {
        p.reason =
          proposals.length > 1
            ? `priority ${p.priority} beats ${proposals[1].priority}`
            : "only active proposal";
      } else {
        p.reason =
          p.priority !== winner.priority
            ? `${winner.priority} > ${p.priority}`
            : `older creation order wins (#${winner.created_sequence} < #${p.created_sequence})`;
      }
    });
    // Only surface as a visible "conflict" when proposals actually disagree on value.
    const distinctValues = new Set(proposals.map((p) => p.value));
    if (proposals.length > 1 && distinctValues.size > 1) {
      conflicts.push({ target, proposals });
    }
  }
  return conflicts;
}

function sameState(a: EnvironmentState, b: EnvironmentState): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function initialEnvironment(): EnvironmentState {
  return defaultEnvironment();
}

export function makeCycleError(path: string[], rejected: RuleDraft): CycleError {
  return {
    type: "cycle_error",
    path,
    rejected_rule: rejected,
    message: `Cycle detected: ${path.join(" -> ")}. The proposed rule was not activated.`,
  };
}
