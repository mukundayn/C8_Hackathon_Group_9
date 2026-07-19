import { useCallback, useRef, useState } from "react";
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
  /** Monotonic id — bumps at the start of every analyze so gauges can roll up once per run. */
  runId: number;
  /** True after a run reaches `done` and agents are finalized (until armed for next upload). */
  flowCompleted: boolean;
  runFile: (file: File) => Promise<void>;
  runText: (text: string, filename: string) => Promise<void>;
  reset: () => void;
  /** Clear flowchart + upload cue only; keep last result and session metrics. */
  resetForNextUpload: () => void;
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
  const [runId, setRunId] = useState(0);
  const [flowCompleted, setFlowCompleted] = useState(false);
  const runSeq = useRef(0);
  const activeRun = useRef(0);

  const reset = useCallback(() => {
    setAgents(initialAgents());
    setTrace([]);
    setDebugLines([]);
    setResult(null);
    setError(null);
    setFileName(null);
    setFlowCompleted(false);
  }, []);

  /** Arm upload + flowchart for another file without wiping results / rollups. */
  const resetForNextUpload = useCallback(() => {
    if (!flowCompleted) return;
    activeRun.current = 0;
    setAgents(initialAgents());
    setTrace([]);
    setDebugLines([]);
    setFileName(null);
    setError(null);
    setRunning(false);
    setFlowCompleted(false);
    // keep result + runId — Results panel, HITL, and session tiles stay as-is
  }, [flowCompleted]);

  const runFile = useCallback(
    async (file: File): Promise<void> => {
      runSeq.current += 1;
      const thisRun = runSeq.current;
      activeRun.current = thisRun;
      setRunId(thisRun);
      setRunning(true);
      setFlowCompleted(false);
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
            if (activeRun.current !== thisRun) return;
            const tr = update?.trace;
            const msg = tr && tr.length > 0 ? tr[tr.length - 1].message : undefined;
            setAgents((prev) =>
              applyNodeEvent(prev, node, msg, update as Record<string, unknown> | undefined),
            );
            if (tr && tr.length > 0) setTrace((t) => [...t, ...tr]);
          },
          onDebug: (line) => {
            if (activeRun.current !== thisRun) return;
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
            if (activeRun.current !== thisRun) return;
            setResult(finalState);
            setAgents((prev) => finalizeAgents(prev));
            setRunning(false);
            setFlowCompleted(true);
            if (finalState && typeof finalState === "object" && "error" in finalState) {
              const msg = String((finalState as { error?: unknown }).error || "");
              if (msg) setError(msg);
            }
          },
          onError: (err) => {
            if (activeRun.current !== thisRun) return;
            setError(err.message);
            setAgents((prev) =>
              prev.map((a): AgentState => (a.status === "active" ? { ...a, status: "failed" } : a)),
            );
            setRunning(false);
            // Allow refresh after a failed run so the operator can clear the chart.
            setFlowCompleted(true);
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
    runId,
    flowCompleted,
    runFile,
    runText,
    reset,
    resetForNextUpload,
  };
}
