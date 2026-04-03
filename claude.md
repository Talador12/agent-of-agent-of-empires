# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v3.8.0

## What shipped in v3.8.0

**v3.8.0 — Session Heartbeat, Action Replay, Fleet Config Profiles**:
- `session-heartbeat.ts`: Detect tmux pane crashes independent of AoE status. Tracks output hash changes per tick, escalates stale → unresponsive → dead. Configurable thresholds (5/10/20 ticks default). **`/heartbeat`** command.
- `action-replay.ts`: Step through daemon decision history for post-mortem analysis. Loads action log, groups by tick, supports seek/step/filter-by-session navigation. Includes replay stats (ticks, actions, failures, sessions). **`/replay [stats|next|prev|N|session]`** command.
- `fleet-config-profiles.ts`: 5 built-in config presets (dev, ci, incident, conservative, overnight) + user-defined profiles. Each profile overrides poll intervals, policies, verbosity, confirm mode. **`/profiles [name]`** command.

100 TUI commands. 99 source modules. 3735 tests. 0 runtime deps.

## What shipped in v3.7.0

**v3.7.0 — Event Bus, Goal Verification, Output Diffs**:
- `fleet-event-bus.ts`: Typed pub/sub with 22 event types. **`/event-bus`** command.
- `goal-completion-verifier.ts`: Post-completion regression scanner. **`/verify-goals`** command.
- `session-output-diff.ts`: Line-level output diffs. **`/output-diff <session>`** command.

## What shipped in v3.6.0

**v3.6.0 — Shift Handoffs, Dependency Auto-Detection, Cost Forecast Alerts**:
- `operator-shift-handoff.ts`: Structured handoff notes. **`/handoff`** command.
- `session-dep-auto-detect.ts`: Infer session dependencies. **`/auto-deps`** command.
- `cost-forecast-alert.ts`: Proactive cost forecast alerts. **`/cost-forecast`** command.

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
- **Session output watermarking** — embed daemon tick ID in injected messages for trace correlation
- **Parallel goal execution** — split a single goal into sub-goals and run across multiple sessions
- **Fleet-wide rollback** — coordinated revert of recent actions across all sessions
- **Session state machine** — formalize session lifecycle as a state machine with transition guards
- **Fleet cost allocation dashboard** — visual cost breakdown by team/repo/tag over time
- **Incremental context loading** — only reload context files that changed since last tick
- **Session peer review** — have one session review another's output before marking complete
- **Daemon self-diagnostics** — /doctor command that checks config, env, perf, and reports issues
