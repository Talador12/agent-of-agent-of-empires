// web.ts — minimal browser dashboard served from aoaoe daemon.
// serves a single HTML page + JSON API endpoints using Node stdlib http.
// zero dependencies. auto-refreshes every 5 seconds.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadTaskState, loadTaskDefinitions, formatAgo, TaskManager } from "./task-manager.js";
import { computeAllHealth } from "./health-score.js";
import { loadSupervisorEvents } from "./supervisor-history.js";
import { loadConfig } from "./config.js";
import type { TaskState } from "./types.js";

let resolveProfilesFn: ((config: ReturnType<typeof loadConfig>) => string[]) | null = null;

export function setResolveProfiles(fn: (config: ReturnType<typeof loadConfig>) => string[]): void {
  resolveProfilesFn = fn;
}

function getTasks(): TaskState[] {
  const basePath = process.cwd();
  const defs = loadTaskDefinitions(basePath);
  if (defs.length === 0) return [...loadTaskState().values()];
  const config = loadConfig();
  const profiles = resolveProfilesFn ? resolveProfilesFn(config) : ["default"];
  return new TaskManager(basePath, defs, profiles).tasks;
}

// ── JSON API ────────────────────────────────────────────────────────────────

function apiTasks(): object {
  const tasks = getTasks();
  const now = Date.now();
  return tasks.map((t) => ({
    session: t.sessionTitle,
    repo: t.repo,
    status: t.status,
    goal: t.goal,
    dependsOn: t.dependsOn ?? [],
    lastProgressAt: t.lastProgressAt ?? null,
    lastProgressAgo: t.lastProgressAt ? formatAgo(now - t.lastProgressAt) : null,
    progressCount: t.progress.length,
    lastProgress: t.progress.length > 0 ? t.progress[t.progress.length - 1].summary : null,
    stuckNudgeCount: t.stuckNudgeCount ?? 0,
  }));
}

function apiHealth(): object {
  return computeAllHealth(getTasks());
}

function apiProgress(sinceMs = 24 * 60 * 60 * 1000): object {
  const tasks = getTasks();
  const now = Date.now();
  const cutoff = now - sinceMs;
  return tasks.map((t) => ({
    session: t.sessionTitle,
    status: t.status,
    recentProgress: t.progress.filter((p) => p.at >= cutoff).map((p) => ({
      at: p.at,
      ago: formatAgo(now - p.at),
      summary: p.summary,
    })),
  }));
}

function apiSupervisor(limit = 20): object {
  const tasks = getTasks();
  const events = loadSupervisorEvents(limit).reverse();
  const active = tasks.filter((t) => t.status === "active").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const paused = tasks.filter((t) => t.status === "paused").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  return {
    summary: { total: tasks.length, active, pending, paused, completed },
    recentEvents: events.map((e) => ({ at: e.at, detail: e.detail })),
  };
}

