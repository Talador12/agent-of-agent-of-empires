# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v6.1.0

## What shipped in v6.1.0

**v6.1.0 — Cost Optimizer, Progress Heatmap, Module Deps**:
- `fleet-cost-optimizer.ts`: Actionable cost reduction recommendations: throttle high-burn, pause idle, complete near-done, review cost hogs. Potential savings estimate, priority-sorted. **`/cost-optimizer`** command.
- `goal-progress-heatmap.ts`: Hourly progress visualization. 24-column heatmap with Unicode heat characters (░▒▓█). Peak hour detection, normalized rendering. **`/progress-heatmap`** command.
- `daemon-module-deps.ts`: Inter-module dependency graph. Roots/leaves, category breakdown (core/intelligence/tui/cli/utility), most-depended module identification. **`/module-deps`** command.

169 TUI commands. 168 source modules. 4560 tests. 0 runtime deps.

## What shipped in v6.0.0

**v6.0.0 — Dep Graph Export, Perf Regression, Compliance Reports**:
- `goal-dep-graph-export.ts`: DOT/Mermaid/ASCII export. **`/dep-graph-export`** command.
- `daemon-perf-regression.ts`: Tick time regression detector. **`/perf-regression`** command.
- `fleet-compliance-report.ts`: 5-section compliance report. **`/compliance-report`** command.

## What shipped in v5.9.0

**v5.9.0 — Graceful Shutdown, Dep Impact, Runbook Library**:
- `daemon-graceful-shutdown.ts`: Phased shutdown. **`/shutdown-status`** command.
- `goal-dep-impact.ts`: Downstream impact analysis. **`/dep-impact`** command.
- `fleet-runbook-library.ts`: 6 operational runbooks. **`/runbook`** command.

## Ideas Backlog (v6.2+)
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
- **Daemon plugin marketplace** — discover and install community hooks
- **Daemon heartbeat federation** — cross-host daemon health monitoring
- **Session output AI summarizer** — opt-in LLM summaries for handoffs
- **Fleet session priority matrix** — 2D urgency vs importance matrix
- **Session output anomaly classifier** — categorize by root cause type
- **Fleet cost trend analyzer** — week-over-week cost trend with projection
- **Goal complexity auto-tagger** — tag goals with estimated complexity level
- **Daemon event sourcing** — full event-sourced state reconstruction
- **Session output search v2** — regex + fuzzy + semantic search across fleet
- **Fleet utilization forecaster** — predict next-day utilization from patterns
