# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v4.8.0

## What shipped in v4.8.0

**v4.8.0 — Session Groups, Context Diff, Config Validation**:
- `fleet-session-grouping.ts`: Logical groups (frontend, backend, infra) with group-level aggregate stats. Add/remove sessions, list groups, compute per-group health/cost/progress. **`/group [add|rm]`** command.
- `session-context-diff.ts`: Track context file content hashes between ticks. Detect added/removed/modified/unchanged files. SHA-256 based. **`/context-diff`** command.
- `daemon-config-schema.ts`: JSON Schema-style validation for daemon config. Type checks, range checks, enum validation, required fields, nested object validation, unknown field warnings. **`/config-validate`** command.

130 TUI commands. 129 source modules. 4135 tests. 0 runtime deps.

## What shipped in v4.7.0

**v4.7.0 — Session Sentiment, Workload Balancer, Crash Reports**:
- `session-sentiment.ts`: Classify output tone (17 patterns, 7 sentiments). **`/sentiment`** command.
- `fleet-workload-balancer.ts`: Detect uneven loads, suggest moves. **`/workload-balance`** command.
- `daemon-crash-report.ts`: Auto-generate diagnostic report. **`/crash-report`** command.

## What shipped in v4.6.0

**v4.6.0 — Tick Profiler, Goal Confidence, Budget Planner**:
- `daemon-tick-profiler.ts`: Per-phase tick timing. **`/tick-profiler`** command.
- `goal-confidence-estimator.ts`: Completion probability. **`/goal-confidence`** command.
- `fleet-budget-planner.ts`: Priority-weighted budget distribution. **`/budget-plan`** command.

## Ideas Backlog (v4.9+)
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
- **Session output correlation** — cross-session output pattern matching
- **Fleet anomaly correlation** — correlate anomalies across sessions for root cause
- **Session output transcript export** — export full session transcript as markdown
- **Goal decomposition quality scorer** — rate sub-goal coverage of parent
- **Fleet session migration** — move sessions between hosts in federated mode
- **Daemon telemetry aggregator** — aggregate metrics across federated daemon instances
- **Session output search index** — inverted index for fast cross-session search
- **Goal template inheritance** — child templates inherit parent constraints + defaults
- **Fleet cost attribution report** — HTML report of cost by team/repo/tag over time
