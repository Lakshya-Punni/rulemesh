// RuleMesh shared contracts — frozen between Person A (backend) and Person B (frontend).
// Mirrors section 3 of the plan (rule model) plus the WS/state/conflict/cycle shapes
// implied by sections 4, 6, and 7. Keep this file in sync with the backend's Pydantic models.

export type Operator = "==" | "!=" | ">" | ">=" | "<" | "<=";

export interface Condition {
  variable: string; // e.g. "laboratory.smoke"
  operator: Operator;
  value: number | boolean | string;
}

export interface RuleAction {
  target: string; // e.g. "laboratory.alarm"
  value: number | boolean | string;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: Condition[];
  action: RuleAction;
  created_sequence: number;
}

// What the rule creation form sends — id/created_sequence are assigned server-side.
export type RuleDraft = Omit<Rule, "id" | "created_sequence">;

export type EnvironmentState = Record<string, number | boolean | string>;

export type DemoStage = "normal" | "heat" | "fire" | "safety_override";

export interface ProposalResult {
  rule_id: string;
  rule_name: string;
  value: number | boolean | string;
  priority: number;
  created_sequence: number;
  won: boolean;
  reason: string; // human-readable, e.g. "90 > 40" or "older creation order"
}

export interface ConflictInfo {
  target: string;
  proposals: ProposalResult[]; // includes winner and losers
}

export interface CycleError {
  type: "cycle_error";
  path: string[]; // e.g. ["laboratory.alarm", "building.evacuation", "laboratory.alarm"]
  rejected_rule: RuleDraft | Rule;
  message: string;
}

export interface ActiveChain {
  // ordered list of variable/rule/target hops that are currently "live"
  nodes: string[];
}

export interface PerfStats {
  events_per_second: number;
  target_events_per_second: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  accepted_events: number;
  rejected_events: number;
}

// The authoritative broadcast the server sends after every tick / mutation.
export interface StateMessage {
  type: "state";
  emitted_at_ms?: number;
  revision: number;
  seed: number | null;
  environment: EnvironmentState;
  actuators: EnvironmentState;
  rules: Rule[];
  conflicts: ConflictInfo[];
  active_chains: ActiveChain[];
  connected_sessions: number;
  simulation_running: boolean;
  perf: PerfStats;
  batch_id?: string;
}

export type ServerMessage = StateMessage | CycleError;

// Commands the client sends over the same socket (per the plan's single
// server-side command queue in hours 11–13).
export type ClientCommand =
  | { type: "create_rule"; rule: RuleDraft }
  | { type: "update_rule"; id: string; rule: Partial<RuleDraft> }
  | { type: "toggle_rule"; id: string; enabled: boolean }
  | { type: "delete_rule"; id: string }
  | { type: "set_manual"; variable: string; value: number | boolean | string }
  | { type: "reset_environment" }
  | { type: "reset_demo" }
  | { type: "run_demo_stage"; stage: DemoStage }
  | { type: "acknowledge_alert"; id: string };

export type ConnectionStatus = "connecting" | "open" | "closed" | "error";
