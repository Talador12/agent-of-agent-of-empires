# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v6.0.0

## What shipped in v6.0.0

**v6.0.0 — Dep Graph Export, Perf Regression Detector, Compliance Reports**:
- `goal-dep-graph-export.ts`: Export dependency graph as DOT (Graphviz), Mermaid, or ASCII. Graph stats (nodes/edges/roots/leaves), cycle-safe ASCII rendering. **`/dep-graph-export [dot|mermaid|ascii]`** command.
- `daemon-perf-regression.ts`: Detect tick processing time regressions via rolling median baseline. Warning at 2x, critical at 4x baseline. Recent alerts history. **`/perf-regression`** command.
- `fleet-compliance-report.ts`: 5-section compliance report: policy, SLA, incidents, cost management, fleet health. Scored 0-100, graded compliant/at-risk/non-compliant. Markdown + TUI output. **`/compliance-report`** command.

166 TUI commands. 165 source modules. 4530 tests. 0 runtime deps.

## What shipped in v5.9.0

**v5.9.0 — Graceful Shutdown, Dep Impact, Runbook Library**:
- `daemon-graceful-shutdown.ts`: Phased shutdown. **`/shutdown-status`** command.
- `goal-dep-impact.ts`: Downstream impact analysis. **`/dep-impact`** command.
- `fleet-runbook-library.ts`: 6 operational runbooks. **`/runbook`** command.

## What shipped in v5.8.0

**v5.8.0 — Startup Profiler, Affinity Groups, Clipboard**:
- `daemon-startup-profiler.ts`: Module init timing. **`/startup-profile`** command.
- `fleet-affinity-groups.ts`: Auto-group by repo. **`/affinity-groups`** command.
- `session-clipboard.ts`: Cross-platform clipboard. **`/clipboard`** command.

## Ideas Backlog (v6.1+)
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
- **Goal templating engine** — Mustache-style templates with variables
- **Fleet multi-tenant isolation** — separate namespaces per team
- **Daemon memory profiler** — track per-module memory usage over time
- **Session output search v2** — regex + fuzzy + semantic search
- **Daemon heartbeat federation** — cross-host daemon health monitoring
- **Session output AI summarizer** — opt-in LLM summaries for handoffs
- **Fleet session priority matrix** — 2D matrix of urgency vs importance
- **Goal progress heatmap** — hourly progress visualization across fleet
- **Daemon module dependency graph** — visualize inter-module dependencies
- **Session output anomaly classifier** — categorize anomalies by root cause type
- **Fleet cost optimization advisor** — actionable cost reduction recommendations
