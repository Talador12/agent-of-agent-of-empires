// api-server.test.ts — tests for the daemon remote control API server

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  validateToken,
  extractBearerToken,
  generateApiToken,
  matchRoute,
  buildRoutes,
  generateOpenApiSpec,
  formatSSE,
  formatApiStatus,
  startApiServer,
  type ApiModules,
  type ApiStats,
} from "./api-server.js";

// ── auth tests ──────────────────────────────────────────────────────────────

describe("validateToken", () => {
  it("returns true when no expected token (no auth required)", () => {
    assert.equal(validateToken(null, null), true);
    assert.equal(validateToken("anything", null), true);
  });

  it("returns false when expected token set but none provided", () => {
    assert.equal(validateToken(null, "secret"), false);
  });

  it("returns true for matching tokens", () => {
    assert.equal(validateToken("my-secret", "my-secret"), true);
  });

  it("returns false for mismatched tokens", () => {
    assert.equal(validateToken("wrong", "secret"), false);
  });

  it("returns false for different length tokens", () => {
    assert.equal(validateToken("short", "longer-token"), false);
  });
});

describe("extractBearerToken", () => {
  it("extracts token from valid Authorization header", () => {
    const req = { headers: { authorization: "Bearer abc123" } } as any;
    assert.equal(extractBearerToken(req), "abc123");
  });

  it("handles case-insensitive Bearer prefix", () => {
    const req = { headers: { authorization: "bearer xyz" } } as any;
    assert.equal(extractBearerToken(req), "xyz");
  });

  it("returns null for missing header", () => {
    const req = { headers: {} } as any;
    assert.equal(extractBearerToken(req), null);
  });

  it("returns null for non-Bearer auth", () => {
    const req = { headers: { authorization: "Basic abc123" } } as any;
    assert.equal(extractBearerToken(req), null);
  });
});

describe("generateApiToken", () => {
  it("generates a 64-character hex string", () => {
    const token = generateApiToken();
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9a-f]+$/);
  });

  it("generates unique tokens", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    assert.notEqual(a, b);
  });
});

// ── route matching tests ────────────────────────────────────────────────────

describe("matchRoute", () => {
  it("matches exact static paths", () => {
    const result = matchRoute("/api/v1/fleet/health", "/api/v1/fleet/health");
    assert.deepEqual(result, {});
  });

  it("extracts path parameters", () => {
    const result = matchRoute("/api/v1/sessions/:id", "/api/v1/sessions/abc123");
    assert.deepEqual(result, { id: "abc123" });
  });

  it("extracts multiple path parameters", () => {
    const result = matchRoute("/api/v1/:category/:id", "/api/v1/fleet/snap-1");
    assert.deepEqual(result, { category: "fleet", id: "snap-1" });
  });

  it("returns null for non-matching paths", () => {
    assert.equal(matchRoute("/api/v1/foo", "/api/v1/bar"), null);
  });

  it("returns null for different segment counts", () => {
    assert.equal(matchRoute("/api/v1/foo/bar", "/api/v1/foo"), null);
  });

  it("decodes URI-encoded path params", () => {
    const result = matchRoute("/api/v1/:name", "/api/v1/hello%20world");
    assert.deepEqual(result, { name: "hello world" });
  });
});

// ── route building tests ────────────────────────────────────────────────────

