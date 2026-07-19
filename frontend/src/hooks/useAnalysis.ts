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
  Expertise,
  TraceEntry,
} from "../types";

export interface UseAnalysis {
  agents: AgentState[];
  progress: number;
  trace: TraceEntry[];
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
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const reset = useCallback(() => {
    setAgents(initialAgents());
    setTrace([]);
    setResult(null);
    setError(null);
  }, []);

  const runFile = useCallback(
    async (file: File): Promise<void> => {
      setRunning(true);
      setFileName(file.name);
      setAgents(
        initialAgents().map(
          (a, i): AgentState =>
            i === 0 ? { ...a, status: "active", progress: 40, message: `${a.name} running…` } : a,
        ),
      );
      setTrace([]);
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
          onDone: (finalState) => {
            setResult(finalState);
            setAgents((prev) => finalizeAgents(prev));
            setRunning(false);
            // Partial done after a server error still carries useful agent output.
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
    result,
    running,
    error,
    fileName,
    runFile,
    runText,
    reset,
  };
}
