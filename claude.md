# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v5.8.0

## What shipped in v5.8.0

**v5.8.0 — Startup Profiler, Affinity Groups, Session Clipboard**:
- `daemon-startup-profiler.ts`: Measure module init time for cold-start optimization. Per-module start/end timing, slowest module ID, threshold filtering, percentage bars. **`/startup-profile`** command.
- `fleet-affinity-groups.ts`: Auto-group sessions by repo path similarity. Same basename = 90% match, shared prefix = proportional. Threshold-gated grouping. **`/affinity-groups`** command.
- `session-clipboard.ts`: Copy output snippets to system clipboard. Cross-platform (pbcopy/xclip/xsel/wl-copy/powershell). ANSI stripping, maxLines, preview. **`/clipboard <session>`** command.

160 TUI commands. 159 source modules. 4471 tests. 0 runtime deps.

## What shipped in v5.7.0

**v5.7.0 — Auto-Scaler, Gamification, Audit Reports**:
- `fleet-auto-scaler.ts`: Scale slots by utilization. **`/auto-scaler`** command.
- `goal-gamification.ts`: XP/levels/badges. **`/gamification`** command.
- `daemon-audit-report.ts`: Compliance audit reports. **`/audit-report`** command.

## What shipped in v5.6.0

**v5.6.0 — Alert Dashboard, Language Detection, Goal SLA**:
- `fleet-alert-dashboard.ts`: Unified alert view. **`/alert-dashboard`** command.
- `session-lang-detector.ts`: 10-language detector. **`/lang-detect`** command.
- `goal-sla-enforcement.ts`: Per-goal time limits. **`/goal-sla`** command.

## Ideas Backlog (v5.9+)
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
- **Fleet cost waterfall chart** — visualize cost accumulation over time
- **Session output diff stream** — real-time diff stream for consumers
- **Fleet session affinity routing v2** — route by language + complexity + load
- **Goal dependency impact analysis** — predict downstream effects of goal changes
- **Daemon graceful shutdown** — drain active sessions before exit
- **Session output search v2** — regex + fuzzy + semantic search across all output
- **Fleet operational runbook library** — pre-built runbooks for common scenarios
