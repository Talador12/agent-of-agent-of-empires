# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v3.2.0

## What shipped in v3.2.0

**v3.2.0 — Wire All Remaining: /session-diff /session-tag /compare /fleet-report + New Modules**:
- `session-snapshot-diff.ts` + `session-tag-manager.ts` + `session-compare.ts` + `fleet-summary-report.ts` — 4 new modules
- **`/session-diff <name>`** — show recent output lines for a session (ANSI-stripped)
- **`/session-tag [name key=value]`** — set/show key-value tags on sessions
- **`/compare <a> <b>`** — side-by-side session comparison (status, cost, progress, goal)
- **`/fleet-report`** — compact text summary for Slack/clipboard (health, sessions, tasks, cost, issues)
- All v2.5, v2.6, v3.1 modules now fully wired with TUI commands

83 TUI commands. 82 source modules. 3536 tests. 0 runtime deps.

## Ideas Backlog (v4.0)
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Daemon OpenTelemetry traces** — distributed tracing
- **Federation auto-discovery** — mDNS peer finding
- **Session replay TUI player** — animated step-through
- **Alert rule inheritance** — child rules inherit parent severity
- **Fleet capacity planning** — historical utilization dashboard
- **Multi-reasoner parallel** — concurrent calls + merge
- **Workflow DAG editor** — interactive definition
- **Output archival to R2/S3** — remote storage
