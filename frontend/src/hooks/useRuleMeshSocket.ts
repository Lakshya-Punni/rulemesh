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
  simulation_running?: boolean;
  simulation_seed?: number | null;
  perf?: {
    events_per_second: number;
    accepted_events: number;
    rejected_events: number;
  };
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

function operationErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = payload.detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

function commandFeedback(command: ClientCommand): { pending: string; success: string } {
  switch (command.type) {
    case "create_rule":
      return { pending: "Validating and saving rule…", success: "Rule created and graph re-evaluated." };
    case "update_rule":
      return { pending: "Updating rule…", success: "Rule updated across live sessions." };
    case "toggle_rule":
      return {
        pending: `${command.enabled ? "Enabling" : "Disabling"} rule…`,
        success: `Rule ${command.enabled ? "enabled" : "disabled"}.`,
      };
    case "delete_rule":
      return { pending: "Deleting rule…", success: "Rule deleted and graph re-evaluated." };
    case "set_manual":
      return { pending: "Applying sensor update…", success: "Sensor update applied." };
    case "reset_environment":
      return { pending: "Resetting environment…", success: "Environment reset." };
    case "reset_demo":
      return { pending: "Restoring the judge demo…", success: "Demo restored to its known-good state." };
    case "acknowledge_alert":
      return { pending: "Acknowledging alert…", success: "Alert acknowledged." };
  }
}

interface UseRuleMeshSocketResult {
  status: ConnectionStatus;
  state: StateMessage | null;
  lastCycleError: CycleError | null;
  dismissCycleError: () => void;
  lastOperationError: string | null;
  dismissOperationError: () => void;
  pendingOperation: string | null;
  lastSuccessMessage: string | null;
  dismissSuccessMessage: () => void;
  send: (command: ClientCommand) => void;
  startSimulation: (seed: number) => void;
  stopSimulation: () => void;
  usingMock: boolean;
}

