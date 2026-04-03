# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v3.5.0

## What shipped in v3.5.0

**v3.5.0 — Health History, Cost Anomaly Throttling, Smart Session Naming**:
- `session-health-history.ts`: Rolling-window health score tracker per session with sparkline visualizations. Computes trend (improving/degrading/stable) from first-half vs second-half average. Worst-health-first sorting. **`/health-history`** command.
- `cost-anomaly-throttle.ts`: Auto-throttle poll rate for cost-anomalous sessions. EMA-smoothed burn rates, fleet average comparison, configurable threshold (default 3x fleet avg). Throttled sessions get slower polling; auto-unthrottles when costs normalize. **`/cost-throttle`** command.
- `smart-session-naming.ts`: Generate descriptive session titles from repo path + goal text. 5 naming strategies: repo-verb, repo-noun, verb-noun, repo-verb-noun, fallback with dedupe. **`/suggest-name <repo> [goal]`** command.

91 TUI commands. 90 source modules. 3620 tests. 0 runtime deps.

## What shipped in v3.4.0

**v3.4.0 — Idle Detection, Goal Conflict Resolution, Fleet Leaderboard**:
- `session-idle-detector.ts`: Track per-session idle duration, escalate from nudge → pause → reclaim. **`/idle-detect`** command.
- `goal-conflict-resolver.ts`: Cross-session goal conflict analysis via Jaccard similarity + file overlap + dependency cycles. **`/goal-conflicts`** command.
- `fleet-leaderboard.ts`: Rank sessions by composite productivity score (completion, velocity, cost efficiency). **`/leaderboard`** command.

## What shipped in v3.3.0

**v3.3.0 — Session Timeline + Fleet Changelog**:
- `session-timeline.ts`: Chronological event timeline from task lifecycle. **`/task-timeline <name>`** command.
- `fleet-changelog.ts`: Deduplicated fleet event changelog from audit trail. **`/changelog [duration]`** command.

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
- **Session output summarizer v2** — LLM-powered summaries (opt-in) for shift handoffs
- **Workflow replay** — replay completed workflow DAGs for post-mortem analysis
- **Cost forecasting alerts** — proactive alerts when projected costs exceed configurable thresholds
- **Session dependency auto-detection** — infer inter-session dependencies from import/file analysis
- **Fleet-wide search-and-replace** — broadcast a code fix across all active sessions
- **Operator shift handoff** — structured handoff notes with auto-generated fleet state summary
- **Task priority inheritance** — child tasks inherit parent session priority + escalation state
- **Session resource profiling** — track CPU/memory usage per tmux pane for resource-aware scheduling
