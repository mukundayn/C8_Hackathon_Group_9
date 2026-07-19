import { useState } from "react";
import {
  BookOpen,
  Database,
  ShieldCheck,
  Terminal as TermIcon,
  Copy,
  Check,
  Link2,
} from "lucide-react";
import type {
  AnalysisResult,
  Cookbook,
  Issue,
  Remediation,
  TraceEntry,
} from "../../types";

interface ResultsPanelProps {
  result: AnalysisResult | null;
  trace: TraceEntry[];
  running: boolean;
}

function severityColor(sev: string): string {
  switch (sev.toLowerCase()) {
    case "critical":
      return "bg-rose-950 text-rose-400 border-rose-800";
    case "high":
      return "bg-orange-950 text-orange-400 border-orange-800";
    case "medium":
      return "bg-amber-950 text-amber-400 border-amber-800";
    case "low":
      return "bg-emerald-950 text-emerald-400 border-emerald-800";
    default:
      return "bg-slate-800 text-slate-400 border-slate-700";
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="flex items-center gap-1 text-[9px] font-mono text-cyan-400 hover:text-cyan-300 cursor-pointer"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "COPIED" : "COPY"}
    </button>
  );
}

function IssuesSection({ issues }: { issues: Issue[] }) {
  return (
    <div className="space-y-2">
      <div className="text-[9px] font-mono text-cyan-400 uppercase tracking-widest">
        Detected Root Causes ({issues.length})
      </div>
      {issues.map((issue) => (
        <div key={issue.id} className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
          <div className="flex justify-between items-start gap-2">
            <h4 className="text-xs font-bold text-white leading-tight">{issue.title}</h4>
            <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold border ${severityColor(issue.severity)}`}>
              {issue.severity.toUpperCase()}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{issue.summary}</p>
          <div className="mt-1.5 text-[9px] font-mono text-slate-500">
            SERVICE: <span className="text-cyan-400">{issue.affected_service}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RemediationsSection({ remediations }: { remediations: Remediation[] }) {
  return (
    <div className="space-y-2">
      <div className="text-[9px] font-mono text-pink-400 uppercase tracking-widest flex items-center gap-1">
        <ShieldCheck className="w-3 h-3" /> RAG-Grounded Remediations ({remediations.length})
      </div>
      {remediations.map((r) => (
        <div key={r.issue_id} className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
          <div className="text-[9px] font-mono text-slate-500 mb-1">ISSUE #{r.issue_id}</div>
          <p className="text-[11px] text-white font-medium leading-relaxed">{r.fix_summary}</p>
          {r.suggested_command && (
            <div className="mt-2 bg-slate-950 border-l-2 border-pink-500 rounded-r p-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[8px] font-mono text-slate-500 uppercase">Suggested Command</span>
                <CopyButton text={r.suggested_command} />
              </div>
              <pre className="text-[10px] font-mono text-pink-300 overflow-x-auto whitespace-pre-wrap">{r.suggested_command}</pre>
            </div>
          )}
          {r.rationale && <p className="text-[10px] text-slate-400 italic mt-1.5 leading-snug">{r.rationale}</p>}
          {r.grounded_in && r.grounded_in.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-[9px] font-mono text-emerald-400">
              <Link2 className="w-3 h-3" /> Grounded in: {r.grounded_in.join(", ")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CookbookSection({ cookbook }: { cookbook: Cookbook }) {
  return (
    <div className="space-y-2">
      <div className="text-[9px] font-mono text-cyan-400 uppercase tracking-widest flex items-center gap-1">
        <BookOpen className="w-3 h-3" /> {cookbook.title ?? "Incident Cookbook"}
      </div>
      {cookbook.items?.map((item) => (
        <div key={item.step} className="flex gap-2.5 p-2.5 bg-slate-900 border border-slate-800 rounded-lg">
          <div className="w-5 h-5 flex-shrink-0 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[10px] font-mono font-bold flex items-center justify-center">
            {item.step}
          </div>
          <div>
            <div className="text-[11px] text-white leading-snug">{item.action}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[9px] font-mono text-slate-500">
              {item.owner_hint && <span>OWNER: {item.owner_hint}</span>}
              {item.done_when && <span>DONE WHEN: {item.done_when}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ResultsPanel({ result, trace, running }: ResultsPanelProps) {
  const hasResult =
    result && ((result.issues?.length ?? 0) > 0 || (result.remediations?.length ?? 0) > 0 || result.cookbook);

  return (
    <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-6 backdrop-blur-md text-left flex-grow flex flex-col min-h-[580px] relative">
      <div className="absolute top-2 right-4 flex items-center gap-1 text-[9px] font-mono text-slate-500">
        <Database className="w-3 h-3" />
        SECTOR: RESOLUTION_GATE
      </div>

      <h2 className="text-sm font-mono uppercase tracking-widest text-pink-400 mb-4 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-pink-400" />
        Automated AI Troubleshooting & Resolutions
      </h2>

      <div className="flex-grow bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-y-auto max-h-[500px] custom-scrollbar">
        {!hasResult ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center py-10">
            {running ? (
              <>
                <TermIcon className="w-12 h-12 text-cyan-500 animate-pulse" />
                <p className="text-slate-400 text-[11px] uppercase tracking-wider max-w-xs leading-relaxed">
                  LangGraph pipeline running — streaming agent trace…
                </p>
                <div className="w-full max-w-sm mt-2 space-y-1 text-left">
                  {trace.slice(-6).map((t, i) => (
                    <div key={i} className="text-[10px] font-mono text-slate-500">
                      <span className="text-cyan-500">[{t.node}]</span> {t.message}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <Database className="w-12 h-12 text-slate-700 animate-pulse" />
                <p className="text-slate-500 text-[11px] uppercase tracking-wider max-w-xs leading-relaxed">
                  Upload a log file to engage the 5-agent resolution pipeline.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {result?.issues && result.issues.length > 0 && <IssuesSection issues={result.issues} />}
            {result?.remediations && result.remediations.length > 0 && (
              <RemediationsSection remediations={result.remediations} />
            )}
            {result?.cookbook && <CookbookSection cookbook={result.cookbook} />}
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-slate-800/85 pt-3 flex justify-between items-center text-[9px] font-mono text-slate-500 uppercase">
        <span>Resolution integrity check</span>
        <span>{hasResult ? "SYNAPSE_PASS: 100%" : "AWAITING_INPUT"}</span>
      </div>
    </div>
  );
}
