# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v5.2.0

## What shipped in v5.2.0

**v5.2.0 — Daily Digest, Goal NL Parser, Hot-Swap Modules**:
- `fleet-daily-digest.ts`: Auto-generated daily fleet summary. Completions, failures, costs, health, incidents, uptime. Markdown + TUI output. **`/daily-digest`** command.
- `goal-nl-parser.ts`: Extract structured goals from freeform text. Detects action verbs, target nouns, repo references, priority signals, dependencies, tags. Confidence scoring. **`/parse-goal <text>`** command.
- `daemon-hot-swap.ts`: Module version registry with swap/rollback, validation gates, enable/disable per module, swap history tracking. **`/hot-swap`** command.

142 TUI commands. 141 source modules. 4275 tests. 0 runtime deps.

## What shipped in v5.1.0

**v5.1.0 — Goal Celebration, Fleet Readiness, Process Supervisor**:
- `goal-celebration.ts`: Achievement badges for completed goals. **`/celebrate`** command.
- `fleet-readiness-score.ts`: 10-check production readiness. **`/readiness`** command.
- `daemon-process-supervisor.ts`: Crash recovery + backoff. **`/supervisor`** command.

## What shipped in v5.0.0

**v5.0.0 — Critical Path, Snapshot Compression, Output Annotations**:
- `goal-critical-path.ts`: Longest dependency chain. **`/critical-path`** command.
- `fleet-snapshot-compression.ts`: Delta-encoded snapshots. **`/snap-compress`** command.
- `session-output-annotations.ts`: Output line annotations. **`/annotate`** command.

## Ideas Backlog (v5.3+)
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
- **Session output knowledge graph** — extract entities from output
- **Daemon upgrade orchestrator** — zero-downtime version upgrades
- **Session resource limiter** — CPU/memory cgroup limits per pane
- **Fleet cost attribution report** — HTML report by team/repo/tag
- **Goal dependency visualizer v2** — interactive browser-based DAG
- **Fleet webhook integrations** — Slack/Teams/Discord notifications
- **Session output structured log** — parse output into structured events
- **Daemon state export/import** — portable daemon state snapshots
- **Goal templating engine** — Mustache-style goal templates with variables
- **Fleet multi-tenant isolation** — separate namespaces per team/project
