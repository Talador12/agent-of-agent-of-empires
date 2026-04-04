# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v6.4.0

## What shipped in v6.4.0

**v6.4.0 — Snapshot Time Machine, Sparkline Dashboard, Tick Budget**:
- `fleet-snapshot-time-machine.ts`: Interactive snapshot browser. Take snapshots, compare any two, diff added/removed sessions + health/cost deltas. Time-range queries. **`/time-machine [snap|diff A B]`** command.
- `goal-sparkline-dashboard.ts`: All-session progress sparklines in one view. Unicode sparkline chars, trend detection (up/down/flat), sorted worst-first. **`/sparkline-dash`** command.
- `daemon-tick-budget.ts`: Allocate compute budget per tick phase (poll 30%, reason 40%, execute 20%, post-tick 10%). Overrun detection + tracking, worst-phase identification. **`/tick-budget`** command.

178 TUI commands. 177 source modules. 4659 tests. 0 runtime deps.

## What shipped in v6.3.0

**v6.3.0 — Distributed Lock, Output Correlation, Utilization Forecaster**:
- `daemon-distributed-lock.ts`: PID lockfile. **`/daemon-lock`** command.
- `session-output-correlation.ts`: Keyword overlap. **`/output-correlation`** command.
- `fleet-utilization-forecaster.ts`: Day-of-week prediction. **`/util-forecast`** command.

## What shipped in v6.2.0

**v6.2.0 — Cost Trend, Complexity Tagger, Event Sourcing**:
- `fleet-cost-trend.ts`: Week-over-week trend. **`/cost-trend`** command.
- `goal-complexity-tagger.ts`: Complexity tagging. **`/complexity`** command.
- `daemon-event-sourcing.ts`: Event store + replay. **`/event-store`** command.

## Ideas Backlog (v6.5+)
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
- **Session affinity routing** — assign sessions to reasoner instances
- **Cross-session knowledge transfer** — share learnings between sessions
- **Reasoner response quality scoring** — rate LLM responses by success rate
- **Fleet topology visualization** — interactive dependency graph
- **Session hibernation** — save full state to disk, resume on demand
- **Audit trail retention policies** — configurable TTL with archival
- **Fleet health dashboard API** — REST API for Grafana/Datadog
- **Batch goal assignment** — YAML manifest for bulk goal loading
- **Parallel goal execution** — split goals across sessions
- **Fleet-wide rollback** — coordinated revert across all sessions
- **Reasoner chain-of-thought logger** — capture LLM reasoning steps
- **Session sandbox mode** — isolated environments with rollback
- **Daemon remote control API** — REST API for external commands
- **Daemon heartbeat federation** — cross-host daemon health monitoring
- **Fleet session priority matrix** — 2D urgency vs importance matrix
- **Daemon config version control** — git-style config history with diff
- **Fleet cost allocation optimizer** — minimize cost while maintaining SLA
- **Goal dependency auto-generator** — infer deps from code import analysis
- **Session output regex library** — curated patterns for common tools
- **Fleet multi-cluster management** — manage multiple daemon fleets from one TUI
- **Daemon tick trace exporter** — export per-tick traces as OpenTelemetry spans
- **Session goal mutation tracker** — track how goals change over time
- **Fleet cost chargeback engine** — assign costs to teams/projects with invoicing
- **Goal completion prediction ensemble** — combine multiple prediction methods
