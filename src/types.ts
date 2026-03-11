// known session status values from AoE CLI + internal states
export type AoeSessionStatus = "working" | "running" | "idle" | "waiting" | "done" | "error" | "stopped" | "unknown";

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
}

// daemon state written to ~/.aoaoe/daemon-state.json for chat UI IPC
export type DaemonPhase = "sleeping" | "polling" | "reasoning" | "executing" | "interrupted";

export interface DaemonSessionState {
  id: string;
  title: string;
  tool: string;
  status: AoeSessionStatus;
  currentTask?: string; // last send_input text sent to this session
  lastActivity?: string; // last non-empty line of output
  todoSummary?: string; // formatted OpenCode-style TODO list parsed from pane output
  userActive?: boolean; // true if a human user is interacting with this tmux pane
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

// user-defined task: "work on this repo"
export interface TaskDefinition {
  repo: string;          // relative path from cwd (e.g. "github/adventure")
  tool?: string;         // AoE tool name (default: "opencode")
  goal?: string;         // what to accomplish (default: read from claude.md roadmap)
}

// a single progress entry (persists even after session cleanup)
export interface TaskProgress {
  at: number;            // timestamp
  summary: string;       // what was accomplished
}

export type TaskStatus = "pending" | "active" | "completed" | "paused" | "failed";

// persistent state for a task — survives session creation and teardown
export interface TaskState {
  repo: string;
  sessionTitle: string;
  tool: string;
  goal: string;
  status: TaskStatus;
  sessionId?: string;     // AoE session ID (set when session is created)
  createdAt?: number;
  lastProgressAt?: number;
  completedAt?: number;
  progress: TaskProgress[];
}
