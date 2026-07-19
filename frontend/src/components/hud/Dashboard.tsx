import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { UserButton, useAuth } from "@clerk/react";
import {
  Cpu,
  Clock,
  User,
  Volume2,
  VolumeX,
  LogOut,
  Upload,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Layers,
} from "lucide-react";
import { useAnalysis } from "../../hooks/useAnalysis";
import { useLiveEvents } from "../../hooks/useLiveEvents";
import { useTraffic } from "../../hooks/useTraffic";
import { useHudMetrics } from "../../hooks/useHudMetrics";
import { useOperator } from "../../hooks/useOperator";
import { AGENT_ORDER } from "../../lib/mappers";
import { summarizeKbPath } from "../../lib/kbPath";
import { approveHitl, fetchIntegrationStatus, type IntegrationStatus } from "../../lib/api";
import {
  loadOpenRouterKey,
  saveOpenRouterKey,
  looksLikeOpenRouterKey,
  maskOpenRouterKey,
} from "../../lib/openrouterKey";
import type { AnomalyAlert, JiraTicket, SlackResult } from "../../types";
import {
  isSoundEnabled,
  setSoundEnabled,
  playClickPulse,
  playHoverTick,
  playSuccessChime,
} from "../../utils/audio";
import MetricGauges from "./MetricGauges";
import FlowChart from "../flow/FlowChart";
import ResultsPanel from "../results/ResultsPanel";
import TrafficChart from "../charts/TrafficChart";
import LiveConsole from "../logs/LiveConsole";
import AlertNotification from "../alerts/AlertNotification";
import SlackBoard from "../integrations/SlackBoard";
import JiraBoard from "../integrations/JiraBoard";
import WebhookConnector from "../integrations/WebhookConnector";

const SAMPLE_TEMPLATES = [
  {
    name: "KB HIT · DB pool exhaustion",
    file: "postgres_db_failure.log",
    text: `CRITICAL [2026-07-18T13:20:04] database-service: PostgreSQL connection pool exhausted!
CRITICAL [2026-07-18T13:20:05] database-service: ConnectionPoolTimeoutException - Timeout waiting for active connections > 100
ERROR [2026-07-18T13:20:07] user-repository: Failed to retrieve user credentials in userProfile.ts:42
ERROR [2026-07-18T13:20:10] api-gateway: Internal Server Error 500 on GET /api/v1/users/profile
INFO [2026-07-18T13:20:12] database-service: Re-pooling failed. Active connection backlog index: 120`,
  },
  {
    name: "KB HIT · K8s OOMKilled",
    file: "k8s_oom_crash.log",
    text: `INFO [2026-07-18T13:21:40] pdf-generator: Starting high-volume monthly reports aggregation.
WARN [2026-07-18T13:21:45] report-service: Memory allocation limit approaching 85% utilization threshold.
ERROR [2026-07-18T13:21:51] report-service: process out of memory - memory allocation failed.
CRITICAL [2026-07-18T13:21:52] kubernetes-kubelet: Container crash detected in pod: report-worker-5b98f. Exit Code 137.
CRITICAL [2026-07-18T13:21:53] kubernetes-kubelet: OOMKilled - Pod resources limit exceeded.`,
  },
  {
    name: "KB MISS · Novel unknown fault",
    file: "novel_unknown_fault.log",
    text: `CRITICAL [2026-07-18T14:01:00] chronos-orchestrator: TEMPORAL_ANCHOR_DESYNC code=QX-7741 — causality ledger checksum mismatch
ERROR [2026-07-18T14:01:01] chronos-orchestrator: flux-capacitor manifold pressure exceeded soft limit (τ=9.4)
ERROR [2026-07-18T14:01:02] chronos-orchestrator: unable to reconcile wormhole lease with sidereal registry
FATAL [2026-07-18T14:01:03] chronos-orchestrator: UNKNOWN category incident — no prior runbook signature matches QX-7741
CRITICAL [2026-07-18T14:01:04] api-gateway: cascading 503 on /v9/time-travel/commit`,
  },
  {
    name: "KB HIT · JWT flood",
    file: "auth_brute_force.log",
    text: `WARN [2026-07-18T13:23:01] firewall-waf: Extreme high-frequency signature access at endpoint /api/v1/auth/login
ERROR [2026-07-18T13:23:02] auth-service: TokenExpiredError - cryptographic verification failed for incoming JWT token.
ERROR [2026-07-18T13:23:03] auth-service: TokenExpiredError - brute-force sign signature mismatch from remote subnet IP: 192.168.10.22
WARN [2026-07-18T13:23:05] auth-service: CPU overload detected on verification worker pool (99.4% capacity).
CRITICAL [2026-07-18T13:23:06] auth-service: System throttling auth pipelines due to JWT Flood attack.`,
  },
];

