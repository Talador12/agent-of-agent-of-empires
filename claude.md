# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v3.0.0

## What shipped in v3.0.0

**v3.0.0 — All Modules Wired: 79 TUI Commands, 78 Source Modules, 3518 Tests**

Final wiring release. Every standalone module from v2.5 and v2.6 is now live in the daemon with TUI commands:

- **`/metrics`** — Prometheus-compatible metrics snapshot (18 metrics: health, sessions, tasks, cost, reasoner, cache, alerts, nudges, poll, uptime)
- **`/fleet-grep <pattern>`** — regex search across gzipped output archives
- **`/runbook-exec`** — step-by-step execution of auto-generated runbooks (advance with each call)
- **`/clone <source> <name> [goal]`** — clone a session for A/B experimentation
- **`/similar-goals`** — Jaccard similarity detection for overlapping task goals
- **`/cost-tags [key]`** — group session costs by tag (team, project, etc.)
- **`/scaling`** — predictive pool scaling recommendation based on utilization

### Platform Stats (v3.0.0)
| Metric | Value |
|--------|-------|
| Source modules | 78 |
| Test files | 114 |
| Tests | 3518 |
| TUI commands | 79 |
| CLI subcommands | 20 |
| Reasoning gates | 8 |
| Prometheus metrics | 18 |
| Alert rules | 5 |
| Workflow templates | 5 |
| Session templates | 6 |
| Tagged releases | v1.0.0, v1.3.0, v2.0.0, v2.5.0, v3.0.0 |
| Runtime deps | 0 |

## Ideas Backlog (v4.0)
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Daemon OpenTelemetry traces** — distributed tracing
- **Federation auto-discovery** — mDNS peer finding
- **Workflow DAG editor** — interactive definition
- **Session replay TUI player** — animated step-through
- **Alert rule inheritance** — child rules inherit parent severity
- **Fleet capacity planning** — historical utilization dashboard
- **Output archival to R2/S3** — remote storage
- **Multi-reasoner parallel** — concurrent calls + merge
