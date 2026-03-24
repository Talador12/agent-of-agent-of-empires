import { createHash } from "node:crypto";
import { exec } from "./shell.js";
import { loadSessionContext } from "./context.js";
import { getActivityForSessions } from "./activity.js";
import {
  toSessionStatus,
  type AoaoeConfig,
  type AoeSession,
  type AoeSessionStatus,
  type SessionSnapshot,
  type SessionChange,
  type Observation,
} from "./types.js";
import { resolveProfiles } from "./tui.js";

export class Poller {
  private config: AoaoeConfig;
  private previousSnapshots: Map<string, SessionSnapshot> = new Map();

  constructor(config: AoaoeConfig) {
    this.config = config;
  }

  async poll(): Promise<Observation> {
    const sessions = await this.listSessions();
    // use allSettled so one failing session doesn't lose all captures
    const results = await Promise.allSettled(
      sessions.map((s) => this.captureSession(s))
    );
    const snapshots = results
      .filter((r): r is PromiseFulfilledResult<SessionSnapshot> => r.status === "fulfilled")
      .map((r) => r.value);
    const failedCount = results.filter((r) => r.status === "rejected").length;
    if (failedCount > 0) {
      this.log(`${failedCount} session capture(s) failed, proceeding with ${snapshots.length}`);
    }

    // detect user activity in tmux panes (batch, parallel)
    const threshold = this.config.policies.userActivityThresholdMs ?? 30_000;
    if (snapshots.length > 0) {
      const tmuxNames = snapshots.map((s) => s.session.tmux_name);
      const activityMap = await getActivityForSessions(tmuxNames, threshold);
      for (const snap of snapshots) {
        const info = activityMap.get(snap.session.tmux_name);
        snap.userActive = info?.userActive ?? false;
      }
    }

    const changes = this.diffSnapshots(snapshots);
    const observation: Observation = {
      timestamp: Date.now(),
      sessions: snapshots,
      changes,
    };

    // store current snapshots for next diff
    this.previousSnapshots.clear();
    for (const snap of snapshots) {
      this.previousSnapshots.set(snap.session.id, snap);
    }

    return observation;
  }

  private async listSessions(): Promise<AoeSession[]> {
    // multi-profile: poll each configured profile and merge results.
    // sessions are deduped by ID (first occurrence wins across profiles).
    const profiles = resolveProfiles(this.config);
    const allRaw: Array<Record<string, unknown> & { _profile?: string }> = [];
    const seenIds = new Set<string>();

    for (const profile of profiles) {
      const args = buildProfileListArgs(profile);
      const result = await exec("aoe", args);
      if (result.exitCode !== 0) {
        this.log(`aoe list failed for profile '${profile}': ${result.stderr}`);
        continue;
      }
      try {
        const parsed = JSON.parse(result.stdout);
        const items = Array.isArray(parsed) ? parsed : [];
        for (const item of items) {
          const id = String(item.id ?? "");
          if (seenIds.has(id)) continue; // dedup across profiles
          seenIds.add(id);
          item._profile = profile;
          allRaw.push(item);
        }
      } catch (e) {
        this.log(`failed to parse aoe list output for profile '${profile}': ${e}`);
      }
    }

    const raw = allRaw;

    // fetch per-session status in parallel — use allSettled so one failing
    // getSessionStatus doesn't lose all sessions
    const statusResults = await Promise.allSettled(
      raw.map(async (s) => {
        const id = String(s.id ?? "");
        const title = String(s.title ?? "");
        const status = await this.getSessionStatus(id);
        return {
          id,
          title,
          path: String(s.path ?? ""),
          tool: String(s.tool ?? ""),
          status,
          tmux_name: computeTmuxName(id, title),
          group: s.group ? String(s.group) : undefined,
          created_at: s.created_at ? String(s.created_at) : undefined,
        };
      })
    );

    const sessions: AoeSession[] = [];
    let statusFailures = 0;
    for (let i = 0; i < statusResults.length; i++) {
      const r = statusResults[i];
      if (r.status === "fulfilled") {
        sessions.push(r.value);
      } else {
        statusFailures++;
        // still include the session with "unknown" status so it's not invisible
        const s = raw[i];
        const id = String(s.id ?? "");
        const title = String(s.title ?? "");
        sessions.push({
          id,
          title,
          path: String(s.path ?? ""),
          tool: String(s.tool ?? ""),
          status: "unknown",
          tmux_name: computeTmuxName(id, title),
          group: s.group ? String(s.group) : undefined,
          created_at: s.created_at ? String(s.created_at) : undefined,
        });
      }
    }
    if (statusFailures > 0) {
      this.log(`${statusFailures} session status fetch(es) failed, marked as "unknown"`);
    }

    return sessions;
  }

