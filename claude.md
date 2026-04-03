# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v5.5.0

## What shipped in v5.5.0

**v5.5.0 — Ops Dashboard, Dep Auto-Repair, Pattern Evolution**:
- `fleet-ops-dashboard.ts`: Full-screen fleet monitor with box-drawing: session table (status/health/cost/progress/sentiment), metrics bar, recent events, capacity. **`/ops-dashboard`** command.
- `goal-dep-auto-repair.ts`: Fix broken dependency chains from completed/removed/failed tasks. Cycle detection via DFS. Apply repairs (remove stale deps). **`/dep-repair`** command.
- `session-pattern-evolution.ts`: Track output pattern frequency over time windows. Detect appeared/disappeared/increased/decreased shifts. Sparkline trends per pattern. **`/pattern-evolution`** command.

151 TUI commands. 150 source modules. 4374 tests. 0 runtime deps.

## What shipped in v5.4.0

**v5.4.0 — Output Dedup, Config Migration, Progress Prediction**:
- `session-output-dedup.ts`: Collapse repeated lines. **`/output-dedup`** command.
- `daemon-config-migration.ts`: Auto-upgrade config v1→v5. **`/config-migrate`** command.
- `goal-progress-prediction.ts`: Statistical completion prediction. **`/progress-predict`** command.

## What shipped in v5.3.0

**v5.3.0 — Webhook Integrations, Structured Log, State Export**:
- `fleet-webhook-integrations.ts`: Slack/Teams/Discord payloads. **`/webhook-preview`** command.
- `session-structured-log.ts`: 8 event type parser. **`/structured-log`** command.
- `daemon-state-portable.ts`: Portable state export. **`/state-export`** command.

## Ideas Backlog (v5.6+)
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
- **Fleet session tagging taxonomy** — hierarchical tag system with inheritance
- **Session output knowledge graph** — extract entities from output
- **Daemon memory profiler** — track per-module memory usage over time
- **Fleet alert dashboard** — unified view of all active/recent alerts with acknowledge
- **Session output language detector** — detect programming language from output patterns
- **Goal SLA enforcement** — per-goal time limits with auto-escalation on breach
- **Daemon audit report generator** — periodic compliance audit reports from trail
