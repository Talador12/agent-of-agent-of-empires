// known session status values from AoE CLI + internal states
export type AoeSessionStatus = "working" | "running" | "idle" | "waiting" | "done" | "error" | "stopped" | "unknown";

const VALID_STATUSES = new Set<AoeSessionStatus>(["working", "running", "idle", "waiting", "done", "error", "stopped", "unknown"]);

// coerce an arbitrary string (e.g. from CLI JSON output) to a valid AoeSessionStatus
export function toSessionStatus(raw: unknown): AoeSessionStatus {
  const s = String(raw ?? "unknown");
  return VALID_STATUSES.has(s as AoeSessionStatus) ? (s as AoeSessionStatus) : "unknown";
}

// session snapshot from aoe status --json + tmux capture
export interface AoeSession {
  id: string;
  title: string;
  path: string;
  tool: string;
  status: AoeSessionStatus;
  tmux_name: string;
  group?: string;
  created_at?: string;
}

export interface SessionSnapshot {
  session: AoeSession;
  output: string; // last N lines from tmux capture-pane
  outputHash: string; // quick hash to detect changes
  capturedAt: number; // Date.now()
  projectContext?: string; // AGENTS.md / claude.md content from session's path
  userActive?: boolean; // true if a human user is interacting with this tmux pane
}

export interface Observation {
  timestamp: number;
  sessions: SessionSnapshot[];
  changes: SessionChange[]; // only sessions with new output since last poll
  userMessage?: string; // optional human operator message injected via stdin
  taskContext?: TaskState[]; // active tasks with goals + progress (for reasoner)
  protectedSessions?: string[]; // session titles that are observe-only
  // policy enforcement context (attached by main loop, consumed by formatObservation)
  policyContext?: {
    policies: AoaoeConfig["policies"];
    sessionStates: Array<{
      sessionId: string;
      lastOutputChangeAt: number;
      consecutiveErrorPolls: number;
      hasPermissionPrompt: boolean;
    }>;
  };
}

export interface SessionChange {
  sessionId: string;
  title: string;
  tool: string;
  status: AoeSessionStatus;
  newLines: string; // lines that appeared since last capture
}

// actions the reasoner can return
export type Action =
  | { action: "send_input"; session: string; text: string }
  | { action: "start_session"; session: string }
  | { action: "stop_session"; session: string }
  | { action: "create_agent"; path: string; title: string; tool: string }
  | { action: "remove_agent"; session: string }
  | { action: "report_progress"; session: string; summary: string }
  | { action: "complete_task"; session: string; summary: string }
  | { action: "wait"; reason?: string };

// extract the session/title identifier from any action (uses discriminated union narrowing)
export function actionSession(action: Action): string | undefined {
  switch (action.action) {
    case "send_input": case "start_session": case "stop_session":
    case "remove_agent": case "report_progress": case "complete_task":
      return action.session;
    case "create_agent":
      return action.title;
    case "wait":
      return undefined;
  }
}

// extract the human-readable detail (text, summary, reason) from any action
export function actionDetail(action: Action): string | undefined {
  switch (action.action) {
    case "send_input":
      return action.text;
    case "report_progress": case "complete_task":
      return action.summary;
    case "wait":
      return action.reason;
    case "start_session": case "stop_session": case "remove_agent": case "create_agent":
      return undefined;
  }
}

export interface ReasonerResult {
  actions: Action[];
  reasoning?: string; // optional explanation from the LLM
}

// reasoner backend interface
export interface Reasoner {
  init(): Promise<void>;
  decide(observation: Observation, signal?: AbortSignal): Promise<ReasonerResult>;
  shutdown(): Promise<void>;
}

export type ReasonerBackend = "opencode" | "claude-code";

