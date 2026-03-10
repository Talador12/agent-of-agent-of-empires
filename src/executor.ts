import { exec, execQuiet } from "./shell.js";
import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Action, AoaoeConfig, SessionSnapshot } from "./types.js";
import { setSessionTask } from "./daemon-state.js";

const LOG_DIR = join(homedir(), ".aoaoe");
const LOG_FILE = join(LOG_DIR, "actions.log");
const LOG_MAX_BYTES = 1_048_576; // 1 MB — rotate when exceeded

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
      // normalize through resolver so title-based and ID-based references
      // hit the same rate limit bucket
      if ("session" in action && action.session) {
        const resolvedId = this.resolveSessionId(action.session, snapshots);
        if (this.isRateLimited(resolvedId)) {
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
    const resolvedId = this.resolveSessionId(sessionId, snapshots);
    this.markAction(resolvedId);

    // track as current task for this session
    if (ok) setSessionTask(resolvedId, text);

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

  // normalize a session reference (could be ID, prefix, or title) to the
  // canonical session ID so rate limiting uses consistent keys
  private resolveSessionId(ref: string, snapshots: SessionSnapshot[]): string {
    const exact = snapshots.find((s) => s.session.id === ref);
    if (exact) return exact.session.id;

    const prefix = snapshots.find((s) => s.session.id.startsWith(ref));
    if (prefix) return prefix.session.id;

    const byTitle = snapshots.find(
      (s) => s.session.title.toLowerCase() === ref.toLowerCase()
    );
    if (byTitle) return byTitle.session.id;

    return ref; // fallback: use as-is
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
    // rotate when file exceeds LOG_MAX_BYTES (rename to .log.old, start fresh)
    if (action.action !== "wait") {
      try {
        this.rotateLogIfNeeded();
        appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
      } catch {} // best-effort, don't crash the daemon
    }

    return entry;
  }

  // rotate actions.log when it exceeds 1MB — rename to .log.old and start fresh
  private rotateLogIfNeeded(): void {
    try {
      const st = statSync(LOG_FILE);
      if (st.size > LOG_MAX_BYTES) {
        renameSync(LOG_FILE, LOG_FILE + ".old");
      }
    } catch {
      // file doesn't exist yet or stat failed — nothing to rotate
    }
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