describe("buildRoutes", () => {
  it("creates GET routes from module getters", () => {
    const getters = new Map<string, () => unknown>();
    getters.set("fleet-health", () => ({ score: 85 }));
    getters.set("session-pool", () => ({ active: 3, max: 5 }));
    const modules: ApiModules = {
      getters,
      actions: new Map(),
    };
    const routes = buildRoutes(modules);
    assert.equal(routes.length, 2);
    assert.equal(routes[0].method, "GET");
    assert.equal(routes[0].path, "/api/v1/fleet-health");
    assert.deepEqual(routes[0].tags, ["fleet"]);
    assert.equal(routes[1].path, "/api/v1/session-pool");
    assert.deepEqual(routes[1].tags, ["session"]);
  });

  it("creates POST routes from actions", () => {
    const modules: ApiModules = {
      getters: new Map(),
      actions: new Map([
        ["pause-session", (body: any) => ({ ok: true, session: body?.session })],
      ]),
    };
    const routes = buildRoutes(modules);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].method, "POST");
    assert.equal(routes[0].path, "/api/v1/actions/pause-session");
    assert.ok(routes[0].tags.includes("actions"));
  });

  it("categorizes routes by prefix", () => {
    const modules: ApiModules = {
      getters: new Map([
        ["fleet-sla", () => null],
        ["session-health", () => null],
        ["goal-progress", () => null],
        ["daemon-health", () => null],
        ["cost-budget", () => null],
        ["workflow-engine", () => null],
        ["alert-rules", () => null],
        ["audit-trail", () => null],
      ]),
      actions: new Map(),
    };
    const routes = buildRoutes(modules);
    assert.equal(routes.find((r) => r.path.includes("fleet-sla"))?.tags[0], "fleet");
    assert.equal(routes.find((r) => r.path.includes("session-health"))?.tags[0], "session");
    assert.equal(routes.find((r) => r.path.includes("goal-progress"))?.tags[0], "goal");
    assert.equal(routes.find((r) => r.path.includes("daemon-health"))?.tags[0], "daemon");
    assert.equal(routes.find((r) => r.path.includes("cost-budget"))?.tags[0], "cost");
    assert.equal(routes.find((r) => r.path.includes("workflow-engine"))?.tags[0], "workflow");
    assert.equal(routes.find((r) => r.path.includes("alert-rules"))?.tags[0], "alerts");
    assert.equal(routes.find((r) => r.path.includes("audit-trail"))?.tags[0], "general");
  });

  it("handlers return module data", () => {
    const modules: ApiModules = {
      getters: new Map([["test-data", () => ({ value: 42 })]]),
      actions: new Map(),
    };
    const routes = buildRoutes(modules);
    const result = routes[0].handler({ url: new URL("http://localhost"), params: {}, body: null });
    assert.deepEqual(result, { value: 42 });
  });
});

// ── OpenAPI spec tests ──────────────────────────────────────────────────────

describe("generateOpenApiSpec", () => {
  it("generates valid OpenAPI 3.1 structure", () => {
    const routes = buildRoutes({
      getters: new Map([["fleet-health", () => null]]),
      actions: new Map([["pause", (b: any) => null]]),
    });
    const spec = generateOpenApiSpec(routes, "http://localhost:4100") as any;
    assert.equal(spec.openapi, "3.1.0");
    assert.equal(spec.info.title, "aoaoe Daemon Remote Control API");
    assert.ok(spec.paths["/api/v1/fleet-health"]);
    assert.ok(spec.paths["/api/v1/fleet-health"].get);
    assert.ok(spec.paths["/api/v1/actions/pause"]);
    assert.ok(spec.paths["/api/v1/actions/pause"].post);
  });

  it("includes SSE events endpoint", () => {
    const spec = generateOpenApiSpec([], "http://localhost:4100") as any;
    assert.ok(spec.paths["/api/v1/events"]);
    assert.ok(spec.paths["/api/v1/events"].get);
  });

  it("includes security scheme", () => {
    const spec = generateOpenApiSpec([], "http://localhost:4100") as any;
    assert.ok(spec.components.securitySchemes.bearerAuth);
    assert.equal(spec.components.securitySchemes.bearerAuth.type, "http");
  });

  it("includes all tag definitions", () => {
    const spec = generateOpenApiSpec([], "http://localhost:4100") as any;
    const tagNames = spec.tags.map((t: any) => t.name);
    assert.ok(tagNames.includes("fleet"));
    assert.ok(tagNames.includes("session"));
    assert.ok(tagNames.includes("goal"));
    assert.ok(tagNames.includes("daemon"));
    assert.ok(tagNames.includes("actions"));
    assert.ok(tagNames.includes("events"));
  });

  it("converts :params to {params} in OpenAPI paths", () => {
    const routes = [{
      method: "GET" as const,
      path: "/api/v1/sessions/:id",
      summary: "Get session",
      tags: ["session"],
      handler: () => null,
    }];
    const spec = generateOpenApiSpec(routes, "http://localhost:4100") as any;
    assert.ok(spec.paths["/api/v1/sessions/{id}"]);
    assert.ok(!spec.paths["/api/v1/sessions/:id"]);
    const params = spec.paths["/api/v1/sessions/{id}"].get.parameters;
    assert.equal(params[0].name, "id");
    assert.equal(params[0].in, "path");
  });
});

