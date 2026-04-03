# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v2.1.0

## What shipped in v2.1.0

**v2.1.0 — Alert DSL, Health Forecasting, Session Tail, Workflow Visualization**:
- `alert-rule-dsl.ts`: user-defined alert rules via config. DSL: `"fleetHealth < 40"`, `"errorSessions > 2"`, etc. `parseCondition()` compiles to functions. `validateCondition()` for pre-flight checks. 6 fields × 6 operators supported.
- `health-forecast.ts`: linear regression on health time series. `forecastHealth()` projects 1h/4h/24h health, computes trend (improving/stable/declining), estimates SLA breach time. Clamps projections to 0-100.
- `session-tail.ts`: `tailSession()` extracts last N lines with ANSI stripping + pattern highlighting (`>>>match<<<`). `parseTailArgs()` parses `/tail <session> [count] [pattern]`. Ready for `/tail` TUI command.
- `workflow-viz.ts`: `renderWorkflowDag()` draws ASCII pipeline with stage/task hierarchy + arrows. `renderChainDag()` draws dependency DAG with depth grouping. `renderWorkflowCompact()` single-line summary: `[○→▶→✓] name`. Ready for `/workflow-viz` TUI command.

70 source modules. 106 test files. 3470 tests. 0 runtime deps.

## Ideas Backlog (v3.0)
- **Wire v2.1 modules** — /tail, /health-forecast, /workflow-viz, custom alert rule loading from config
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Federation auto-discovery** — mDNS peer finding
- **Output archival to R2/S3** — remote storage
- **Runbook execution engine** — auto-execute generated runbooks
- **Session replay TUI player** — animated step-through
- **Multi-reasoner parallel** — concurrent backend calls + merge
- **Alert rule composition** — AND/OR combining multiple conditions
- **Fleet-wide grep** — regex search across all archived outputs
