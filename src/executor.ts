import { exec, execQuiet } from "./shell.js";
import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import type { Action, AoaoeConfig, SessionSnapshot } from "./types.js";
import { setSessionTask } from "./daemon-state.js";
import type { TaskManager } from "./task-manager.js";

// known valid AoE tool names — used to validate create_agent tool field
export const VALID_TOOLS = new Set([
  "opencode", "claude-code", "cursor", "windsurf", "aider", "codex", "cline",
]);

const LOG_DIR = join(homedir(), ".aoaoe");
const LOG_FILE = join(LOG_DIR, "actions.log");
const LOG_MAX_BYTES = 1_048_576; // 1 MB — rotate when exceeded

// permission approvals (Enter-only) get a much shorter cooldown since OpenCode
// has multi-step permission flows (mkdir → dir access → edit → run) that each
// need a separate Enter. 30s between steps would take 2+ minutes per agent.
export const PERMISSION_COOLDOWN_MS = 1_500;

export class Executor {
  private config: AoaoeConfig;
  private actionLog: ActionLogEntry[] = [];
  private recentActions: Map<string, number> = new Map(); // session -> last action timestamp
  private lastActionWasPermission: Map<string, boolean> = new Map(); // session -> was last action a permission approval
  private taskManager?: TaskManager; // optional — set when tasks are loaded