  private async getSessionStatus(id: string): Promise<AoeSessionStatus> {
    const result = await exec("aoe", ["session", "show", id, "--json"]);
    if (result.exitCode !== 0) return "unknown";
    try {
      const data = JSON.parse(result.stdout);
      return toSessionStatus(data.status);
    } catch (e) {
      console.error(`[poller] failed to parse session status for ${id}: ${e}`);
      return "unknown";
    }
  }

  private async captureSession(session: AoeSession): Promise<SessionSnapshot> {
    const output = await this.captureTmuxPane(session.tmux_name);
    const outputHash = quickHash(output);

    // load AI instruction files from session's project directory
    // auto-discovers AGENTS.md, claude.md, .cursorrules, etc. + user-configured extras
    // resolves the actual repo dir by matching session title against subdirectories
    // cached internally with 60s TTL so this is cheap on subsequent polls
    const extraFiles = this.config.contextFiles.length ? this.config.contextFiles : undefined;
    const sessionDirs = Object.keys(this.config.sessionDirs).length ? this.config.sessionDirs : undefined;
    const projectContext = loadSessionContext(session.path, session.title, extraFiles, sessionDirs) || undefined;

    return {
      session,
      output,
      outputHash,
      capturedAt: Date.now(),
      projectContext,
    };
  }

  private async captureTmuxPane(tmuxName: string): Promise<string> {
    if (!tmuxName) return "";

    const result = await exec("tmux", [
      "capture-pane",
      "-t",
      tmuxName,
      "-p", // print to stdout
      "-S",
      `-${this.config.captureLinesCount}`, // last N lines
    ]);

    if (result.exitCode !== 0) {
      // session might not exist in tmux (stopped, etc)
      this.log(`tmux capture failed for ${tmuxName}: exit ${result.exitCode} ${result.stderr.trim()}`);
      return "";
    }

    // strip ANSI escape codes then trim trailing blank lines that tmux pads
    return stripAnsi(result.stdout).replace(/\n+$/, "");
  }

  private diffSnapshots(current: SessionSnapshot[]): SessionChange[] {
    const changes: SessionChange[] = [];

    for (const snap of current) {
      const prev = this.previousSnapshots.get(snap.session.id);

      if (!prev) {
        // first poll for this session — show last 20 lines so the reasoner
        // can assess initial agent state instead of seeing "no changes"
        const lines = snap.output.split("\n");
        const tail = lines.slice(-20).join("\n").trim();
        if (tail) {
          changes.push({
            sessionId: snap.session.id,
            title: snap.session.title,
            tool: snap.session.tool,
            status: snap.session.status,
            newLines: `[initial capture, last ${Math.min(lines.length, 20)} lines]\n${tail}`,
          });
        }
        continue;
      }

      // same hash = no change
      if (snap.outputHash === prev.outputHash) continue;

      // find new lines by diffing output
      const newLines = extractNewLines(prev.output, snap.output);
      if (newLines.trim()) {
        changes.push({
          sessionId: snap.session.id,
          title: snap.session.title,
          tool: snap.session.tool,
          status: snap.session.status,
          newLines,
        });
      }
    }

    return changes;
  }

  private log(msg: string) {
    if (this.config.verbose) {
      console.error(`[poller] ${msg}`);
    }
  }
}

// exported for testing -- pure utility functions below

