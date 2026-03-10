import { exec, execQuiet } from "./shell.js";
import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { Action, AoaoeConfig, SessionSnapshot } from "./types.js";
import { setSessionTask } from "./daemon-state.js";

// known valid AoE tool names — used to validate create_agent tool field
export const VALID_TOOLS = new Set([
  "opencode", "claude-code", "cursor", "windsurf", "aider", "codex", "cline",
]);

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
      // rate limit: don't hammer the same session (or create_agent spam)
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
      // rate limit create_agent by title to prevent LLM from spamming agent creation
      if (action.action === "create_agent") {
        const bucket = `create:${action.title?.toLowerCase() ?? "unknown"}`;
        if (this.isRateLimited(bucket)) {
          const entry = this.logAction(action, false, "rate limited (create_agent too soon)");
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
        return this.startSession(action.session, snapshots);

      case "stop_session":
        return this.stopSession(action.session, snapshots);

      case "create_agent":
        return this.createAgent(action.path, action.title, action.tool);

      case "remove_agent":
        return this.removeAgent(action.session, snapshots);

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

    // safety: cap text length to prevent overwhelming the target agent's input buffer
    const MAX_INPUT_LENGTH = 4096;
    let sendText = text;
    if (sendText.length > MAX_INPUT_LENGTH) {
      sendText = sendText.slice(0, MAX_INPUT_LENGTH);
      this.log(`truncated send_input text to ${MAX_INPUT_LENGTH} chars for session ${sessionId}`);
    }

    // tmux send-keys: -l for literal text (prevents control sequence injection from LLM),
    // then a separate send-keys for Enter (which must NOT be literal)
    const textOk = await execQuiet("tmux", ["send-keys", "-t", tmuxName, "-l", sendText]);
    const enterOk = textOk ? await execQuiet("tmux", ["send-keys", "-t", tmuxName, "Enter"]) : false;
    const ok = textOk && enterOk;
    const resolvedId = this.resolveSessionId(sessionId, snapshots);
    this.markAction(resolvedId);

    // track as current task for this session
    if (ok) setSessionTask(resolvedId, sendText);

    return this.logAction(
      { action: "send_input", session: sessionId, text },
      ok,
      ok ? `sent to ${tmuxName}` : `send-keys failed for ${tmuxName}`
    );
  }

  private async startSession(sessionId: string, snapshots: SessionSnapshot[] = []): Promise<ActionLogEntry> {
    const resolvedId = this.resolveSessionId(sessionId, snapshots);
    const result = await exec("aoe", ["session", "start", resolvedId]);
    this.markAction(resolvedId);

    return this.logAction(
      { action: "start_session", session: sessionId },
      result.exitCode === 0,
      result.exitCode === 0 ? "started" : result.stderr.trim()
    );
  }

  private async stopSession(sessionId: string, snapshots: SessionSnapshot[] = []): Promise<ActionLogEntry> {
    const resolvedId = this.resolveSessionId(sessionId, snapshots);
    const result = await exec("aoe", ["session", "stop", resolvedId]);
    this.markAction(resolvedId);

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
    // validate path exists as a directory
    if (!path || !existsSync(path)) {
      return this.logAction(
        { action: "create_agent", path, title, tool },
        false,
        `path does not exist: ${path}`
      );
    }
    try {
      if (!statSync(path).isDirectory()) {
        return this.logAction(
          { action: "create_agent", path, title, tool },
          false,
          `path is not a directory: ${path}`
        );
      }
    } catch {
      return this.logAction(
        { action: "create_agent", path, title, tool },
        false,
        `cannot stat path: ${path}`
      );
    }

    // validate tool name
    if (!tool || !VALID_TOOLS.has(tool.toLowerCase())) {
      return this.logAction(
        { action: "create_agent", path, title, tool },
        false,
        `unknown tool "${tool}", expected one of: ${[...VALID_TOOLS].join(", ")}`
      );
    }

    const args = ["add", path, "-t", title, "-c", tool, "-y"]; // -y for yolo mode
    const result = await exec("aoe", args);

    // mark rate limit under title bucket
    this.markAction(`create:${title.toLowerCase()}`);

    return this.logAction(
      { action: "create_agent", path, title, tool },
      result.exitCode === 0,
      result.exitCode === 0 ? "created" : result.stderr.trim()
    );
  }

  private async removeAgent(sessionId: string, snapshots: SessionSnapshot[] = []): Promise<ActionLogEntry> {
    const resolvedId = this.resolveSessionId(sessionId, snapshots);
    const result = await exec("aoe", ["remove", resolvedId, "-y"]);
    this.markAction(resolvedId);

    return this.logAction(
      { action: "remove_agent", session: sessionId },
      result.exitCode === 0,
      result.exitCode === 0 ? "removed" : result.stderr.trim()
    );
  }

  // resolve a session reference (exact ID, prefix, or title) to the matching snapshot
  // single source of truth for session resolution — both tmux name and ID derive from this
  private resolveSession(ref: string, snapshots: SessionSnapshot[]): SessionSnapshot | null {
    // try exact ID match first
    const exact = snapshots.find((s) => s.session.id === ref);
    if (exact) return exact;

    // try prefix match (reasoner might return truncated IDs)
    const prefix = snapshots.find((s) => s.session.id.startsWith(ref));
    if (prefix) return prefix;

    // try title match (case-insensitive)
    const byTitle = snapshots.find(
      (s) => s.session.title.toLowerCase() === ref.toLowerCase()
    );
    if (byTitle) return byTitle;

    return null;
  }

  private resolveTmuxName(sessionId: string, snapshots: SessionSnapshot[]): string | null {
    return this.resolveSession(sessionId, snapshots)?.session.tmux_name ?? null;
  }

  private resolveSessionId(ref: string, snapshots: SessionSnapshot[]): string {
    return this.resolveSession(ref, snapshots)?.session.id ?? ref;
  }

  private get cooldownMs(): number {
    return this.config.policies.actionCooldownMs ?? 30_000;
  }

  // rate limiting: don't act on the same session within the cooldown window
  private isRateLimited(sessionId: string): boolean {
    const last = this.recentActions.get(sessionId);
    if (!last) return false;
    return Date.now() - last < this.cooldownMs;
  }

  private markAction(sessionId: string) {
    this.recentActions.set(sessionId, Date.now());
    this.pruneStaleActions();
  }

  // remove entries older than 2x cooldown to prevent unbounded growth
  private pruneStaleActions() {
    const cutoff = Date.now() - this.cooldownMs * 2;
    for (const [key, ts] of this.recentActions) {
      if (ts < cutoff) this.recentActions.delete(key);
    }
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

  private log(msg: string) {
    console.error(`[executor] ${msg}`);
  }
}

export interface ActionLogEntry {
  timestamp: number;
  action: Action;
  success: boolean;
  detail: string;
}
