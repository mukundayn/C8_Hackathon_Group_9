import { useState } from "react";
import { Radio, Send, GitBranch } from "lucide-react";
import type { Expertise } from "../../types";
import { webhookAnalyzeUrl, webhookIngestUrl } from "../../lib/api";
import { playClickPulse, playSuccessChime } from "../../utils/audio";

interface WebhookConnectorProps {
  expertise: Expertise[];
  connected: boolean;
}

export default function WebhookConnector({ expertise, connected }: WebhookConnectorProps) {
  const liveUrl = webhookIngestUrl();
  const analyzeUrl = webhookAnalyzeUrl();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const sendTest = async () => {
    playClickPulse();
    setBusy(true);
    setLastResult(null);
    try {
      const res = await fetch(liveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          source: "cockpit-test",
          message: "CRITICAL database-service: connection pool exhausted (webhook probe)",
          severity: "CRITICAL",
          service: "database-service",
          category: "Database",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLastResult(`FAILED ${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
        return;
      }
      playSuccessChime();
      const mode = body.mode === "live_feed" ? "live_feed" : "ingest";
      const llm = body.runs_llm === true ? "LLM=yes" : "LLM=no";
      setLastResult(
        `OK · ${mode} · ${llm} · ingested ${body.ingested ?? 1} · buffer ${body.buffer_size ?? "?"}. ` +
          "Appears in Live Console only — not a LangGraph analyze run.",
      );
    } catch (err) {
      setLastResult(`NETWORK ERROR: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="xl:col-span-3 flex flex-col justify-between bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
      <div>
        <div className="flex justify-between items-center mb-4 gap-2">
          <h3 className="text-xs font-mono uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
            <span className="p-1 rounded bg-slate-900 border border-slate-800 text-cyan-400">
              <Radio className="w-3.5 h-3.5" />
            </span>
            Live feed webhook
          </h3>
          <span
            className={`px-2 py-0.5 rounded text-[9px] font-mono border flex-shrink-0 ${
              connected
                ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-400"
                : "bg-slate-900 border-slate-800 text-slate-500"
            }`}
          >
            {connected ? "LISTENING" : "IDLE"}
          </span>
        </div>

        <div className="mb-3 px-2.5 py-2 rounded-lg border border-amber-500/30 bg-amber-950/15">
          <p className="text-[10px] font-mono text-amber-200/90 uppercase tracking-wider font-bold">
            Live feed · no LLM
          </p>
          <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
            n8n / monitors POST here → Live Console, traffic chart, threat cards. Does{" "}
            <span className="text-white font-semibold">not</span> run classifier / RAG / Jira.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 mb-3 text-[9px] font-mono">
          <div className="flex gap-2 items-start border border-slate-800 rounded-lg p-2 bg-slate-950/50">
            <span className="text-cyan-400 flex-shrink-0">A</span>
            <div>
              <div className="text-cyan-300 uppercase">Live feed (this URL)</div>
              <div className="text-slate-500 mt-0.5">Buffer only · fast · what n8n should use</div>
            </div>
          </div>
          <div className="flex gap-2 items-start border border-slate-800 rounded-lg p-2 bg-slate-950/50">
            <span className="text-violet-400 flex-shrink-0">
              <GitBranch className="w-3 h-3 inline" /> B
            </span>
            <div>
              <div className="text-violet-300 uppercase">Full analysis</div>
              <div className="text-slate-500 mt-0.5">
                Cockpit log upload (/api/analyze) or POST /api/webhook/ingest
              </div>
            </div>
          </div>
        </div>

        <label className="block text-[9px] font-mono uppercase text-slate-500 mb-1">
          Path A · live-feed endpoint
        </label>
        <div className="flex gap-1.5">
          <input
            type="text"
            readOnly
            value={liveUrl}
            className="flex-1 bg-slate-950 border border-cyan-900/40 text-cyan-300 font-mono text-[9px] px-2 py-1.5 rounded focus:outline-none min-w-0"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(liveUrl);
              playSuccessChime();
            }}
            className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 px-2.5 py-1.5 rounded font-mono text-[9px] font-bold uppercase transition active:scale-95 cursor-pointer flex-shrink-0"
          >
            COPY
          </button>
        </div>

        <label className="block text-[9px] font-mono uppercase text-slate-500 mb-1 mt-3">
          Path B · LangGraph ingest (optional)
        </label>
        <div className="flex gap-1.5">
          <input
            type="text"
            readOnly
            value={analyzeUrl}
            className="flex-1 bg-slate-950 border border-violet-900/40 text-violet-300/90 font-mono text-[9px] px-2 py-1.5 rounded focus:outline-none min-w-0"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(analyzeUrl);
              playSuccessChime();
            }}
            className="bg-violet-600/80 hover:bg-violet-500 text-white px-2.5 py-1.5 rounded font-mono text-[9px] font-bold uppercase transition active:scale-95 cursor-pointer flex-shrink-0"
          >
            COPY
          </button>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void sendTest()}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded border border-cyan-500/40 bg-cyan-950/30 hover:bg-cyan-950/50 text-cyan-300 font-mono text-[10px] uppercase tracking-wider cursor-pointer disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          {busy ? "Sending…" : "Send test · live feed only"}
        </button>

        {lastResult && (
          <p className="mt-2 text-[9px] font-mono text-slate-400 leading-relaxed break-words">{lastResult}</p>
        )}

        <div className="mt-4 bg-cyan-950/20 border border-cyan-800/25 p-3 rounded-lg">
          <div className="text-[9px] font-mono text-slate-400 uppercase mb-1">Active Operator Expertise</div>
          <div className="text-[11px] font-mono font-bold text-cyan-300">{expertise.join(", ")}</div>
          <p className="text-[9px] text-slate-500 mt-1 leading-snug">
            Routes Jira on Path B / HITL — not applied to live-feed POSTs alone.
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-850 pt-3 text-[9px] font-mono text-slate-500 text-left">
        PROTOCOL: HTTPS POST · application/json · mode=live_feed
      </div>
    </div>
  );
}
