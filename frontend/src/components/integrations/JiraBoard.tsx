import { Layers } from "lucide-react";
import type { JiraTicket } from "../../types";

interface JiraBoardProps {
  tickets: JiraTicket[];
  mode?: "real" | "mock";
}

export default function JiraBoard({ tickets, mode = "mock" }: JiraBoardProps) {
  return (
    <div className="xl:col-span-5 flex flex-col justify-between bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-pink-500/5 rounded-full blur-2xl pointer-events-none" />
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs font-mono uppercase tracking-widest text-pink-400 flex items-center gap-1.5">
            <span className="p-1 rounded bg-slate-900 border border-slate-800 text-pink-400 font-bold">
              <Layers className="w-3.5 h-3.5" />
            </span>
            Jira Ticketing & Expert Router
          </h3>
          <span
            className={`px-2 py-0.5 rounded text-[9px] font-mono border ${
              mode === "real"
                ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-400"
                : "bg-pink-950/20 border-pink-500/40 text-pink-400"
            }`}
          >
            {mode === "real" ? "LIVE_JIRA" : "MOCK_JIRA"}
          </span>
        </div>

        <div className="text-[10px] font-mono text-slate-500 uppercase mb-2">
          Generated Tickets ({tickets.length})
        </div>

        <div className="space-y-2.5 max-h-[260px] overflow-y-auto custom-scrollbar">
          {tickets.length === 0 ? (
            <p className="text-[10px] font-mono text-slate-600 text-center py-8">
              NO TICKETS YET. NEWLY LEARNED CRITICALS REQUIRE HITL APPROVE.
            </p>
          ) : (
            tickets.map((ticket) => {
              const assigned = ticket.routing_status === "assigned";
              return (
                <div key={ticket.key} className="p-3 bg-slate-900 border border-slate-850 rounded-lg space-y-1.5 relative overflow-hidden">
                  <div className={`absolute top-0 left-0 h-full w-1 ${assigned ? "bg-emerald-500" : "bg-amber-500"}`} />

                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-1.5">
                      <a
                        href={ticket.url || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-mono font-bold text-slate-300 hover:text-cyan-400 hover:underline cursor-pointer"
                      >
                        {ticket.key}
                      </a>
                      <span
                        className={`px-1.5 py-0.5 rounded-[4px] text-[8px] font-mono font-bold ${
                          ticket.severity?.toLowerCase() === "critical"
                            ? "bg-rose-950 text-rose-400 border border-rose-800"
                            : "bg-amber-950 text-amber-400 border border-amber-800"
                        }`}
                      >
                        {ticket.severity?.toUpperCase()}
                      </span>
                    </div>

                    {ticket.routing_status && (
                      <span
                        className={`px-1.5 py-0.5 rounded-[4px] text-[8px] font-mono font-bold ${
                          assigned
                            ? "bg-emerald-950/40 text-emerald-400 border border-emerald-500/30"
                            : "bg-amber-950/40 text-amber-400 border border-amber-500/30"
                        }`}
                      >
                        {assigned ? "ASSIGNED TO YOU" : "ROUTED OUT"}
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-white font-medium leading-relaxed">{ticket.summary}</p>

                  {(ticket.assignee || ticket.required_expertise) && (
                    <div className="grid grid-cols-2 gap-2 text-[9px] font-mono pt-1 border-t border-slate-800/80">
                      {ticket.assignee && (
                        <div>
                          <span className="text-slate-500">ASSIGNEE:</span>{" "}
                          <span className={assigned ? "text-emerald-400 font-bold" : "text-amber-400 font-medium"}>
                            {ticket.assignee}
                          </span>
                        </div>
                      )}
                      {ticket.required_expertise && (
                        <div>
                          <span className="text-slate-500">REQ XP:</span>{" "}
                          <span className="text-cyan-400 font-bold">{ticket.required_expertise}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {ticket.routing_explanation && (
                    <div className="text-[9px] font-mono text-slate-500 italic leading-snug mt-1 pt-1 border-t border-slate-800/30">
                      {ticket.routing_explanation}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-slate-850 pt-3 flex items-center justify-between text-[9px] font-mono text-slate-500">
        <span>INTEGRATION: ATLASSIAN REST</span>
        <span>CONVERGENCE ROUTE: ACTIVE</span>
      </div>
    </div>
  );
}
