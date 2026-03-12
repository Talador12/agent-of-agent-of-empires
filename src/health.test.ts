// health.test.ts — tests for the health check HTTP endpoint
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildHealthResponse, startHealthServer, type HealthResponse } from "./health.js";
import type { DaemonState, DaemonSessionState } from "./types.js";

// ── fixtures ────────────────────────────────────────────────────────────────

function makeState(overrides?: Partial<DaemonState>): DaemonState {
  return {
    tickStartedAt: Date.now(),
    nextTickAt: Date.now() + 10_000,
    pollIntervalMs: 10_000,
    phase: "sleeping",
    phaseStartedAt: Date.now(),
    pollCount: 5,
    paused: false,
    sessionCount: 2,
    changeCount: 1,
    sessions: [],
    ...overrides,
  };
}

function makeSession(overrides?: Partial<DaemonSessionState>): DaemonSessionState {
  return {
    id: "abc-123",
    title: "test-agent",
    tool: "opencode",
    status: "working",
    userActive: false,
    ...overrides,
  };
}

// ── buildHealthResponse tests ───────────────────────────────────────────────

describe("buildHealthResponse", () => {
  const startedAt = Date.now() - 60_000; // 60s ago
  const now = Date.now();

  it("returns ok status with daemon state", () => {
    const state = makeState({ pollCount: 10, sessionCount: 3 });
    const res = buildHealthResponse(state, startedAt, now);
    assert.equal(res.status, "ok");
    assert.ok(res.uptimeMs >= 59_000); // ~60s
    assert.ok(res.version); // should be a string
    assert.ok(res.daemon);
    assert.equal(res.daemon!.pollCount, 10);
    assert.equal(res.daemon!.sessionCount, 3);
  });

  it("returns error status when state is null", () => {
    const res = buildHealthResponse(null, startedAt, now);
    assert.equal(res.status, "error");
    assert.equal(res.daemon, null);
    assert.ok(res.uptimeMs >= 59_000);
    assert.ok(res.version);
  });

  it("includes session details", () => {
    const sessions: DaemonSessionState[] = [
      makeSession({ title: "adventure", tool: "opencode", status: "working", currentTask: "build login" }),
      makeSession({ title: "chv", tool: "claude-code", status: "idle", userActive: true }),
    ];
    const state = makeState({ sessions, sessionCount: 2 });
    const res = buildHealthResponse(state, startedAt, now);

    assert.equal(res.daemon!.sessions.length, 2);

    const adv = res.daemon!.sessions.find((s) => s.title === "adventure");
    assert.ok(adv);
    assert.equal(adv!.tool, "opencode");
    assert.equal(adv!.status, "working");
    assert.equal(adv!.currentTask, "build login");
    assert.equal(adv!.userActive, false);

    const chv = res.daemon!.sessions.find((s) => s.title === "chv");
    assert.ok(chv);
    assert.equal(chv!.tool, "claude-code");
    assert.equal(chv!.userActive, true);
  });

  it("reflects daemon phase correctly", () => {
    const state = makeState({ phase: "reasoning" });
    const res = buildHealthResponse(state, startedAt, now);
    assert.equal(res.daemon!.phase, "reasoning");
  });

  it("reflects paused state", () => {
    const state = makeState({ paused: true });
    const res = buildHealthResponse(state, startedAt, now);
    assert.equal(res.daemon!.paused, true);
  });

  it("calculates uptime correctly", () => {
    const earlyStart = now - 3_600_000; // 1 hour ago
    const res = buildHealthResponse(makeState(), earlyStart, now);
    assert.equal(res.uptimeMs, 3_600_000);
  });

  it("returns version string", () => {
    const res = buildHealthResponse(makeState(), startedAt, now);
    assert.equal(typeof res.version, "string");
    assert.ok(res.version.length > 0);
  });

  it("empty sessions array", () => {
    const state = makeState({ sessions: [], sessionCount: 0 });
    const res = buildHealthResponse(state, startedAt, now);
    assert.equal(res.daemon!.sessions.length, 0);
    assert.equal(res.daemon!.sessionCount, 0);
  });
});

// ── startHealthServer integration tests ─────────────────────────────────────

describe("startHealthServer", () => {
  let server: ReturnType<typeof startHealthServer> | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it("responds to GET /health with JSON", async () => {
    const port = 19876; // unlikely to conflict
    server = startHealthServer(port, Date.now() - 5_000);

    // give server time to bind
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");

    const body = await res.json() as HealthResponse;
    assert.ok(body.version);
    assert.ok(body.uptimeMs >= 4_000); // started 5s ago
    // state is whatever the real daemon-state.json has (or error if missing)
    assert.ok(body.status === "ok" || body.status === "error");
  });

  it("responds to GET / as alias for /health", async () => {
    const port = 19877;
    server = startHealthServer(port, Date.now());
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const body = await res.json() as HealthResponse;
    assert.ok(body.version);
  });

  it("returns 404 for unknown paths", async () => {
    const port = 19878;
    server = startHealthServer(port, Date.now());
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    assert.equal(res.status, 404);
    const body = await res.json() as { error: string };
    assert.equal(body.error, "not found");
  });
});
