import type { AgentId, AgentState } from "../../types";
import { playHoverTick } from "../../utils/audio";
import PipelineDebugLog from "./PipelineDebugLog";
import type { DebugLogLine } from "../../types";

interface FlowChartProps {
  agents: AgentState[];
  overallProgress: number;
  /** TEMP debug strip — remove after testing. */
  debugLines?: DebugLogLine[];
}

type GraphNodeId = AgentId | "START" | "END";

interface LayoutNode {
  id: GraphNodeId;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  optional?: boolean;
  terminal?: boolean;
}

interface LayoutEdge {
  from: GraphNodeId;
  to: GraphNodeId;
  label?: string;
  dashed?: boolean;
}

/** Positions match approved LangGraph LR diagram (viewBox 0 0 1100 480). */
const NODES: LayoutNode[] = [
  { id: "START", label: "START", x: 24, y: 210, w: 72, h: 36, terminal: true },
  { id: "classifier", label: "classifier", x: 140, y: 190, w: 130, h: 56 },
  { id: "image_analyzer", label: "image_analyzer", x: 340, y: 48, w: 150, h: 56, optional: true },
  { id: "remediation", label: "remediation", x: 340, y: 190, w: 140, h: 56 },
  { id: "fallback", label: "fallback", x: 560, y: 320, w: 130, h: 56 },
  { id: "cookbook", label: "cookbook", x: 560, y: 190, w: 130, h: 56 },
  { id: "jira", label: "jira", x: 780, y: 80, w: 110, h: 56 },
  { id: "notifier", label: "notifier", x: 780, y: 190, w: 120, h: 56 },
  { id: "END", label: "END", x: 980, y: 210, w: 72, h: 36, terminal: true },
];

const EDGES: LayoutEdge[] = [
  { from: "START", to: "classifier" },
  { from: "classifier", to: "image_analyzer", label: "has image", dashed: true },
  { from: "classifier", to: "remediation", label: "no image" },
  { from: "image_analyzer", to: "remediation", dashed: true },
  { from: "remediation", to: "cookbook", label: "KB HIT" },
  { from: "remediation", to: "fallback", label: "KB MISS" },
  { from: "fallback", to: "cookbook", label: "learn → Chroma" },
  { from: "cookbook", to: "jira", label: "critical/high" },
  { from: "cookbook", to: "notifier", label: "else" },
  { from: "jira", to: "notifier" },
  { from: "notifier", to: "END" },
];

function nodeCenter(n: LayoutNode): { cx: number; cy: number } {
  return { cx: n.x + n.w / 2, cy: n.y + n.h / 2 };
}

function edgePath(from: LayoutNode, to: LayoutNode): string {
  const a = nodeCenter(from);
  const b = nodeCenter(to);
  // Simple elbow when vertical distance is large.
  if (Math.abs(b.cy - a.cy) > 40 && Math.abs(b.cx - a.cx) > 40) {
    const midX = (a.cx + b.cx) / 2;
    return `M ${a.cx} ${a.cy} L ${midX} ${a.cy} L ${midX} ${b.cy} L ${b.cx} ${b.cy}`;
  }
  return `M ${a.cx} ${a.cy} L ${b.cx} ${b.cy}`;
}

function statusOf(agents: AgentState[], id: GraphNodeId): AgentState["status"] | "terminal" {
  if (id === "START") {
    const started = agents.some((a) => a.status !== "idle");
    return started ? "completed" : "terminal";
  }
  if (id === "END") {
    const notifier = agents.find((a) => a.id === "notifier");
    return notifier?.status === "completed" ? "completed" : "terminal";
  }
  return agents.find((a) => a.id === id)?.status ?? "idle";
}

function nodeFill(status: AgentState["status"] | "terminal"): string {
  switch (status) {
    case "active":
      return "#083344";
    case "completed":
      return "#064e3b";
    case "failed":
      return "#4c0519";
    case "terminal":
      return "#0f172a";
    default:
      return "#0f172a";
  }
}

