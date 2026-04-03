# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v3.1.0

## What shipped in v3.1.0

**v3.1.0 — Session Snapshot Diffs + Tag Manager**:
- `session-snapshot-diff.ts`: `diffSessionOutput()` computes line-level diff between two output snapshots showing added/removed lines. `formatSessionDiff()` for TUI with +/- indicators. Useful for understanding what changed while the operator was away.
- `session-tag-manager.ts`: `SessionTagStore` with `setTag()`, `getTag()`, `removeTag()`, `findByTag()`. Tags are key-value pairs (team, project, priority, etc.) attached to sessions. `formatTagStore()` for TUI. Integrates with cost-allocation-tags for grouped reporting.

80 source modules. 116 test files. 3531 tests. 79 TUI commands. 0 runtime deps.

## Ideas Backlog (v4.0)
- **Wire v3.1 modules** — /session-diff, /tag, /tags TUI commands
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Daemon OpenTelemetry traces** — distributed tracing
- **Federation auto-discovery** — mDNS peer finding
- **Workflow DAG editor** — interactive definition
- **Session replay TUI player** — animated step-through
- **Alert rule inheritance** — child rules inherit parent severity
- **Fleet capacity planning** — historical utilization dashboard
- **Multi-reasoner parallel** — concurrent calls + merge
