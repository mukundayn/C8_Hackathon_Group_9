import { useState } from "react";
import { Settings, Send } from "lucide-react";
import type { Expertise } from "../../types";
import { webhookIngestUrl } from "../../lib/api";
import { playClickPulse, playSuccessChime } from "../../utils/audio";

interface WebhookConnectorProps {
  expertise: Expertise[];
  connected: boolean;
}

export default function WebhookConnector({ expertise, connected }: WebhookConnectorProps) {
  const url = webhookIngestUrl();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const sendTest = async () => {
    playClickPulse();
    setBusy(true);
    setLastResult(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          source: "cockpit-test",
          message: "CRITICAL database-service: connection pool exhausted (webhook probe)",
          severity: "CRITICAL",
          service: "database-service",
          category: "Database",
          response_time_ms: 942,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLastResult(`FAILED ${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
        return;
      }
      playSuccessChime();
      setLastResult(
        `OK — ingested ${body.ingested ?? 1} event(s). Buffer size: ${body.buffer_size ?? "?"}. Check Live Console.`,
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
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs font-mono uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
            <span className="p-1 rounded bg-slate-900 border border-slate-800 text-cyan-400">
              <Settings className="w-3.5 h-3.5" />
            </span>
            Webhook Connector
          </h3>
          <span
            className={`px-2 py-0.5 rounded text-[9px] font-mono border ${
              connected
                ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-400"
                : "bg-slate-900 border-slate-800 text-slate-500"
            }`}
          >
            {connected ? "LISTENING" : "IDLE"}
          </span>
        </div>

        <p className="text-[10px] text-slate-400 leading-relaxed mb-3">
          POST JSON here to fill the Live Console + traffic chart. This path does{" "}
          <span className="text-cyan-400 font-bold">not</span> run the LLM pipeline — use{" "}
          <span className="font-mono text-slate-300">/api/webhook/ingest</span> for full analysis.
        </p>

        <label className="block text-[9px] font-mono uppercase text-slate-500 mb-1">Live-feed endpoint</label>
        <div className="flex gap-1.5">
          <input
            type="text"
            readOnly
            value={url}
            className="flex-1 bg-slate-950 border border-cyan-900/40 text-cyan-300 font-mono text-[9px] px-2 py-1.5 rounded focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              playSuccessChime();
            }}
            className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 px-2.5 py-1.5 rounded font-mono text-[9px] font-bold uppercase transition active:scale-95 cursor-pointer"
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
          {busy ? "Sending…" : "Send test event"}
        </button>

        {lastResult && (
          <p className="mt-2 text-[9px] font-mono text-slate-400 leading-relaxed break-words">{lastResult}</p>
        )}

        <div className="mt-4 bg-cyan-950/20 border border-cyan-800/25 p-3 rounded-lg">
          <div className="text-[9px] font-mono text-slate-400 uppercase mb-1">Active Operator Expertise</div>
          <div className="text-[11px] font-mono font-bold text-cyan-300">{expertise.join(", ")}</div>
          <p className="text-[9px] text-slate-500 mt-1 leading-snug">
            Example body: {"{"}"message","severity","service","source"{"}"}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-850 pt-3 text-[9px] font-mono text-slate-500 text-left">
        PROTOCOL: HTTPS POST · application/json
      </div>
    </div>
  );
}
