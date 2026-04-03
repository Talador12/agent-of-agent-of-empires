# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v4.6.0

## What shipped in v4.6.0

**v4.6.0 — Tick Profiler, Goal Confidence, Budget Planner**:
- `daemon-tick-profiler.ts`: Per-phase timing breakdown for each tick. Records poll/reason/execute/post-tick durations, computes per-phase stats (avg/max/% of total), identifies bottleneck phase, finds slowest tick. **`/tick-profiler`** command.
- `goal-confidence-estimator.ts`: Predict goal completion probability (0-100%) from 6 factors: progress, velocity, errors, signal balance, stuck duration, time pressure. Trend detection (rising/falling/steady), ETA from velocity. **`/goal-confidence`** command.
- `fleet-budget-planner.ts`: Distribute total cost budget across sessions by priority and progress. Higher priority = more budget, near-complete tasks get less. Emergency reserve (default 10%). **`/budget-plan`** command.

124 TUI commands. 123 source modules. 4060 tests. 0 runtime deps.

## What shipped in v4.5.0

**v4.5.0 — Daemon Health Score, Event Replay, Context Budget Optimizer**:
- `daemon-health-score.ts`: Composite A-F health grade. **`/health-score`** command.
- `fleet-event-replay.ts`: Event bus playback debugger. **`/event-replay`** command.
- `session-context-budget.ts`: Relevance-scored context selection. **`/context-budget`** command.

## What shipped in v4.4.0

**v4.4.0 — Daemon Watchdog, Cost Regression Detector, Goal Cascading**:
- `daemon-watchdog.ts`: Self-recovery on stalls. **`/watchdog-status`** command.
- `fleet-cost-regression.ts`: Cost deviation alerts. **`/cost-regression`** command.
- `goal-cascading.ts`: Hierarchical goal trees. **`/goal-cascade`** command.

## Ideas Backlog (v4.7+)
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
- **Session output sentiment analysis** — classify output tone (progress, frustration, blocked)
- **Fleet workload balancer** — redistribute tasks when session load is uneven
- **Daemon crash report** — auto-generate diagnostic report on unexpected exit
- **Goal dependency graph pruning** — auto-remove completed deps from active task graphs
- **Session context diff** — show what changed in context files between ticks
