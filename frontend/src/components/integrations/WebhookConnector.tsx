import { Settings } from "lucide-react";
import type { Expertise } from "../../types";
import { webhookIngestUrl } from "../../lib/api";
import { playSuccessChime } from "../../utils/audio";

interface WebhookConnectorProps {
  expertise: Expertise[];
  connected: boolean;
}

export default function WebhookConnector({ expertise, connected }: WebhookConnectorProps) {
  const url = webhookIngestUrl();

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
          Point any monitoring source (n8n, Datadog, Grafana, PagerDuty) at this endpoint. Incoming
          logs appear in the live console and drive the traffic analytics.
        </p>

        <label className="block text-[9px] font-mono uppercase text-slate-500 mb-1">Ingest Endpoint</label>
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

        <div className="mt-4 bg-cyan-950/20 border border-cyan-800/25 p-3 rounded-lg">
          <div className="text-[9px] font-mono text-slate-400 uppercase mb-1">Active Operator Expertise</div>
          <div className="text-[11px] font-mono font-bold text-cyan-300">{expertise.join(", ")}</div>
          <p className="text-[9px] text-slate-500 mt-1 leading-snug">
            Tickets matching these domains are assigned to you; others route to specialist queues.
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-850 pt-3 text-[9px] font-mono text-slate-500 text-left">
        PROTOCOL: HTTPS POST · JSON
      </div>
    </div>
  );
}
