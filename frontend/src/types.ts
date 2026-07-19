// ─────────────────────────────────────────────────────────────────────────────
// Shared domain types for the Netra.ai cockpit.
//
// These model the REAL backend contract (FastAPI + LangGraph) plus the UI-only
// view models used by the HUD widgets. The old Netra demo used a simulated
// Express server; everything here targets the real Python API.
// ─────────────────────────────────────────────────────────────────────────────

/** Severity levels emitted by the classifier agent. */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** Operator expertise domains — drives Jira routing. */
export type Expertise = "DB" | "Network" | "Memory" | "CPU" | "General";

// ─── Analysis pipeline (POST /api/analyze → SSE) ─────────────────────────────

/** A single trace / log entry streamed by an agent node. */
export interface TraceEntry {
  node: string;
  message: string;
}

/** A detected incident issue returned by the classifier. */
export interface Issue {
  id: string;
  title: string;
  category?: string;
  severity: Severity;
  affected_service: string;
  summary: string;
  evidence?: string[];
}

/** How the remediation was grounded against the runbook KB. */
export type KbStatus = "hit" | "miss" | "learned";

/** A RAG-grounded remediation for a specific issue. */
export interface Remediation {
  issue_id: string;
  fix_summary: string;
  suggested_command?: string;
  rationale?: string;
  risk_level?: "low" | "medium" | "high";
  requires_approval?: boolean;
  grounded_in?: string[];
  /** Set by remediation/fallback nodes: hit = KB match, miss → learn, learned = written back. */
  kb_status?: KbStatus;
  fallback?: boolean;
}

/** Fallback node payload when KB miss triggers learn-into-Chroma. */
export interface FallbackResults {
  path?: "miss_learn" | string;
  processed?: number;
  new_remediations?: number;
  patterns_learned?: number;
  learned_issue_ids?: string[];
  learned_titles?: string[];
  eval_scores?: Array<{
    issue_id: string;
    issue_title?: string;
    relevance_score?: number;
    coverage?: number;
    docs_found?: number;
  }>;
}

/** A single step inside the incident cookbook. */
export interface CookbookItem {
  step: number;
  action: string;
  owner_hint?: string;
  done_when?: string;
}

/** The incident cookbook returned by the cookbook-builder agent. */
export interface Cookbook {
  title?: string;
  items: CookbookItem[];
}

/** A Jira ticket created by the jira-integrator agent (with routing metadata). */
export interface JiraTicket {
  key: string;
  url: string;
  summary: string;
  severity: string;
  issue_id?: string;
  /** New: category → expertise mapping for intent routing. */
  required_expertise?: Expertise;
  /** New: "assigned" | "routed" depending on operator expertise match. */
  routing_status?: "assigned" | "routed";
  assignee?: string;
  routing_explanation?: string;
}

/** The Slack notification result from the notifier agent. */
export interface SlackResult {
  channel: string;
  ts?: string;
  permalink?: string;
  text_preview: string;
}

/** The final state object emitted by the `done` SSE event. */
export interface AnalysisResult {
  issues?: Issue[];
  remediations?: Remediation[];
  cookbook?: Cookbook;
  jira_tickets?: JiraTicket[];
  slack_result?: SlackResult;
  image_analysis?: Record<string, unknown> | null;
  fallback_results?: FallbackResults | null;
}

// ─── SSE / API contract types ─────────────────────────────────────────────────

export interface NodeUpdate {
  trace?: TraceEntry[];
  [key: string]: unknown;
}

export interface NodeEvent {
  node: string;
  update?: NodeUpdate;
}

export interface AnalyzeCallbacks {
  onNode?: (event: NodeEvent) => void;
  onDone?: (state: AnalysisResult) => void;
  onError?: (error: Error) => void;
  /** TEMP debug strip — remove after testing. */
  onDebug?: (line: DebugLogLine) => void;
}

// ─── Agent flow-chart view model ──────────────────────────────────────────────

/** Real LangGraph node ids surfaced in the flow chart. */
export type AgentId =
  | "classifier"
  | "image_analyzer"
  | "remediation"
  | "fallback"
  | "cookbook"
  | "jira"
  | "notifier";

export type AgentStatus = "idle" | "active" | "completed" | "failed";

export interface AgentState {
  id: AgentId;
  name: string;
  role: string;
  status: AgentStatus;
  progress: number;
  message: string;
  result?: unknown;
  /** Optional / conditional graph node (dashed in the flowchart). */
  optional?: boolean;
}

/** TEMP: backend debug lines streamed over SSE (`event: debug`). Remove after testing. */
export interface DebugLogLine {
  level?: string;
  file: string;
  node?: string | null;
  message: string;
  ts?: string;
}

// ─── Live telemetry view models (fed by the real webhook buffer) ──────────────

export interface LogEntry {
  id: string;
  timestamp: string;
  service: string;
  method?: string;
  path?: string;
  status?: number;
  responseTime: number;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  message: string;
  userAssigned?: string;
  category: "API" | "Database" | "Auth" | "Network" | "System";
}

export interface AnomalyAlert {
  id: string;
  timestamp: string;
  logId?: string;
  severity: "WARN" | "ERROR" | "CRITICAL";
  message: string;
  resolved: boolean;
  service?: string;
  threatIndex: number;
}

/** Raw event shape returned by GET /api/events/recent. */
export interface LiveEvent {
  id: string;
  timestamp: string;
  service: string;
  severity: string;
  message: string;
  category: string;
  source: string;
  response_time_ms?: number;
}

/** Operator profile derived from Clerk + local expertise preference. */
export interface OperatorProfile {
  username: string;
  email: string;
  expertise: Expertise[];
}
