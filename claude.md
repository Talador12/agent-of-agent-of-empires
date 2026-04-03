# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v2.2.0

## What shipped in v2.2.0

**v2.2.0 — Wire v2.1: /tail, /health-forecast, /workflow-viz Live in Daemon**:
- **`/tail <session> [count] [pattern]` TUI command** — live tail of any session's output. Shows last N lines with ANSI stripping and optional regex highlighting. `parseTailArgs()` supports `adventure 50 error` syntax.
- **`/health-forecast` TUI command** — fleet health trend prediction using linear regression. Shows current health, 1h/4h/24h projections, trend direction, and estimated SLA breach time.
- **`/workflow-viz` TUI command** — ASCII DAG rendering for active workflow and/or workflow chain. Workflow: `┌├│└` box chars with stage→task hierarchy. Chain: `╔║╚` double-line with dependency arrows and depth grouping.

72 TUI commands. 70 source modules. 3470 tests. 0 runtime deps.

## Ideas Backlog (v3.0)
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Federation auto-discovery** — mDNS peer finding
- **Output archival to R2/S3** — remote storage
- **Runbook execution engine** — auto-execute generated runbooks
- **Session replay TUI player** — animated step-through
- **Multi-reasoner parallel** — concurrent backend calls + merge
- **Alert rule composition** — AND/OR combining conditions
- **Fleet-wide grep** — regex search across archived outputs
- **Daemon metrics export** — Prometheus/OpenTelemetry metrics endpoint
