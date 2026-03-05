// daemon-state.ts -- shared state file for IPC between daemon and chat UI
// the daemon writes this file each time its phase changes;
// chat.ts reads it on a 1-second interval to display countdown + session tasks.
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DaemonState, DaemonPhase, DaemonSessionState, Observation } from "./types.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const STATE_FILE = join(AOAOE_DIR, "daemon-state.json");
const INTERRUPT_FILE = join(AOAOE_DIR, "interrupt");

let currentState: DaemonState = {
  tickStartedAt: 0,
  nextTickAt: 0,
  pollIntervalMs: 10_000,
  phase: "sleeping",
  phaseStartedAt: Date.now(),
  pollCount: 0,
  paused: false,
  sessionCount: 0,
  changeCount: 0,
  sessions: [],
};

// track last task sent to each session (persists across ticks)
const sessionTasks = new Map<string, string>();

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
    mkdirSync(AOAOE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(currentState) + "\n");
  } catch {
    // best-effort, don't crash the daemon
  }
}

// build session state list from an observation, merging in tracked tasks
export function buildSessionStates(obs: Observation): DaemonSessionState[] {
  return obs.sessions.map((snap) => {
    const s = snap.session;
    // extract last non-empty line from output as "last activity"
    const lines = snap.output.split("\n").filter((l) => l.trim());
    const lastActivity = lines.length > 0 ? lines[lines.length - 1].trim() : undefined;
    return {
      id: s.id,
      title: s.title,
      tool: s.tool,
      status: s.status,
      currentTask: sessionTasks.get(s.id),
      lastActivity: lastActivity && lastActivity.length > 100
        ? lastActivity.slice(0, 97) + "..."
        : lastActivity,
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
    mkdirSync(AOAOE_DIR, { recursive: true });
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
    if (existsSync(INTERRUPT_FILE)) unlinkSync(INTERRUPT_FILE);
  } catch {
    // best-effort
  }
}

export function cleanupState(): void {
  try {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } catch {}
  clearInterrupt();
}