// ── HTML dashboard ──────────────────────────────────────────────────────────

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>aoaoe dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { font-size: 1.4em; margin-bottom: 16px; color: #58a6ff; }
  h2 { font-size: 1.1em; margin: 20px 0 8px; color: #8b949e; border-bottom: 1px solid #21262d; padding-bottom: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
  .card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 14px; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .session-name { font-weight: 600; font-size: 1em; }
  .status { font-size: 0.8em; padding: 2px 8px; border-radius: 12px; }
  .status-active { background: #1f6f2b; color: #3fb950; }
  .status-pending { background: #2d333b; color: #8b949e; }
  .status-paused { background: #4a3200; color: #d29922; }
  .status-completed { background: #1a3a4a; color: #58a6ff; }
  .status-failed { background: #4a1a1a; color: #f85149; }
  .health-bar { height: 6px; background: #21262d; border-radius: 3px; margin: 6px 0; overflow: hidden; }
  .health-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
  .health-healthy { background: #3fb950; }
  .health-ok { background: #58a6ff; }
  .health-degraded { background: #d29922; }
  .health-critical { background: #f85149; }
  .health-inactive { background: #484f58; }
  .goal { font-size: 0.85em; color: #8b949e; margin: 4px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .progress-entry { font-size: 0.8em; color: #8b949e; padding: 2px 0; border-top: 1px solid #21262d; }
  .progress-time { color: #484f58; }
  .meta { font-size: 0.75em; color: #484f58; margin-top: 6px; }
  .summary-bar { display: flex; gap: 16px; margin-bottom: 12px; font-size: 0.9em; }
  .summary-item { padding: 6px 12px; background: #161b22; border: 1px solid #21262d; border-radius: 6px; }
  .events { max-height: 200px; overflow-y: auto; }
  .event { font-size: 0.8em; padding: 3px 0; color: #8b949e; }
  .event-time { color: #484f58; }
  .refresh { font-size: 0.75em; color: #484f58; text-align: right; margin-top: 12px; }
  #error { color: #f85149; font-size: 0.85em; display: none; margin-bottom: 8px; }
</style>
</head>
<body>
<h1>aoaoe dashboard</h1>
<div id="error"></div>
<div class="summary-bar" id="summary"></div>
<h2>sessions</h2>
<div class="grid" id="tasks"></div>
<h2>supervisor events</h2>
<div class="events" id="events"></div>
<div class="refresh" id="refresh"></div>

<script>
const API = window.location.origin;
const REFRESH_MS = 5000;

async function fetchJson(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
  return res.json();
}

function statusClass(status) {
  return 'status status-' + (status || 'pending');
}

function healthClass(grade) {
  return 'health-fill health-' + (grade || 'inactive');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function refresh() {
  try {
    const [tasks, healths, progress, supervisor] = await Promise.all([
      fetchJson('/api/tasks'),
      fetchJson('/api/health'),
      fetchJson('/api/progress?since=8h'),
      fetchJson('/api/supervisor'),
    ]);

    const healthMap = {};
    healths.forEach(h => healthMap[h.session] = h);

    // summary
    const s = supervisor.summary;
    document.getElementById('summary').innerHTML =
      '<div class="summary-item">' + s.total + ' tasks</div>' +
      '<div class="summary-item" style="color:#3fb950">' + s.active + ' active</div>' +
      (s.pending > 0 ? '<div class="summary-item">' + s.pending + ' pending</div>' : '') +
      (s.paused > 0 ? '<div class="summary-item" style="color:#d29922">' + s.paused + ' paused</div>' : '') +
      (s.completed > 0 ? '<div class="summary-item" style="color:#58a6ff">' + s.completed + ' done</div>' : '') +
      '<div class="summary-item">avg health: ' + Math.round(healths.reduce((a,h) => a + h.score, 0) / (healths.length || 1)) + '</div>';

    // task cards
    const progressMap = {};
    progress.forEach(p => progressMap[p.session] = p.recentProgress || []);

    let html = '';
    tasks.forEach(t => {
      const h = healthMap[t.session] || { score: 0, grade: 'inactive', factors: [] };
      const recent = (progressMap[t.session] || []).slice(-3);
      html += '<div class="card">';
      html += '<div class="card-header"><span class="session-name">' + escHtml(t.session) + '</span><span class="' + statusClass(t.status) + '">' + escHtml(t.status) + '</span></div>';
      html += '<div class="health-bar"><div class="' + healthClass(h.grade) + '" style="width:' + Math.max(0, Math.min(100, h.score)) + '%"></div></div>';
      html += '<div class="meta">health: ' + escHtml(h.score + '/100 (' + h.grade + ')') + ' · ' + escHtml(h.factors.join(' · ')) + '</div>';
      html += '<div class="goal" title="' + escHtml(t.goal) + '">' + escHtml(t.goal) + '</div>';
      if (t.dependsOn && t.dependsOn.length) html += '<div class="meta">depends on: ' + escHtml(t.dependsOn.join(', ')) + '</div>';
      if (recent.length > 0) {
        recent.forEach(p => {
          html += '<div class="progress-entry"><span class="progress-time">' + p.ago + '</span> ' + escHtml(p.summary) + '</div>';
        });
      } else {
        html += '<div class="progress-entry">' + (t.lastProgressAgo ? 'last progress: ' + t.lastProgressAgo : 'no progress yet') + '</div>';
      }
      if (t.stuckNudgeCount > 0) html += '<div class="meta" style="color:#d29922">stuck nudges: ' + t.stuckNudgeCount + '</div>';
      html += '</div>';
    });
    document.getElementById('tasks').innerHTML = html;

    // events
    let evHtml = '';
    supervisor.recentEvents.forEach(e => {
      const d = new Date(e.at);
      evHtml += '<div class="event"><span class="event-time">' + escHtml(d.toLocaleTimeString()) + '</span> ' + escHtml(e.detail) + '</div>';
    });
    document.getElementById('events').innerHTML = evHtml || '<div class="event">no recent events</div>';

    document.getElementById('error').style.display = 'none';
    document.getElementById('refresh').textContent = 'last refresh: ' + new Date().toLocaleTimeString() + ' (every ' + (REFRESH_MS/1000) + 's)';
  } catch (err) {
    document.getElementById('error').textContent = 'fetch error: ' + err.message;
    document.getElementById('error').style.display = 'block';
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
</script>
</body>
</html>`;
}

// ── HTTP server ─────────────────────────────────────────────────────────────

function parseSince(url: URL): number {
  const raw = url.searchParams.get("since");
  if (!raw) return 24 * 60 * 60 * 1000;
  const match = raw.match(/^(\d+)(h|m|d)$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const [, n, unit] = match;
  const ms = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 86_400_000;
  return parseInt(n, 10) * ms;
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  try {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  // no CORS header — dashboard is same-origin, no cross-origin access needed
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");

  if (path === "/" || path === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHtml());
    return;
  }

  if (path === "/api/tasks") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(apiTasks()));
    return;
  }

  if (path === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(apiHealth()));
    return;
  }

  if (path === "/api/progress") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(apiProgress(parseSince(url))));
    return;
  }

  if (path === "/api/supervisor") {
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(apiSupervisor(limit)));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
  } catch (err) {
    try {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    } catch { /* response already started */ }
  }
}

export function startWebServer(port: number): { close: () => void } {
  // suppress noisy log lines when loading config/tasks for API responses
  process.env.AOAOE_QUIET = "1";

  const server = createServer(handleRequest);
  server.listen(port, "127.0.0.1", () => {
    console.log(`aoaoe dashboard: http://127.0.0.1:${port}`);
  });
  return { close: () => server.close() };
}
