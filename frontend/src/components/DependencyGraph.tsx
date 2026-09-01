import { useMemo, useState } from "react";
import { ReactFlow, Background, type Node, type Edge, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ActiveChain, Rule } from "../types";
import { ZONES } from "../mock/engine";

interface DependencyGraphProps {
  rules: Rule[];
  activeChains: ActiveChain[];
  cyclePath: string[] | null;
}

function zoneOf(key: string): string {
  return key.split(".")[0];
}

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 74;

// Layers every node left-to-right by longest path from a source (a variable
// with no incoming edge), via Kahn's algorithm. The accepted rule set is
// guaranteed acyclic (findCycle rejects any rule that would close a loop
// before it's ever added), so this always terminates and gives a clean
// "condition -> rule -> effect -> rule -> effect" left-to-right reading
// order instead of the old fixed two-column layout, where a variable that
// was both a condition somewhere and a target elsewhere got stuck on
// whichever side it was first seen on and produced crossing edges.
function layoutByLayer(nodeIds: string[], adjacency: Map<string, string[]>): Map<string, number> {
  const indegree = new Map<string, number>();
  for (const id of nodeIds) indegree.set(id, 0);
  for (const [, targets] of adjacency) {
    for (const t of targets) indegree.set(t, (indegree.get(t) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  const queue: string[] = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  for (const id of queue) layer.set(id, 0);

  const workingIndegree = new Map(indegree);
  let head = 0;
  while (head < queue.length) {
    const node = queue[head++];
    const nodeLayer = layer.get(node) ?? 0;
    for (const next of adjacency.get(node) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, nodeLayer + 1));
      const remaining = (workingIndegree.get(next) ?? 0) - 1;
      workingIndegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  // Any node untouched (shouldn't happen in an acyclic graph, but guards
  // against a stray disconnected node) defaults to layer 0.
  for (const id of nodeIds) if (!layer.has(id)) layer.set(id, 0);
  return layer;
}

export function DependencyGraph({ rules, activeChains, cyclePath }: DependencyGraphProps) {
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [activeOnly, setActiveOnly] = useState(false);

  const activeVarSet = useMemo(() => new Set(activeChains.flatMap((c) => c.nodes)), [activeChains]);
  const activeRuleNames = useMemo(() => new Set(activeChains.map((c) => c.nodes[1])), [activeChains]);
  const cycleSet = useMemo(() => new Set(cyclePath ?? []), [cyclePath]);

  const filteredRules = useMemo(() => {
    let result = rules;
    if (zoneFilter !== "all") {
      result = result.filter(
        (r) => r.conditions.some((c) => zoneOf(c.variable) === zoneFilter) || zoneOf(r.action.target) === zoneFilter,
      );
    }
    if (activeOnly) {
      // Always keep any rule that's part of a just-rejected cycle visible,
      // even though it's not "active" — that's the whole point of the demo
      // step where the judge injects a cycle and expects to see it.
      result = result.filter((r) => activeRuleNames.has(r.name) || cycleSet.has(r.name));
    }
    return result;
  }, [rules, zoneFilter, activeOnly, activeRuleNames, cycleSet]);

  const { nodes, edges } = useMemo(() => {
    const adjacency = new Map<string, string[]>();
    const varLabel = new Map<string, string>();
    const ruleMeta = new Map<string, Rule>();

    const addEdge = (a: string, b: string) => {
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a)!.push(b);
    };

    filteredRules.forEach((rule) => {
      const ruleId = `rule::${rule.id}`;
      ruleMeta.set(ruleId, rule);
      rule.conditions.forEach((c) => {
        const varId = `var::${c.variable}`;
        varLabel.set(varId, c.variable);
        addEdge(varId, ruleId);
      });
      const targetId = `var::${rule.action.target}`;
      varLabel.set(targetId, rule.action.target);
      addEdge(ruleId, targetId);
    });

    const allNodeIds = [...new Set([...varLabel.keys(), ...ruleMeta.keys()])];
    const layer = layoutByLayer(allNodeIds, adjacency);

    // Stable per-layer ordering (sorted by id) so nodes don't jump around
    // between renders as unrelated state changes elsewhere in the app.
    const perLayerIndex = new Map<string, number>();
    const layerCounts = new Map<number, number>();
    for (const id of [...allNodeIds].sort()) {
      const l = layer.get(id) ?? 0;
      const idx = layerCounts.get(l) ?? 0;
      perLayerIndex.set(id, idx);
      layerCounts.set(l, idx + 1);
    }

    const nodeList: Node[] = allNodeIds.map((id) => {
      const l = layer.get(id) ?? 0;
      const idx = perLayerIndex.get(id) ?? 0;
      const count = layerCounts.get(l) ?? 1;
      const position = { x: 20 + l * COLUMN_WIDTH, y: 20 + idx * ROW_HEIGHT - ((count - 1) * ROW_HEIGHT) / 2 + 200 };

      if (varLabel.has(id)) {
        const key = varLabel.get(id)!;
        return {
          id,
          position,
          data: { label: key },
          style: nodeStyle(activeVarSet.has(key), cycleSet.has(key), false, true),
        };
      }
      const rule = ruleMeta.get(id)!;
      const isActive = activeRuleNames.has(rule.name);
      const inCycle = cycleSet.has(rule.name);
      return {
        id,
        position,
        data: { label: `${rule.name}\nP${rule.priority}` },
        style: nodeStyle(isActive, inCycle, !rule.enabled),
      };
    });

    const edgeList: Edge[] = [];
    for (const [source, targets] of adjacency) {
      for (const target of targets) {
        const sourceIsRule = source.startsWith("rule::");
        const rule = sourceIsRule ? ruleMeta.get(source) : ruleMeta.get(target);
        const isActive = rule ? activeRuleNames.has(rule.name) : false;
        const inCycle = rule ? cycleSet.has(rule.name) : false;
        edgeList.push(edgeFor(source, target, isActive, inCycle));
      }
    }

    return { nodes: nodeList, edges: edgeList };
  }, [filteredRules, activeVarSet, activeRuleNames, cycleSet]);

  return (
    <div className="graph-panel">
      <div className="panel" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        <div className="panel__title" style={{ marginBottom: 0 }}>
          Dependency graph
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)" }}>
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
              Active only
            </label>
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 12,
              }}
            >
              <option value="all">All zones</option>
              {ZONES.map((z) => (
                <option key={z} value={z}>
                  {z.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        {nodes.length === 0 ? (
          <div className="empty-note" style={{ padding: 20 }}>
            {activeOnly ? "No rules are currently active." : "No rules match this filter."}
          </div>
        ) : (
          <ReactFlow nodes={nodes} edges={edges} fitView colorMode="dark" nodesDraggable={false} nodesConnectable={false}>
            <Background gap={20} color="#232a33" />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

function nodeStyle(active: boolean, inCycle: boolean, disabled: boolean, isVar = false) {
  const base = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    padding: 8,
    borderRadius: 6,
    whiteSpace: "pre-wrap" as const,
    background: isVar ? "#171c23" : "#12161c",
    color: "#e7ecf1",
    border: "1px solid #262d37",
    width: isVar ? 170 : 190,
    opacity: disabled ? 0.4 : 1,
  };
  if (inCycle) return { ...base, border: "1.5px solid #e5555a", background: "rgba(229,85,90,0.14)" };
  if (active) return { ...base, border: "1.5px solid #38c6d9", background: "rgba(56,198,217,0.14)" };
  return base;
}

function edgeFor(source: string, target: string, active: boolean, inCycle: boolean): Edge {
  const color = inCycle ? "#e5555a" : active ? "#38c6d9" : "#3a4351";
  return {
    id: `${source}->${target}`,
    source,
    target,
    animated: active && !inCycle,
    style: { stroke: color, strokeWidth: active || inCycle ? 2 : 1 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  };
}
