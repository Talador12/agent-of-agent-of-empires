# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v4.5.0

## What shipped in v4.5.0

**v4.5.0 — Daemon Health Score, Event Replay, Context Budget Optimizer**:
- `daemon-health-score.ts`: Composite health metric from 7 weighted subsystems: watchdog (20%), SLA health (20%), error rate (15%), session health (15%), cache efficiency (10%), incidents (10%), compliance (10%). Letter grades A-F. **`/health-score`** command.
- `fleet-event-replay.ts`: Replay event bus history with playback controls. Step forward/backward, seek by position or timestamp, filter by type or session. Progress tracking + time range. **`/event-replay [next|prev|N|filter|reload]`** command.
- `session-context-budget.ts`: Minimize context tokens while maximizing relevance. Scores files by recency, goal keyword match, importance (AGENTS.md priority), and size penalty. Greedy budget fill. **`/context-budget`** command.

121 TUI commands. 120 source modules. 4022 tests. 0 runtime deps.

## What shipped in v4.4.0

**v4.4.0 — Daemon Watchdog, Cost Regression Detector, Goal Cascading**:
- `daemon-watchdog.ts`: Self-recovery on stalls. **`/watchdog-status`** command.
- `fleet-cost-regression.ts`: Cost deviation alerts. **`/cost-regression`** command.
- `goal-cascading.ts`: Hierarchical goal trees. **`/goal-cascade`** command.

## What shipped in v4.3.0

**v4.3.0 — Config Diff, Goal Auto-Priority, Capacity Forecaster**:
- `daemon-config-diff.ts`: Config reload diffs. **`/config-diff`** command.
- `goal-auto-priority.ts`: Urgency/impact goal ranking. **`/goal-priority`** command.
- `fleet-capacity-forecaster.ts`: Pool exhaustion prediction. **`/capacity-forecast`** command.

## Ideas Backlog (v4.6+)
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
- **Session output pattern library** — reusable regex patterns for tool outputs
- **Reasoner chain-of-thought logger** — capture LLM reasoning steps
- **Session sandbox mode** — isolated environments with rollback
- **Daemon remote control API** — REST API for external tool commands
- **Fleet time-travel** — rewind to any snapshot and compare
- **Goal template versioning** — version control for decomposition templates
- **Session output summarizer v3** — multi-model summarization with voting
- **Daemon tick profiler** — per-phase timing breakdown with flame graph export
- **Fleet budget allocation planner** — distribute cost budget across sessions by priority
- **Session output correlation** — cross-session output pattern matching for related changes
- **Goal confidence estimator** — predict goal completion probability from early signals
- **Fleet topology auto-layout** — auto-arrange session dep graphs for minimal crossing
