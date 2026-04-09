// api-server.ts — REST API server for daemon remote control + external integrations.
// provides GET endpoints for every fleet metric, POST endpoints for actions,
// SSE live event stream, bearer token auth, and auto-generated OpenAPI 3.1 spec.
// zero dependencies — uses node:http + node:crypto stdlib only.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

// ── types ───────────────────────────────────────────────────────────────────

/** HTTP method for route definitions */
export type HttpMethod = "GET" | "POST";

/** Route definition for the registry */
export interface ApiRoute {
  method: HttpMethod;
  path: string;            // e.g. "/api/v1/fleet/health"
  summary: string;         // one-line description for OpenAPI
  tags: string[];          // OpenAPI tags (fleet, session, goal, daemon, cost)
  handler: ApiHandler;
  /** optional JSON schema snippet for request body (POST) */
  requestBody?: Record<string, unknown>;
  /** optional JSON schema snippet for response body */
  responseSchema?: Record<string, unknown>;
}

/** Request context passed to handlers */
export interface ApiContext {
  url: URL;
  params: Record<string, string>;  // path params extracted from route
  body: unknown;                     // parsed JSON body (POST)
}

/** Handler function — returns a JSON-serializable value */
export type ApiHandler = (ctx: ApiContext) => unknown | Promise<unknown>;

/** Stats tracked per API server instance */
export interface ApiStats {
  startedAt: number;
  totalRequests: number;
  totalErrors: number;
  activeSSEClients: number;
  routeCount: number;
  lastRequestAt: number;
  requestsPerRoute: Map<string, number>;
}

/** Modules and state passed to the API server from main() */
export interface ApiModules {
  // each key maps to a getter function that returns current module state as JSON.
  // populated by index.ts wiring — the API server doesn't import intelligence modules directly.
  getters: Map<string, () => unknown>;
  // action handlers for POST endpoints
  actions: Map<string, (body: unknown) => unknown | Promise<unknown>>;
  // event bus subscription for SSE
  onEvent?: (callback: (event: { type: string; data: unknown; timestamp: number }) => void) => () => void;
}

// ── auth ────────────────────────────────────────────────────────────────────

