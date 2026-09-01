import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientCommand,
  ConnectionStatus,
  CycleError,
  EnvironmentState,
  Rule,
  RuleDraft,
  StateMessage,
} from "../types";
import { MockRuleMeshSocket } from "../mock/mockSocket";

const WS_URL = import.meta.env.VITE_WS_URL as string | undefined;
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true" || !WS_URL;
const LATENCY_WINDOW = 60;
const SENSOR_KEYS = new Set([
  "laboratory.smoke",
  "laboratory.temperature",
  "building.quiet_hours",
]);
const RESET_ENVIRONMENT: EnvironmentState = {
  "laboratory.smoke": 0,
  "laboratory.temperature": 24,
  "building.quiet_hours": false,
};

interface BackendProposal {
  rule_id: string;
  rule_name: string;
  priority: number;
  created_sequence: number;
  value: number | boolean | string;
}

interface BackendSnapshot {
  type: "snapshot";
  revision: number;
  state: EnvironmentState;
  rules: Rule[];
  active_rule_ids: string[];
  conflicts: Array<{
    target: string;
    winner: BackendProposal;
    proposals: BackendProposal[];
    reason: string;
  }>;
  connected_sessions?: number;
}

interface BackendCycleError {
  code: "CYCLE_DETECTED";
  message: string;
  path: string[];
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return Math.round(sortedAsc[idx]);
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface UseRuleMeshSocketResult {
  status: ConnectionStatus;
  state: StateMessage | null;
  lastCycleError: CycleError | null;
  dismissCycleError: () => void;
  send: (command: ClientCommand) => void;
  startSimulation: (seed: number) => void;
  stopSimulation: () => void;
  usingMock: boolean;
}

export function useRuleMeshSocket(): UseRuleMeshSocketResult {
  const [state, setStateRaw] = useState<StateMessage | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(USE_MOCK ? "open" : "connecting");
  const [lastCycleError, setLastCycleError] = useState<CycleError | null>(null);
  const [renderLatency, setRenderLatency] = useState({ p50: 0, p95: 0 });
  const mockRef = useRef<MockRuleMeshSocket | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef<StateMessage | null>(null);
  const simulationRef = useRef<number | null>(null);
  const simulationBusyRef = useRef(false);
  const seedRef = useRef<number | null>(null);
  const latencySamplesRef = useRef<number[]>([]);
  const acceptedEventsRef = useRef(0);
  const rejectedEventsRef = useRef(0);
  const eventTimesRef = useRef<number[]>([]);

  const handleStateMessage = useCallback((msg: StateMessage) => {
    const receivedAt = performance.now();
    stateRef.current = msg;
    setStateRaw(msg);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const latency = performance.now() - receivedAt;
        const samples = latencySamplesRef.current;
        samples.push(latency);
        if (samples.length > LATENCY_WINDOW) samples.shift();
        const sorted = [...samples].sort((a, b) => a - b);
        setRenderLatency({ p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) });
      });
    });
  }, []);

  const handleBackendSnapshot = useCallback(
    (snapshot: BackendSnapshot) => {
      const environment: EnvironmentState = {};
      const actuators: EnvironmentState = {};
      for (const [key, value] of Object.entries(snapshot.state)) {
        (SENSOR_KEYS.has(key) ? environment : actuators)[key] = value;
      }

      const activeIds = new Set(snapshot.active_rule_ids);
      const now = performance.now();
      eventTimesRef.current = eventTimesRef.current.filter((at) => now - at <= 1000);
      handleStateMessage({
        type: "state",
        revision: snapshot.revision,
        seed: seedRef.current,
        environment,
        actuators,
        rules: snapshot.rules,
        conflicts: snapshot.conflicts.map((conflict) => ({
          target: conflict.target,
          proposals: conflict.proposals.map((proposal) => ({
            ...proposal,
            won: proposal.rule_id === conflict.winner.rule_id,
            reason: conflict.reason,
          })),
        })),
        active_chains: snapshot.rules
          .filter((rule) => activeIds.has(rule.id))
          .flatMap((rule) =>
            rule.conditions.map((condition) => ({
              nodes: [condition.variable, rule.name, rule.action.target],
            })),
          ),
        connected_sessions: snapshot.connected_sessions ?? 1,
        perf: {
          events_per_second: eventTimesRef.current.length,
          p50_latency_ms: 0,
          p95_latency_ms: 0,
          accepted_events: acceptedEventsRef.current,
          rejected_events: rejectedEventsRef.current,
        },
      });
    },
    [handleStateMessage],
  );

  useEffect(() => {
    if (USE_MOCK) {
      const mock = new MockRuleMeshSocket();
      mockRef.current = mock;
      const unsubscribe = mock.onMessage((msg) => {
        if (msg.type === "state") handleStateMessage(msg);
        else setLastCycleError(msg);
      });
      return () => {
        unsubscribe();
        mock.stopSimulation();
      };
    }

    let cancelled = false;
    const ws = new WebSocket(WS_URL!);
    wsRef.current = ws;
    setStatus("connecting");
    ws.onopen = () => !cancelled && setStatus("open");
    ws.onclose = () => !cancelled && setStatus("closed");
    ws.onerror = () => !cancelled && setStatus("error");
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as BackendSnapshot;
        if (msg.type === "snapshot") handleBackendSnapshot(msg);
      } catch {
        // The next authoritative snapshot repairs the UI after a malformed frame.
      }
    };
    return () => {
      cancelled = true;
      ws.close();
      if (simulationRef.current !== null) window.clearInterval(simulationRef.current);
    };
  }, [handleBackendSnapshot, handleStateMessage]);

  const recordAccepted = useCallback((count: number) => {
    acceptedEventsRef.current += count;
    const now = performance.now();
    for (let i = 0; i < count; i += 1) eventTimesRef.current.push(now);
  }, []);

  const sendReal = useCallback(
    async (command: ClientCommand) => {
      let method = "POST";
      let path = "";
      let body: unknown;
      let rejectedRule: RuleDraft | Rule | null = null;
      let eventCount = 1;

      switch (command.type) {
        case "create_rule":
          path = "/api/rules";
          body = command.rule;
          rejectedRule = command.rule;
          break;
        case "update_rule": {
          method = "PUT";
          path = `/api/rules/${encodeURIComponent(command.id)}`;
          body = command.rule;
          const existing = stateRef.current?.rules.find((rule) => rule.id === command.id);
          if (existing) rejectedRule = { ...existing, ...command.rule };
          break;
        }
        case "toggle_rule":
          path = `/api/rules/${encodeURIComponent(command.id)}/toggle`;
          body = { enabled: command.enabled };
          break;
        case "delete_rule":
          method = "DELETE";
          path = `/api/rules/${encodeURIComponent(command.id)}`;
          break;
        case "set_manual":
          path = "/api/environment";
          body = { changes: { [command.variable]: command.value } };
          break;
        case "reset_environment":
          path = "/api/environment";
          body = { changes: RESET_ENVIRONMENT };
          eventCount = Object.keys(RESET_ENVIRONMENT).length;
          break;
        case "acknowledge_alert":
          return;
      }

      try {
        const response = await fetch(`${API_URL}${path}`, {
          method,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const payload = (await response.json()) as BackendSnapshot | BackendCycleError | { detail?: string };
        if (!response.ok) {
          rejectedEventsRef.current += eventCount;
          if ("code" in payload && payload.code === "CYCLE_DETECTED") {
            setLastCycleError({
              type: "cycle_error",
              path: payload.path,
              rejected_rule: rejectedRule ?? {
                name: "Rejected update",
                enabled: false,
                priority: 0,
                conditions: [],
                action: { target: "unknown", value: false },
              },
              message: `${payload.message} Path: ${payload.path.join(" → ")}`,
            });
          } else {
            console.error("RuleMesh API rejected a command", payload);
          }
          return;
        }

        recordAccepted(eventCount);
        if (wsRef.current?.readyState !== WebSocket.OPEN && "type" in payload && payload.type === "snapshot") {
          handleBackendSnapshot(payload);
        }
      } catch (error) {
        setStatus("error");
        console.error("RuleMesh API request failed", error);
      }
    },
    [handleBackendSnapshot, recordAccepted],
  );

  const send = useCallback(
    (command: ClientCommand) => {
      if (USE_MOCK) mockRef.current?.send(command);
      else void sendReal(command);
    },
    [sendReal],
  );

  const startSimulation = useCallback(
    (seed: number) => {
      if (USE_MOCK) {
        mockRef.current?.startSimulation(seed);
        return;
      }
      if (simulationRef.current !== null) window.clearInterval(simulationRef.current);
      seedRef.current = seed;
      const random = mulberry32(seed);
      const incidentTick = 18 + Math.floor(random() * 12);
      let tick = 0;
      simulationRef.current = window.setInterval(() => {
        if (simulationBusyRef.current) return;
        simulationBusyRef.current = true;
        tick += 1;
        const smoke = tick < incidentTick ? Math.round(random() * 8) : Math.min(95, (tick - incidentTick) * 6);
        const temperature = tick < incidentTick ? 24 + random() * 2 : Math.min(45, 26 + (tick - incidentTick) * 1.2);
        void sendReal({ type: "set_manual", variable: "laboratory.smoke", value: smoke })
          .then(() => sendReal({ type: "set_manual", variable: "laboratory.temperature", value: temperature }))
          .finally(() => {
            simulationBusyRef.current = false;
          });
      }, 100);
    },
    [sendReal],
  );

  const stopSimulation = useCallback(() => {
    if (USE_MOCK) mockRef.current?.stopSimulation();
    else if (simulationRef.current !== null) {
      window.clearInterval(simulationRef.current);
      simulationRef.current = null;
    }
  }, []);

  const dismissCycleError = useCallback(() => setLastCycleError(null), []);
  const measuredState = useMemo<StateMessage | null>(
    () =>
      state
        ? {
            ...state,
            perf: {
              ...state.perf,
              p50_latency_ms: renderLatency.p50,
              p95_latency_ms: renderLatency.p95,
            },
          }
        : null,
    [renderLatency.p50, renderLatency.p95, state],
  );

  return {
    status,
    state: measuredState,
    lastCycleError,
    dismissCycleError,
    send,
    startSimulation,
    stopSimulation,
    usingMock: USE_MOCK,
  };
}
