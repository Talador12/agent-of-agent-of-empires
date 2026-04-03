# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v3.9.0

## What shipped in v3.9.0

**v3.9.0 — Self-Diagnostics, State Machine, Incremental Context**:
- `daemon-diagnostics.ts`: `/doctor` command — checks node version, config file, state dir, reasoner backend, poll interval sanity, uptime, tick count, session count, actions log. Severity-ranked (ok/warn/error/info) with actionable suggestions. **`/doctor`** command.
- `session-state-machine.ts`: Formalizes 11 session lifecycle states (pending → starting → active → idle → stuck → error → paused → completing → completed → failed → removed) with 31 valid transitions and guard conditions. Blocks illegal state changes. **`/state-machine [state]`** command. Supports transition checking: `/state-machine active→idle`.
- `incremental-context.ts`: Tracks file mtimes/sizes per tick, skips re-reads for unchanged files. Reports cache hit rate, reload/skip counts, and recent change details. Reduces I/O on large fleets. **`/context-stats`** command.

103 TUI commands. 102 source modules. 3778 tests. 0 runtime deps.

## What shipped in v3.8.0

**v3.8.0 — Session Heartbeat, Action Replay, Fleet Config Profiles**:
- `session-heartbeat.ts`: Tmux pane crash detection. **`/heartbeat`** command.
- `action-replay.ts`: Decision history debugger. **`/replay`** command.
- `fleet-config-profiles.ts`: Named config presets. **`/profiles`** command.

## What shipped in v3.7.0

**v3.7.0 — Event Bus, Goal Verification, Output Diffs**:
- `fleet-event-bus.ts`: Typed pub/sub. **`/event-bus`** command.
- `goal-completion-verifier.ts`: Regression scanner. **`/verify-goals`** command.
- `session-output-diff.ts`: Line-level diffs. **`/output-diff <session>`** command.

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
- **Session output watermarking** — embed daemon tick ID in injected messages for trace correlation
- **Parallel goal execution** — split a single goal into sub-goals and run across multiple sessions
- **Fleet-wide rollback** — coordinated revert of recent actions across all sessions
- **Fleet cost allocation dashboard** — visual cost breakdown by team/repo/tag over time
- **Session peer review** — have one session review another's output before marking complete
- **Daemon metrics histogram** — per-tick latency distribution for reasoning, polling, execution
- **Session output pattern library** — reusable regex patterns for common tool outputs
- **Goal template marketplace** — share goal + decomposition templates across teams
- **Fleet warm standby** — pre-warm session slots with context for fast task activation
- **Reasoner chain-of-thought logger** — capture and display LLM reasoning steps for transparency
