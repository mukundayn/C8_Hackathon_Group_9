import {
  Search,
  ShieldCheck,
  BookOpen,
  Ticket,
  Slack,
  Cpu,
  Play,
} from "lucide-react";
import type { AgentId, AgentState } from "../../types";
import { playHoverTick } from "../../utils/audio";

interface FlowChartProps {
  agents: AgentState[];
  overallProgress: number;
}

function AgentIcon({ id, active }: { id: AgentId; active: boolean }) {
  const cls = `w-6 h-6 ${active ? "animate-pulse text-cyan-400" : "text-gray-500"}`;
  switch (id) {
    case "classifier":
      return <Search className={cls} />;
    case "remediation":
      return <ShieldCheck className={cls} />;
    case "cookbook":
      return <BookOpen className={cls} />;
    case "jira":
      return <Ticket className={cls} />;
    case "notifier":
      return <Slack className={cls} />;
    default:
      return <Cpu className={cls} />;
  }
}

function statusBorder(status: AgentState["status"]): string {
  switch (status) {
    case "active":
      return "border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.15)] bg-slate-950";
    case "completed":
      return "border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.1)] bg-slate-950";
    case "failed":
      return "border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.15)] bg-slate-950";
    default:
      return "border-slate-800 bg-slate-950/40";
  }
}

function statusText(status: AgentState["status"]): string {
  switch (status) {
    case "active":
      return "RUNNING…";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "HALTED";
    default:
      return "PENDING";
  }
}

function statusTextColor(status: AgentState["status"]): string {
  switch (status) {
    case "active":
      return "text-cyan-400";
    case "completed":
      return "text-emerald-400 font-bold";
    case "failed":
      return "text-rose-400";
    default:
      return "text-slate-600 font-mono";
  }
}

export default function FlowChart({ agents, overallProgress }: FlowChartProps) {
  return (
    <div className="relative border border-slate-800 bg-slate-900/40 rounded-2xl p-6 backdrop-blur-md">
      <div className="absolute inset-0 bg-grid-white/[0.01] rounded-2xl pointer-events-none" />
      <div className="absolute top-2 right-4 flex items-center gap-1.5 text-[10px] font-mono text-slate-500 select-none">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
        PIPELINE SYNAPSE MONITOR
      </div>

      <h2 className="text-sm font-mono uppercase tracking-widest text-cyan-400 mb-6 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-cyan-400" />
        5-Agent LangGraph Resolution Engine
      </h2>

      <div className="mb-8 border border-slate-800 bg-slate-950 rounded-xl p-3">
        <div className="flex justify-between items-center text-xs font-mono mb-1">
          <span className="text-slate-400">PIPELINE INTEGRATION INDEX</span>
          <span className="text-cyan-400 font-bold">{overallProgress}%</span>
        </div>
        <div className="h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full transition-all duration-500 relative shadow-[0_0_10px_#06b6d4]"
            style={{ width: `${overallProgress}%` }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent)] animate-pulse" />
          </div>
        </div>
        <div className="flex justify-between items-center text-[9px] font-mono text-slate-500 mt-1">
          <span>LANGGRAPH STREAM</span>
          <span>NETRA AI COGNITIVE PARITY</span>
        </div>
      </div>

      <div className="relative grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="absolute top-1/2 left-0 w-full h-0.5 -translate-y-1/2 hidden md:block border-t border-dashed border-cyan-500/20 -z-0 pointer-events-none" />

        {agents.map((agent, index) => {
          const isActive = agent.status === "active";
          const isCompleted = agent.status === "completed";
          const isFailed = agent.status === "failed";

          return (
            <div
              key={agent.id}
              className="relative z-10 flex flex-col items-center group"
              onMouseEnter={playHoverTick}
            >
              <div
                id={`agent-${agent.id}`}
                className={`w-full max-w-[220px] border rounded-lg p-4 transition-all duration-300 backdrop-blur-md text-left flex flex-col justify-between h-[155px] ${statusBorder(agent.status)}`}
              >
                <div className="absolute top-2 right-3 flex items-center gap-1 text-[9px] font-mono leading-none">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isActive
                        ? "bg-cyan-400 animate-ping"
                        : isCompleted
                          ? "bg-emerald-400"
                          : isFailed
                            ? "bg-red-400"
                            : "bg-gray-700"
                    }`}
                  />
                  <span className={statusTextColor(agent.status)}>{statusText(agent.status)}</span>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`p-1.5 rounded bg-gray-900/80 border ${isActive ? "border-cyan-400" : "border-gray-800"}`}>
                      <AgentIcon id={agent.id} active={isActive} />
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-cyan-400/60 uppercase">AGENT 0{index + 1}</div>
                      <h3 className="text-xs font-bold text-white leading-tight uppercase tracking-wider">{agent.name}</h3>
                    </div>
                  </div>

                  <p className="text-[11px] text-gray-400 line-clamp-2 min-h-[32px] leading-relaxed">
                    {isActive ? agent.message : isCompleted ? `Success: ${agent.role}` : `Role: ${agent.role}`}
                  </p>
                </div>

                <div className="mt-3">
                  <div className="flex justify-between items-center text-[8px] font-mono text-gray-500 mb-0.5">
                    <span>STAGE COVERAGE</span>
                    <span>{agent.progress}%</span>
                  </div>
                  <div className="h-1 bg-gray-950 rounded-full overflow-hidden border border-gray-800">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isCompleted ? "bg-emerald-500" : isFailed ? "bg-red-500" : "bg-cyan-400"
                      }`}
                      style={{ width: `${agent.progress}%` }}
                    />
                  </div>
                </div>
              </div>

              {index < agents.length - 1 && (
                <div className="my-2 md:my-0 md:absolute md:top-1/2 md:left-full md:-translate-x-2 md:-translate-y-1/2 text-cyan-500/40 pointer-events-none">
                  <Play className="w-4 h-4 transform rotate-90 md:rotate-0 animate-pulse fill-cyan-500/20" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 border-t border-slate-800/80 pt-4 flex flex-col md:flex-row justify-between items-center gap-2 text-[9px] font-mono text-slate-500 text-left">
        <span>SECURITY ENVELOPE: SERVER_SIDE_LLM</span>
        <span className="flex items-center gap-4">
          <span>SOURCE: LANGGRAPH_ASTREAM</span>
          <span>RAG: CHROMA + RERANK</span>
        </span>
      </div>
    </div>
  );
}
