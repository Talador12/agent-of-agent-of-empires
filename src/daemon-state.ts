// daemon-state.ts -- shared state file for IPC between daemon and chat UI
// the daemon writes this file each time its phase changes;
// chat.ts reads it on a 1-second interval to display countdown + session tasks.
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DaemonState, DaemonPhase, DaemonSessionState, Observation } from "./types.js";
import { parseTasks, formatTaskList } from "./task-parser.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const STATE_FILE = join(AOAOE_DIR, "daemon-state.json");
const INTERRUPT_FILE = join(AOAOE_DIR, "interrupt");
const LOCK_FILE = join(AOAOE_DIR, "daemon.lock");

// cache: only mkdirSync once per process (no need to stat the dir on every phase change)
let dirEnsured = false;
function ensureDir(): void {
  if (dirEnsured) return;
  mkdirSync(AOAOE_DIR, { recursive: true });
  dirEnsured = true;
}

const INITIAL_STATE: DaemonState = {
  tickStartedAt: 0,
  nextTickAt: 0,
  pollIntervalMs: 10_000,
  phase: "sleeping",
  phaseStartedAt: 0,
  pollCount: 0,
  paused: false,
  sessionCount: 0,
  changeCount: 0,
  sessions: [],
};

let currentState: DaemonState = { ...INITIAL_STATE, phaseStartedAt: Date.now() };

// reset module-level state (for test isolation)
export function resetInternalState(): void {
  currentState = { ...INITIAL_STATE, phaseStartedAt: Date.now() };
}

// track last task sent to each session (persists across ticks)
const sessionTasks = new Map<string, string>();
// cache parsed TODO summaries for unchanged sessions
const todoCache = new Map<string, string | undefined>();

export function setSessionTask(sessionId: string, task: string): void {
  // keep task text short for display
  sessionTasks.set(sessionId, task.length > 80 ? task.slice(0, 77) + "..." : task);
}

export function writeState(
  phase: DaemonPhase,
  updates: Partial<Omit<DaemonState, "phase" | "phaseStartedAt">> = {}
): void {
  currentState = {
    ...currentState,
    ...updates,
    phase,
    phaseStartedAt: Date.now(),
  };
  try {
    ensureDir();
    writeFileSync(STATE_FILE, JSON.stringify(currentState) + "\n");
  } catch {
    // best-effort, don't crash the daemon
  }
}

// build session state list from an observation, merging in tracked tasks + parsed TODOs
export function buildSessionStates(obs: Observation): DaemonSessionState[] {
  const currentIds = new Set(obs.sessions.map((s) => s.session.id));

  // prune stale entries for sessions that no longer exist
  for (const id of sessionTasks.keys()) {
    if (!currentIds.has(id)) sessionTasks.delete(id);
  }

  // only re-parse TODO items for sessions that have new output
  const changedIds = new Set(obs.changes.map((c) => c.sessionId));

  return obs.sessions.map((snap) => {
    const s = snap.session;
    // extract last non-empty line from output as "last activity"
    const lines = snap.output.split("\n").filter((l) => l.trim());
    const lastActivity = lines.length > 0 ? lines[lines.length - 1].trim() : undefined;
    // parse OpenCode-style TODO items from pane output (skip unchanged sessions)
    let todoSummary: string | undefined;
    if (changedIds.has(s.id)) {
      const todos = parseTasks(snap.output);
      todoSummary = todos.length > 0 ? formatTaskList(todos) : undefined;
      todoCache.set(s.id, todoSummary);
    } else {
      todoSummary = todoCache.get(s.id);
    }
    return {
      id: s.id,
      title: s.title,
      tool: s.tool,
      status: s.status,
      currentTask: sessionTasks.get(s.id),
      lastActivity: lastActivity && lastActivity.length > 100
        ? lastActivity.slice(0, 97) + "..."
        : lastActivity,
      todoSummary,
      userActive: snap.userActive ?? false,
    };
  });
}

export function readState(): DaemonState | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as DaemonState;
  } catch {
    return null;
  }
}

// interrupt flag file -- chat.ts creates this, daemon checks + removes it
export function requestInterrupt(): void {
  try {
    ensureDir();
    writeFileSync(INTERRUPT_FILE, String(Date.now()));
  } catch {
    // best-effort
  }
}

export function checkInterrupt(): boolean {
  try {
    return existsSync(INTERRUPT_FILE);
  } catch {
    return false;
  }
}

export function clearInterrupt(): void {
  try {
    unlinkSync(INTERRUPT_FILE);
  } catch {
    // ENOENT is expected (file already gone), other errors are best-effort
  }
}

export function cleanupState(): void {
  try {
    unlinkSync(STATE_FILE);
  } catch {
    // ENOENT is expected
  }
  clearInterrupt();
  releaseLock();
}

// ── Daemon lock file ────────────────────────────────────────────────────────
// prevents two daemons from running simultaneously (race condition on sessions)

export function acquireLock(): { acquired: boolean; existingPid?: number } {
  ensureDir();
  try {
    if (existsSync(LOCK_FILE)) {
      const content = readFileSync(LOCK_FILE, "utf-8").trim();
      const pid = parseInt(content, 10);
      if (!isNaN(pid) && isProcessRunning(pid)) {
        return { acquired: false, existingPid: pid };
      }
      // stale lock file — previous daemon crashed without cleanup
      unlinkSync(LOCK_FILE);
    }
    writeFileSync(LOCK_FILE, String(process.pid));
    return { acquired: true };
  } catch {
    return { acquired: false };
  }
}

export function releaseLock(): void {
  try {
    // only remove if we own the lock (our PID)
    if (existsSync(LOCK_FILE)) {
      const content = readFileSync(LOCK_FILE, "utf-8").trim();
      if (content === String(process.pid)) {
        unlinkSync(LOCK_FILE);
      }
    }
  } catch {
    // best-effort
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, doesn't kill
    return true;
  } catch {
    return false; // ESRCH = process doesn't exist
  }
}
