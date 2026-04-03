# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v4.9.0

## What shipped in v4.9.0

**v4.9.0 — Transcript Export, Decomposition Quality, Anomaly Correlation**:
- `session-transcript-export.ts`: Export full session transcript as self-contained markdown. Metadata table, progress timeline, action log, recent output (ANSI-stripped), generation footer. **`/transcript <session>`** command.
- `goal-decomp-quality.ts`: Rate how well sub-goals cover the parent goal via keyword extraction + coverage analysis. Letter grades A-F, uncovered keyword detection, actionable suggestions. **`/decomp-quality`** command.
- `fleet-anomaly-correlation.ts`: Correlate anomalies across sessions by time proximity. Detects fleet-wide issues, cascading failures, shared dependencies. Hot-session ranking. **`/anomaly-corr`** command.

133 TUI commands. 132 source modules. 4167 tests. 0 runtime deps.

## What shipped in v4.8.0

**v4.8.0 — Session Groups, Context Diff, Config Validation**:
- `fleet-session-grouping.ts`: Logical session groups with stats. **`/group`** command.
- `session-context-diff.ts`: Context file hash diffs. **`/context-diff`** command.
- `daemon-config-schema.ts`: Config schema validation. **`/config-validate`** command.

## What shipped in v4.7.0

**v4.7.0 — Session Sentiment, Workload Balancer, Crash Reports**:
- `session-sentiment.ts`: Output tone classification. **`/sentiment`** command.
- `fleet-workload-balancer.ts`: Load balancing. **`/workload-balance`** command.
- `daemon-crash-report.ts`: Crash diagnostics. **`/crash-report`** command.

## Ideas Backlog (v5.0+)
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
- **Session output search index** — inverted index for fast cross-session search
- **Goal template inheritance** — child templates inherit parent constraints
- **Fleet cost attribution report** — HTML report of cost by team/repo/tag
- **Daemon process supervisor** — fork-exec recovery with clean restart on OOM/crash
- **Session output annotation API** — programmatic annotation of output lines with metadata
- **Fleet snapshot compression** — delta-encode fleet snapshots for storage efficiency
- **Goal dependency critical path** — identify the longest dependency chain for scheduling
- **Daemon plugin marketplace** — discover and install community hooks via registry
