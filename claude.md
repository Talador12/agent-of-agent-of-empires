# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v4.3.0

## What shipped in v4.3.0

**v4.3.0 — Config Diff, Goal Auto-Priority, Capacity Forecaster**:
- `daemon-config-diff.ts`: Track config snapshots, compute field-level diffs (added/removed/changed) including nested objects. Recent diff history. **`/config-diff`** command.
- `goal-auto-priority.ts`: Rank goals by composite score: urgency keywords (fix/critical/security), impact keywords (deploy/production/auth), dependency count, age (anti-starvation), explicit priority tags. **`/goal-priority`** command.
- `fleet-capacity-forecaster.ts`: Predict pool exhaustion from utilization, queue depth, completion/arrival rates. Recommends ok/scale-up/throttle-intake/critical. ETA to exhaustion. **`/capacity-forecast`** command.

115 TUI commands. 114 source modules. 3943 tests. 0 runtime deps.

## What shipped in v4.2.0

**v4.2.0 — Incident Timeline, Output Bookmarks, Canary Mode**:
- `fleet-incident-timeline.ts`: Error/failure/recovery timeline. **`/incidents`** command.
- `session-output-bookmarks.ts`: Mark output lines for reference. **`/bookmark`** command.
- `daemon-canary-mode.ts`: Safe config rollout. **`/canary`** command.

## What shipped in v4.1.0

**v4.1.0 — Output Redaction, Fleet Compliance, Plugin Hooks**:
- `session-output-redaction.ts`: Auto-strip secrets/PII. **`/redaction-stats`** command.
- `fleet-compliance-checker.ts`: Org policy verification. **`/compliance`** command.
- `daemon-plugin-hooks.ts`: Lifecycle hooks. **`/plugin-hooks`** command.

## Ideas Backlog (v4.4+)
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
- **Parallel goal execution** — split a single goal into sub-goals and run across multiple sessions
- **Fleet-wide rollback** — coordinated revert of recent actions across all sessions
- **Session output pattern library** — reusable regex patterns for common tool outputs
- **Reasoner chain-of-thought logger** — capture and display LLM reasoning steps for transparency
- **Session sandbox mode** — run sessions in isolated environments with rollback on failure
- **Goal progress dashboard** — visual progress bars + ETA for all active sessions in one view
- **Fleet time-travel** — rewind fleet state to any snapshot and compare with current
- **Session output streaming API** — WebSocket endpoint for external consumers of live output
- **Session dependency graph viz** — ASCII/browser rendering of auto-detected dep graph
- **Daemon watchdog timer** — self-recovery if main loop stalls beyond configurable threshold
- **Fleet cost regression detector** — alert when cost patterns deviate from historical baseline
- **Session output summarizer v3** — multi-model summarization with quality voting
- **Goal cascading** — parent goals auto-generate child goals across dependent sessions
- **Daemon remote control API** — REST API for external tools to send commands to the daemon
