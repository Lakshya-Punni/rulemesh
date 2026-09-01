import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { useRuleMeshSocket } from "./hooks/useRuleMeshSocket";
import { Header } from "./components/Header";
import { ZoneControls } from "./components/ZoneControls";
import { ActuatorGrid } from "./components/ActuatorGrid";
import { ConflictPanel } from "./components/ConflictPanel";
import { CycleBanner } from "./components/CycleBanner";
import { OperationBanner } from "./components/OperationBanner";
import { CommandStatus } from "./components/CommandStatus";
import { RuleList } from "./components/RuleList";
import { RuleForm } from "./components/RuleForm";
import { DependencyGraph } from "./components/DependencyGraph";
import { SensorChart, type SensorSample } from "./components/SensorChart";
import { ExecutionTrace, type TraceEntry } from "./components/ExecutionTrace";
import { ZONES, starterRules } from "./mock/engine";
import type { Rule, RuleDraft, StateMessage } from "./types";

const ZONE_LABELS: Record<string, string> = {
  laboratory: "Laboratory",
  server_room: "Server Room",
  lobby: "Lobby",
  warehouse: "Warehouse",
  office: "Office",
};

const MAX_SENSOR_SAMPLES = 80; // ~8s of history at the 10Hz tick rate
const MAX_TRACE_ENTRIES = 40;