export function useRuleMeshSocket(): UseRuleMeshSocketResult {
  const [state, setStateRaw] = useState<StateMessage | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(USE_MOCK ? "open" : "connecting");
  const [lastCycleError, setLastCycleError] = useState<CycleError | null>(null);
  const [lastOperationError, setLastOperationError] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<string | null>(null);
  const [lastSuccessMessage, setLastSuccessMessage] = useState<string | null>(null);
  const [renderLatency, setRenderLatency] = useState({ p50: 0, p95: 0 });
  const mockRef = useRef<MockRuleMeshSocket | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef<StateMessage | null>(null);
  const latencySamplesRef = useRef<number[]>([]);
  const rejectedEventsRef = useRef(0);
  const pendingCountRef = useRef(0);

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
      handleStateMessage({
        type: "state",
        revision: snapshot.revision,
        seed: snapshot.simulation_seed ?? null,
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
        simulation_running: snapshot.simulation_running ?? false,
        perf: {
          events_per_second: snapshot.perf?.events_per_second ?? 0,
          p50_latency_ms: 0,
          p95_latency_ms: 0,
          accepted_events: snapshot.perf?.accepted_events ?? 0,
          rejected_events: Math.max(snapshot.perf?.rejected_events ?? 0, rejectedEventsRef.current),
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
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(WS_URL!);
      wsRef.current = ws;
      ws.onopen = () => {
        if (cancelled) return;
        reconnectAttempt = 0;
        setStatus("open");
      };
      ws.onclose = () => {
        if (cancelled) return;
        setStatus("closed");
        const delay = Math.min(3000, 250 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(() => {
          setStatus("connecting");
          connect();
        }, delay);
      };
      ws.onerror = () => !cancelled && setStatus("error");
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as BackendSnapshot;
          if (msg.type === "snapshot") handleBackendSnapshot(msg);
        } catch {
          // The next authoritative snapshot repairs the UI after a malformed frame.
        }
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [handleBackendSnapshot, handleStateMessage]);

  const sendEnvironmentChanges = useCallback(
    async (changes: EnvironmentState) => {
      const eventCount = Object.keys(changes).length;
      try {
        const response = await fetch(`${API_URL}/api/environment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes }),
        });
        const payload = (await response.json()) as BackendSnapshot | { detail?: string };
        if (!response.ok) {
          rejectedEventsRef.current += eventCount;
          setLastOperationError(operationErrorMessage(payload, "The environment update was rejected."));
          console.error("RuleMesh API rejected an environment update", payload);
          return false;
        }

        setLastOperationError(null);
        if (wsRef.current?.readyState !== WebSocket.OPEN && "type" in payload && payload.type === "snapshot") {
          handleBackendSnapshot(payload);
        }
        return true;
      } catch (error) {
        setStatus("error");
        setLastOperationError(error instanceof Error ? error.message : "The backend could not be reached.");
        console.error("RuleMesh environment update failed", error);
        return false;
      }
    },
    [handleBackendSnapshot],
  );

  const sendSimulationControl = useCallback(
    async (path: "/api/simulation/start" | "/api/simulation/stop", body?: { seed: number }) => {
      try {
        const response = await fetch(`${API_URL}${path}`, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = (await response.json()) as BackendSnapshot | { detail?: string };
        if (!response.ok) {
          setLastOperationError(operationErrorMessage(payload, "The simulation command was rejected."));
          console.error("RuleMesh API rejected a simulation command", payload);
          return false;
        }
        setLastOperationError(null);
        if (wsRef.current?.readyState !== WebSocket.OPEN && "type" in payload && payload.type === "snapshot") {
          handleBackendSnapshot(payload);
        }
        return true;
      } catch (error) {
        setStatus("error");
        setLastOperationError(error instanceof Error ? error.message : "The backend could not be reached.");
        console.error("RuleMesh simulation command failed", error);
        return false;
      }
    },
    [handleBackendSnapshot],
  );

  const sendReal = useCallback(
    async (command: ClientCommand) => {
      let method = "POST";
      let path = "";
      let body: unknown;
      let rejectedRule: RuleDraft | Rule | null = null;

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
          return await sendEnvironmentChanges({ [command.variable]: command.value });
        case "reset_environment":
          return await sendEnvironmentChanges(RESET_ENVIRONMENT);
        case "reset_demo":
          path = "/api/demo/reset";
          break;
        case "acknowledge_alert":
          return true;
      }

      try {
        const response = await fetch(`${API_URL}${path}`, {
          method,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const payload = (await response.json()) as BackendSnapshot | BackendCycleError | { detail?: string };
        if (!response.ok) {
          rejectedEventsRef.current += 1;
          if ("code" in payload && payload.code === "CYCLE_DETECTED") {
            setLastOperationError(null);
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
            setLastOperationError(operationErrorMessage(payload, "The backend rejected this command."));
            console.error("RuleMesh API rejected a command", payload);
          }
          return false;
        }

        setLastOperationError(null);
        if (command.type === "reset_demo") setLastCycleError(null);
        if (wsRef.current?.readyState !== WebSocket.OPEN && "type" in payload && payload.type === "snapshot") {
          handleBackendSnapshot(payload);
        }
        return true;
      } catch (error) {
        setStatus("error");
        setLastOperationError(error instanceof Error ? error.message : "The backend could not be reached.");
        console.error("RuleMesh API request failed", error);
        return false;
      }
    },
    [handleBackendSnapshot, sendEnvironmentChanges],
  );

  const executeWithFeedback = useCallback(
    async (pending: string, success: string, operation: () => Promise<boolean>) => {
      pendingCountRef.current += 1;
      setPendingOperation(pending);
      setLastSuccessMessage(null);
      try {
        if (await operation()) setLastSuccessMessage(success);
      } finally {
        pendingCountRef.current -= 1;
        if (pendingCountRef.current === 0) setPendingOperation(null);
      }
    },
    [],
  );

  const send = useCallback(
    (command: ClientCommand) => {
      const feedback = commandFeedback(command);
      void executeWithFeedback(feedback.pending, feedback.success, async () => {
        if (USE_MOCK) {
          mockRef.current?.send(command);
          return true;
        }
        return await sendReal(command);
      });
    },
    [executeWithFeedback, sendReal],
  );

  const startSimulation = useCallback(
    (seed: number) => {
      void executeWithFeedback("Starting deterministic simulation…", "Simulation started.", async () => {
        if (USE_MOCK) {
          mockRef.current?.startSimulation(seed);
          return true;
        }
        return await sendSimulationControl("/api/simulation/start", { seed });
      });
    },
    [executeWithFeedback, sendSimulationControl],
  );

  const stopSimulation = useCallback(() => {
    void executeWithFeedback("Stopping simulation…", "Simulation stopped.", async () => {
      if (USE_MOCK) {
        mockRef.current?.stopSimulation();
        return true;
      }
      return await sendSimulationControl("/api/simulation/stop");
    });
  }, [executeWithFeedback, sendSimulationControl]);

  const dismissCycleError = useCallback(() => setLastCycleError(null), []);
  const dismissOperationError = useCallback(() => setLastOperationError(null), []);
  const dismissSuccessMessage = useCallback(() => setLastSuccessMessage(null), []);
  useEffect(() => {
    if (!lastSuccessMessage) return;
    const timer = window.setTimeout(() => setLastSuccessMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [lastSuccessMessage]);
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
    lastOperationError,
    dismissOperationError,
    pendingOperation,
    lastSuccessMessage,
    dismissSuccessMessage,
    send,
    startSimulation,
    stopSimulation,
    usingMock: USE_MOCK,
  };
}
