import { Activity, Gauge, ShieldAlert, Sparkles } from "lucide-react";

interface MetricGaugesProps {
  ingestRate: number;
  avgResponseMs: number;
  activeAlerts: number;
  agentsCompleted: number;
  agentsTotal: number;
  pipelineProgress: number;
}

export default function MetricGauges({
  ingestRate,
  avgResponseMs,
  activeAlerts,
  agentsCompleted,
  agentsTotal,
  pipelineProgress,
}: MetricGaugesProps) {
  return (
    <section className="relative z-10 grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* Ingestion rate */}
      <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-4 backdrop-blur-md flex flex-col justify-between h-24 text-left transition hover:border-slate-700">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
          <span>Sys Ingest Rate</span>
          <Activity className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-black text-white tracking-tight">{ingestRate}</span>
          <span className="text-[10px] font-mono text-cyan-400">EVENTS</span>
        </div>
        <div className="h-1 bg-slate-950 rounded-full mt-1 overflow-hidden border border-slate-800">
          <div className={`h-full bg-cyan-400 rounded-full ${ingestRate > 0 ? "w-[75%] animate-pulse" : "w-0"}`} />
        </div>
      </div>

      {/* Avg response */}
      <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-4 backdrop-blur-md flex flex-col justify-between h-24 text-left transition hover:border-slate-700">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
          <span>Avg Response</span>
          <Gauge className="w-4 h-4 text-pink-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-black text-white tracking-tight">{avgResponseMs}</span>
          <span className="text-[10px] font-mono text-pink-400">MILLISECONDS</span>
        </div>
        <div className="h-1 bg-slate-950 rounded-full mt-1 overflow-hidden border border-slate-800">
          <div
            className="h-full bg-pink-500 rounded-full"
            style={{ width: `${Math.min(100, Math.max(10, avgResponseMs / 5))}%` }}
          />
        </div>
      </div>

      {/* Threat incidents */}
      <div
        className={`border rounded-2xl p-4 backdrop-blur-md flex flex-col justify-between h-24 text-left transition-all duration-300 ${
          activeAlerts > 0
            ? "border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.15)] bg-rose-950/10"
            : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
        }`}
      >
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
          <span>Threat Incidents</span>
          <ShieldAlert className={`w-4 h-4 ${activeAlerts > 0 ? "text-rose-400 animate-bounce" : "text-emerald-400"}`} />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`text-2xl font-black tracking-tight ${activeAlerts > 0 ? "text-rose-400" : "text-emerald-400"}`}>
            {activeAlerts}
          </span>
          <span className={`text-[10px] font-mono ${activeAlerts > 0 ? "text-rose-400 animate-pulse" : "text-emerald-400"}`}>
            {activeAlerts > 0 ? "UNRESOLVED" : "STABLE"}
          </span>
        </div>
        <div className="h-1 bg-slate-950 rounded-full mt-1 overflow-hidden border border-slate-800">
          <div
            className={`h-full rounded-full ${activeAlerts > 0 ? "bg-rose-500" : "bg-emerald-500"}`}
            style={{ width: `${activeAlerts > 0 ? 100 : 10}%` }}
          />
        </div>
      </div>

      {/* Agent coverage */}
      <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-4 backdrop-blur-md flex flex-col justify-between h-24 text-left transition hover:border-slate-700">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
          <span>Agents Covered</span>
          <Sparkles className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-black text-white tracking-tight">
            {agentsCompleted}/{agentsTotal}
          </span>
          <span className="text-[10px] font-mono text-cyan-400">STAGES</span>
        </div>
        <div className="h-1 bg-slate-950 rounded-full mt-1 overflow-hidden border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 to-blue-600 rounded-full"
            style={{ width: `${pipelineProgress}%` }}
          />
        </div>
      </div>
    </section>
  );
}
