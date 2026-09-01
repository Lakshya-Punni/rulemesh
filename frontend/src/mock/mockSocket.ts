import type {
  ClientCommand,
  Rule,
  StateMessage,
  ServerMessage,
  EnvironmentState,
} from "../types";
import { ZONES, starterRules, evaluate, initialEnvironment, findCycle, makeCycleError } from "./engine";

// Deterministic PRNG so a "seed" behaves like the real judge-controlled seed.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Listener = (msg: ServerMessage) => void;

/** Drop-in stand-in for a real WebSocket connection to /ws/live. Same message
 * shapes as the backend contract (see types.ts) so swapping to the real
 * socket later is a one-line change in useRuleMeshSocket. */
export class MockRuleMeshSocket {
  private rules: Rule[] = starterRules();
  private env: EnvironmentState = initialEnvironment();
  private revision = 0;
  private seed: number | null = null;
  private rand = mulberry32(42);
  private nextId = 1000;
  private listeners = new Set<Listener>();
  private tickHandle: number | null = null;
  private accepted = 0;
  private rejected = 0;
  private connectedSessions = 1;

  constructor() {
    setTimeout(() => this.broadcast(), 50);
  }

  onMessage(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  send(command: ClientCommand) {
    switch (command.type) {
      case "create_rule": {
        const cycle = findCycle(this.rules, command.rule);
        if (cycle) {
          this.emit(makeCycleError(cycle, command.rule));
          this.rejected++;
          return;
        }
        const rule: Rule = { ...command.rule, id: `rule-${this.nextId}`, created_sequence: this.nextId };
        this.nextId++;
        this.rules.push(rule);
        this.accepted++;
        break;
      }
      case "update_rule": {
        const idx = this.rules.findIndex((r) => r.id === command.id);
        if (idx === -1) return;
        const candidate: Rule = { ...this.rules[idx], ...command.rule };
        const others = this.rules.filter((r) => r.id !== command.id);
        const cycle = findCycle(others, candidate);
        if (cycle) {
          this.emit(makeCycleError(cycle, candidate));
          this.rejected++;
          return;
        }
        this.rules[idx] = candidate;
        break;
      }
      case "toggle_rule": {
        const idx = this.rules.findIndex((r) => r.id === command.id);
        if (idx !== -1) this.rules[idx] = { ...this.rules[idx], enabled: command.enabled };
        break;
      }
      case "delete_rule": {
        this.rules = this.rules.filter((r) => r.id !== command.id);
        break;
      }
      case "set_manual": {
        this.env = { ...this.env, [command.variable]: command.value };
        break;
      }
      case "reset_environment": {
        this.env = initialEnvironment();
        break;
      }
      case "acknowledge_alert":
        break;
    }
    this.broadcast();
  }

  startSimulation(seed: number) {
    this.seed = seed;
    this.rand = mulberry32(seed);
    const incidentZone = ZONES[Math.floor(this.rand() * ZONES.length)];
    const incidentAtTick = 30 + Math.floor(this.rand() * 50); // ~3-8s at 100ms ticks
    let tick = 0;
    if (this.tickHandle) window.clearInterval(this.tickHandle);
    this.tickHandle = window.setInterval(() => {
      tick++;
      const nextEnv = { ...this.env };
      for (const zone of ZONES) {
        const noise = (this.rand() - 0.5) * 2;
        nextEnv[`${zone}.temperature`] = clamp(Number(nextEnv[`${zone}.temperature`]) + noise * 0.3, 18, 40);
        if (zone === incidentZone && tick >= incidentAtTick) {
          const rampTicks = tick - incidentAtTick;
          nextEnv[`${zone}.smoke`] = clamp(rampTicks * 1.5, 0, 100);
          nextEnv[`${zone}.temperature`] = clamp(20 + rampTicks * 0.4, 18, 60);
        } else {
          nextEnv[`${zone}.smoke`] = clamp(Number(nextEnv[`${zone}.smoke`]) + noise * 0.5, 0, 20);
        }
      }
      this.env = nextEnv;
      this.accepted += 2;
      this.broadcast();
    }, 100);
  }

  stopSimulation() {
    if (this.tickHandle) window.clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  private broadcast() {
    this.revision++;
    const { actuators, conflicts, active_chains } = evaluate(this.env, this.rules);
    const msg: StateMessage = {
      type: "state",
      revision: this.revision,
      seed: this.seed,
      environment: this.env,
      actuators,
      rules: this.rules,
      conflicts,
      active_chains,
      connected_sessions: this.connectedSessions,
      perf: {
        events_per_second: this.tickHandle ? 20 : 0,
        // p50/p95 are NOT measured here — they're overwritten by useRuleMeshSocket
        // with a real client-side render-latency measurement. See that hook.
        p50_latency_ms: 0,
        p95_latency_ms: 0,
        accepted_events: this.accepted,
        rejected_events: this.rejected,
      },
    };
    this.emit(msg);
  }

  private emit(msg: ServerMessage) {
    for (const l of this.listeners) l(msg);
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
