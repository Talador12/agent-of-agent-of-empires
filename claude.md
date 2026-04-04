# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v5.9.0

## What shipped in v5.9.0

**v5.9.0 — Graceful Shutdown, Dep Impact Analysis, Runbook Library**:
- `daemon-graceful-shutdown.ts`: Phased shutdown (draining→saving→exiting→complete). Track active/drained sessions, drain timeout, state save confirmation. **`/shutdown-status`** command.
- `goal-dep-impact.ts`: BFS downstream impact analysis for goal changes. Direct + transitive blocked sessions, critical path detection. Fleet-wide risk assessment. **`/dep-impact <session>`** command.
- `fleet-runbook-library.ts`: 6 built-in operational runbooks (stuck-session, cost-overspend, fleet-health-drop, scale-up, shift-handoff, debug-session). Searchable by keyword/tag. Auto/manual step markers with TUI commands. **`/runbook [id|search]`** command.

163 TUI commands. 162 source modules. 4503 tests. 0 runtime deps.

## What shipped in v5.8.0

**v5.8.0 — Startup Profiler, Affinity Groups, Session Clipboard**:
- `daemon-startup-profiler.ts`: Module init timing. **`/startup-profile`** command.
- `fleet-affinity-groups.ts`: Auto-group by repo. **`/affinity-groups`** command.
- `session-clipboard.ts`: Cross-platform clipboard. **`/clipboard`** command.

## What shipped in v5.7.0

**v5.7.0 — Auto-Scaler, Gamification, Audit Reports**:
- `fleet-auto-scaler.ts`: Scale slots by utilization. **`/auto-scaler`** command.
- `goal-gamification.ts`: XP/levels/badges. **`/gamification`** command.
- `daemon-audit-report.ts`: Compliance audit reports. **`/audit-report`** command.

## Ideas Backlog (v6.0+)
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
- **Session output search v2** — regex + fuzzy + semantic search
- **Fleet session affinity routing v2** — route by language + complexity
- **Daemon heartbeat federation** — cross-host daemon health monitoring
- **Session output AI summarizer** — opt-in LLM summaries for shift handoffs
- **Fleet compliance report generator** — scheduled HTML/PDF compliance reports
- **Goal dependency graph export** — export dep graph as DOT/Mermaid for docs
- **Daemon performance regression detector** — alert when tick times increase