function nodeStroke(status: AgentState["status"] | "terminal", optional?: boolean): string {
  if (optional && status === "idle") return "#475569";
  switch (status) {
    case "active":
      return "#22d3ee";
    case "completed":
      return "#10b981";
    case "failed":
      return "#f43f5e";
    case "terminal":
      return "#334155";
    default:
      return "#334155";
  }
}

function edgeStroke(
  agents: AgentState[],
  edge: LayoutEdge,
): { color: string; width: number } {
  const toStatus = statusOf(agents, edge.to);
  const fromStatus = statusOf(agents, edge.from);
  if (toStatus === "completed" || toStatus === "active" || fromStatus === "completed") {
    if (toStatus === "completed" || (fromStatus === "completed" && toStatus !== "idle")) {
      return { color: "#10b981", width: 2 };
    }
    if (toStatus === "active") return { color: "#22d3ee", width: 2.2 };
  }
  return { color: edge.dashed ? "#475569" : "#334155", width: 1.4 };
}

export default function FlowChart({ agents, overallProgress, debugLines = [] }: FlowChartProps) {
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<GraphNodeId, LayoutNode>;

  return (
    <div className="relative border border-slate-800 bg-slate-900/40 rounded-2xl p-6 backdrop-blur-md">
      <div className="absolute top-2 right-4 flex items-center gap-1.5 text-[10px] font-mono text-slate-500 select-none">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
        LANGGRAPH · NODES + EDGES
      </div>

      <h2 className="text-sm font-mono uppercase tracking-widest text-cyan-400 mb-2 flex flex-wrap items-center gap-2">
        LangGraph Resolution Graph
        <span className="normal-case tracking-normal text-[10px] text-slate-500 font-sans">
          dashed = optional image_analyzer · green = node complete
        </span>
      </h2>

      <div className="mb-4 border border-slate-800 bg-slate-950 rounded-xl p-3">
        <div className="flex justify-between items-center text-xs font-mono mb-1">
          <span className="text-slate-400">PIPELINE INTEGRATION INDEX</span>
          <span className="text-cyan-400 font-bold">{overallProgress}%</span>
        </div>
        <div className="h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full transition-all duration-500"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      <div className="w-full overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80">
        <svg
          viewBox="0 0 1100 420"
          className="w-full min-w-[720px] h-auto"
          role="img"
          aria-label="LangGraph node and edge flowchart"
        >
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill="#64748b" />
            </marker>
            <marker id="arrow-active" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill="#22d3ee" />
            </marker>
            <marker id="arrow-done" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill="#10b981" />
            </marker>
          </defs>

          {EDGES.map((e) => {
            const from = byId[e.from];
            const to = byId[e.to];
            const { color, width } = edgeStroke(agents, e);
            const marker =
              color === "#10b981" ? "url(#arrow-done)" : color === "#22d3ee" ? "url(#arrow-active)" : "url(#arrow)";
            const mid = {
              x: (nodeCenter(from).cx + nodeCenter(to).cx) / 2,
              y: (nodeCenter(from).cy + nodeCenter(to).cy) / 2 - 8,
            };
            return (
              <g key={`${e.from}-${e.to}-${e.label ?? ""}`}>
                <path
                  d={edgePath(from, to)}
                  fill="none"
                  stroke={color}
                  strokeWidth={width}
                  strokeDasharray={e.dashed ? "6 4" : undefined}
                  markerEnd={marker}
                  opacity={0.9}
                />
                {e.label && (
                  <text
                    x={mid.x}
                    y={mid.y}
                    textAnchor="middle"
                    className="fill-slate-500"
                    style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                  >
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}

          {NODES.map((n) => {
            const st = statusOf(agents, n.id);
            const agent = n.id !== "START" && n.id !== "END" ? agents.find((a) => a.id === n.id) : undefined;
            const rx = n.terminal ? n.h / 2 : 8;
            const isActive = st === "active";
            const isDone = st === "completed";
            const wasSkipped = Boolean(agent?.message?.startsWith("Skipped"));
            // Optional nodes (image_analyzer) stay unticked when the branch was not taken.
            const showTick = isDone && !(n.optional && wasSkipped);
            return (
              <g
                key={n.id}
                id={`agent-${n.id}`}
                onMouseEnter={playHoverTick}
                style={{ cursor: "default" }}
              >
                {isActive && (
                  <rect
                    className="lg-node-active-ring"
                    x={n.x - 5}
                    y={n.y - 5}
                    width={n.w + 10}
                    height={n.h + 10}
                    rx={rx + 2}
                    ry={rx + 2}
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth={2}
                  />
                )}
                <rect
                  className={isActive ? "lg-node-active-fill lg-node-active-stroke" : undefined}
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx={rx}
                  ry={rx}
                  fill={wasSkipped && n.optional ? nodeFill("idle") : nodeFill(st)}
                  stroke={
                    wasSkipped && n.optional
                      ? nodeStroke("idle", true)
                      : nodeStroke(st, n.optional)
                  }
                  strokeWidth={isActive ? 2.4 : showTick ? 2 : 1.6}
                  strokeDasharray={n.optional ? "5 3" : undefined}
                />
                {isActive && (
                  <text
                    x={n.x + n.w / 2}
                    y={n.y - 8}
                    textAnchor="middle"
                    className="lg-node-active-ring"
                    style={{
                      fontSize: 9,
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 700,
                      fill: "#22d3ee",
                    }}
                  >
                    ● LIVE
                  </text>
                )}
                <text
                  x={n.x + n.w / 2}
                  y={n.y + n.h / 2 - (agent && !n.terminal ? 6 : 0)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: n.terminal ? 11 : 12,
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                    fill:
                      showTick ? "#6ee7b7" : isActive ? "#67e8f8" : "#94a3b8",
                    pointerEvents: "none",
                  }}
                >
                  {n.label}
                </text>
                {agent && !n.terminal && (
                  <text
                    x={n.x + n.w / 2}
                    y={n.y + n.h / 2 + 12}
                    textAnchor="middle"
                    style={{
                      fontSize: 9,
                      fontFamily: "ui-monospace, monospace",
                      fill: isActive ? "#22d3ee" : "#64748b",
                      pointerEvents: "none",
                    }}
                  >
                    {st === "active"
                      ? "RUNNING…"
                      : wasSkipped && n.optional
                        ? "NOT USED"
                        : st === "completed"
                          ? agent.message.startsWith("Skipped")
                            ? "SKIPPED"
                            : "DONE"
                          : st === "failed"
                            ? "FAILED"
                            : n.optional
                              ? "OPTIONAL"
                              : "PENDING"}
                  </text>
                )}
                {/* Green tick only when the node actually ran (not skipped optional). */}
                {showTick && (
                  <g transform={`translate(${n.x + n.w - 2}, ${n.y - 2})`} aria-label="completed">
                    <circle r="9" fill="#059669" stroke="#6ee7b7" strokeWidth="1.5" />
                    <path
                      d="M-4 0.5 L-1.2 3.2 L4.5 -3.5"
                      fill="none"
                      stroke="#ecfdf5"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[9px] font-mono text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 text-[8px] text-white">
            ✓
          </span>{" "}
          DONE (+ green tick)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm border border-cyan-400 bg-cyan-950 animate-pulse" />{" "}
          RUNNING (blinks)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-slate-500 bg-slate-950" />{" "}
          OPTIONAL
        </span>
        <span className="ml-auto">SOURCE: graph.astream · edges from backend/app/graph.py</span>
      </div>

      <PipelineDebugLog lines={debugLines} />
    </div>
  );
}
