# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v4.4.0

## What shipped in v4.4.0

**v4.4.0 — Daemon Watchdog, Cost Regression Detector, Goal Cascading**:
- `daemon-watchdog.ts`: Self-recovery if main loop stalls. Tracks tick timestamps, detects stalls beyond threshold (default 2m), escalates warn → restart (2x) → exit (3x). Enable/disable, configurable threshold. **`/watchdog-status`** command.
- `fleet-cost-regression.ts`: Alert when cost patterns deviate from historical baseline. Rolling per-session $/hr samples, warning at 50% above baseline, critical at 100%. **`/cost-regression`** command.
- `goal-cascading.ts`: Parent goals auto-generate child goals across sessions. Tree structure with configurable max depth (default 3). Bottom-up auto-completion propagation. **`/goal-cascade [add|child]`** command.

118 TUI commands. 117 source modules. 3982 tests. 0 runtime deps.

## What shipped in v4.3.0

**v4.3.0 — Config Diff, Goal Auto-Priority, Capacity Forecaster**:
- `daemon-config-diff.ts`: Config reload diffs. **`/config-diff`** command.
- `goal-auto-priority.ts`: Urgency/impact goal ranking. **`/goal-priority`** command.
- `fleet-capacity-forecaster.ts`: Pool exhaustion prediction. **`/capacity-forecast`** command.

## What shipped in v4.2.0

**v4.2.0 — Incident Timeline, Output Bookmarks, Canary Mode**:
- `fleet-incident-timeline.ts`: Error/recovery timeline. **`/incidents`** command.
- `session-output-bookmarks.ts`: Output bookmarks. **`/bookmark`** command.
- `daemon-canary-mode.ts`: Safe config rollout. **`/canary`** command.

## Ideas Backlog (v4.5+)
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
- **Reasoner response quality scoring** — rate LLM responses by action success rate
- **Fleet topology visualization** — interactive dependency graph in browser
- **Session hibernation** — save full state to disk, resume on demand
- **Audit trail retention policies** — configurable TTL with archival
- **Fleet health dashboard API** — REST API for Grafana/Datadog
- **Batch goal assignment** — YAML manifest for bulk goal loading
- **Parallel goal execution** — split goals into sub-goals across sessions
- **Fleet-wide rollback** — coordinated revert across all sessions
- **Session output pattern library** — reusable regex patterns for tool outputs
- **Reasoner chain-of-thought logger** — capture LLM reasoning steps
- **Session sandbox mode** — isolated environments with rollback
- **Daemon remote control API** — REST API for external tool commands
- **Fleet time-travel** — rewind to any snapshot and compare
- **Session output streaming API** — WebSocket for live output consumers
- **Session dependency graph viz** — ASCII/browser dep graph rendering
- **Session output summarizer v3** — multi-model summarization with voting
- **Daemon health score** — composite health metric from all subsystems
- **Goal template versioning** — version control for goal decomposition templates
- **Fleet event replay** — replay event bus history for debugging
- **Session context budget optimizer** — minimize context tokens while maximizing relevance
