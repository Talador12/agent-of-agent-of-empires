// ExecutorLike over the plugin API. Maps reasoner Actions onto the host
// primitives the plugin actually holds grants for, and refuses the rest with
// an explicit outcome so the boundary is visible instead of silent:
//
//   send_input    -> sessions.turn.send, only when allow_nudge is on AND the
//                    session is plugin-owned (the host enforces ownership too;
//                    checking here gives a clear reason instead of FORBIDDEN)
//   create_agent  -> sessions.create
//   everything else (start/stop/remove) -> blocked: the plugin API has no
//                    lifecycle primitives, and stop/remove are destructive —
//                    those stay recommendations for the human
//
// Cooldown state is updated as each action executes (not snapshotted before
// the batch), so two actions of one kind on one session in a single tick
// cannot both fire — the cooldown bug called out in the PR #2699 review.

import type { Action, SessionSnapshot } from "../types.js";
import type { ActionResult, ExecutorLike } from "../loop.js";
import type { HostClient } from "./host.js";
import type { PluginSettings } from "./settings.js";

export interface CooldownState {
  // "<sessionId>:<actionKind>" -> last executed at (Date.now())
  [key: string]: number;
}

export class PluginExecutor implements ExecutorLike {
  constructor(
    private readonly host: HostClient,
    private readonly getSettings: () => PluginSettings,
    private readonly ownedSessionIds: Set<string>,
    private readonly cooldowns: CooldownState = {}
  ) {}

  async execute(actions: Action[], snapshots: SessionSnapshot[]): Promise<ActionResult[]> {
    const settings = this.getSettings();
    const results: ActionResult[] = [];

    for (const action of actions) {
      results.push(await this.executeOne(action, snapshots, settings));
    }
    return results;
  }

  private async executeOne(action: Action, snapshots: SessionSnapshot[], settings: PluginSettings): Promise<ActionResult> {
    switch (action.action) {
      case "send_input": {
        const snap = resolveSession(action.session, snapshots);
        if (!snap) return fail(action, `unknown session "${action.session}"`);
        const sid = snap.session.id;
        if (!settings.allowNudge) {
          return fail(action, "nudges disabled (allow_nudge is off)");
        }
        if (!this.ownedSessionIds.has(sid)) {
          return fail(action, "session not created by the orchestrator; plugin API only delivers turns to own sessions");
        }
        const cd = this.checkCooldown(sid, "send_input", settings);
        if (cd) return fail(action, cd);
        try {
          await this.host.turnSend(sid, action.text);
          this.stampCooldown(sid, "send_input");
          return ok(action, `turn delivered to ${snap.session.title}`);
        } catch (err) {
          return fail(action, `turn.send failed: ${errMessage(err)}`);
        }
      }
      case "create_agent": {
        if (this.ownedSessionIds.size >= settings.maxActiveSessions) {
          return fail(action, `session pool full (${this.ownedSessionIds.size}/${settings.maxActiveSessions})`);
        }
        if (!settings.spawnAgent) {
          return fail(action, "no spawn_agent configured");
        }
        const cd = this.checkCooldown(action.title, "create_agent", settings);
        if (cd) return fail(action, cd);
        try {
          const res = await this.host.sessionsCreate({
            agent_id: settings.spawnAgent,
            project_path: action.path || settings.spawnProjectPath || undefined,
            model_id: settings.spawnModel || undefined,
            title: action.title,
          });
          if (res.session_id) this.ownedSessionIds.add(res.session_id);
          this.stampCooldown(action.title, "create_agent");
          return ok(action, `${res.created ? "created" : "already existed"}: ${res.session_id}`);
        } catch (err) {
          return fail(action, `sessions.create failed: ${errMessage(err)}`);
        }
      }
      case "start_session":
      case "stop_session":
      case "remove_agent":
        return fail(action, `${action.action} has no plugin API primitive; surfaced as a recommendation only`);
      case "report_progress":
      case "complete_task":
        // task bookkeeping is standalone-mode functionality; harmless no-op here
        return ok(action, "acknowledged (no task store in plugin mode)");
      case "wait":
        return ok(action, action.reason ?? "waiting");
    }
  }

  private checkCooldown(sessionKey: string, kind: string, settings: PluginSettings): string | null {
    const ms = settings.actionCooldownSecs * 1000;
    if (ms <= 0) return null;
    const key = `${sessionKey}:${kind}`;
    const last = this.cooldowns[key];
    if (last !== undefined && Date.now() - last < ms) {
      const remaining = Math.ceil((ms - (Date.now() - last)) / 1000);
      return `cooldown: ${kind} on ${sessionKey} for another ${remaining}s`;
    }
    return null;
  }

  private stampCooldown(sessionKey: string, kind: string): void {
    this.cooldowns[key(sessionKey, kind)] = Date.now();
  }
}

function key(sessionKey: string, kind: string): string {
  return `${sessionKey}:${kind}`;
}

/** Reasoners address sessions by title or id; accept either. */
function resolveSession(ref: string, snapshots: SessionSnapshot[]): SessionSnapshot | undefined {
  return snapshots.find((s) => s.session.id === ref || s.session.title === ref);
}

function ok(action: Action, detail: string): ActionResult {
  return { action, success: true, detail };
}

function fail(action: Action, detail: string): ActionResult {
  return { action, success: false, detail };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
