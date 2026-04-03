# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v4.1.0

## What shipped in v4.1.0

**v4.1.0 — Output Redaction, Fleet Compliance, Plugin Hooks**:
- `session-output-redaction.ts`: Auto-strip secrets/PII from captured pane output. 11 default rules: bearer tokens, API keys, AWS keys, JWTs, private keys, passwords, connection strings, emails, IPv4 addresses, hex secrets. Custom rule support, per-rule hit tracking. **`/redaction-stats`** command.
- `fleet-compliance-checker.ts`: Verify all sessions follow org policy. 7 check types: naming convention, required tags, budget cap, max idle, require goal, require repo, banned goal patterns. Severity-ranked (error/warning/info) with remediation. **`/compliance`** command.
- `daemon-plugin-hooks.ts`: Lifecycle hooks for custom logic. 7 hook phases: pre-tick, post-tick, pre-reason, post-reason, pre-execute, post-execute, on-error. Priority ordering, enable/disable, error isolation. **`/plugin-hooks`** command.

109 TUI commands. 108 source modules. 3865 tests. 0 runtime deps.

## What shipped in v4.0.0

**v4.0.0 — Metrics Histogram, Peer Review, Warm Standby**:
- `daemon-metrics-histogram.ts`: Per-tick latency percentiles + ASCII histograms. **`/metrics-hist`** command.
- `session-peer-review.ts`: Cross-session review gating. **`/peer-review`** command.
- `fleet-warm-standby.ts`: Pre-warm session slots. **`/warm-standby`** command.

## What shipped in v3.9.0

**v3.9.0 — Self-Diagnostics, State Machine, Incremental Context**:
- `daemon-diagnostics.ts`: `/doctor` self-diagnostics. **`/doctor`** command.
- `session-state-machine.ts`: 11-state lifecycle. **`/state-machine`** command.
- `incremental-context.ts`: Skip-unchanged context reloads. **`/context-stats`** command.

## Ideas Backlog (v4.2+)
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
- **Goal progress dashboard** — visual progress bars + ETA for all active sessions in one view
- **Fleet incident timeline** — chronological view of all errors/failures/recoveries across sessions
- **Session output bookmarks** — mark interesting output lines for later reference
- **Daemon canary mode** — run new config/rules on one session before fleet-wide rollout
- **Reasoner cost budget splits** — allocate LLM cost budgets per-phase (reason vs nudge vs review)
- **Session dependency graph viz** — ASCII/browser rendering of auto-detected dep graph
