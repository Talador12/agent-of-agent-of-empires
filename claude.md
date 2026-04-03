# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v2.5.0

## What shipped in v2.5.0

**v2.5.0 — Platform Completion: Metrics, Alert Composition, Fleet Grep, Runbook Execution**:
- `metrics-export.ts`: Prometheus-compatible text exposition format. 18 metrics: fleet health, session/task counts, cost, reasoner calls/cost, cache hits/misses, alerts, nudges, poll interval, uptime. `buildMetricsSnapshot()` + `formatPrometheusMetrics()`. Ready for `/metrics` endpoint.
- `alert-composer.ts`: AND/OR composition of alert conditions. `composeAnd(["fleetHealth < 40", "errorSessions > 2"])` requires all true. `composeOr()` requires any true. `parseComposedCondition()` handles string, `{and: [...]}`, `{or: [...]}` formats.
- `fleet-grep.ts`: regex search across gzipped output archives. `grepArchives()` decompresses and searches up to 20 most recent archives. Returns ranked hits with line numbers and match positions. Ready for `/fleet-grep` command.
- `runbook-executor.ts`: step-by-step execution of generated runbooks. `createExecution()` → `advanceExecution()` cycle with running/completed/skipped/failed states. `skipStep()` and `failExecution()` for control flow. Ready for `/runbook-exec` command.

74 source modules. 110 test files. 3491 tests. 0 runtime deps.

### Platform Summary (v2.5.0)
| Category | Count |
|----------|-------|
| Source modules | 74 |
| Test files | 110 |
| TUI commands | 72 |
| CLI subcommands | 20 |
| Tests | 3491 |
| Reasoning gates | 8 |
| Alert rules (built-in) | 5 |
| Workflow templates | 5 |
| Session templates | 6 |
| Prometheus metrics | 18 |
| Runtime deps | 0 |
| Tagged releases | v1.0.0, v1.3.0, v2.0.0 |

## Ideas Backlog (v3.0)
- **Wire v2.5 modules** — /metrics, /fleet-grep, /runbook-exec, composed alert rules loading
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Federation auto-discovery** — mDNS peer finding
- **Output archival to R2/S3** — remote storage backend
- **Session replay TUI player** — animated step-through with controls
- **Multi-reasoner parallel** — concurrent calls + merge
- **Daemon OpenTelemetry traces** — distributed tracing for reasoning pipeline
- **Workflow DAG editor** — interactive ASCII workflow definition
- **Fleet cost allocation tags** — label sessions by team/project
