import { Zap, Trash2 } from "lucide-react";
import type { LogEntry } from "../../types";
import { playClickPulse } from "../../utils/audio";

interface LiveConsoleProps {
  logs: LogEntry[];
  connected: boolean;
  onClear: () => void;
}

export default function LiveConsole({ logs, connected, onClear }: LiveConsoleProps) {
  return (
    <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-6 backdrop-blur-md text-left flex flex-col justify-between h-full min-h-[440px] relative">
      <div className="absolute top-2 right-4 flex items-center gap-1.5 text-[9px] font-mono">
        <Zap className="w-3 h-3 text-cyan-400" />
        <span className="text-slate-500">LIVE FEED</span>
        <span className="px-1.5 py-0.5 rounded border border-amber-500/35 text-amber-300/90 bg-amber-950/20">
          NO LLM
        </span>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 border-b border-slate-800/60 pb-4">
        <div>
          <h2 className="text-sm font-mono uppercase tracking-widest text-cyan-400 flex items-center gap-2">
            Live Log Stream Ingestion Console
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Telemetry from /api/webhook/logs (n8n, probes). Not a LangGraph analyze run — upload a
            log in the Diagnostic Portal for full AI triage.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 text-xs font-mono ${
              connected
                ? "border-emerald-500/40 bg-emerald-950/10 text-emerald-400"
                : "border-slate-800 bg-slate-950 text-slate-500"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
            {connected ? "CONNECTED" : "IDLE"}
          </span>
          <button
            type="button"
            onClick={() => {
              playClickPulse();
              onClear();
            }}
            className="p-2 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-400 hover:text-white cursor-pointer"
            title="Clear console logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-grow bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-[11px] overflow-y-auto max-h-[300px] custom-scrollbar text-left space-y-1.5">
        {logs.length === 0 ? (
          <div className="text-slate-600 text-center py-10 leading-relaxed">
            NO LIVE EVENTS YET.
            <br />
            POST logs to the webhook connector (see the Integration Hub) to populate this feed.
          </div>
        ) : (
          logs.map((log) => {
            const isErr = log.severity === "ERROR" || log.severity === "CRITICAL";
            const isWarn = log.severity === "WARN";
            const badgeColor = isErr ? "text-rose-400 font-bold" : isWarn ? "text-amber-400" : "text-cyan-400";
            return (
              <div
                key={log.id}
                className={`py-1 px-2 rounded hover:bg-slate-900 flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2 leading-relaxed transition ${
                  isErr ? "bg-rose-950/10 border-l border-rose-500/30" : ""
                }`}
              >
                <span className="text-slate-500 flex-shrink-0">[{log.timestamp}]</span>
                <span className={`font-bold uppercase tracking-wider flex-shrink-0 w-16 ${badgeColor}`}>{log.severity}</span>
                <span className="text-indigo-400 flex-shrink-0 font-bold">{log.service}:</span>
                <span className="text-slate-300 break-all">{log.message}</span>
                {log.responseTime > 0 && (
                  <span className="ml-auto text-[9px] text-slate-500 italic flex-shrink-0">({log.responseTime}ms)</span>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 border-t border-slate-800/80 pt-3 flex justify-between items-center text-[9px] font-mono text-slate-500 gap-2 flex-wrap">
        <span>SOURCE: /api/events/recent · mode=live_feed</span>
        <span>BUFFER: {logs.length}/120</span>
      </div>
    </div>
  );
}
