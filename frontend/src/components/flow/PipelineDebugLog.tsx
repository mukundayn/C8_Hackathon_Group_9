import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Terminal } from "lucide-react";
import type { DebugLogLine } from "../../types";
import { playClickPulse } from "../../utils/audio";

interface Props {
  lines: DebugLogLine[];
}

/** Live SSE file/node traces under the LangGraph chart — collapsible. */
export default function PipelineDebugLog({ lines }: Props) {
  const [open, setOpen] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lines.length, open]);

  const toggle = () => {
    playClickPulse();
    setOpen((v) => !v);
  };

  return (
    <div className="mt-4 border border-slate-700 bg-black text-left rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full px-2 py-1.5 border-b border-slate-700 text-[10px] font-mono text-slate-400 flex items-center justify-between gap-2 hover:bg-slate-900/80 hover:text-cyan-300 transition cursor-pointer"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 uppercase tracking-widest text-cyan-400/90">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Terminal className="w-3 h-3" />
          Live Code Parser · pipeline debug
        </span>
        <span className="text-slate-500 flex-shrink-0">
          {lines.length} lines · {open ? "COLLAPSE" : "EXPAND"}
        </span>
      </button>

      {open && (
        <div className="h-36 overflow-y-auto overflow-x-auto px-2 py-1 font-mono text-[10px] leading-relaxed text-slate-300 whitespace-pre">
          {lines.length === 0 ? (
            <div className="text-slate-600">Waiting for analyze SSE debug events…</div>
          ) : (
            lines.map((line, i) => (
              <div key={i} className={line.level === "ERROR" ? "text-rose-400" : undefined}>
                <span className="text-slate-500">{line.ts ? `${line.ts} ` : ""}</span>
                <span className="text-amber-500/90">{line.file}</span>
                {line.node ? <span className="text-cyan-500"> [{line.node}]</span> : null}
                <span> — {line.message}</span>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
