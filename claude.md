# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v4.7.0

## What shipped in v4.7.0

**v4.7.0 — Session Sentiment, Workload Balancer, Crash Reports**:
- `session-sentiment.ts`: Classify session output tone using 17 keyword patterns across 7 sentiment types (success, progress, blocked, frustration, error, idle, neutral). Priority-weighted with error > blocked > frustration. **`/sentiment`** command.
- `fleet-workload-balancer.ts`: Detect uneven session loads, classify as overloaded/normal/underloaded, suggest move or pause recommendations. Load score from tasks + burn rate + health. **`/workload-balance`** command.
- `daemon-crash-report.ts`: Auto-generate diagnostic report on unexpected exit. Captures uptime, ticks, error + stack, recent events, active sessions, health, memory usage, sanitized config. **`/crash-report`** command.

127 TUI commands. 126 source modules. 4095 tests. 0 runtime deps.

## What shipped in v4.6.0

**v4.6.0 — Tick Profiler, Goal Confidence, Budget Planner**:
- `daemon-tick-profiler.ts`: Per-phase tick timing. **`/tick-profiler`** command.
- `goal-confidence-estimator.ts`: Completion probability estimator. **`/goal-confidence`** command.
- `fleet-budget-planner.ts`: Priority-weighted budget distribution. **`/budget-plan`** command.

## What shipped in v4.5.0

**v4.5.0 — Daemon Health Score, Event Replay, Context Budget**:
- `daemon-health-score.ts`: Composite A-F health grade. **`/health-score`** command.
- `fleet-event-replay.ts`: Event bus playback debugger. **`/event-replay`** command.
- `session-context-budget.ts`: Relevance-scored context selection. **`/context-budget`** command.

## Ideas Backlog (v4.8+)
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
- **Goal template versioning** — version control for decomposition templates
- **Session output correlation** — cross-session output pattern matching
- **Fleet topology auto-layout** — auto-arrange dep graphs for minimal crossing
- **Goal dependency graph pruning** — auto-remove completed deps from task graphs
- **Session context diff** — show what changed in context files between ticks
- **Fleet anomaly correlation** — correlate anomalies across sessions for root cause
- **Daemon config schema validator** — JSON Schema validation with helpful error messages
- **Session output transcript export** — export full session transcript as markdown
- **Goal decomposition quality scorer** — rate how well sub-goals cover the parent
- **Fleet session grouping** — logical groups (frontend/backend/infra) with group-level stats
