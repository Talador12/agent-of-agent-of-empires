# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v3.3.0

## What shipped in v3.3.0

**v3.3.0 — Session Timeline + Fleet Changelog**:
- `session-timeline.ts`: `buildTimeline()` builds chronological events from task createdAt + progress entries + completedAt. Icons: ★ milestone, → progress. `formatTimeline()` for TUI. **`/task-timeline <name>`** command.
- `fleet-changelog.ts`: `generateChangelog(sinceMs)` builds deduplicated event list from audit trail. Supports duration parsing (`1h`, `30m`, `2d`). **`/changelog [duration]`** command.

85 TUI commands. 84 source modules. 3543 tests. 0 runtime deps.

## Ideas Backlog (v4.0)
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Daemon OpenTelemetry traces** — distributed tracing
- **Federation auto-discovery** — mDNS peer finding
- **Session replay TUI player** — animated step-through
- **Multi-reasoner parallel** — concurrent calls + merge
- **Workflow DAG editor** — interactive definition
- **Output archival to R2/S3** — remote storage
- **Alert rule inheritance** — child rules inherit severity
- **Fleet capacity planning** — historical utilization dashboard
