// session snapshot from aoe status --json + tmux capture
export interface AoeSession {
  id: string;
  title: string;
  path: string;
  tool: string;
  status: string; // "working" | "idle" | "waiting" | "done" | "error" | "stopped"
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
}

export interface Observation {
  timestamp: number;
  sessions: SessionSnapshot[];
  changes: SessionChange[]; // only sessions with new output since last poll
  userMessage?: string; // optional human operator message injected via stdin
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
  status: string;
  newLines: string; // lines that appeared since last capture
}

// actions the reasoner can return
export type Action =
  | { action: "send_input"; session: string; text: string }
  | { action: "start_session"; session: string }
  | { action: "stop_session"; session: string }
  | { action: "create_agent"; path: string; title: string; tool: string }
  | { action: "remove_agent"; session: string }
  | { action: "wait"; reason?: string };

export interface ReasonerResult {
  actions: Action[];
  reasoning?: string; // optional explanation from the LLM
}

// reasoner backend interface
export interface Reasoner {
  init(): Promise<void>;
  decide(observation: Observation): Promise<ReasonerResult>;
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
  };
  contextFiles: string[]; // extra AI instruction file paths to load (relative to project root)
  captureLinesCount: number; // how many lines to capture from each tmux pane
  verbose: boolean;
  dryRun: boolean; // observe + reason but don't execute; log what would happen
}

// daemon state written to ~/.aoaoe/daemon-state.json for chat UI IPC
export type DaemonPhase = "sleeping" | "polling" | "reasoning" | "executing" | "interrupted";

export interface DaemonSessionState {
  id: string;
  title: string;
  tool: string;
  status: string;
  currentTask?: string; // last send_input text sent to this session
  lastActivity?: string; // last non-empty line of output
  todoSummary?: string; // formatted OpenCode-style TODO list parsed from pane output
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
}