/** validate bearer token using timing-safe comparison */
export function validateToken(provided: string | null, expected: string | null): boolean {
  if (!expected) return true; // no token configured = no auth required
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** extract bearer token from Authorization header */
export function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

/** generate a random API token (32 bytes hex) */
export function generateApiToken(): string {
  return randomBytes(32).toString("hex");
}

// ── route matching ──────────────────────────────────────────────────────────

/** match a URL path against a route pattern, extracting :params */
export function matchRoute(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.startsWith(":")) {
      params[pp.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (pp !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// ── route registry ──────────────────────────────────────────────────────────

/** build the default route registry from the provided module getters and actions */
export function buildRoutes(modules: ApiModules): ApiRoute[] {
  const routes: ApiRoute[] = [];

  // GET endpoints — one per module getter
  for (const [name, getter] of modules.getters) {
    const tag = categorizeRoute(name);
    routes.push({
      method: "GET",
      path: `/api/v1/${name}`,
      summary: `Get current ${name.replace(/-/g, " ")} data`,
      tags: [tag],
      handler: () => getter(),
      responseSchema: { type: "object" },
    });
  }

  // POST endpoints — one per action
  for (const [name, action] of modules.actions) {
    const tag = categorizeRoute(name);
    routes.push({
      method: "POST",
      path: `/api/v1/actions/${name}`,
      summary: `Execute ${name.replace(/-/g, " ")} action`,
      tags: [tag, "actions"],
      handler: (ctx) => action(ctx.body),
      requestBody: { type: "object" },
      responseSchema: { type: "object" },
    });
  }

  return routes;
}

/** categorize a route name into an OpenAPI tag */
function categorizeRoute(name: string): string {
  if (name.startsWith("fleet-")) return "fleet";
  if (name.startsWith("session-")) return "session";
  if (name.startsWith("goal-")) return "goal";
  if (name.startsWith("daemon-")) return "daemon";
  if (name.startsWith("cost-")) return "cost";
  if (name.startsWith("workflow-")) return "workflow";
  if (name.startsWith("alert-")) return "alerts";
  return "general";
}

// ── OpenAPI spec generation ─────────────────────────────────────────────────

/** generate an OpenAPI 3.1.0 spec from the route registry */
export function generateOpenApiSpec(routes: ApiRoute[], serverUrl: string): object {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const openApiPath = route.path.replace(/:(\w+)/g, "{$1}");
    if (!paths[openApiPath]) paths[openApiPath] = {};

    const operation: Record<string, unknown> = {
      summary: route.summary,
      tags: route.tags,
      responses: {
        "200": {
          description: "Success",
          content: { "application/json": { schema: route.responseSchema ?? { type: "object" } } },
        },
        "401": { description: "Unauthorized — missing or invalid bearer token" },
        "500": { description: "Internal server error" },
      },
    };

    // path params
    const paramMatches = route.path.match(/:(\w+)/g);
    if (paramMatches) {
      operation.parameters = paramMatches.map((p) => ({
        name: p.slice(1),
        in: "path",
        required: true,
        schema: { type: "string" },
      }));
    }

    // request body for POST
    if (route.method === "POST" && route.requestBody) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: route.requestBody } },
      };
    }

    paths[openApiPath][route.method.toLowerCase()] = operation;
  }

  // add SSE endpoint
  paths["/api/v1/events"] = {
    get: {
      summary: "Server-Sent Events stream for live fleet events",
      tags: ["events"],
      responses: {
        "200": {
          description: "SSE event stream",
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "aoaoe Daemon Remote Control API",
      description: "REST API for monitoring and controlling the aoaoe autonomous supervisor daemon. Provides read access to all fleet metrics and write access for daemon actions.",
      version: "1.0.0",
    },
    servers: [{ url: serverUrl, description: "Local daemon" }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "fleet", description: "Fleet-wide metrics and operations" },
      { name: "session", description: "Per-session data and operations" },
      { name: "goal", description: "Goal tracking and analysis" },
      { name: "daemon", description: "Daemon health and configuration" },
      { name: "cost", description: "Cost tracking and budgets" },
      { name: "workflow", description: "Workflow orchestration" },
      { name: "alerts", description: "Alert rules and notifications" },
      { name: "actions", description: "Write endpoints for daemon control" },
      { name: "events", description: "Live event streaming" },
      { name: "general", description: "General daemon information" },
    ],
  };
}

// ── SSE ─────────────────────────────────────────────────────────────────────

/** SSE client connection */
interface SSEClient {
  res: ServerResponse;
  connectedAt: number;
}

/** format an SSE message */
export function formatSSE(event: string, data: unknown): string {
  const json = JSON.stringify(data);
  return `event: ${event}\ndata: ${json}\n\n`;
}

// ── HTTP server ─────────────────────────────────────────────────────────────

export interface ApiServerOptions {
  port: number;
  token?: string | null;   // bearer token for auth (null = no auth)
  modules: ApiModules;
}

export interface ApiServer {
  close: () => void;
  stats: () => ApiStats;
  routes: ApiRoute[];
}