export interface AoaoeConfig {
  reasoner: ReasonerBackend;
  pollIntervalMs: number;
  opencode: {
    port: number;
    model?: string;
  };
  claudeCode: {
    model?: string;
    yolo: boolean;
    resume: boolean;
  };
  aoe: {
    profile: string;
  };
  policies: {
    maxIdleBeforeNudgeMs: number;
    maxErrorsBeforeRestart: number;
    autoAnswerPermissions: boolean;
    actionCooldownMs?: number; // rate limit cooldown per session (default: 30000)
    userActivityThresholdMs?: number; // skip send_input when user was active within this window (default: 30000)
    allowDestructive?: boolean; // allow remove_agent and stop_session (default: false — blocked unless explicitly enabled)
  };
  contextFiles: string[]; // extra AI instruction file paths to load (relative to project root)
  sessionDirs: Record<string, string>; // explicit session title -> project directory mapping (absolute or relative to cwd)
  protectedSessions: string[]; // session titles that are observe-only (no actions allowed, case-insensitive)
  captureLinesCount: number; // how many lines to capture from each tmux pane
  verbose: boolean;
  dryRun: boolean; // observe + reason but don't execute; log what would happen
  observe: boolean; // observe only — no LLM, no execution, zero cost
  confirm: boolean; // ask the user to approve each action before execution
  notifications?: {
    webhookUrl?: string; // generic webhook — POST JSON payload on events
    slackWebhookUrl?: string; // Slack incoming webhook — POST Slack block format
    events?: NotificationEvent[]; // filter which events trigger notifications (default: all)
    maxRetries?: number; // retry failed deliveries with exponential backoff (default: 0 = no retry)
  };
  healthPort?: number; // optional HTTP health check server port (e.g. 4098)
  tuiHistoryRetentionDays?: number; // how many days of TUI history to keep on startup replay (default: 7)
}

export type NotificationEvent = "session_error" | "session_done" | "action_executed" | "action_failed" | "daemon_started" | "daemon_stopped";

// daemon state written to ~/.aoaoe/daemon-state.json for chat UI IPC
export type DaemonPhase = "sleeping" | "polling" | "reasoning" | "executing" | "interrupted";

export interface DaemonSessionState {
  id: string;
  title: string;
  tool: string;
  status: AoeSessionStatus;
  currentTask?: string; // last send_input text sent to this session
  lastActivity?: string; // last non-empty line of output
  contextTokens?: string; // latest parsed context usage (e.g. "137,918 tokens")
  todoSummary?: string; // formatted OpenCode-style TODO list parsed from pane output
  userActive?: boolean; // true if a human user is interacting with this tmux pane
  costStr?: string;      // latest parsed cost (e.g. "$3.42")
  path?: string;         // project directory path (from AoeSession)
  createdAt?: string;    // ISO 8601 creation time from AoE
}

export interface DaemonState {
  tickStartedAt: number;
  nextTickAt: number;
  pollIntervalMs: number;
  phase: DaemonPhase;
  phaseStartedAt: number;
  pollCount: number;
  paused: boolean;
  sessionCount: number;
  changeCount: number;
  sessions: DaemonSessionState[];
  tasks?: TaskState[]; // persistent task progress for dashboard/chat
}

// ── Task system ─────────────────────────────────────────────────────────────

export type TaskSessionMode = "auto" | "existing" | "new";

// user-defined task: "work on this repo"
export interface TaskDefinition {
  repo: string;          // relative path from cwd (e.g. "github/adventure")
  sessionTitle?: string; // optional AoE session title to target (default: derive from repo)
  sessionMode?: TaskSessionMode; // auto=link-or-create, existing=link-only, new=create-only
  tool?: string;         // AoE tool name (default: "opencode")
  goal?: string;         // what to accomplish (default: read from claude.md roadmap)
}

// a single progress entry (persists even after session cleanup)
export interface TaskProgress {
  at: number;            // timestamp
  summary: string;       // what was accomplished
}

export type TaskStatus = "pending" | "active" | "completed" | "paused" | "failed";

const VALID_TASK_STATUSES = new Set<TaskStatus>(["pending", "active", "completed", "paused", "failed"]);

