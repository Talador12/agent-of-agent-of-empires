# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.196.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Task definitions → session reconcile → goal injection → reasoner monitoring → progress/completion lifecycle
- Profile-aware session discovery and lifecycle across multiple AoE profiles
- Periodic reconcile in daemon loop (every ~6 polls) auto-adopts new sessions
- Stuck-task detection (⚠ POSSIBLY STUCK after 30min) + auto-pause after N nudges
- Goal injection on reconcile, edit, and quick step-in via tmux send-keys
- Task dependency graph: `dependsOn` with cascading activation
- Supervisor event history persists across restarts
- Health scoring (0-100 per session) with fleet average
- Session output summarization — plain English activity digests without LLM calls
- Cross-session conflict detection — alerts when two sessions edit the same files
- Goal completion detection — heuristic auto-complete from git/test/todo signals
- Cost budgets — per-session USD limits with auto-pause enforcement

### Operator surface
- Interactive: `/supervisor`, `/incident`, `/runbook`, `/progress`, `/health`, `/prompt-template`, `/pin-save/load/presets`
- CLI: `aoaoe tasks/progress/health/summary/supervisor/incident/runbook/adopt/doctor`
- All JSON-capable: `--json`, `--ndjson`, `--watch`, `--changes-only`, `--heartbeat`, `--follow`
- Fleet management: `task start-all/stop-all/pause-all/resume-all`
- Templates: 6 task templates, 5 prompt templates, user-extensible
- Quick step-in: `/task <session> :: <goal>` with immediate goal injection

### What's next — real blockers to daily use
- **Session error state misdetection** — 4/5 sessions show as `error` (`!`) in the dashboard when they're actually idle. The error detection heuristic is too aggressive — confusing idle opencode UI chrome with error output.
- **Legacy dashboard uses repo paths not session titles** — the periodic CLI dashboard (`daemonTick` status table) still shows truncated absolute paths instead of session titles.
- **Task-session linking not shown in dashboard** — tasks have sessionIds but the dashboard `task` column shows `-` for everything.
- **Notification escalation** — if a task stays stuck after N notifications, escalate (e.g., Slack DM instead of channel, or SMS via webhook)
- **Daemon systemd/launchd integration** — generate service files so aoaoe starts on boot and restarts on crash
- **Session replay from history** — replay a specific session's activity timeline for post-mortem analysis
- **Reasoner cost tracking** — track per-reasoning-call token usage and cost (separate from session cost) for optimizer insights
- **Auto-restart on config change** — detect config file changes and hot-apply without manual daemon restart
- **Session priority queue** — when the reasoner can only process one session at a time, prioritize by health score and staleness
- **Multi-reasoner support** — run different reasoner backends for different sessions (e.g., Claude for complex, Gemini for simple)

### Shipped
- ~~**Web dashboard**~~ — `aoaoe web`
- ~~**Multi-machine coordination**~~ — `aoaoe sync`
- ~~**Session output summarization**~~ — `SessionSummarizer` in `session-summarizer.ts`
- ~~**Cross-session conflict detection**~~ — `ConflictDetector` in `conflict-detector.ts`
- ~~**Goal completion detection**~~ — `detectCompletionSignals` in `goal-detector.ts`
- ~~**Session cost budgets**~~ — `costBudgets` config + `cost-budget.ts`
- ~~**Config validation on startup**~~ — `costBudgets` validation + `maxStuckNudgesBeforePause`/`quietHours` in known keys

### What shipped in v0.196.0

**v0.196.0 — Intelligence Layer: Summarization, Conflict Detection, Goal Completion, Cost Budgets**:
- `SessionSummarizer` class: distills session tmux output into plain English activity summaries (coding, testing, building, committing, debugging, error, idle, etc.) without LLM calls — pattern-based, priority-ranked
- `ConflictDetector` class: tracks file edits across sessions with a sliding time window, detects when two+ sessions edit the same code files, formats conflict alerts
- `detectCompletionSignals()` + `shouldAutoComplete()`: heuristic goal completion detection from git push, tests passing, version bumps, all TODOs done, explicit "done" messages, idle-after-progress patterns — aggregate confidence scoring with diminishing returns
- `CostBudgetConfig` in config: `costBudgets.globalBudgetUsd`, `costBudgets.sessionBudgets`, `costBudgets.autoPauseOnExceed` — per-session USD limits with warning levels (ok/warning/critical/exceeded) and formatted alerts
- Config validation: `costBudgets` fields validated on startup, `maxStuckNudgesBeforePause` and `quietHours` added to known policy keys (eliminates spurious warnings)
- SQLite corruption recovery: session init wraps in try/catch, detects SQLiteError/disk I/O, auto-wipes corrupt DB, restarts opencode server, retries

New files: `src/session-summarizer.ts`, `src/conflict-detector.ts`, `src/goal-detector.ts`, `src/cost-budget.ts`
Test files: `src/session-summarizer.test.ts`, `src/conflict-detector.test.ts`, `src/goal-detector.test.ts`, `src/cost-budget.test.ts`
Modified: `src/types.ts`, `src/config.ts`, `src/reasoner/opencode.ts`, `claude.md`
Test changes: +103 new tests, net 2811 tests across 41 files.

### What shipped in v0.186.0

**v0.186.0 — Task Dependencies + Progress Digest + CLI Enrichment**:
- Task dependency graph: `dependsOn` field in task definitions, cascading activation on completion
- Init now generates `aoaoe.tasks.json` from imported sessions (+ fixed state key bug)
- `/progress` interactive command + `aoaoe progress` CLI for per-session accomplishment digest
- `aoaoe tasks --json` and `aoaoe progress --json` with live AoE session status enrichment
- All JSON outputs include `liveStatus` from real-time `aoe list` probe

### Older versions (v0.1.0 → v0.195.0)

195 releases from scaffolding through full orchestration. Key milestones:
- v0.1–v0.9: scaffolding, poller, reasoner, executor, dashboard, npm publish
- v0.10–v0.50: loop tests, session resolution, context loading, TUI
- v0.51–v0.100: policy enforcement, notifications, config hot-reload, stats
- v0.101–v0.150: health endpoint, export, replay, tail, prompt watcher
- v0.151–v0.184: alert patterns, lifecycle hooks, relay rules, OOM detection, trust ladder
- v0.185–v0.186: multi-session orchestration, goal injection, task dependencies
- v0.187–v0.195: auto-pause, health scores, web dashboard, sync, backup/restore, security hardening

Full history: `git log --oneline` or check GitHub Releases.

## Ideas Backlog

- **Session replay from history** — replay a specific session's activity timeline step-by-step for post-mortem
- **Reasoner cost tracking** — track per-reasoning-call token usage and cost for optimizer insights
- **Session priority queue** — prioritize reasoner attention by health score and staleness
- **Multi-reasoner support** — different backends for different sessions (Claude for complex, Gemini for simple)
- **Notification escalation** — stuck tasks escalate from Slack channel → DM → SMS webhook
- **Daemon systemd/launchd integration** — generate service files for boot start + crash restart
- **Auto-restart on config change** — detect config file changes and hot-apply without manual restart
- **Conflict auto-resolution** — when two sessions conflict, auto-pause the lower-priority one
- **Session templates** — pre-configured session profiles (frontend, backend, infra) with tailored prompts
- **Audit trail export** — export all daemon decisions as a compliance-friendly audit log
