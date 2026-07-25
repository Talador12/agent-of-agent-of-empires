// PollerLike over the plugin API: sessions.list metadata becomes the same
// Observation shape the standalone tmux poller produces, so loop.ts, the
// reasoners, and the intelligence modules run unchanged. Pane output is not
// available through the plugin API (see DESIGN.md "Missing host primitives"),
// so snapshots carry empty output and "changes" are status transitions.

import { createHash } from "node:crypto";
import type { Observation, SessionChange, SessionSnapshot, AoeSessionStatus } from "../types.js";
import type { PollerLike } from "../loop.js";
import type { HostClient, HostSession } from "./host.js";

// host Status (Debug-formatted Rust enum) -> aoaoe status vocabulary
const STATUS_MAP: Record<string, AoeSessionStatus> = {
  Running: "running",
  Waiting: "waiting",
  Idle: "idle",
  Error: "error",
  Stopped: "stopped",
  Starting: "running",
  Creating: "running",
  Deleting: "stopped",
  Unknown: "unknown",
};

export function mapHostStatus(status: string): AoeSessionStatus {
  return STATUS_MAP[status] ?? "unknown";
}

export class PluginPoller implements PollerLike {
  private lastStatus = new Map<string, string>();
  /** Sessions as returned by the most recent poll, for consumers that need
   * the raw host rows (attention ranking) without a second RPC. */
  lastSessions: HostSession[] = [];

  constructor(private readonly host: HostClient) {}

  async poll(): Promise<Observation> {
    const now = Date.now();
    const sessions = await this.host.sessionsList(["trashed"]);
    this.lastSessions = sessions;

    const snapshots: SessionSnapshot[] = [];
    const changes: SessionChange[] = [];
    const liveIds = new Set<string>();

    for (const s of sessions) {
      if (s.archived) continue; // archived sessions are out of scope, like the in-tree conductor
      liveIds.add(s.id);
      const status = mapHostStatus(s.status);
      const snapshot: SessionSnapshot = {
        session: {
          id: s.id,
          title: s.title,
          path: s.project_path,
          tool: s.tool,
          status,
          tmux_name: "", // plugin mode has no tmux visibility by design
        },
        output: "",
        outputHash: hashStatus(s.status),
        capturedAt: now,
      };
      snapshots.push(snapshot);

      const prev = this.lastStatus.get(s.id);
      if (prev !== undefined && prev !== s.status) {
        changes.push({
          sessionId: s.id,
          title: s.title,
          tool: s.tool,
          status,
          newLines: `[status] ${prev} -> ${s.status}`,
        });
      }
      this.lastStatus.set(s.id, s.status);
    }

    for (const id of this.lastStatus.keys()) {
      if (!liveIds.has(id)) this.lastStatus.delete(id);
    }

    return { timestamp: now, sessions: snapshots, changes };
  }
}

function hashStatus(status: string): string {
  return createHash("sha256").update(status).digest("hex").slice(0, 16);
}