// replicate AoE tmux naming: aoe_<sanitized_title_max20>_<first8_of_id>
// from agent-of-empires/src/tmux/session.rs:22-25
/**
 * Build the `aoe` CLI args for listing sessions from a specific profile.
 * The "default" profile omits the -p flag (uses aoe's own default).
 */
export function buildProfileListArgs(profile: string): string[] {
  return profile === "default"
    ? ["list", "--json"]
    : ["-p", profile, "list", "--json"];
}

export function computeTmuxName(id: string, title: string): string {
  const safeTitle = sanitizeTmuxName(title);
  const shortId = id.slice(0, 8);
  return `aoe_${safeTitle}_${shortId}`;
}

// AoE sanitization: only [a-zA-Z0-9_-], max 20 chars, everything else -> _
// from agent-of-empires/src/tmux/session.rs:220-231
export function sanitizeTmuxName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized.slice(0, 20);
}

export function quickHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

// strip ANSI escape sequences (CSI, OSC, simple escapes) so they don't break
// hash-based change detection or anchor-based line diffing.
// covers: CSI (\x1b[...X), OSC (\x1b]...ST), and simple two-char escapes (\x1bX)
// also strips \x9b (8-bit CSI) sequences
export function stripAnsi(s: string): string {
  return s.replace(/[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[\]()#;?0-9A-ORZcf-nqry=><~]/g, "");
}

// shared session listing function — used by both Poller.listSessions() and chat.ts
// avoids duplicating the aoe list + session show + computeTmuxName logic
export interface BasicSessionInfo {
  id: string;
  title: string;
  tool: string;
  status: string;
  tmuxName: string;
}

export async function listAoeSessionsShared(timeoutMs = 10_000): Promise<BasicSessionInfo[]> {
  const result = await exec("aoe", ["list", "--json"], timeoutMs);
  if (result.exitCode !== 0) return [];

  let raw: Array<Record<string, string>>;
  try {
    const parsed = JSON.parse(result.stdout);
    raw = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`[poller] failed to parse session list: ${e}`);
    return [];
  }

  const results = await Promise.allSettled(
    raw.map(async (s) => {
      const id = s.id ?? "";
      const title = s.title ?? "";
      let status = "unknown";
      try {
        const showResult = await exec("aoe", ["session", "show", id, "--json"], 5_000);
        if (showResult.exitCode === 0) {
          status = (JSON.parse(showResult.stdout) as { status?: string }).status ?? "unknown";
        }
      } catch (e) { console.error(`[poller] failed to parse session show for ${id}: ${e}`); }
      return { id, title, tool: s.tool ?? "", status, tmuxName: computeTmuxName(id, title) };
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<BasicSessionInfo> => r.status === "fulfilled")
    .map((r) => r.value);
}

// extract lines in `current` that weren't in `previous`.
// uses a line-by-line backward scan to find the overlap point,
// which handles repeated lines correctly (unlike the old lastIndexOf approach).
export function extractNewLines(previous: string, current: string): string {
  const prevLines = previous.split("\n");
  const currLines = current.split("\n");

  // get the last non-empty lines of previous as anchors
  const anchorLines = prevLines.filter((l) => l.trim()).slice(-5);
  if (anchorLines.length === 0) return current;

  // scan backward through current to find where the anchor sequence starts.
  // this avoids the lastIndexOf false negative when repeated lines appear
  // multiple times — we find the match closest to the end of current.
  const anchorLen = anchorLines.length;
  for (let i = currLines.length - anchorLen; i >= 0; i--) {
    // check if anchorLines match at position i (filtering empties in current)
    let match = true;
    let ai = 0;
    let ci = i;
    while (ai < anchorLen && ci < currLines.length) {
      if (!currLines[ci].trim()) {
        ci++;
        continue;
      }
      if (currLines[ci] !== anchorLines[ai]) {
        match = false;
        break;
      }
      ai++;
      ci++;
    }
    if (match && ai === anchorLen) {
      // found the anchor ending at ci — everything after is new
      const after = currLines.slice(ci).join("\n");
      return after.replace(/^\n/, "");
    }
  }

  // no overlap found (screen clear, etc) -- return last 20 lines
  return currLines.slice(-20).join("\n");
}
