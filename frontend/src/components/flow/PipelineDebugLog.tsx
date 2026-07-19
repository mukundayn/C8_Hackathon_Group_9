import { useEffect, useRef } from "react";
import type { DebugLogLine } from "../../types";

interface Props {
  lines: DebugLogLine[];
}

/**
 * TEMP horizontal debug strip under the LangGraph chart.
 * Streams backend `event: debug` lines (file + message). Remove after testing.
 */
export default function PipelineDebugLog({ lines }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lines.length]);

  return (
    <div className="mt-4 border border-slate-700 bg-black text-left">
      <div className="px-2 py-1 border-b border-slate-700 text-[10px] font-mono text-slate-400 flex justify-between">
        <span>TEMP DEBUG LOG · backend file traces (remove after testing)</span>
        <span>{lines.length} lines</span>
      </div>
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
    </div>
  );
}
