# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v1.7.0

## What shipped in v1.7.0

**v1.7.0 — Wire v1.6: A/B Stats, Workflow Chain, Workflow Forecast, Cost Preview**:
- **`/ab-stats` TUI command** — shows A/B reasoning trial results: wins, losses, ties, and which backend is performing better.
- **`/workflow-chain` TUI command** — shows active workflow chain state with dependency arrows and status icons.
- **`/workflow-forecast <template>` TUI command** — previews cost + time estimate for a workflow template before creating it.
- **Cost forecast auto-shown on `/workflow-new`** — when creating a workflow from template, the cost forecast is now displayed automatically before the workflow starts.
- **Workflow chain wired into main loop** — `advanceChain()` runs every tick, auto-activating dependent workflows when predecessors complete.
- **A/B reasoning tracker instantiated** — ready for the reasoning pipeline to feed trial results.

65 TUI commands. 62 source modules. 3409 tests. 0 runtime deps.

## Ideas Backlog
- **Fleet federation** — coordinate across multiple aoaoe daemons via HTTP
- **Web dashboard v2** — real-time browser UI via SSE from daemon
- **Reasoner plugin system** — load custom backends as ESM modules
- **Session replay TUI player** — animated step-through with timing controls
- **Multi-reasoner parallel calls** — call backends concurrently, merge results
- **Workflow retry policies** — auto-retry failed stages with configurable strategies
- **Workflow visualization** — ASCII DAG rendering for workflow chains
- **Fleet health alerting rules** — custom alert rules beyond SLA threshold
- **Session output archival** — compress + archive old outputs to disk/S3
- **Operator runbook generator** — auto-generate runbooks from audit trail patterns
