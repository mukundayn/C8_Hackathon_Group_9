import { useCallback, useState } from "react";
import { analyze, textToLogFile } from "../lib/api";
import {
  applyNodeEvent,
  finalizeAgents,
  initialAgents,
  overallProgress,
} from "../lib/mappers";
import type {
  AgentState,
  AnalysisResult,
  DebugLogLine,
  Expertise,
  TraceEntry,
} from "../types";

export interface UseAnalysis {
  agents: AgentState[];
  progress: number;
  trace: TraceEntry[];
  debugLines: DebugLogLine[];
  result: AnalysisResult | null;
  running: boolean;
  error: string | null;
  fileName: string | null;
  runFile: (file: File) => Promise<void>;
  runText: (text: string, filename: string) => Promise<void>;
  reset: () => void;
}

/**
 * Drives the real /api/analyze SSE pipeline and exposes flow-chart-ready state.
 * Operator expertise is forwarded so the backend can route Jira tickets.
 */
export function useAnalysis(expertise: Expertise[]): UseAnalysis {
  const [agents, setAgents] = useState<AgentState[]>(initialAgents);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [debugLines, setDebugLines] = useState<DebugLogLine[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const reset = useCallback(() => {
    setAgents(initialAgents());
    setTrace([]);
    setDebugLines([]);
    setResult(null);
    setError(null);
  }, []);

  const runFile = useCallback(
    async (file: File): Promise<void> => {
      setRunning(true);
      setFileName(file.name);
      setAgents(
        initialAgents().map(
          (a): AgentState =>
            a.id === "classifier"
              ? { ...a, status: "active", progress: 40, message: `${a.name} running…` }
              : a,
        ),
      );
      setTrace([]);
      setDebugLines([]);
      setResult(null);
      setError(null);

      await analyze(
        file,
        {
          onNode: ({ node, update }) => {
            const tr = update?.trace;
            const msg = tr && tr.length > 0 ? tr[tr.length - 1].message : undefined;
            setAgents((prev) => applyNodeEvent(prev, node, msg));
            if (tr && tr.length > 0) setTrace((t) => [...t, ...tr]);
          },
          onDebug: (line) => {
            const stamped: DebugLogLine = {
              ...line,
              ts: new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Kolkata",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              }).format(new Date()),
            };
            setDebugLines((prev) => [...prev.slice(-200), stamped]);
          },
          onDone: (finalState) => {
            setResult(finalState);
            setAgents((prev) => finalizeAgents(prev));
            setRunning(false);
            if (finalState && typeof finalState === "object" && "error" in finalState) {
              const msg = String((finalState as { error?: unknown }).error || "");
              if (msg) setError(msg);
            }
          },
          onError: (err) => {
            setError(err.message);
            setAgents((prev) =>
              prev.map((a): AgentState => (a.status === "active" ? { ...a, status: "failed" } : a)),
            );
            setRunning(false);
          },
        },
        expertise,
      );
    },
    [expertise],
  );

  const runText = useCallback(
    (text: string, filename: string) => runFile(textToLogFile(text, filename)),
    [runFile],
  );

  return {
    agents,
    progress: overallProgress(agents),
    trace,
    debugLines,
    result,
    running,
    error,
    fileName,
    runFile,
    runText,
    reset,
  };
}
