# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v4.0.0

## What shipped in v4.0.0

**v4.0.0 — Metrics Histogram, Peer Review, Warm Standby**:
- `daemon-metrics-histogram.ts`: Per-tick latency distribution for poll, reason, execute, and tick-total phases. Records timing samples, computes percentiles (p50/p90/p99), renders ASCII histograms with 8 buckets. Capped at 500 samples per phase. **`/metrics-hist`** command.
- `session-peer-review.ts`: Cross-session code review gating. Request reviews, approve/reject with feedback, expire stale reviews. Gates task completion on peer approval. **`/peer-review [request|approve|reject]`** command.
- `fleet-warm-standby.ts`: Pre-warm session slots with loaded context for instant task activation. Pool-limited, TTL-based expiry, repo-matched claiming. **`/warm-standby [warm|claim]`** command.

106 TUI commands. 105 source modules. 3819 tests. 0 runtime deps.

## What shipped in v3.9.0

**v3.9.0 — Self-Diagnostics, State Machine, Incremental Context**:
- `daemon-diagnostics.ts`: `/doctor` self-diagnostics. **`/doctor`** command.
- `session-state-machine.ts`: 11-state lifecycle with 31 guarded transitions. **`/state-machine`** command.
- `incremental-context.ts`: Mtime/size fingerprinting for skip-unchanged reloads. **`/context-stats`** command.

## What shipped in v3.8.0

**v3.8.0 — Session Heartbeat, Action Replay, Fleet Config Profiles**:
- `session-heartbeat.ts`: Pane crash detection. **`/heartbeat`** command.
- `action-replay.ts`: Decision history debugger. **`/replay`** command.
- `fleet-config-profiles.ts`: Named config presets. **`/profiles`** command.

## Ideas Backlog (v4.1+)
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
- **Session output pattern library** — reusable regex patterns for common tool outputs
- **Goal template marketplace** — share goal + decomposition templates across teams
- **Reasoner chain-of-thought logger** — capture and display LLM reasoning steps for transparency
- **Session sandbox mode** — run sessions in isolated environments with rollback on failure
- **Fleet compliance checker** — verify all sessions follow org policy (naming, budgets, tags)
- **Daemon plugin hooks** — lifecycle hooks (pre-tick, post-reason, pre-execute) for custom logic
- **Session output redaction** — auto-strip secrets/PII from captured pane output before logging
- **Goal progress dashboard** — visual progress bars + ETA for all active sessions in one view
