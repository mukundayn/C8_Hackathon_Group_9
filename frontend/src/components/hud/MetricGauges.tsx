import { Activity, Gauge, ShieldAlert, Sparkles, Library } from "lucide-react";

interface MetricGaugesProps {
  /** Lifetime events ingested this process (not a per-second rate). */
  ingestRate: number;
  avgResponseMs: number;
  /** Count of CRITICAL-severity events in the live buffer. */
  activeAlerts: number;
  /** Session rollup — KB HIT count across completed analyses. */
  kbHits: number;
  /** Session rollup — newly learned / MISS→LEARN count. */
  kbLearned: number;
  /** Session rollup — agent stages completed across runs. */
  agentsCompleted: number;
  agentsTotal: number;
  pipelineProgress: number;
}

/** Map a count toward a soft ceiling into 0–100% bar width. */
function barPct(value: number, fullAt: number): number {
  if (value <= 0 || fullAt <= 0) return 0;
  return Math.min(100, Math.round((value / fullAt) * 100));
}

export default function MetricGauges({
  ingestRate,
  avgResponseMs,
  activeAlerts,
  kbHits,
  kbLearned,
  agentsCompleted,
  agentsTotal,
  pipelineProgress,
}: MetricGaugesProps) {
  const kbTotal = kbHits + kbLearned;
  const knownPct = kbTotal > 0 ? Math.round((kbHits / kbTotal) * 100) : 0;
  const learnedPct = kbTotal > 0 ? Math.round((kbLearned / kbTotal) * 100) : 0;

  // Soft ceilings map counts/ms into bar width (full at the denominators below).
  const ingestBar = barPct(ingestRate, 80);
  // 0 ms → empty; ~3s analyze/ingest average → full.
  const latencyBar = barPct(avgResponseMs, 3000);
  const threatBar = barPct(activeAlerts, 10);
  const agentBar = Math.min(100, Math.max(0, Math.round(pipelineProgress)));

  return (
    <section className="relative z-10 grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      {/* Ingestion total */}
      <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-4 backdrop-blur-md flex flex-col justify-between h-24 text-left transition hover:border-slate-700">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
          <span>Events Ingested</span>
          <Activity className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-black text-white tracking-tight">{ingestRate}</span>
          <span className="text-[10px] font-mono text-cyan-400">TOTAL</span>
        </div>
        <div className="h-1 bg-slate-950 rounded-full mt-1 overflow-hidden border border-slate-800">
          <div
            className="h-full bg-cyan-400 rounded-full transition-[width] duration-500"
            style={{ width: `${ingestBar}%` }}
          />
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
            className="h-full bg-pink-500 rounded-full transition-[width] duration-500"
            style={{ width: `${latencyBar}%` }}
            title="Bar fills toward 3000 ms average"
          />
        </div>
      </div>

      {/* Threat incidents — CRITICAL count only */}
      <div
        className={`border rounded-2xl p-4 backdrop-blur-md flex flex-col justify-between h-24 text-left transition-all duration-300 ${
          activeAlerts > 0
            ? "border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.15)] bg-rose-950/10"
            : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
        }`}
      >
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
          <span>Threat Incidents</span>
          <ShieldAlert className={`w-4 h-4 ${activeAlerts > 0 ? "text-rose-400" : "text-emerald-400"}`} />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`text-2xl font-black tracking-tight ${activeAlerts > 0 ? "text-rose-400" : "text-emerald-400"}`}>
            {activeAlerts}
          </span>
          <span className={`text-[10px] font-mono ${activeAlerts > 0 ? "text-rose-400" : "text-emerald-400"}`}>
            {activeAlerts > 0 ? "CRITICAL" : "STABLE"}
          </span>
        </div>
        <div className="h-1 bg-slate-950 rounded-full mt-1 overflow-hidden border border-slate-800">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              activeAlerts > 0 ? "bg-rose-500" : "bg-emerald-500"
            }`}
            style={{ width: `${activeAlerts > 0 ? threatBar : 0}%` }}
            title="Bar fills toward 10 CRITICAL events in the live buffer"
          />
        </div>
      </div>

      {/* Known vs Newly Learned */}
      <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-4 backdrop-blur-md flex flex-col justify-between h-24 text-left transition hover:border-violet-700/50">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
          <span>Known vs Learned</span>
          <Library className="w-4 h-4 text-violet-400" />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-black text-white tracking-tight">
            <span className="text-emerald-400">{kbHits}</span>
            <span className="text-slate-600 mx-0.5">/</span>
            <span className="text-violet-300">{kbLearned}</span>
          </span>
          <span className="text-[9px] font-mono text-slate-500">HIT / NEW</span>
        </div>
        <div className="h-1 bg-slate-950 rounded-full mt-1 overflow-hidden border border-slate-800 flex">
          {kbTotal === 0 ? (
            <div className="h-full w-0" />
          ) : (
            <>
              <div className="h-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${knownPct}%` }} />
              <div className="h-full bg-violet-500 transition-[width] duration-500" style={{ width: `${learnedPct}%` }} />
            </>
          )}
        </div>
      </div>

      {/* Agent coverage — session rollup of stages completed */}
      <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-4 backdrop-blur-md flex flex-col justify-between h-24 text-left transition hover:border-slate-700">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase">
          <span>Agents Covered</span>
          <Sparkles className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-black text-white tracking-tight">{agentsCompleted}</span>
          <span className="text-[10px] font-mono text-cyan-400">STAGES · /{agentsTotal} PER RUN</span>
        </div>
        <div className="h-1 bg-slate-950 rounded-full mt-1 overflow-hidden border border-slate-800">
          <div
            className="h-full bg-cyan-400 rounded-full transition-[width] duration-500"
            style={{ width: `${agentBar}%` }}
          />
        </div>
      </div>
    </section>
  );
}