  constructor(config: AoaoeConfig) {
    this.config = config;
    // ensure log dir exists
    try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}
  }

  setTaskManager(tm: TaskManager): void {
    this.taskManager = tm;
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
    // session protection gate: block all actions targeting protected sessions
    if ("session" in action && action.session) {
      const snap = this.resolveSession(action.session, snapshots);
      if (snap && this.isProtected(snap.session.title)) {
        return this.logAction(
          action,
          false,
          `blocked: session "${snap.session.title}" is protected (observe-only)`
        );
      }
    }

    // destructive action gate: block remove_agent and stop_session unless explicitly allowed
    if ((action.action === "remove_agent" || action.action === "stop_session") && !this.config.policies.allowDestructive) {
      return this.logAction(
        action,
        false,
        `blocked: ${action.action} requires policies.allowDestructive=true in config`
      );
    }

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

      case "report_progress":
        return this.reportProgress(action.session, action.summary, snapshots);

      case "complete_task":
        return this.completeTask(action.session, action.summary, snapshots);

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
    // user activity guard: refuse to send input when a human is interacting
    const snap = this.resolveSession(sessionId, snapshots);
    if (snap?.userActive) {
      return this.logAction(
        { action: "send_input", session: sessionId, text },
        false,
        `skipped: user active in ${snap.session.title} — will not interfere`
      );
    }

    // resolve tmux session name from session ID
    const tmuxName = this.resolveTmuxName(sessionId, snapshots);
    if (!tmuxName) {
      return this.logAction(
        { action: "send_input", session: sessionId, text },
        false,
        `could not resolve tmux name for session ${sessionId}`
      );
    }

    // permission-approve shorthand: empty text or Enter-only means "press Enter"
    // to confirm the default selection on OpenCode/Claude Code permission prompts.
    // the LLM returns empty text when it wants to press Enter without typing anything.
    const isEnterOnly = !text.trim();

    if (isEnterOnly) {
      // send bare Enter (no literal text) to confirm permission prompts
      const enterOk = await execQuiet("tmux", ["send-keys", "-t", tmuxName, "Enter"]);
      const resolvedId = this.resolveSessionId(sessionId, snapshots);
      if (enterOk) {
        this.markAction(resolvedId, true); // permission = true -> fast cooldown
        setSessionTask(resolvedId, "(approved permission prompt)");
      }
      return this.logAction(
        { action: "send_input", session: sessionId, text: "(Enter)" },
        enterOk,
        enterOk ? `sent Enter to ${tmuxName}` : `send-keys Enter failed for ${tmuxName}`
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

    // only mark action (trigger cooldown) on success — failed sends should be retryable
    if (ok) {
      this.markAction(resolvedId);
      setSessionTask(resolvedId, sendText);
    }

    return this.logAction(
      { action: "send_input", session: sessionId, text },
      ok,
      ok ? `sent to ${tmuxName}` : `send-keys failed for ${tmuxName}`
    );
  }

  private async startSession(sessionId: string, snapshots: SessionSnapshot[] = []): Promise<ActionLogEntry> {
    const resolvedId = this.resolveSessionId(sessionId, snapshots);
    const result = await exec("aoe", ["session", "start", resolvedId]);

    // only mark action (trigger cooldown) on success — failed starts should be retryable
    if (result.exitCode === 0) this.markAction(resolvedId);

    return this.logAction(
      { action: "start_session", session: sessionId },
      result.exitCode === 0,
      result.exitCode === 0 ? "started" : result.stderr.trim()
    );
  }

  private async stopSession(sessionId: string, snapshots: SessionSnapshot[] = []): Promise<ActionLogEntry> {
    const resolvedId = this.resolveSessionId(sessionId, snapshots);
    const result = await exec("aoe", ["session", "stop", resolvedId]);

    // only mark action (trigger cooldown) on success — failed stops should be retryable
    if (result.exitCode === 0) this.markAction(resolvedId);

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
    } catch (e) {
      console.error(`[executor] statSync failed for create_agent path ${path}: ${e}`);
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

    // only mark rate limit on success — failed creates should be retryable
    if (result.exitCode === 0) this.markAction(`create:${title.toLowerCase()}`);

    return this.logAction(
      { action: "create_agent", path, title, tool },
      result.exitCode === 0,
      result.exitCode === 0 ? "created" : result.stderr.trim()
    );
  }

  private async removeAgent(sessionId: string, snapshots: SessionSnapshot[] = []): Promise<ActionLogEntry> {
    const resolvedId = this.resolveSessionId(sessionId, snapshots);
    const result = await exec("aoe", ["remove", resolvedId, "-y"]);

    // only mark action (trigger cooldown) on success — failed removes should be retryable
    if (result.exitCode === 0) this.markAction(resolvedId);

    return this.logAction(
      { action: "remove_agent", session: sessionId },
      result.exitCode === 0,
      result.exitCode === 0 ? "removed" : result.stderr.trim()
    );
  }

  private async reportProgress(
    sessionId: string,
    summary: string,
    snapshots: SessionSnapshot[]
  ): Promise<ActionLogEntry> {
    if (!this.taskManager) {
      return this.logAction(
        { action: "report_progress", session: sessionId, summary },
        false,
        "no task manager configured"
      );
    }
    const snap = this.resolveSession(sessionId, snapshots);
    const title = snap?.session.title ?? sessionId;
    this.taskManager.reportProgress(title, summary);
    return this.logAction(
      { action: "report_progress", session: sessionId, summary },
      true,
      `progress recorded for ${title}`
    );
  }

  private async completeTask(
    sessionId: string,
    summary: string,
    snapshots: SessionSnapshot[]
  ): Promise<ActionLogEntry> {
    if (!this.taskManager) {
      return this.logAction(
        { action: "complete_task", session: sessionId, summary },
        false,
        "no task manager configured"
      );
    }
    const snap = this.resolveSession(sessionId, snapshots);
    const title = snap?.session.title ?? sessionId;
    await this.taskManager.completeTask(title, summary);
    return this.logAction(
      { action: "complete_task", session: sessionId, summary },
      true,
      `task completed for ${title}: ${summary}`
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

  // check if a session title is in the protectedSessions list (case-insensitive)
  private isProtected(title: string): boolean {
    const list = this.config.protectedSessions;
    if (!list || list.length === 0) return false;
    const lower = title.toLowerCase();
    return list.some((p) => p.toLowerCase() === lower);
  }

  private get cooldownMs(): number {
    return this.config.policies.actionCooldownMs ?? 30_000;
  }

  // rate limiting: don't act on the same session within the cooldown window.
  // permission approvals use a much shorter cooldown (1.5s) since OpenCode has
  // multi-step permission flows that each need a separate Enter.
  private isRateLimited(sessionId: string): boolean {
    const last = this.recentActions.get(sessionId);
    if (!last) return false;
    const wasPermission = this.lastActionWasPermission.get(sessionId) ?? false;
    const cooldown = wasPermission ? PERMISSION_COOLDOWN_MS : this.cooldownMs;
    return Date.now() - last < cooldown;
  }

  private markAction(sessionId: string, isPermission = false) {
    this.recentActions.set(sessionId, Date.now());
    this.lastActionWasPermission.set(sessionId, isPermission);
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
      } catch (e) { console.error(`[executor] action log write failed: ${e}`); } // best-effort, don't crash the daemon
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
