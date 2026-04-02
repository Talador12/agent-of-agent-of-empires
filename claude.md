# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.200.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Task definitions → session reconcile → goal injection → reasoner monitoring → progress/completion lifecycle
- Profile-aware session discovery and lifecycle across multiple AoE profiles
- Stuck-task detection + auto-pause after N nudges
- Task dependency graph with cascading activation
- Health scoring (0-100 per session) with fleet average
- Session output summarization — `/activity`
- Cross-session conflict detection + auto-resolution — `/conflicts`
- Goal completion auto-detect — auto-completes tasks per-tick
- Cost budget enforcement — auto-pauses tasks exceeding budget per-tick
- Activity heatmap — `/heatmap`
- Structured audit trail — `/audit`, `/audit-stats`, `/audit-search`
- Fleet snapshots — `/fleet-snap`
- Predictive budget alerts — `/budget-predict`
- Task auto-retry with backoff — `/retries`
- **Adaptive poll interval** — speeds up when active, slows when idle — `/poll-status`
- **Fleet cost forecasting** — aggregated burn rate + daily/weekly projections — `/fleet-forecast`
- **Session priority queue** — ranked by health, staleness, error state — `/priority`
- **Notification escalation** — normal → elevated → critical with per-level webhooks — `/escalations`

### Operator surface
- Interactive: `/supervisor`, `/incident`, `/runbook`, `/progress`, `/health`, `/prompt-template`, `/pin-save/load/presets`, `/activity`, `/conflicts`, `/heatmap`, `/audit`, `/audit-stats`, `/audit-search`, `/fleet-snap`, `/budget-predict`, `/retries`, `/fleet-forecast`, `/priority`, `/escalations`, `/poll-status`
- CLI: `aoaoe tasks/progress/health/summary/supervisor/incident/runbook/adopt/doctor`
- All JSON-capable: `--json`, `--ndjson`, `--watch`, `--changes-only`, `--heartbeat`, `--follow`

### What's next
- **Session error state misdetection** — idle opencode UI chrome triggers false error status
- **Legacy dashboard uses repo paths not session titles**
- **Daemon systemd/launchd integration** — generate service files

### Shipped
- ~~**Adaptive poll interval**~~ — `/poll-status`
- ~~**Fleet cost forecasting**~~ — `/fleet-forecast`
- ~~**Session priority queue**~~ — `/priority`
- ~~**Notification escalation**~~ — `/escalations`
- ~~**Predictive budget alerts**~~ — `/budget-predict`
- ~~**Task retry with backoff**~~ — `/retries`
- ~~**Audit trail + search**~~ — `/audit`, `/audit-search`
- ~~**Activity heatmap**~~ — `/heatmap`
- ~~**Fleet snapshots**~~ — `/fleet-snap`
- ~~**Conflict auto-resolution**~~ — auto-pauses lower-priority
- ~~**Goal completion detection**~~ — auto-completes per-tick
- ~~**Cost budgets**~~ — auto-pauses per-tick
- ~~**Session summarization**~~ — `/activity`
- ~~**Web dashboard**~~ — `aoaoe web`
- ~~**Multi-machine coordination**~~ — `aoaoe sync`

### What shipped in v0.200.0

**v0.200.0 — Autonomy Layer: Adaptive Poll, Fleet Forecast, Priority Queue, Escalation**:
- `AdaptivePollController`: dynamic poll interval replaces fixed `config.pollIntervalMs` in sleep call. Speeds up (min 5s) after 2+ consecutive active ticks; slows down (max 60s) after 3+ idle ticks. Resets to base on operator input. Fed tick results (change count + reasoner actions) each iteration. `/poll-status` TUI command.
- `computeFleetForecast()`: aggregates all session `BudgetPrediction`s into total fleet burn rate ($/hr), projected daily/weekly cost, earliest exhaustion session, over-budget list, imminent list. `/fleet-forecast` TUI command.
- `SessionPriority` system: weighted priority scoring — error (100), stuck (80), failed task (70), low health (proportional below 50), staleness (proportional to idle time), user-active (-200 = back off). `rankSessionsByPriority()`, `selectTopPriority()`. `/priority` TUI command.
- `EscalationManager`: progressive notification escalation. Tracks per-session notify count, escalates normal → elevated → critical based on configurable thresholds. Supports separate webhook URLs per level (default channel → DM → SMS/pager). Cooldown between notifications. `/escalations` TUI command.

New files: `src/adaptive-poll.ts`, `src/fleet-forecast.ts`, `src/session-priority.ts`, `src/notify-escalation.ts`
Test files: `src/adaptive-poll.test.ts`, `src/fleet-forecast.test.ts`, `src/session-priority.test.ts`, `src/notify-escalation.test.ts`
Modified: `src/index.ts`, `src/input.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +42 new tests, net 2949 tests across 52 files.

### Older versions

- v0.199.0: budget predictor, task retry, audit search
- v0.198.0: activity heatmap, audit trail, fleet snapshots, conflict auto-resolution
- v0.197.0: daemon wiring of all intelligence modules
- v0.196.0: standalone intelligence modules (summarizer, conflict, goal, cost)
- v0.1–v0.195: scaffolding → full orchestration (195 releases)

## Ideas Backlog

- **Session replay from history** — replay activity timeline for post-mortem
- **Reasoner cost tracking** — per-reasoning-call token usage for optimizer
- **Multi-reasoner support** — different backends for different sessions
- **Daemon systemd/launchd integration** — generate service files for boot
- **Auto-restart on config change** — detect config changes, hot-apply
- **Session templates** — pre-configured profiles with tailored prompts
- **Smart scheduling** — batch reasoning calls for low-activity sessions
- **Goal decomposition** — auto-split complex goals into sub-tasks
- **Fleet snapshot diffing CLI** — `aoaoe fleet-diff` command
- **Session dependency inference** — detect dependencies from import graphs
- **Reasoner context pruning** — auto-trim observation history for LLM context
- **Session memory** — persist per-session learnings across restarts
- **Cross-repo impact analysis** — detect when one session breaks another's tests
- **Heatmap overlay in TUI** — embed sparklines in session panel header
- **Priority-aware reasoning** — only send highest-priority sessions to reasoner
- **Session pool limits** — cap concurrent active sessions to control spend
- **Drift detection** — alert when a session diverges from its stated goal
- **Goal progress estimation** — predict % completion based on pattern matching
- **Session forking** — clone a session to try alternative approaches in parallel
