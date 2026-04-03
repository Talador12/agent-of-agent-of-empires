# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v3.4.0

## What shipped in v3.4.0

**v3.4.0 — Idle Detection, Goal Conflict Resolution, Fleet Leaderboard**:
- `session-idle-detector.ts`: Track per-session idle duration, escalate from nudge → pause → reclaim. Stateful tracker with `createIdleDetector()`, `recordActivity()`, `detectIdleSessions()`. **`/idle-detect`** command.
- `goal-conflict-resolver.ts`: Cross-session goal conflict analysis using keyword Jaccard similarity, file overlap detection, and dependency cycle detection. Severity ranking (low/medium/high) with actionable suggestions. **`/goal-conflicts`** command.
- `fleet-leaderboard.ts`: Rank sessions by composite productivity score (40% completion rate, 30% velocity, 30% cost efficiency). Medal emojis for top 3. **`/leaderboard`** command.

88 TUI commands. 87 source modules. 3576 tests. 0 runtime deps.

## What shipped in v3.3.0

**v3.3.0 — Session Timeline + Fleet Changelog**:
- `session-timeline.ts`: `buildTimeline()` builds chronological events from task createdAt + progress entries + completedAt. Icons: ★ milestone, → progress. `formatTimeline()` for TUI. **`/task-timeline <name>`** command.
- `fleet-changelog.ts`: `generateChangelog(sinceMs)` builds deduplicated event list from audit trail. Supports duration parsing (`1h`, `30m`, `2d`). **`/changelog [duration]`** command.

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
- **Cost anomaly auto-throttle** — automatically reduce poll rate for cost-anomalous sessions
- **Reasoner response quality scoring** — rate LLM responses by action success rate, train routing
- **Fleet topology visualization** — interactive dependency + workflow graph in browser
- **Session hibernation** — save full session state to disk, resume on demand without tmux
- **Goal decomposer auto-trigger** — automatically split goals when difficulty score exceeds threshold
- **Audit trail retention policies** — configurable TTL with automatic archival to compressed storage
- **Smart session naming** — auto-generate descriptive session titles from repo + goal analysis
- **Fleet health dashboard API** — REST API for external monitoring tools (Grafana, Datadog)
- **Batch goal assignment** — assign goals to multiple sessions at once from a YAML manifest
- **Session output summarizer v2** — LLM-powered summaries (opt-in) for shift handoffs
- **Workflow replay** — replay completed workflow DAGs for post-mortem analysis
- **Cost forecasting alerts** — proactive alerts when projected costs exceed configurable thresholds