// persistent state for a task — survives session creation and teardown
export interface TaskState {
  repo: string;
  sessionTitle: string;
  sessionMode: TaskSessionMode;
  tool: string;
  goal: string;
  status: TaskStatus;
  sessionId?: string;     // AoE session ID (set when session is created)
  createdAt?: number;
  lastProgressAt?: number;
  completedAt?: number;
  progress: TaskProgress[];
}

// validate an unknown value (e.g. from JSON.parse) as a TaskState, returning null if invalid
export function toTaskState(raw: unknown): TaskState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.repo !== "string" || !r.repo) return null;
  if (typeof r.sessionTitle !== "string") return null;
  if (typeof r.tool !== "string") return null;
  if (typeof r.goal !== "string") return null;
  if (typeof r.status !== "string" || !VALID_TASK_STATUSES.has(r.status as TaskStatus)) return null;
  if (!Array.isArray(r.progress)) return null;
  return {
    repo: r.repo,
    sessionTitle: r.sessionTitle,
    sessionMode: r.sessionMode === "existing" || r.sessionMode === "new" ? r.sessionMode : "auto",
    tool: r.tool,
    goal: r.goal,
    status: r.status as TaskStatus,
    sessionId: typeof r.sessionId === "string" ? r.sessionId : undefined,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : undefined,
    lastProgressAt: typeof r.lastProgressAt === "number" ? r.lastProgressAt : undefined,
    completedAt: typeof r.completedAt === "number" ? r.completedAt : undefined,
    progress: r.progress.filter(
      (p: unknown): p is TaskProgress =>
        !!p && typeof p === "object" &&
        typeof (p as Record<string, unknown>).at === "number" &&
        typeof (p as Record<string, unknown>).summary === "string"
    ),
  };
}

// validate an unknown value as a DaemonState, returning null if invalid
export function toDaemonState(raw: unknown): DaemonState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tickStartedAt !== "number") return null;
  if (typeof r.nextTickAt !== "number") return null;
  if (typeof r.pollIntervalMs !== "number") return null;
  if (typeof r.phase !== "string") return null;
  if (typeof r.phaseStartedAt !== "number") return null;
  if (typeof r.pollCount !== "number") return null;
  if (typeof r.paused !== "boolean") return null;
  if (typeof r.sessionCount !== "number") return null;
  if (typeof r.changeCount !== "number") return null;
  if (!Array.isArray(r.sessions)) return null;
  return raw as DaemonState;
}

// validate an unknown array as an AoE session list (from `aoe list --json`)
export function toAoeSessionList(raw: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is { id: string; title: string } =>
      !!item && typeof item === "object" &&
      typeof (item as Record<string, unknown>).id === "string" &&
      typeof (item as Record<string, unknown>).title === "string"
  );
}

// validate a string as a ReasonerBackend, throwing on invalid input
const VALID_REASONER_BACKENDS = new Set<ReasonerBackend>(["opencode", "claude-code"]);
export function toReasonerBackend(raw: string): ReasonerBackend {
  if (VALID_REASONER_BACKENDS.has(raw as ReasonerBackend)) return raw as ReasonerBackend;
  throw new Error(`--reasoner must be "opencode" or "claude-code", got "${raw}"`);
}

// runtime validator for action log JSONL entries (replaces unsafe `as` casts)
export interface ActionLogEntry {
  timestamp: number;
  action: { action: string; session?: string; text?: string; title?: string };
  success: boolean;
  detail: string;
}

export function toActionLogEntry(raw: unknown): ActionLogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.timestamp !== "number") return null;
  if (typeof obj.success !== "boolean") return null;
  if (typeof obj.detail !== "string") obj.detail = "";
  if (!obj.action || typeof obj.action !== "object") return null;
  const action = obj.action as Record<string, unknown>;
  if (typeof action.action !== "string") return null;
  return {
    timestamp: obj.timestamp,
    action: {
      action: action.action,
      session: typeof action.session === "string" ? action.session : undefined,
      text: typeof action.text === "string" ? action.text : undefined,
      title: typeof action.title === "string" ? action.title : undefined,
    },
    success: obj.success,
    detail: typeof obj.detail === "string" ? obj.detail : "",
  };
}
