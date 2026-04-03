# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v5.0.0

## What shipped in v5.0.0

**v5.0.0 — Critical Path, Snapshot Compression, Output Annotations**:
- `goal-critical-path.ts`: Identify the longest dependency chain in the task graph. Topological sort + longest-path DP. Finds bottleneck node, counts parallelizable tasks off the critical path. **`/critical-path`** command.
- `fleet-snapshot-compression.ts`: Delta-encode fleet snapshots. Only stores changes (added/removed/modified) vs full snapshots. Auto-falls back to full when delta > 60% of full size. Auto-compaction after max deltas. **`/snap-compress`** command.
- `session-output-annotations.ts`: Programmatic annotation of output lines with labels, severity, notes, and creator attribution. Filter by session/severity/label. **`/annotate [add|session]`** command.

136 TUI commands. 135 source modules. 4203 tests. 0 runtime deps.

## What shipped in v4.9.0

**v4.9.0 — Transcript Export, Decomposition Quality, Anomaly Correlation**:
- `session-transcript-export.ts`: Markdown transcript export. **`/transcript`** command.
- `goal-decomp-quality.ts`: Sub-goal coverage grading. **`/decomp-quality`** command.
- `fleet-anomaly-correlation.ts`: Cross-session anomaly correlation. **`/anomaly-corr`** command.

## What shipped in v4.8.0

**v4.8.0 — Session Groups, Context Diff, Config Validation**:
- `fleet-session-grouping.ts`: Logical session groups. **`/group`** command.
- `session-context-diff.ts`: Context file diffs. **`/context-diff`** command.
- `daemon-config-schema.ts`: Config validation. **`/config-validate`** command.

## Ideas Backlog (v5.1+)
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
- **Session affinity routing** — assign sessions to reasoner instances by repo type
- **Cross-session knowledge transfer** — share learnings between sessions
- **Reasoner response quality scoring** — rate LLM responses by success rate
- **Fleet topology visualization** — interactive dependency graph in browser
- **Session hibernation** — save full state to disk, resume on demand
- **Audit trail retention policies** — configurable TTL with archival
- **Fleet health dashboard API** — REST API for Grafana/Datadog
- **Batch goal assignment** — YAML manifest for bulk goal loading
- **Parallel goal execution** — split goals into sub-goals across sessions
- **Fleet-wide rollback** — coordinated revert across all sessions
- **Reasoner chain-of-thought logger** — capture LLM reasoning steps
- **Session sandbox mode** — isolated environments with rollback
- **Daemon remote control API** — REST API for external tool commands
- **Fleet time-travel** — rewind to any snapshot and compare
- **Fleet session migration** — move sessions between hosts in federated mode
- **Daemon process supervisor** — fork-exec recovery on crash
- **Daemon plugin marketplace** — discover and install community hooks
- **Fleet cost attribution report** — HTML report of cost by team/repo/tag
- **Session output diffusion tracker** — track how output patterns spread across sessions
- **Goal completion celebration** — auto-generate achievement summaries for completed goals
- **Fleet operational readiness score** — composite readiness metric for production workloads
- **Daemon upgrade orchestrator** — zero-downtime daemon version upgrades with state migration
- **Session output knowledge graph** — extract entities and relations from output for querying
