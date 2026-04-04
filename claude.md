# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v6.5.0

## Current State

**180 source modules**, **181 TUI commands**, **4688 tests**, **zero runtime dependencies**.
~54,000 lines of TypeScript. Node stdlib only (`node:test`, `node:fs`, `node:crypto`, etc).

The project is an autonomous supervisor daemon for AI coding sessions. It observes
tmux panes, reasons about what it sees (via OpenCode or Claude Code), and acts.
On top of the core poll→reason→execute loop, 138 intelligence modules run every
daemon tick without LLM calls — pure computation covering fleet observability,
cost management, goal tracking, scheduling, health monitoring, and operator tooling.

Every module follows the same pattern: standalone `.ts` file with pure functions
or a stateful class, a `format*()` function returning `string[]` for TUI display,
a test file, wired into `input.ts` (handler type + slash command) and `index.ts`
(import + instantiation + TUI handler).

## What Just Shipped (v3.4.0 → v6.5.0)

This extended session shipped **90+ modules** across 30+ releases, from v3.4.0
through v6.5.0. Every release adds 3 modules + tests + wiring + docs. The
development session summary in AGENTS.md has the full version-by-version breakdown.

Key categories of modules shipped:
- **Fleet intelligence**: idle detection, goal conflicts, leaderboard, health history
- **Cost management**: anomaly throttle, forecast alerts, budget planner, chargeback, trends, optimizer
- **Goal tracking**: auto-priority, cascading, confidence, NL parser, complexity, mutations, decomp quality
- **Observability**: event bus, incident timeline, sentiment, pattern evolution, structured log
- **Operations**: shift handoff, compliance, runbooks, readiness, auto-scaler, diagnostics
- **Debugging**: action replay, heartbeat, config diff, perf regression, output diff, annotations
- **Infrastructure**: state machine, config profiles, hot-swap, graceful shutdown, distributed lock, process supervisor
- **Visualization**: leaderboard, heatmap, sparklines, ops dashboard, dep graph export, time machine
- **Integration**: webhook integrations, clipboard, transcript export, state export, daily digest

## Ambitious Ideas for Fresh Context

These are the **biggest, most impactful items** from the roadmap — each would be
a meaningful multi-file effort worth dedicating a full context window to:

### 1. Web Dashboard v2 (SSE-based browser UI)
The flagship missing feature. Build a real-time browser dashboard using Server-Sent
Events from the existing health endpoint. Show fleet state, session outputs, cost
charts, incident timeline — all live-updating. Would need:
- `src/web-dashboard.ts` — HTTP server with SSE endpoint
- `src/web-dashboard-routes.ts` — API routes for all fleet data
- `src/web-dashboard-client.ts` — Minimal HTML/JS client (inline, no build step)
- Wire into existing health server, reuse all existing `format*()` functions
- Could be the "v7.0.0" release — biggest single feature ever

### 2. Daemon Remote Control API (REST API for external tools)
Enable external tools (Grafana, custom scripts, CI/CD) to control the daemon:
- GET endpoints for every fleet metric (reuse existing modules)
- POST endpoints for actions (pause/resume/nudge/scale)
- WebSocket for live event streaming
- OpenAPI spec generation from the route definitions
- Authentication via bearer token

### 3. Reasoner Plugin System (ESM module loading)
Load custom reasoning backends as ESM modules:
- Plugin manifest format (name, version, init function, capabilities)
- Dynamic `import()` loading from a plugins directory
- Plugin lifecycle (init, validate, swap, disable)
- Could integrate with existing hot-swap module for version management

### 4. Daemon OpenTelemetry Traces (distributed tracing)
Full tracing for every daemon tick:
- Span per phase (poll, reason, execute, post-tick)
- Trace context propagation through intelligence modules
- Export to Jaeger/Zipkin/OTLP
- Integrate with existing tick profiler + perf regression detector

### 5. Federation Auto-Discovery (mDNS peer finding)
Enable multiple daemon instances to find each other on a LAN:
- mDNS service advertisement + discovery
- Peer health exchange
- Coordinated session scheduling across hosts
- Build on existing fleet-federation module

### 6. Session Hibernation (full state save/resume)
Save complete session state to disk and resume later:
- Serialize all in-memory state for a session
- Checkpoint file format with versioning
- Resume from checkpoint without losing context
- Build on existing session-checkpoint module

### 7. Multi-Reasoner Parallel (concurrent LLM calls + merge)
Call multiple LLM backends simultaneously and merge results:
- Fan-out to 2-3 backends per observation
- Merge/vote on actions (majority wins, confidence weighting)
- Build on existing multi-reasoner + A/B reasoning modules

### 8. Workflow DAG Editor (interactive definition)
Interactive TUI for defining and editing workflow DAGs:
- ASCII-based node/edge editing
- Validate against workflow-engine rules
- Save/load workflow definitions
- Build on existing workflow-engine + workflow-viz modules

### 9. Fleet Time-Travel (full state rewind)
Rewind fleet state to any historical snapshot and explore:
- Full state reconstruction from event store
- Side-by-side comparison of any two time points
- "What-if" analysis (replay with different config)
- Build on existing event-sourcing + snapshot-compression + time-machine modules

### 10. Session Sandbox Mode (isolated environments with rollback)
Run sessions in isolated environments:
- Git branch isolation per session
- Filesystem snapshot before each action
- Automatic rollback on failure
- "Safe mode" that prevents any destructive operations

## Standard Backlog (smaller items, 1 module each)
- Alert rule inheritance — child rules inherit severity
- Fleet capacity planning — historical utilization dashboard
- Session affinity routing — assign sessions to reasoner instances
- Cross-session knowledge transfer — share learnings between sessions
- Audit trail retention policies — configurable TTL with archival
- Batch goal assignment — YAML manifest for bulk goal loading
- Parallel goal execution — split goals into sub-goals across sessions
- Fleet-wide rollback — coordinated revert across all sessions
- Session output search v2 — regex + fuzzy + semantic search
- Daemon heartbeat federation — cross-host daemon health monitoring
- Fleet session priority matrix — 2D urgency vs importance matrix
- Daemon config version control — git-style config history with diff
- Fleet cost allocation optimizer — minimize cost while maintaining SLA
- Goal dependency auto-generator — infer deps from code import analysis
- Session output regex library — curated patterns for common tools
- Fleet multi-cluster management — manage multiple daemon fleets from one TUI

## Session Workflow (for AI agents)

When asked to continue work on this project:
- **Do multiple roadmap items per request.** Ship 3 features in a single pass:
  module + tests + wiring + docs. Don't stop at one.
- **Add new roadmap ideas** to this file's Ideas Backlog.
- **Update both files every commit**: this file (version, shipped items, counts)
  and `AGENTS.md` (source layout table, intelligence module descriptions, test counts).
- Follow the established pattern: standalone module → test → wire into input.ts +
  index.ts → update docs. Each module is a pure function or stateful class,
  zero runtime deps, includes a `format*()` function returning `string[]` for TUI.
- **Add this response to AGENTS.md** — every session's shipped summary goes into
  the development session summary table.
