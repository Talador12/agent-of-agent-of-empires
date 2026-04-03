# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v4.2.0

## What shipped in v4.2.0

**v4.2.0 — Incident Timeline, Output Bookmarks, Canary Mode**:
- `fleet-incident-timeline.ts`: Chronological view of all fleet errors, failures, recoveries, stuck/idle/budget events. Filterable by session, type, time range, resolved status. Hot-session ranking, type counts. **`/incidents`** command.
- `session-output-bookmarks.ts`: Mark interesting output lines with labels for later reference. Add/remove/search bookmarks, filter by session, count by session. **`/bookmark [add|rm|search]`** command.
- `daemon-canary-mode.ts`: Run new config on a single canary session before fleet-wide rollout. Tracks canary health vs baseline, monitors cost rate, auto-recommends promote/rollback/continue. **`/canary [start|promote|rollback]`** command.

112 TUI commands. 111 source modules. 3906 tests. 0 runtime deps.

## What shipped in v4.1.0

**v4.1.0 — Output Redaction, Fleet Compliance, Plugin Hooks**:
- `session-output-redaction.ts`: Auto-strip secrets/PII (11 rules). **`/redaction-stats`** command.
- `fleet-compliance-checker.ts`: Org policy verification (7 checks). **`/compliance`** command.
- `daemon-plugin-hooks.ts`: Lifecycle hooks (7 phases). **`/plugin-hooks`** command.

## What shipped in v4.0.0

**v4.0.0 — Metrics Histogram, Peer Review, Warm Standby**:
- `daemon-metrics-histogram.ts`: Latency percentiles + ASCII histograms. **`/metrics-hist`** command.
- `session-peer-review.ts`: Cross-session review gating. **`/peer-review`** command.
- `fleet-warm-standby.ts`: Pre-warm session slots. **`/warm-standby`** command.

## Ideas Backlog (v4.3+)
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
- **Parallel goal execution** — split a single goal into sub-goals and run across multiple sessions
- **Fleet-wide rollback** — coordinated revert of recent actions across all sessions
- **Session output pattern library** — reusable regex patterns for common tool outputs
- **Goal template marketplace** — share goal + decomposition templates across teams
- **Reasoner chain-of-thought logger** — capture and display LLM reasoning steps for transparency
- **Session sandbox mode** — run sessions in isolated environments with rollback on failure
- **Goal progress dashboard** — visual progress bars + ETA for all active sessions in one view
- **Reasoner cost budget splits** — allocate LLM cost budgets per-phase (reason vs nudge vs review)
- **Session dependency graph viz** — ASCII/browser rendering of auto-detected dep graph
- **Fleet time-travel** — rewind fleet state to any snapshot and compare with current
- **Session output streaming API** — WebSocket endpoint for external consumers of live output
- **Daemon config diff** — show what changed between config reloads
- **Goal auto-prioritization** — rank goals by business impact + urgency from metadata
- **Fleet capacity forecaster** — predict when pool slots will be exhausted from task queue depth
