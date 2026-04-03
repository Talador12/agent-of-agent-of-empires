# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v3.7.0

## What shipped in v3.7.0

**v3.7.0 — Event Bus, Goal Verification, Output Diffs**:
- `fleet-event-bus.ts`: Typed pub/sub event system with 22 event types (session/task/cost/health/fleet/approval/reasoner). Wildcard subscriptions, history buffer with type filtering, event counts, error-resilient delivery. **`/event-bus`** command.
- `goal-completion-verifier.ts`: Post-completion regression scanner. Checks recent output for 7 positive patterns (tests passing, build success, git push, PR activity) and 8 negative patterns (failures, crashes, conflicts, reverts). Outputs confirm/revert/review recommendation. **`/verify-goals`** command.
- `session-output-diff.ts`: Line-level diff between consecutive session captures. LCS-based for small outputs, tail-diff for large (>500 lines). Context-window filtering, ANSI stripping. **`/output-diff <session>`** command.

97 TUI commands. 96 source modules. 3690 tests. 0 runtime deps.

## What shipped in v3.6.0

**v3.6.0 — Shift Handoffs, Dependency Auto-Detection, Cost Forecast Alerts**:
- `operator-shift-handoff.ts`: Structured handoff notes. **`/handoff`** command.
- `session-dep-auto-detect.ts`: Infer session dependencies. **`/auto-deps`** command.
- `cost-forecast-alert.ts`: Proactive cost forecast alerts. **`/cost-forecast`** command.

## What shipped in v3.5.0

**v3.5.0 — Health History, Cost Anomaly Throttling, Smart Session Naming**:
- `session-health-history.ts`: Health sparklines. **`/health-history`** command.
- `cost-anomaly-throttle.ts`: EMA burn rate auto-throttle. **`/cost-throttle`** command.
- `smart-session-naming.ts`: Smart title generation. **`/suggest-name <repo> [goal]`** command.

## What shipped in v3.4.0

**v3.4.0 — Idle Detection, Goal Conflict Resolution, Fleet Leaderboard**:
- `session-idle-detector.ts`: Idle escalation. **`/idle-detect`** command.
- `goal-conflict-resolver.ts`: Goal conflict analysis. **`/goal-conflicts`** command.
- `fleet-leaderboard.ts`: Productivity rankings. **`/leaderboard`** command.

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
- **Reasoner prompt tuning** — auto-adjust system prompt parameters based on action success rates
- **Fleet config profiles** — named config presets for different workload types (dev, CI, incident)
- **Session output watermarking** — embed daemon tick ID in injected messages for trace correlation
- **Parallel goal execution** — split a single goal into sub-goals and run across multiple sessions
- **Fleet-wide rollback** — coordinated revert of recent actions across all sessions
- **Action replay debugger** — step through daemon decision history with what-if analysis
- **Session heartbeat monitor** — detect tmux pane crashes independent of AoE status reporting
