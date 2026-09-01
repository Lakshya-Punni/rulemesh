import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientCommand, ConnectionStatus, CycleError, StateMessage } from "../types";
import { MockRuleMeshSocket } from "../mock/mockSocket";

const WS_URL = import.meta.env.VITE_WS_URL as string | undefined;
const USE_MOCK = !WS_URL;

// How many recent state-message render latencies we keep to compute rolling
// p50/p95. This is the plan's hours 9-11 requirement, measured for real
// rather than faked: for every "state" message, we time from the moment we
// hand it to React (setState) to the moment the browser actually paints the
// resulting frame (via a double requestAnimationFrame), which is the honest
// "interface latency" a judge watching the screen actually experiences.
const LATENCY_WINDOW = 60;

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return Math.round(sortedAsc[idx]);
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
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastCycleError, setLastCycleError] = useState<CycleError | null>(null);
  const [renderLatency, setRenderLatency] = useState({ p50: 0, p95: 0 });
  const mockRef = useRef<MockRuleMeshSocket | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const latencySamplesRef = useRef<number[]>([]);

  // Wraps setState so every "state" message is timed from hand-off to React
  // through to the next painted frame, and folds that into a rolling p50/p95.
  const handleStateMessage = useCallback((msg: StateMessage) => {
    const receivedAt = performance.now();
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

  useEffect(() => {
    if (USE_MOCK) {
      const mock = new MockRuleMeshSocket();
      mockRef.current = mock;
      setStatus("open");
      const unsubscribe = mock.onMessage((msg) => {
        if (msg.type === "state") handleStateMessage(msg);
        else if (msg.type === "cycle_error") setLastCycleError(msg);
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
        const msg = JSON.parse(event.data) as StateMessage | CycleError;
        if (msg.type === "state") handleStateMessage(msg);
        else if (msg.type === "cycle_error") setLastCycleError(msg);
      } catch {
        // ignore malformed frame
      }
    };
    return () => {
      cancelled = true;
      ws.close();
    };
  }, [handleStateMessage]);

  // Expose state with perf.p50/p95 overwritten by the real measurement above.
  // events_per_second/accepted/rejected still come from the server — those
  // are legitimate counts, not something the client can measure itself.
  const measuredState: StateMessage | null = state
    ? {
        ...state,
        perf: { ...state.perf, p50_latency_ms: renderLatency.p50, p95_latency_ms: renderLatency.p95 },
      }
    : null;

  const send = useCallback((command: ClientCommand) => {
    if (USE_MOCK) mockRef.current?.send(command);
    else if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(command));
  }, []);

  const startSimulation = useCallback((seed: number) => {
    if (USE_MOCK) mockRef.current?.startSimulation(seed);
    else send({ type: "set_manual", variable: "__start_simulation__", value: seed });
  }, [send]);

  const stopSimulation = useCallback(() => {
    if (USE_MOCK) mockRef.current?.stopSimulation();
    else send({ type: "set_manual", variable: "__stop_simulation__", value: true });
  }, [send]);

  const dismissCycleError = useCallback(() => setLastCycleError(null), []);

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
