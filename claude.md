# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.199.0

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
- Activity heatmap — per-session sparklines — `/heatmap`
- Structured audit trail — `/audit`, `/audit-stats`, `/audit-search`
- Fleet snapshots — periodic auto-save — `/fleet-snap`
- Predictive budget alerts — time-to-exhaustion projection — `/budget-predict`
- Task auto-retry — exponential backoff + jitter — `/retries`

### Operator surface
- Interactive: `/supervisor`, `/incident`, `/runbook`, `/progress`, `/health`, `/prompt-template`, `/pin-save/load/presets`, `/activity`, `/conflicts`, `/heatmap`, `/audit`, `/audit-stats`, `/audit-search`, `/fleet-snap`, `/budget-predict`, `/retries`
- CLI: `aoaoe tasks/progress/health/summary/supervisor/incident/runbook/adopt/doctor`
- All JSON-capable: `--json`, `--ndjson`, `--watch`, `--changes-only`, `--heartbeat`, `--follow`

### What's next
- **Session error state misdetection** — idle opencode UI chrome triggers false error status
- **Legacy dashboard uses repo paths not session titles**
- **Notification escalation** — stuck tasks escalate from Slack → DM → SMS
- **Daemon systemd/launchd integration** — generate service files

### Shipped
- ~~**Web dashboard**~~ — `aoaoe web`
- ~~**Multi-machine coordination**~~ — `aoaoe sync`
- ~~**Session output summarization**~~ — `/activity`
- ~~**Cross-session conflict detection + auto-resolution**~~ — `/conflicts`
- ~~**Goal completion detection**~~ — auto-completes per-tick
- ~~**Session cost budgets**~~ — auto-pauses per-tick
- ~~**Activity heatmap**~~ — `/heatmap`
- ~~**Audit trail + search**~~ — `/audit`, `/audit-search`
- ~~**Fleet snapshots**~~ — `/fleet-snap`
- ~~**Conflict auto-resolution**~~ — auto-pauses lower-priority
- ~~**Predictive budget alerts**~~ — `/budget-predict`
- ~~**Task retry with backoff**~~ — `/retries`

### What shipped in v0.199.0

**v0.199.0 — Predictive Intelligence: Budget Forecasting, Task Retry, Audit Search**:
- `BudgetPredictor` class: records cost samples per session each tick, computes $/hr burn rate via linear regression on recent samples, projects time-to-budget-exhaustion. Warns in TUI when exhaustion is imminent (<30min). New `/budget-predict` command shows all predictions with sparkline-style warning icons.
- `TaskRetryManager` class: auto-retries failed tasks with exponential backoff + jitter. Configurable max retries (default 3), base delay (60s), max delay (30min), jitter fraction (20%). Tracks retry count, next-retry-at, exhaustion. Failed tasks auto-register; due retries auto-activate tasks. New `/retries` command.
- `audit-search.ts`: structured search of audit trail — filter by `type:`, `session:`, `keyword:`, `last:` (duration), `before:`, `limit:`. Parses query DSL string, returns filtered entries. New `/audit-search` command.
- All three modules wired into daemon loop: budget predictor records costs every tick and alerts on imminent exhaustion; task retry checks for due retries every tick and re-activates failed tasks; audit search available on demand.
- `daemonTick()` intelligence parameter expanded to include `budgetPredictor` and `taskRetryManager`.

New files: `src/budget-predictor.ts`, `src/task-retry.ts`, `src/audit-search.ts`
Test files: `src/budget-predictor.test.ts`, `src/task-retry.test.ts`, `src/audit-search.test.ts`
Modified: `src/index.ts`, `src/input.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +35 new tests, net 2907 tests across 48 files.

### What shipped in v0.198.0

**v0.198.0 — Observability Layer**: activity heatmap, audit trail, fleet snapshots, conflict auto-resolution.

### What shipped in v0.197.0

**v0.197.0 — Daemon Wiring**: all intelligence modules wired into daemonTick.

### What shipped in v0.196.0

**v0.196.0 — Intelligence Layer**: standalone modules for summarization, conflict detection, goal completion, cost budgets.

### Older versions (v0.1.0 → v0.195.0)

195 releases. Key milestones: scaffolding → poller → reasoner → executor → TUI → policy → notifications → config hot-reload → health endpoint → export → replay → tail → prompt watcher → alert patterns → lifecycle hooks → relay rules → OOM detection → trust ladder → multi-session orchestration → goal injection → task dependencies → auto-pause → health scores → web dashboard → sync → security hardening.

## Ideas Backlog

- **Session replay from history** — replay activity timeline step-by-step for post-mortem
- **Reasoner cost tracking** — per-reasoning-call token usage and cost for optimizer insights
- **Session priority queue** — prioritize reasoner attention by health score and staleness
- **Multi-reasoner support** — different backends for different sessions
- **Notification escalation** — stuck tasks escalate Slack → DM → SMS
- **Daemon systemd/launchd integration** — generate service files for boot start
- **Auto-restart on config change** — detect config file changes and hot-apply
- **Session templates** — pre-configured session profiles with tailored prompts
- **Smart scheduling** — batch reasoning calls for low-activity sessions to reduce costs
- **Goal decomposition** — auto-split complex goals into sub-tasks with dependency chains
- **Fleet snapshot diffing CLI** — `aoaoe fleet-diff` for command-line snapshot comparison
- **Heatmap overlay in TUI** — embed sparklines directly in the session panel header
- **Session dependency inference** — auto-detect implicit dependencies from import graphs
- **Adaptive poll interval** — speed up polling when sessions are active, slow down when idle
- **Reasoner context pruning** — auto-trim observation history to stay within LLM context limits
- **Session memory** — persist per-session learnings across daemon restarts for smarter supervision
- **Cross-repo impact analysis** — detect when one session's changes break another's tests
- **Fleet cost forecasting** — aggregate all session predictions into a total fleet spend forecast
