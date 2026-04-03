# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v1.9.0

## What shipped in v1.9.0

**v1.9.0 — Fleet Federation, Output Archival, Runbook Generator, Custom Alert Rules**:
- `fleet-federation.ts`: `fetchPeerState()` queries other daemons via `/health` endpoint. `aggregateFederation()` merges peer states into unified overview (total sessions, tasks, health, cost). Ready for `/federation` TUI command.
- `output-archival.ts`: `archiveSessionOutput()` gzips old pane output to `~/.aoaoe/output-archive/`. Auto-prunes at 200 archives. `listArchives()` + `formatArchiveList()` for TUI. Ready for `/archives` command.
- `runbook-generator.ts`: `generateRunbooks()` analyzes audit trail for recurring patterns (stuck sessions, budget overruns, error recovery, task completion) and produces step-by-step playbooks with confidence scores. Ready for `/runbook-gen` command.
- `alert-rules.ts`: 5 built-in alert rules (fleet-health-critical, high-error-rate, cost-spike, all-stuck, no-active-sessions). `evaluateAlertRules()` checks conditions with configurable severity + cooldown. Ready for per-tick evaluation + `/alert-rules` command.

66 source modules. 102 test files. 3441 tests. 0 runtime deps.

## Ideas Backlog
- **Wire v1.9 modules into daemon** — /federation, /archives, /runbook-gen, /alert-rules + per-tick alert evaluation
- **Web dashboard v2** — real-time browser UI via SSE from daemon
- **Reasoner plugin system** — load custom backends as ESM modules
- **Session replay TUI player** — animated step-through with timing controls
- **Multi-reasoner parallel calls** — call backends concurrently, merge results
- **Alert rule DSL** — user-defined alert rules via config file
- **Federation auto-discovery** — daemons find each other via multicast/mDNS
- **Output archival to R2/S3** — remote storage for long-term retention
- **Runbook execution engine** — auto-execute generated runbooks step-by-step
- **Fleet health forecasting** — predict health trends from historical data