function App() {
  const {
    status,
    state,
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
  } = useRuleMeshSocket();
  const [selectedZone, setSelectedZone] = useState<(typeof ZONES)[number]>(ZONES[0]);
  const [sensorHistory, setSensorHistory] = useState<SensorSample[]>([]);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const commandsBusy = pendingOperation !== null;

  const prevStateRef = useRef<StateMessage | null>(null);
  const traceSeqRef = useRef(0);
  const sensorTRef = useRef(0);

  function handleStart(seed: number) {
    startSimulation(seed);
  }

  function handleStop() {
    stopSimulation();
  }

  function handleCreateRule(rule: RuleDraft) {
    send({ type: "create_rule", rule });
  }

  function handleResetDemo() {
    dismissCycleError();
    dismissOperationError();
    setSensorHistory([]);
    setTrace([]);
    send({ type: "reset_demo" });
  }

  // "Load starter rules" (plan hours 5-7, Person B) — re-adds any of the
  // seven default rule patterns that are currently missing (by name),
  // without a new command type: it's just create_rule commands the server
  // already understands, so no contract change is needed. Useful for
  // resetting to a known-good demo state after live rule editing.
  function handleLoadStarterRules() {
    const existingNames = new Set((state?.rules ?? []).map((r) => r.name));
    for (const { id: _id, created_sequence: _seq, ...draft } of starterRules()) {
      if (!existingNames.has(draft.name)) {
        send({ type: "create_rule", rule: draft });
      }
    }
  }

  // Reset the selected-zone chart history whenever the zone changes, so
  // stale data from a different zone never lingers on screen.
  useEffect(() => {
    setSensorHistory([]);
    sensorTRef.current = 0;
  }, [selectedZone]);

  // Append one sensor sample per state message (naturally <=10Hz, since the
  // simulator ticks at 100ms) and derive execution-trace entries by diffing
  // this state against the previous one. All client-side, no backend change.
  useEffect(() => {
    if (!state) return;
    const smoke = Number(state.environment[`${selectedZone}.smoke`] ?? 0);
    const temperature = Number(state.environment[`${selectedZone}.temperature`] ?? 0);
    sensorTRef.current += 1;
    setSensorHistory((prev) => {
      const next = [...prev, { t: sensorTRef.current, smoke, temperature }];
      return next.length > MAX_SENSOR_SAMPLES ? next.slice(next.length - MAX_SENSOR_SAMPLES) : next;
    });

    const prev = prevStateRef.current;
    const newEntries: TraceEntry[] = [];
    const nextId = () => `t${traceSeqRef.current++}`;

    if (prev) {
      const prevActiveRules = new Set(prev.active_chains.map((c) => c.nodes[1]));
      const nextActiveRules = new Set(state.active_chains.map((c) => c.nodes[1]));
      for (const chain of state.active_chains) {
        const ruleName = chain.nodes[1];
        if (!prevActiveRules.has(ruleName)) {
          newEntries.push({
            id: nextId(),
            kind: "activated",
            atMs: Date.now(),
            text: `${chain.nodes[0]} → "${ruleName}" → ${chain.nodes[2]}`,
          });
        }
      }
      for (const chain of prev.active_chains) {
        const ruleName = chain.nodes[1];
        if (!nextActiveRules.has(ruleName)) {
          newEntries.push({ id: nextId(), kind: "deactivated", atMs: Date.now(), text: `"${ruleName}" retracted` });
        }
      }

      const prevConflictTargets = new Set(prev.conflicts.map((c) => c.target));
      for (const c of state.conflicts) {
        if (!prevConflictTargets.has(c.target)) {
          const winner = c.proposals.find((p) => p.won);
          newEntries.push({
            id: nextId(),
            kind: "conflict",
            atMs: Date.now(),
            text: `Conflict on ${c.target} — "${winner?.rule_name}" won (${winner?.reason})`,
          });
        }
      }
      const nextConflictTargets = new Set(state.conflicts.map((c) => c.target));
      for (const c of prev.conflicts) {
        if (!nextConflictTargets.has(c.target)) {
          newEntries.push({ id: nextId(), kind: "resolved", atMs: Date.now(), text: `${c.target} conflict resolved` });
        }
      }

      if (state.rules.length > prev.rules.length) {
        const prevIds = new Set(prev.rules.map((r) => r.id));
        const added = state.rules.filter((r: Rule) => !prevIds.has(r.id));
        for (const r of added) {
          newEntries.push({ id: nextId(), kind: "rule", atMs: Date.now(), text: `Rule added: "${r.name}"` });
        }
      } else if (state.rules.length < prev.rules.length) {
        newEntries.push({ id: nextId(), kind: "rule", atMs: Date.now(), text: "Rule deleted" });
      }
    }

    if (newEntries.length > 0) {
      setTrace((t) => [...newEntries.reverse(), ...t].slice(0, MAX_TRACE_ENTRIES));
    }
    prevStateRef.current = state;
  }, [state, selectedZone]);

  // Log rejected cycles into the same trace so they show up in scrollback,
  // not only as the transient red banner.
  useEffect(() => {
    if (!lastCycleError) return;
    setTrace((t) =>
      [
        {
          id: `cycle-${Date.now()}`,
          kind: "cycle" as const,
          atMs: Date.now(),
          text: `Rejected — cycle: ${lastCycleError.path.join(" → ")}`,
        },
        ...t,
      ].slice(0, MAX_TRACE_ENTRIES),
    );
  }, [lastCycleError]);

  const knownKeys = useMemo(() => {
    const keys = new Set<string>();
    if (state?.environment) for (const k of Object.keys(state.environment)) keys.add(k);
    if (state?.actuators) for (const k of Object.keys(state.actuators)) keys.add(k);
    return [...keys].sort();
  }, [state?.environment, state?.actuators]);

  const activeRuleNames = useMemo(
    () => new Set((state?.active_chains ?? []).map((c) => c.nodes[1])),
    [state?.active_chains],
  );

  return (
    <div className="app">
      <Header
        status={status}
        seed={state?.seed ?? null}
        revision={state?.revision ?? 0}
        connectedSessions={state?.connected_sessions ?? 0}
        perf={state?.perf ?? null}
        onStart={handleStart}
        onStop={handleStop}
        isRunning={state?.simulation_running ?? false}
        commandsBusy={commandsBusy}
      />

      <CommandStatus
        pending={pendingOperation}
        success={lastSuccessMessage}
        onDismissSuccess={dismissSuccessMessage}
      />

      <div className="layout">
        <div className="layout__col">
          <ZoneControls
            environment={state?.environment ?? null}
            selectedZone={selectedZone}
            onZoneChange={setSelectedZone}
            onSetManual={(variable, value) => send({ type: "set_manual", variable, value })}
            onReset={handleResetDemo}
            onDemoStage={(stage) => send({ type: "run_demo_stage", stage })}
            commandsBusy={commandsBusy}
          />
          <SensorChart zoneLabel={ZONE_LABELS[selectedZone]} samples={sensorHistory} />
          <ExecutionTrace entries={trace} />
        </div>

        <div className="layout__col">
          <ActuatorGrid actuators={state?.actuators ?? null} />
          <div className="panel">
            <CycleBanner error={lastCycleError} onDismiss={dismissCycleError} />
            <OperationBanner message={lastOperationError} onDismiss={dismissOperationError} />
            <ConflictPanel conflicts={state?.conflicts ?? []} />
          </div>
        </div>

        <div className="layout__col">
          <div className="panel">
            <div className="panel__title">
              Rules
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="panel__title-badge">{state?.rules.length ?? 0}</span>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={handleLoadStarterRules}
                  type="button"
                  disabled={commandsBusy}
                >
                  Load starter rules
                </button>
              </span>
            </div>
            <RuleList
              rules={state?.rules ?? []}
              activeRuleNames={activeRuleNames}
              onToggle={(id, enabled) => send({ type: "toggle_rule", id, enabled })}
              onDelete={(id) => send({ type: "delete_rule", id })}
              onUpdatePriority={(id, priority) => send({ type: "update_rule", id, rule: { priority } })}
              commandsBusy={commandsBusy}
            />
            <RuleForm
              onSubmit={handleCreateRule}
              lastRejectionMessage={lastCycleError?.message ?? null}
              knownKeys={knownKeys}
              commandsBusy={commandsBusy}
            />
          </div>
        </div>
      </div>

      <DependencyGraph
        rules={state?.rules ?? []}
        activeChains={state?.active_chains ?? []}
        cyclePath={lastCycleError?.path ?? null}
      />
    </div>
  );
}

export default App;
