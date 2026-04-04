# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v6.3.0

## What shipped in v6.3.0

**v6.3.0 — Distributed Lock, Output Correlation, Utilization Forecaster**:
- `daemon-distributed-lock.ts`: PID-based lockfile with staleness detection. Acquire/release, stale reclaim after configurable timeout. **`/daemon-lock`** command.
- `session-output-correlation.ts`: Find related sessions via keyword frequency overlap in recent output. Jaccard-style similarity scoring above configurable threshold. **`/output-correlation`** command.
- `fleet-utilization-forecaster.ts`: Predict next-day utilization from day-of-week hourly patterns. Peak hour, avg utilization, confidence scoring, sparkline forecast. **`/util-forecast`** command.

175 TUI commands. 174 source modules. 4626 tests. 0 runtime deps.

## What shipped in v6.2.0

**v6.2.0 — Cost Trend, Complexity Tagger, Event Sourcing**:
- `fleet-cost-trend.ts`: Week-over-week cost trend. **`/cost-trend`** command.
- `goal-complexity-tagger.ts`: Complexity level tagging. **`/complexity`** command.
- `daemon-event-sourcing.ts`: Event store with replay. **`/event-store`** command.

## What shipped in v6.1.0

**v6.1.0 — Cost Optimizer, Progress Heatmap, Module Deps**:
- `fleet-cost-optimizer.ts`: Cost reduction recommendations. **`/cost-optimizer`** command.
- `goal-progress-heatmap.ts`: Hourly progress heatmap. **`/progress-heatmap`** command.
- `daemon-module-deps.ts`: Module dependency graph. **`/module-deps`** command.

## Ideas Backlog (v6.4+)
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
- **Daemon heartbeat federation** — cross-host daemon health monitoring
- **Session output AI summarizer** — opt-in LLM summaries for handoffs
- **Fleet session priority matrix** — 2D urgency vs importance matrix
- **Daemon config version control** — git-style config history with diff
- **Fleet cost allocation optimizer** — minimize cost while maintaining SLA
- **Goal dependency auto-generator** — infer deps from code import analysis
- **Session output search v2** — regex + fuzzy + semantic search across fleet
- **Fleet snapshot time machine** — interactive snapshot browser with comparison
- **Goal progress sparkline dashboard** — all-session sparklines in one view
- **Daemon tick budget allocator** — allocate compute budget per tick phase
- **Session output regex library** — curated patterns for common tools/frameworks
