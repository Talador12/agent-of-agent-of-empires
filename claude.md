# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v6.2.0

## What shipped in v6.2.0

**v6.2.0 — Cost Trend, Complexity Tagger, Event Sourcing**:
- `fleet-cost-trend.ts`: Week-over-week cost trend with daily snapshots, rolling averages, direction detection, sparkline, weekly/monthly projections. **`/cost-trend`** command.
- `goal-complexity-tagger.ts`: Tag goals with complexity level (trivial→epic). Keyword scope analysis, description length, deps, multi-task indicators. Score 0-100. **`/complexity`** command.
- `daemon-event-sourcing.ts`: Immutable event store with append, query (type/source/time-range), type counts, reducer-based replay for state reconstruction. **`/event-store`** command.

172 TUI commands. 171 source modules. 4594 tests. 0 runtime deps.

## What shipped in v6.1.0

**v6.1.0 — Cost Optimizer, Progress Heatmap, Module Deps**:
- `fleet-cost-optimizer.ts`: Cost reduction recommendations. **`/cost-optimizer`** command.
- `goal-progress-heatmap.ts`: Hourly progress heatmap. **`/progress-heatmap`** command.
- `daemon-module-deps.ts`: Module dependency graph. **`/module-deps`** command.

## What shipped in v6.0.0

**v6.0.0 — Dep Graph Export, Perf Regression, Compliance Reports**:
- `goal-dep-graph-export.ts`: DOT/Mermaid/ASCII export. **`/dep-graph-export`** command.
- `daemon-perf-regression.ts`: Tick time regression detector. **`/perf-regression`** command.
- `fleet-compliance-report.ts`: 5-section compliance report. **`/compliance-report`** command.

## Ideas Backlog (v6.3+)
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
- **Fleet time-travel** — rewind to any snapshot and compare
- **Fleet session migration** — move sessions between hosts
- **Daemon heartbeat federation** — cross-host daemon health monitoring
- **Session output AI summarizer** — opt-in LLM summaries for handoffs
- **Fleet session priority matrix** — 2D urgency vs importance matrix
- **Session output anomaly classifier** — categorize by root cause type
- **Fleet utilization forecaster** — predict next-day utilization
- **Daemon config version control** — git-style config history with diff
- **Session output correlation engine** — find related changes across sessions
- **Fleet cost allocation optimizer** — minimize total cost while maintaining SLA
- **Goal dependency auto-generator** — infer deps from code import analysis
- **Daemon distributed lock** — prevent concurrent daemon instances
