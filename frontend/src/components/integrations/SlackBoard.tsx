import { Slack } from "lucide-react";
import type { SlackResult } from "../../types";

interface SlackBoardProps {
  slack: SlackResult | undefined;
  mode?: "real" | "mock";
}

export default function SlackBoard({ slack, mode = "mock" }: SlackBoardProps) {
  const channel = slack?.channel ?? "#incidents";
  const lines = (slack?.text_preview ?? "").split("\n").filter(Boolean);

  return (
    <div className="xl:col-span-4 flex flex-col justify-between bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs font-mono uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
            <span className="p-1 rounded bg-slate-900 border border-slate-800 text-cyan-400">
              <Slack className="w-3.5 h-3.5" />
            </span>
            Slack Notifier
          </h3>
          <span
            className={`px-2 py-0.5 rounded text-[9px] font-mono border ${
              mode === "real"
                ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-400"
                : slack
                  ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-400"
                  : "bg-slate-900 border-slate-800 text-slate-500"
            }`}
          >
            {mode === "real" ? (slack ? "LIVE · DELIVERED" : "LIVE · STANDBY") : slack ? "MOCK · DELIVERED" : "MOCK · STANDBY"}
          </span>
        </div>

        <div className="text-[10px] font-mono text-slate-500 uppercase mb-2">Posted to {channel}</div>

        <div className="space-y-2 max-h-[260px] overflow-y-auto custom-scrollbar">
          {!slack ? (
            <p className="text-[10px] font-mono text-slate-600 text-center py-8">
              STANDBY — SLACK FIRES ONLY AFTER HITL APPROVE ON NEWLY LEARNED CRITICALS.
            </p>
          ) : (
            <div className="p-3 bg-slate-900 border border-slate-800/80 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-[11px]">
                  🤖
                </div>
                <div>
                  <span className="text-[11px] font-bold text-white">OpsBot</span>
                  <span className="text-[9px] text-slate-500 ml-2 font-mono">just now</span>
                </div>
              </div>
              <div className="space-y-1">
                {lines.map((line, i) => (
                  <p key={i} className="text-[11px] text-slate-300 font-mono leading-snug break-words">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-slate-850 pt-3 flex items-center justify-between text-[9px] font-mono text-slate-500">
        <span>INTEGRATION: MCP SLACK</span>
        <span>{slack?.permalink ? "PERMALINK_OK" : "MOCK_CLIENT"}</span>
      </div>
    </div>
  );
}
