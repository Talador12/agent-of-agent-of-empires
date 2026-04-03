# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v3.6.0

## What shipped in v3.6.0

**v3.6.0 — Shift Handoffs, Dependency Auto-Detection, Cost Forecast Alerts**:
- `operator-shift-handoff.ts`: Structured handoff notes for operator shift changes. Aggregates fleet state, session health/cost, failed/paused task alerts, pending approvals, and actionable recommendations into a scannable summary. TUI + markdown output. **`/handoff`** command.
- `session-dep-auto-detect.ts`: Infer inter-session dependencies from explicit declarations, goal text references ("after X", "blocked by X"), shared file edits, and repo path overlap. Confidence-ranked, deduplicated. **`/auto-deps`** command.
- `cost-forecast-alert.ts`: Project costs at daily/weekly/monthly intervals from current spend + burn rate. Fires alerts when projections exceed configurable thresholds. Critical severity for imminent breaches (<2h). **`/cost-forecast`** command.

94 TUI commands. 93 source modules. 3654 tests. 0 runtime deps.

## What shipped in v3.5.0

**v3.5.0 — Health History, Cost Anomaly Throttling, Smart Session Naming**:
- `session-health-history.ts`: Rolling-window health score sparklines + trend detection. **`/health-history`** command.
- `cost-anomaly-throttle.ts`: EMA-smoothed burn rate monitoring + auto-throttle. **`/cost-throttle`** command.
- `smart-session-naming.ts`: Generate descriptive titles from repo + goal. **`/suggest-name <repo> [goal]`** command.

## What shipped in v3.4.0

**v3.4.0 — Idle Detection, Goal Conflict Resolution, Fleet Leaderboard**:
- `session-idle-detector.ts`: Idle escalation (nudge/pause/reclaim). **`/idle-detect`** command.
- `goal-conflict-resolver.ts`: Cross-session goal conflict analysis. **`/goal-conflicts`** command.
- `fleet-leaderboard.ts`: Productivity rankings. **`/leaderboard`** command.

## What shipped in v3.3.0

**v3.3.0 — Session Timeline + Fleet Changelog**:
- `session-timeline.ts`: Task lifecycle timeline. **`/task-timeline <name>`** command.
- `fleet-changelog.ts`: Fleet event changelog. **`/changelog [duration]`** command.

## Ideas Backlog (v4.0+)
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
- **Session affinity routing** — assign sessions to specific reasoner instances by repo type
- **Cross-session knowledge transfer** — share learnings from completed sessions to active ones
- **Reasoner response quality scoring** — rate LLM responses by action success rate, train routing
- **Fleet topology visualization** — interactive dependency + workflow graph in browser
- **Session hibernation** — save full session state to disk, resume on demand without tmux
- **Goal decomposer auto-trigger** — automatically split goals when difficulty score exceeds threshold
- **Audit trail retention policies** — configurable TTL with automatic archival to compressed storage
- **Fleet health dashboard API** — REST API for external monitoring tools (Grafana, Datadog)
- **Batch goal assignment** — assign goals to multiple sessions at once from a YAML manifest
- **Workflow replay** — replay completed workflow DAGs for post-mortem analysis
- **Task priority inheritance** — child tasks inherit parent session priority + escalation state
- **Session resource profiling** — track CPU/memory usage per tmux pane for resource-aware scheduling
- **Fleet event bus** — pub/sub event system for decoupled module communication
- **Session output diff highlights** — color-coded diff view between consecutive captures
- **Reasoner prompt tuning** — auto-adjust system prompt parameters based on action success rates
- **Goal completion verification** — double-check completed goals by re-scanning output for regressions
- **Fleet config profiles** — named config presets for different workload types (dev, CI, incident)