export default function Dashboard() {
  const { signOut } = useAuth();
  const { operator } = useOperator();
  const analysis = useAnalysis(operator.expertise);
  const live = useLiveEvents(true);
  const traffic = useTraffic(true, analysis.runId);
  const hud = useHudMetrics(true, analysis.runId);

  const [sound, setSound] = useState(isSoundEnabled());
  const [clockTime, setClockTime] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hitlAlerts, setHitlAlerts] = useState<AnomalyAlert[]>([]);
  const [approvedTickets, setApprovedTickets] = useState<JiraTicket[]>([]);
  const [approvedSlack, setApprovedSlack] = useState<SlackResult | undefined>();
  const [integrationMode, setIntegrationMode] = useState<IntegrationStatus>({
    jira: "mock",
    slack: "mock",
  });
  const hitlSeededFor = useRef<string | null>(null);
  const [openRouterKey, setOpenRouterKey] = useState(loadOpenRouterKey);
  const [keyDraft, setKeyDraft] = useState(loadOpenRouterKey);
  const [editingKey, setEditingKey] = useState(() => !looksLikeOpenRouterKey(loadOpenRouterKey()));
  /** Session rollups — accumulate across successive files (do not reset per run). */
  const [sessionKbHits, setSessionKbHits] = useState(0);
  const [sessionKbLearned, setSessionKbLearned] = useState(0);
  const [sessionAgentStages, setSessionAgentStages] = useState(0);
  const rolledUpRunId = useRef(0);

  useEffect(() => {
    const update = () => {
      const fmt = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      // en-IN often yields DD/MM/YYYY, HH:MM:SS — normalize spacing + IST label
      const parts = fmt.formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      setClockTime(
        `${get("year")}-${get("month")}-${get("day")}  ${get("hour")}:${get("minute")}:${get("second")} IST`,
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchIntegrationStatus()
      .then((s) => {
        if (!cancelled) setIntegrationMode(s);
      })
      .catch(() => {
        /* keep mock badges */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed HITL threat alerts when analysis finishes with newly-learned criticals.
  useEffect(() => {
    const pending = analysis.result?.hitl_pending ?? [];
    const seedKey = pending.map((p) => p.issue_id).sort().join("|") || null;
    if (!seedKey || seedKey === hitlSeededFor.current) return;
    hitlSeededFor.current = seedKey;
    const now = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
    setHitlAlerts(
      pending.map(
        (p): AnomalyAlert => ({
          id: `hitl-${p.issue_id}`,
          timestamp: now,
          severity: "CRITICAL",
          message:
            p.summary ||
            p.fix_summary ||
            `Newly learned pattern for ${p.title ?? p.issue_id}. Approve to open Jira + Slack.`,
          resolved: false,
          service: p.affected_service,
          threatIndex: 9.4,
          hitl: true,
          hitlIssueId: p.issue_id,
          hitlStatus: "pending",
          title: p.title,
        }),
      ),
    );
  }, [analysis.result]);

  // Roll cockpit tiles once per completed analyze (2nd+ files keep accumulating).
  useLayoutEffect(() => {
    if (analysis.running || !analysis.result || analysis.runId <= 0) return;
    if (rolledUpRunId.current === analysis.runId) return;
    rolledUpRunId.current = analysis.runId;

    const summary = summarizeKbPath(analysis.result);
    const hits = summary.hits.length;
    const learned =
      summary.learned.length || (summary.fallback?.patterns_learned ?? 0);
    const stagesDone = analysis.agents.filter((a) => a.status === "completed").length;

    setSessionKbHits((n) => n + hits);
    setSessionKbLearned((n) => n + learned);
    setSessionAgentStages((n) => n + stagesDone);
  }, [analysis.running, analysis.result, analysis.runId, analysis.agents]);

  const handleApproveHitl = useCallback(
    async (alert: AnomalyAlert) => {
      const result = analysis.result;
      if (!result || !alert.hitlIssueId) return;
      const res = await approveHitl({
        issue_ids: [alert.hitlIssueId],
        pending: (result.hitl_pending ?? []) as unknown as Array<Record<string, unknown>>,
        issues: (result.issues ?? []) as unknown as Array<Record<string, unknown>>,
        remediations: (result.remediations ?? []) as unknown as Array<Record<string, unknown>>,
        operator_expertise: operator.expertise,
        cookbook: (result.cookbook ?? null) as Record<string, unknown> | null,
        learned_issue_ids: result.fallback_results?.learned_issue_ids,
      });
      setApprovedTickets((prev) => [...prev, ...(res.jira_tickets ?? [])]);
      if (res.slack_result) setApprovedSlack(res.slack_result);
      setHitlAlerts((prev) =>
        prev.map((a) =>
          a.id === alert.id ? { ...a, hitlStatus: "approved", resolved: true } : a,
        ),
      );
    },
    [analysis.result, operator.expertise],
  );

  const handleRejectHitl = useCallback((alert: AnomalyAlert) => {
    setHitlAlerts((prev) =>
      prev.map((a) => (a.id === alert.id ? { ...a, hitlStatus: "rejected", resolved: true } : a)),
    );
  }, []);

  const handleSoundToggle = () => {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    if (next) playClickPulse();
  };

  /** Clear per-run UI (HITL / boards) before every new file — keep session gauge rollups. */
  const beginNewAnalysis = useCallback(() => {
    hitlSeededFor.current = null;
    setHitlAlerts([]);
    setApprovedTickets([]);
    setApprovedSlack(undefined);
    setUploadError(null);
  }, []);

  const processFile = (file: File) => {
    const ok = /\.(log|txt|json)$/i.test(file.name);
    if (!ok) {
      setUploadError("FORMAT REJECTION: only .log, .txt, or .json files are parsed by Netra.");
      return;
    }
    playSuccessChime();
    beginNewAnalysis();
    void analysis.runFile(file);
  };

  const runTemplate = (text: string, filename: string) => {
    playClickPulse();
    beginNewAnalysis();
    void analysis.runText(text, filename);
  };

  const completedCount = analysis.agents.filter((a) => a.status === "completed").length;
  const criticalCount = hud.critical_incidents;
  const displayKbHits = sessionKbHits;
  const displayKbLearned = sessionKbLearned;
  // While a run is in flight, show session total + stages completed so far this run.
  const displayAgentStages =
    sessionAgentStages + (analysis.running ? completedCount : 0);
  const displayTickets = [
    ...(analysis.result?.jira_tickets ?? []),
    ...approvedTickets,
  ];
  const displaySlack = approvedSlack ?? analysis.result?.slack_result;
  const mergedAlerts = [...hitlAlerts.filter((a) => !a.resolved), ...live.alerts];

  return (
    <div className="relative min-h-screen bg-[#060814] text-gray-300 font-sans p-4 lg:p-6 overflow-x-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0c102b_1px,transparent_1px),linear-gradient(to_bottom,#0c102b_1px,transparent_1px)] bg-[size:3rem_3rem] opacity-35" />
      <div className="absolute top-0 left-0 w-full h-0.5 bg-cyan-400/80 animate-pulse z-20" />

      <AlertNotification
        alerts={mergedAlerts}
        onDismiss={live.dismissAlert}
        onApproveHitl={handleApproveHitl}
        onRejectHitl={handleRejectHitl}
      />

      {/* Header */}
      <header className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/60 border border-slate-800 rounded-2xl p-5 mb-6 backdrop-blur-md shadow-2xl">
        <div className="flex items-center gap-4 text-left">
          <div className="p-2.5 bg-cyan-500/10 border border-slate-800 rounded-xl">
            <Cpu className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 leading-none">
                NETRA.AI
              </h1>
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 rounded border border-cyan-400/20">
                OPERATOR COCKPIT v4.0
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              {criticalCount > 0
                ? `${criticalCount} critical incident(s) detected`
                : "Real-time cognitive observability & threat mitigation"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 md:gap-4 w-full md:w-auto font-mono text-[11px] border-t border-slate-800 md:border-0 pt-3 md:pt-0">
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-cyan-400">
            <Clock className="w-3.5 h-3.5" />
            <span>{clockTime || "CLOCKING…"}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-pink-400">
            <User className="w-3.5 h-3.5 text-pink-400" />
            <span>{operator.username}</span>
          </div>
          <button
            type="button"
            onClick={handleSoundToggle}
            className="p-2 rounded border border-slate-800 bg-slate-950/50 text-slate-400 hover:bg-slate-800 hover:border-slate-700 cursor-pointer"
            title="Toggle sound"
          >
            {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <UserButton />
          <button
            type="button"
            onClick={() => {
              playClickPulse();
              void signOut({ redirectUrl: "/login" });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-rose-500/20 hover:border-rose-500/40 bg-rose-950/10 hover:bg-rose-950/30 text-rose-400 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>SIGN OUT</span>
          </button>
        </div>
      </header>

      {/* Bring-your-own OpenRouter key — required for analyze */}
      <div
        className={`relative z-10 mb-4 rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${
          looksLikeOpenRouterKey(openRouterKey)
            ? "border-slate-800 bg-slate-900/40"
            : "border-amber-500/40 bg-amber-950/20"
        }`}
      >
        <div className="flex-1 text-left min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1">
            OpenRouter BYOK {looksLikeOpenRouterKey(openRouterKey) ? "· ACTIVE" : "· REQUIRED"}
          </div>
          {editingKey ? (
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-or-v1-… paste your key"
              autoComplete="off"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-cyan-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
            />
          ) : (
            <p className="text-xs font-mono text-cyan-300/90 truncate">
              {maskOpenRouterKey(openRouterKey)} · LLM calls bill this key
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {editingKey ? (
            <button
              type="button"
              onClick={() => {
                if (!looksLikeOpenRouterKey(keyDraft)) return;
                playClickPulse();
                saveOpenRouterKey(keyDraft);
                setOpenRouterKey(keyDraft.trim());
                setEditingKey(false);
              }}
              disabled={!looksLikeOpenRouterKey(keyDraft)}
              className="px-3 py-1.5 rounded border border-cyan-500/40 bg-cyan-950/30 text-cyan-300 text-[10px] font-mono uppercase cursor-pointer disabled:opacity-40"
            >
              Save key
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                playClickPulse();
                setKeyDraft(openRouterKey);
                setEditingKey(true);
              }}
              className="px-3 py-1.5 rounded border border-slate-700 bg-slate-950 text-slate-400 hover:text-cyan-300 text-[10px] font-mono uppercase cursor-pointer"
            >
              Change
            </button>
          )}
        </div>
      </div>

      <MetricGauges
        ingestRate={hud.ingest_total}
        avgResponseMs={hud.avg_response_ms}
        activeAlerts={criticalCount}
        kbHits={displayKbHits}
        kbLearned={displayKbLearned}
        agentsCompleted={displayAgentStages}
        agentsTotal={AGENT_ORDER.length}
        pipelineProgress={analysis.progress}
      />

      {/* Main workspace */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <div className="lg:col-span-7 space-y-6">
          {/* Upload portal */}
          <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-6 backdrop-blur-md text-left relative overflow-hidden">
            <div className="absolute top-2 right-4 flex items-center gap-1 text-[9px] font-mono text-slate-500">
              <Upload className="w-3 h-3" />
              CHANNEL: DIRECT_IO
            </div>
            <h2 className="text-sm font-mono uppercase tracking-widest text-cyan-400 mb-4 flex items-center gap-2">
              <Upload className="w-4 h-4 text-cyan-400" />
              Log Stream & Automated Diagnostic Portal
            </h2>

            <div
              onDragEnter={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) processFile(file);
              }}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-300 ${
                dragActive
                  ? "border-cyan-400 bg-cyan-950/10 shadow-[inset_0_0_15px_rgba(6,182,212,0.1)]"
                  : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
              } ${analysis.running ? "opacity-60 pointer-events-none" : ""}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processFile(file);
                  e.target.value = "";
                }}
                accept=".log,.txt,.json"
                className="hidden"
              />
              <div className="flex flex-col items-center justify-center gap-2">
                <FileCode className="w-10 h-10 text-cyan-400 animate-pulse mb-1" />
                <p className="text-xs font-semibold text-white">
                  {analysis.running ? "Analyzing…" : "Drag & drop your server .log / .txt / .json file"}
                </p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">OR CLICK TO SELECT FROM SYSTEM EXPLORER</p>
              </div>

              {analysis.fileName && !uploadError && (
                <div className="mt-4 inline-flex items-center gap-1.5 bg-slate-950 border border-cyan-500/30 px-3 py-1.5 rounded text-xs font-mono text-cyan-400">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                  <span>PAYLOAD: {analysis.fileName}</span>
                </div>
              )}
            </div>

            {(uploadError || analysis.error) && (
              <div className="mt-4 p-3 bg-red-950/20 border border-red-500/20 rounded-lg text-xs font-mono text-red-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <span>{uploadError ?? analysis.error}</span>
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-slate-800/80">
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">
                Load High-Fidelity Incident Templates
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SAMPLE_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.file}
                    type="button"
                    disabled={analysis.running}
                    onMouseEnter={playHoverTick}
                    onClick={() => runTemplate(tpl.text, tpl.file)}
                    className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-800 hover:border-slate-700 hover:bg-slate-900/60 text-[11px] font-mono text-slate-300 hover:text-cyan-300 text-left transition disabled:opacity-50 cursor-pointer"
                  >
                    <span className="truncate">{tpl.name}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <FlowChart
            agents={analysis.agents}
            overallProgress={analysis.progress}
            debugLines={analysis.debugLines}
          />
        </div>

        <div className="lg:col-span-5 flex flex-col">
          <ResultsPanel result={analysis.result} trace={analysis.trace} running={analysis.running} />
        </div>
      </div>

      {/* Traffic + live console */}
      <section className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6">
          <TrafficChart points={traffic} />
        </div>
        <div className="lg:col-span-6">
          <LiveConsole logs={live.logs} connected={live.connected} onClear={live.clearLogs} />
        </div>
      </section>

      {/* Integration hub */}
      <section className="relative z-10 mt-6 border border-slate-800 bg-slate-900/35 rounded-2xl p-6 backdrop-blur-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-slate-800/60 pb-4">
          <div className="text-left">
            <h2 className="text-sm font-mono uppercase tracking-widest text-cyan-400 flex items-center gap-2">
              <Layers className="w-5 h-5 text-cyan-400 animate-pulse" />
              Integration Shield & Automated Routing Hub
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Jira + Slack only after HITL approve on newly learned criticals. KB HIT skips ticketing.
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-cyan-950/20 border border-cyan-800/40 rounded-lg text-[10px] font-mono text-cyan-300">
            <span className="text-slate-400">ACTIVE EXPERTISE:</span>
            <span className="font-bold">{operator.expertise.join(", ")}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <SlackBoard
            slack={displaySlack && Object.keys(displaySlack).length ? displaySlack : undefined}
            mode={integrationMode.slack}
          />
          <JiraBoard tickets={displayTickets} mode={integrationMode.jira} />
          <WebhookConnector expertise={operator.expertise} connected={live.connected} />
        </div>
      </section>
    </div>
  );
}
