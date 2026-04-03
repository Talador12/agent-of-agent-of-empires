# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v5.6.0

## What shipped in v5.6.0

**v5.6.0 — Alert Dashboard, Language Detection, Goal SLA Enforcement**:
- `fleet-alert-dashboard.ts`: Unified alert view aggregating incidents, cost, compliance, health, watchdog. Acknowledge/dismiss. Severity counts. **`/alert-dashboard [ack N]`** command.
- `session-lang-detector.ts`: Detect programming language from output (10 languages: TS, JS, Python, Rust, Go, Java, C/C++, Ruby, Shell, SQL). Multi-signal confidence scoring. **`/lang-detect`** command.
- `goal-sla-enforcement.ts`: Per-goal time limits with auto-escalation. Register SLAs, check status (ok/warning/breached), breach detection. **`/goal-sla [set session hours]`** command.

154 TUI commands. 153 source modules. 4410 tests. 0 runtime deps.

## What shipped in v5.5.0

**v5.5.0 — Ops Dashboard, Dep Auto-Repair, Pattern Evolution**:
- `fleet-ops-dashboard.ts`: Full-screen fleet monitor. **`/ops-dashboard`** command.
- `goal-dep-auto-repair.ts`: Fix broken dep chains. **`/dep-repair`** command.
- `session-pattern-evolution.ts`: Pattern frequency tracking. **`/pattern-evolution`** command.

## What shipped in v5.4.0

**v5.4.0 — Output Dedup, Config Migration, Progress Prediction**:
- `session-output-dedup.ts`: Collapse repeated lines. **`/output-dedup`** command.
- `daemon-config-migration.ts`: Auto-upgrade config. **`/config-migrate`** command.
- `goal-progress-prediction.ts`: Statistical prediction. **`/progress-predict`** command.

## Ideas Backlog (v5.7+)
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
- **Daemon audit report generator** — periodic compliance reports from trail
- **Fleet session auto-scaler** — add/remove sessions based on queue depth
- **Goal progress gamification** — XP/levels for sessions based on completions
- **Session output diff stream** — real-time diff stream for external consumers
- **Fleet cost waterfall chart** — visualize cost accumulation over time per session