// ── SSE format tests ────────────────────────────────────────────────────────

describe("formatSSE", () => {
  it("formats SSE message correctly", () => {
    const result = formatSSE("tick", { count: 5 });
    assert.equal(result, 'event: tick\ndata: {"count":5}\n\n');
  });

  it("handles complex data", () => {
    const result = formatSSE("session-update", { id: "abc", status: "active", health: 85 });
    assert.ok(result.startsWith("event: session-update\n"));
    assert.ok(result.includes('"id":"abc"'));
    assert.ok(result.endsWith("\n\n"));
  });
});

// ── format TUI tests ────────────────────────────────────────────────────────

describe("formatApiStatus", () => {
  it("formats basic API status for TUI", () => {
    const stats: ApiStats = {
      startedAt: Date.now() - 300_000, // 5 min ago
      totalRequests: 42,
      totalErrors: 2,
      activeSSEClients: 1,
      routeCount: 50,
      lastRequestAt: Date.now() - 5000,
      requestsPerRoute: new Map([
        ["GET /api/v1/fleet-health", 15],
        ["GET /api/v1/session-pool", 10],
      ]),
    };
    const lines = formatApiStatus(stats, 4100, true);
    assert.ok(lines.length > 0);
    assert.ok(lines[0].includes("4100"));
    assert.ok(lines.some((l) => l.includes("bearer token")));
    assert.ok(lines.some((l) => l.includes("42 total")));
    assert.ok(lines.some((l) => l.includes("1 connected")));
    assert.ok(lines.some((l) => l.includes("openapi.json")));
    assert.ok(lines.some((l) => l.includes("top routes")));
  });

  it("shows no auth when disabled", () => {
    const stats: ApiStats = {
      startedAt: Date.now(),
      totalRequests: 0,
      totalErrors: 0,
      activeSSEClients: 0,
      routeCount: 10,
      lastRequestAt: 0,
      requestsPerRoute: new Map(),
    };
    const lines = formatApiStatus(stats, 4100, false);
    assert.ok(lines.some((l) => l.includes("none (open)")));
  });

  it("shows hours for long uptime", () => {
    const stats: ApiStats = {
      startedAt: Date.now() - 7_200_000, // 2 hours
      totalRequests: 0,
      totalErrors: 0,
      activeSSEClients: 0,
      routeCount: 10,
      lastRequestAt: 0,
      requestsPerRoute: new Map(),
    };
    const lines = formatApiStatus(stats, 4100, false);
    assert.ok(lines.some((l) => l.includes("2h")));
  });
});

// ── HTTP server integration tests ───────────────────────────────────────────