/** read request body as string */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxSize = 1024 * 1024; // 1MB max
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) { req.destroy(); reject(new Error("body too large")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** start the API server */
export function startApiServer(options: ApiServerOptions): ApiServer {
  const { port, token, modules } = options;
  const routes = buildRoutes(modules);
  const sseClients: SSEClient[] = [];

  const stats: ApiStats = {
    startedAt: Date.now(),
    totalRequests: 0,
    totalErrors: 0,
    activeSSEClients: 0,
    routeCount: routes.length,
    lastRequestAt: 0,
    requestsPerRoute: new Map(),
  };

  // subscribe to event bus for SSE broadcasting
  let unsubscribe: (() => void) | null = null;
  if (modules.onEvent) {
    unsubscribe = modules.onEvent((event) => {
      const msg = formatSSE(event.type, { ...event, timestamp: event.timestamp });
      for (let i = sseClients.length - 1; i >= 0; i--) {
        try {
          sseClients[i].res.write(msg);
        } catch {
          sseClients.splice(i, 1);
          stats.activeSSEClients = sseClients.length;
        }
      }
    });
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    stats.totalRequests++;
    stats.lastRequestAt = Date.now();

    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const method = (req.method ?? "GET").toUpperCase();
      const pathname = url.pathname;

      // CORS preflight
      if (method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
        });
        res.end();
        return;
      }

      // CORS headers on all responses
      res.setHeader("Access-Control-Allow-Origin", "*");

      // auth check (skip for OpenAPI spec — allow discovery without auth)
      if (pathname !== "/api/v1/openapi.json") {
        if (!validateToken(extractBearerToken(req), token ?? null)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized", hint: "provide Authorization: Bearer <token>" }));
          return;
        }
      }

      // OpenAPI spec
      if (method === "GET" && pathname === "/api/v1/openapi.json") {
        const spec = generateOpenApiSpec(routes, `http://127.0.0.1:${port}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(spec, null, 2));
        return;
      }

      // SSE event stream
      if (method === "GET" && pathname === "/api/v1/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        res.write(formatSSE("connected", { timestamp: Date.now() }));
        const client: SSEClient = { res, connectedAt: Date.now() };
        sseClients.push(client);
        stats.activeSSEClients = sseClients.length;
        req.on("close", () => {
          const idx = sseClients.indexOf(client);
          if (idx >= 0) sseClients.splice(idx, 1);
          stats.activeSSEClients = sseClients.length;
        });
        return;
      }

      // API index
      if (method === "GET" && (pathname === "/api/v1" || pathname === "/api/v1/")) {
        const index = routes.map((r) => ({
          method: r.method,
          path: r.path,
          summary: r.summary,
          tags: r.tags,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ routes: index, sse: "/api/v1/events", openapi: "/api/v1/openapi.json" }));
        return;
      }

      // match route
      for (const route of routes) {
        if (route.method !== method) continue;
        const params = matchRoute(route.path, pathname);
        if (!params) continue;

        // track per-route stats
        const key = `${route.method} ${route.path}`;
        stats.requestsPerRoute.set(key, (stats.requestsPerRoute.get(key) ?? 0) + 1);

        // parse body for POST
        let body: unknown = null;
        if (method === "POST") {
          try {
            const raw = await readBody(req);
            body = raw ? JSON.parse(raw) : null;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid JSON body" }));
            return;
          }
        }

        const ctx: ApiContext = { url, params, body };
        const result = await route.handler(ctx);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found", hint: "GET /api/v1 for route index" }));
    } catch (err) {
      stats.totalErrors++;
      try {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      } catch { /* response already started */ }
    }
  });

  server.listen(port, "127.0.0.1");

  return {
    close: () => {
      if (unsubscribe) unsubscribe();
      for (const client of sseClients) {
        try { client.res.end(); } catch { /* ignore */ }
      }
      sseClients.length = 0;
      server.close();
    },
    stats: () => ({ ...stats, activeSSEClients: sseClients.length }),
    routes,
  };
}

// ── TUI format ──────────────────────────────────────────────────────────────

/** format API server status for TUI display */
export function formatApiStatus(stats: ApiStats, port: number, hasAuth: boolean): string[] {
  const uptime = Date.now() - stats.startedAt;
  const uptimeStr = uptime > 3_600_000
    ? `${Math.floor(uptime / 3_600_000)}h ${Math.floor((uptime % 3_600_000) / 60_000)}m`
    : `${Math.floor(uptime / 60_000)}m ${Math.floor((uptime % 60_000) / 1000)}s`;

  const lines: string[] = [
    `API server: http://127.0.0.1:${port}`,
    `  auth: ${hasAuth ? "bearer token required" : "none (open)"}`,
    `  uptime: ${uptimeStr}`,
    `  routes: ${stats.routeCount} (${stats.routeCount} GET + POST endpoints)`,
    `  requests: ${stats.totalRequests} total, ${stats.totalErrors} errors`,
    `  SSE clients: ${stats.activeSSEClients} connected`,
    `  last request: ${stats.lastRequestAt ? new Date(stats.lastRequestAt).toLocaleTimeString() : "none"}`,
    `  OpenAPI spec: http://127.0.0.1:${port}/api/v1/openapi.json`,
    `  event stream: http://127.0.0.1:${port}/api/v1/events`,
    `  route index:  http://127.0.0.1:${port}/api/v1`,
  ];

  // top routes by request count
  const topRoutes = [...stats.requestsPerRoute.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topRoutes.length > 0) {
    lines.push("  top routes:");
    for (const [route, count] of topRoutes) {
      lines.push(`    ${count.toString().padStart(4)} ${route}`);
    }
  }

  return lines;
}
