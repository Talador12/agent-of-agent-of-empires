// health.ts — HTTP health check endpoint for daemon monitoring
// starts a lightweight HTTP server that responds to GET /health with JSON status.
// enabled when config.healthPort is set (opt-in). the server reads daemon state
// from the IPC state file and returns uptime, phase, session info, and version.

import { createServer, type Server } from "node:http";
import { readState } from "./daemon-state.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DaemonState } from "./types.js";

// read version from package.json at startup (cached)
let cachedVersion: string | undefined;
function getVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    // resolve from compiled dist/ to project root package.json
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(thisDir, "..", "package.json"), "utf-8"));
    cachedVersion = pkg.version ?? "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion!;
}

// pure function: build health response JSON from daemon state (exported for testing)
export function buildHealthResponse(state: DaemonState | null, startedAt: number, now = Date.now()): HealthResponse {
  const uptimeMs = now - startedAt;
  const version = getVersion();

  if (!state) {
    return {
      status: "error",
      version,
      uptimeMs,
      daemon: null,
    };
  }

  return {
    status: "ok",
    version,
    uptimeMs,
    daemon: {
      phase: state.phase,
      phaseStartedAt: state.phaseStartedAt,
      pollCount: state.pollCount,
      pollIntervalMs: state.pollIntervalMs,
      sessionCount: state.sessionCount,
      changeCount: state.changeCount,
      paused: state.paused,
      sessions: state.sessions.map((s) => ({
        title: s.title,
        tool: s.tool,
        status: s.status,
        currentTask: s.currentTask,
        userActive: s.userActive ?? false,
      })),
    },
  };
}

export interface HealthResponse {
  status: "ok" | "error";
  version: string;
  uptimeMs: number;
  daemon: {
    phase: string;
    phaseStartedAt: number;
    pollCount: number;
    pollIntervalMs: number;
    sessionCount: number;
    changeCount: number;
    paused: boolean;
    sessions: Array<{
      title: string;
      tool: string;
      status: string;
      currentTask?: string;
      userActive: boolean;
    }>;
  } | null;
}

// start the health HTTP server on the given port. returns the server for shutdown.
export function startHealthServer(port: number, startedAt: number): Server {
  const server = createServer((req, res) => {
    // only respond to GET /health (and GET / as convenience alias)
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      const state = readState();
      const body = JSON.stringify(buildHealthResponse(state, startedAt), null, 2);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(body + "\n");
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found", hint: "try GET /health" }) + "\n");
  });

  server.listen(port, "127.0.0.1", () => {
    // listening — logged by caller
  });

  return server;
}
