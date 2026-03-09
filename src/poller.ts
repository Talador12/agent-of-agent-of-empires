import { createHash } from "node:crypto";
import { exec } from "./shell.js";
import type {
  AoaoeConfig,
  AoeSession,
  SessionSnapshot,
  SessionChange,
  Observation,
} from "./types.js";

export class Poller {
  private config: AoaoeConfig;
  private previousSnapshots: Map<string, SessionSnapshot> = new Map();

  constructor(config: AoaoeConfig) {
    this.config = config;
  }

  async poll(): Promise<Observation> {
    const sessions = await this.listSessions();
    const snapshots = await Promise.all(
      sessions.map((s) => this.captureSession(s))
    );

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
    // aoe list --json returns array with id, title, path, tool, command, profile, created_at
    // does NOT include status or tmux_name -- we derive both
    const result = await exec("aoe", ["list", "--json"]);
    if (result.exitCode !== 0) {
      this.log(`aoe list failed: ${result.stderr}`);
      return [];
    }

    let raw: Record<string, unknown>[];
    try {
      const parsed = JSON.parse(result.stdout);
      raw = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      this.log(`failed to parse aoe list output: ${e}`);
      return [];
    }

    // fetch per-session status in parallel
    const sessions: AoeSession[] = await Promise.all(
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

    return sessions;
  }

  private async getSessionStatus(id: string): Promise<string> {
    const result = await exec("aoe", ["session", "show", id, "--json"]);
    if (result.exitCode !== 0) return "unknown";
    try {
      const data = JSON.parse(result.stdout);
      return String(data.status ?? "unknown");
    } catch {
      return "unknown";
    }
  }

  private async captureSession(session: AoeSession): Promise<SessionSnapshot> {
    const output = await this.captureTmuxPane(session.tmux_name);
    const outputHash = quickHash(output);

    return {
      session,
      output,
      outputHash,
      capturedAt: Date.now(),
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
      return "";
    }

    // trim trailing blank lines that tmux pads
    return result.stdout.replace(/\n+$/, "");
  }

  private diffSnapshots(current: SessionSnapshot[]): SessionChange[] {
    const changes: SessionChange[] = [];

    for (const snap of current) {
      const prev = this.previousSnapshots.get(snap.session.id);

      // no previous snapshot = first poll, skip to avoid spamming the reasoner
      // with all existing output on startup
      if (!prev) continue;

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

// extract lines in `current` that weren't in `previous`
export function extractNewLines(previous: string, current: string): string {
  const prevLines = previous.split("\n");
  const currLines = current.split("\n");

  if (prevLines.length === 0) return current;

  // look for the last few non-empty lines of previous in current to find the overlap point
  const anchorLines = prevLines.filter((l) => l.trim()).slice(-5);
  if (anchorLines.length === 0) return current;

  const anchor = anchorLines.join("\n");
  const currJoined = currLines.join("\n");
  const anchorIdx = currJoined.lastIndexOf(anchor);

  if (anchorIdx >= 0) {
    const after = currJoined.slice(anchorIdx + anchor.length);
    return after.replace(/^\n/, "");
  }

  // no overlap found (screen clear, etc) -- return last 20 lines
  return currLines.slice(-20).join("\n");
}