describe("startApiServer", () => {
  let server: ReturnType<typeof startApiServer> | null = null;
  const TEST_PORT = 19876; // high port to avoid conflicts

  afterEach(() => {
    if (server) { server.close(); server = null; }
  });

  it("starts server and responds to route index", async () => {
    const modules: ApiModules = {
      getters: new Map([["test-module", () => ({ ok: true })]]),
      actions: new Map(),
    };
    server = startApiServer({ port: TEST_PORT, modules });
    await new Promise((r) => setTimeout(r, 50)); // let server bind

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.ok(data.routes);
    assert.ok(data.routes.length > 0);
    assert.ok(data.openapi);
  });

  it("returns 404 for unknown paths", async () => {
    server = startApiServer({ port: TEST_PORT, modules: { getters: new Map(), actions: new Map() } });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/nonexistent`);
    assert.equal(res.status, 404);
    const data = await res.json() as any;
    assert.ok(data.error);
  });

  it("serves OpenAPI spec without auth", async () => {
    server = startApiServer({
      port: TEST_PORT,
      token: "secret",
      modules: { getters: new Map(), actions: new Map() },
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/openapi.json`);
    assert.equal(res.status, 200);
    const spec = await res.json() as any;
    assert.equal(spec.openapi, "3.1.0");
  });

  it("rejects unauthenticated requests when token set", async () => {
    server = startApiServer({
      port: TEST_PORT,
      token: "my-secret",
      modules: { getters: new Map([["test", () => "data"]]), actions: new Map() },
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/test`);
    assert.equal(res.status, 401);
  });

  it("accepts authenticated requests with correct token", async () => {
    server = startApiServer({
      port: TEST_PORT,
      token: "my-secret",
      modules: { getters: new Map([["test", () => ({ value: 42 })]]), actions: new Map() },
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/test`, {
      headers: { Authorization: "Bearer my-secret" },
    });
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.equal(data.value, 42);
  });

  it("handles GET module endpoints", async () => {
    const getters = new Map<string, () => unknown>();
    getters.set("fleet-health", () => ({ score: 85, grade: "B" }));
    getters.set("session-pool", () => ({ active: 3, max: 5, queued: 1 }));
    const modules: ApiModules = {
      getters,
      actions: new Map(),
    };
    server = startApiServer({ port: TEST_PORT, modules });
    await new Promise((r) => setTimeout(r, 50));

    const res1 = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/fleet-health`);
    assert.equal(res1.status, 200);
    const data1 = await res1.json() as any;
    assert.equal(data1.score, 85);

    const res2 = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/session-pool`);
    assert.equal(res2.status, 200);
    const data2 = await res2.json() as any;
    assert.equal(data2.active, 3);
  });

  it("handles POST action endpoints", async () => {
    const modules: ApiModules = {
      getters: new Map(),
      actions: new Map([
        ["pause-session", (body: any) => ({ ok: true, session: body?.session })],
      ]),
    };
    server = startApiServer({ port: TEST_PORT, modules });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/actions/pause-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: "adventure" }),
    });
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.equal(data.ok, true);
    assert.equal(data.session, "adventure");
  });

  it("returns 400 for invalid JSON body on POST", async () => {
    const modules: ApiModules = {
      getters: new Map(),
      actions: new Map([["test-action", () => ({ ok: true })]]),
    };
    server = startApiServer({ port: TEST_PORT, modules });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/actions/test-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    assert.equal(res.status, 400);
  });

  it("handles CORS preflight", async () => {
    server = startApiServer({ port: TEST_PORT, modules: { getters: new Map(), actions: new Map() } });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.ok(res.headers.get("access-control-allow-origin"));
  });

  it("tracks request stats", async () => {
    const modules: ApiModules = {
      getters: new Map([["test", () => "ok"]]),
      actions: new Map(),
    };
    server = startApiServer({ port: TEST_PORT, modules });
    await new Promise((r) => setTimeout(r, 50));

    await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/test`);
    await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/test`);

    const stats = server.stats();
    assert.ok(stats.totalRequests >= 2);
    assert.ok(stats.lastRequestAt > 0);
    assert.ok(stats.requestsPerRoute.get("GET /api/v1/test")! >= 2);
  });

  it("establishes SSE connection with correct headers", async () => {
    const sseServer = startApiServer({ port: TEST_PORT + 2, modules: { getters: new Map(), actions: new Map() } });
    await new Promise((r) => setTimeout(r, 50));

    // just verify the response headers without holding the connection open
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT + 2}/api/v1/events`, {
        signal: controller.signal,
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/event-stream");
      assert.equal(res.headers.get("cache-control"), "no-cache");
    } catch (err: any) {
      if (err.name !== "AbortError") throw err;
    }
    sseServer.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("registers onEvent callback for SSE broadcasting", () => {
    let registered = false;
    const modules: ApiModules = {
      getters: new Map(),
      actions: new Map(),
      onEvent: (cb) => { registered = true; return () => { registered = false; }; },
    };
    server = startApiServer({ port: TEST_PORT + 1, modules }); // use different port
    assert.equal(registered, true);
    // cleanup unsubscribes
    server.close();
    assert.equal(registered, false);
    server = null;
  });

  it("allows no auth when token is null", async () => {
    server = startApiServer({
      port: TEST_PORT,
      token: null,
      modules: { getters: new Map([["test", () => "ok"]]), actions: new Map() },
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/test`);
    assert.equal(res.status, 200);
  });

  it("exposes route count in stats", () => {
    const modules: ApiModules = {
      getters: new Map([["a", () => 1], ["b", () => 2], ["c", () => 3]]),
      actions: new Map([["x", () => null]]),
    };
    server = startApiServer({ port: TEST_PORT, modules });
    const stats = server.stats();
    assert.equal(stats.routeCount, 4); // 3 GET + 1 POST
  });
});
