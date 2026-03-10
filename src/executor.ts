import { exec, execQuiet } from "./shell.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Action, AoaoeConfig, SessionSnapshot } from "./types.js";
import { setSessionTask } from "./daemon-state.js";

const LOG_DIR = join(homedir(), ".aoaoe");
const LOG_FILE = join(LOG_DIR, "actions.log");

export class Executor {
  private config: AoaoeConfig;
  private actionLog: ActionLogEntry[] = [];
  private recentActions: Map<string, number> = new Map(); // session -> last action timestamp

  constructor(config: AoaoeConfig) {
    this.config = config;
    // ensure log dir exists
    try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}
  }

  async execute(
    actions: Action[],
    snapshots: SessionSnapshot[]
  ): Promise<ActionLogEntry[]> {
    const results: ActionLogEntry[] = [];

    for (const action of actions) {
      // rate limit: don't hammer the same session
      if ("session" in action && action.session) {
        if (this.isRateLimited(action.session)) {
          const entry = this.logAction(action, false, "rate limited (too soon)");
          results.push(entry);
          continue;
        }
      }

      const entry = await this.executeOne(action, snapshots);
      results.push(entry);
    }

    return results;
  }

  private async executeOne(
    action: Action,
    snapshots: SessionSnapshot[]
  ): Promise<ActionLogEntry> {
    switch (action.action) {
      case "send_input":
        return this.sendInput(action.session, action.text, snapshots);

      case "start_session":
        return this.startSession(action.session);

      case "stop_session":
        return this.stopSession(action.session);

      case "create_agent":
        return this.createAgent(action.path, action.title, action.tool);

      case "remove_agent":
        return this.removeAgent(action.session);

      case "wait":
        return this.logAction(action, true, action.reason ?? "no action needed");

      default:
        return this.logAction(action, false, "unknown action type");
    }
  }

  private async sendInput(
    sessionId: string,
    text: string,
    snapshots: SessionSnapshot[]
  ): Promise<ActionLogEntry> {
    // resolve tmux session name from session ID
    const tmuxName = this.resolveTmuxName(sessionId, snapshots);
    if (!tmuxName) {
      return this.logAction(
        { action: "send_input", session: sessionId, text },
        false,
        `could not resolve tmux name for session ${sessionId}`
      );
    }

    // safety: refuse empty or whitespace-only input
    if (!text.trim()) {
      return this.logAction(
        { action: "send_input", session: sessionId, text },
        false,
        "refusing to send empty input"
      );
    }

    // tmux send-keys: -l for literal text (prevents control sequence injection from LLM),
    // then a separate send-keys for Enter (which must NOT be literal)
    const textOk = await execQuiet("tmux", ["send-keys", "-t", tmuxName, "-l", text]);
    const enterOk = textOk ? await execQuiet("tmux", ["send-keys", "-t", tmuxName, "Enter"]) : false;
    const ok = textOk && enterOk;
    this.markAction(sessionId);

    // track as current task for this session
    if (ok) setSessionTask(sessionId, text);

    return this.logAction(
      { action: "send_input", session: sessionId, text },
      ok,
      ok ? `sent to ${tmuxName}` : `send-keys failed for ${tmuxName}`
    );
  }

  private async startSession(sessionId: string): Promise<ActionLogEntry> {
    const result = await exec("aoe", ["session", "start", sessionId]);
    this.markAction(sessionId);

    return this.logAction(
      { action: "start_session", session: sessionId },
      result.exitCode === 0,
      result.exitCode === 0 ? "started" : result.stderr.trim()
    );
  }

  private async stopSession(sessionId: string): Promise<ActionLogEntry> {
    const result = await exec("aoe", ["session", "stop", sessionId]);
    this.markAction(sessionId);

    return this.logAction(
      { action: "stop_session", session: sessionId },
      result.exitCode === 0,
      result.exitCode === 0 ? "stopped" : result.stderr.trim()
    );
  }

  private async createAgent(
    path: string,
    title: string,
    tool: string
  ): Promise<ActionLogEntry> {
    const args = ["add", path, "-t", title, "-c", tool, "-y"]; // -y for yolo mode
    const result = await exec("aoe", args);

    return this.logAction(
      { action: "create_agent", path, title, tool },
      result.exitCode === 0,
      result.exitCode === 0 ? "created" : result.stderr.trim()
    );
  }

  private async removeAgent(sessionId: string): Promise<ActionLogEntry> {
    const result = await exec("aoe", ["remove", sessionId, "-y"]);
    this.markAction(sessionId);

    return this.logAction(
      { action: "remove_agent", session: sessionId },
      result.exitCode === 0,
      result.exitCode === 0 ? "removed" : result.stderr.trim()
    );
  }

  private resolveTmuxName(
    sessionId: string,
    snapshots: SessionSnapshot[]
  ): string | null {
    // try exact match first
    const exact = snapshots.find((s) => s.session.id === sessionId);
    if (exact?.session.tmux_name) return exact.session.tmux_name;

    // try prefix match (reasoner might return truncated IDs)
    const prefix = snapshots.find((s) => s.session.id.startsWith(sessionId));
    if (prefix?.session.tmux_name) return prefix.session.tmux_name;

    // try title match
    const byTitle = snapshots.find(
      (s) => s.session.title.toLowerCase() === sessionId.toLowerCase()
    );
    if (byTitle?.session.tmux_name) return byTitle.session.tmux_name;

    return null;
  }

  // rate limiting: don't act on the same session more than once per 30s
  private isRateLimited(sessionId: string): boolean {
    const last = this.recentActions.get(sessionId);
    if (!last) return false;
    return Date.now() - last < 30_000;
  }

  private markAction(sessionId: string) {
    this.recentActions.set(sessionId, Date.now());
  }

  private logAction(action: Action, success: boolean, detail: string): ActionLogEntry {
    const entry: ActionLogEntry = {
      timestamp: Date.now(),
      action,
      success,
      detail,
    };
    this.actionLog.push(entry);

    // keep in-memory log bounded
    if (this.actionLog.length > 1000) {
      this.actionLog = this.actionLog.slice(-500);
    }

    // persist to ~/.aoaoe/actions.log (JSONL, one entry per line)
    if (action.action !== "wait") {
      try {
        appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
      } catch {} // best-effort, don't crash the daemon
    }

    return entry;
  }

  getRecentLog(n = 20): ActionLogEntry[] {
    return this.actionLog.slice(-n);
  }
}

export interface ActionLogEntry {
  timestamp: number;
  action: Action;
  success: boolean;
  detail: string;
}
