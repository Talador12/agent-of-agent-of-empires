# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.197.0

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
- **Session output summarization** — live plain-English activity digests in TUI via `/activity`
- **Cross-session conflict detection** — live file conflict alerts in TUI via `/conflicts`
- **Goal completion auto-detect** — auto-completes tasks from git/test/todo signals per-tick
- **Cost budget enforcement** — auto-pauses tasks exceeding budget per-tick

### Operator surface
- Interactive: `/supervisor`, `/incident`, `/runbook`, `/progress`, `/health`, `/prompt-template`, `/pin-save/load/presets`, `/activity`, `/conflicts`
- CLI: `aoaoe tasks/progress/health/summary/supervisor/incident/runbook/adopt/doctor`
- All JSON-capable: `--json`, `--ndjson`, `--watch`, `--changes-only`, `--heartbeat`, `--follow`
- Fleet management: `task start-all/stop-all/pause-all/resume-all`
- Templates: 6 task templates, 5 prompt templates, user-extensible
- Quick step-in: `/task <session> :: <goal>` with immediate goal injection

### What's next — real blockers to daily use
- **Session error state misdetection** — idle opencode UI chrome triggers false error status
- **Legacy dashboard uses repo paths not session titles** — daemonTick status table still shows truncated paths
- **Task-session linking not shown in dashboard** — tasks have sessionIds but task column shows `-`
- **Notification escalation** — stuck tasks escalate from Slack channel → DM → SMS webhook
- **Daemon systemd/launchd integration** — generate service files for boot start + crash restart

### Shipped
- ~~**Web dashboard**~~ — `aoaoe web`
- ~~**Multi-machine coordination**~~ — `aoaoe sync`
- ~~**Session output summarization**~~ — wired into daemon loop + `/activity` command
- ~~**Cross-session conflict detection**~~ — wired into daemon loop + `/conflicts` command
- ~~**Goal completion detection**~~ — wired into daemon loop, auto-completes tasks per-tick
- ~~**Session cost budgets**~~ — wired into daemon loop, auto-pauses on exceed per-tick
- ~~**Config validation**~~ — `costBudgets` validation + policy key coverage

### What shipped in v0.197.0

**v0.197.0 — Daemon Wiring: Intelligence Modules Live in the Loop**:
- All four v0.196 intelligence modules now run every daemon tick:
  - `SessionSummarizer` processes `observation.changes` new lines → per-session activity summaries
  - `ConflictDetector` tracks file edits across sessions → automatic conflict alerts in TUI
  - `detectCompletionSignals()` scans active tasks for goal completion → auto-completes above 0.7 confidence
  - `findOverBudgetSessions()` compares parsed costs against budgets → auto-pauses on exceed
- New TUI commands: `/activity` (session summaries), `/conflicts` (file conflict report)
- `daemonTick()` takes new `intelligence` parameter carrying module instances + supervisor event hooks
- Fixed `SessionSummarizer` false positive: `ℹ fail 0` (zero failures) no longer classified as error
- Added `ℹ fail N` (N>0) as explicit error signal at priority 88
- `AGENTS.md` updated with intelligence module documentation and "how to add a TUI command" guide

Modified: `src/index.ts`, `src/input.ts`, `src/session-summarizer.ts`, `AGENTS.md`, `claude.md`, `package.json`
New test file: `src/daemon-intelligence.test.ts` (18 integration tests)
Test changes: +18 new tests, net 2829 tests across 42 files.

### What shipped in v0.196.0

**v0.196.0 — Intelligence Layer: Summarization, Conflict Detection, Goal Completion, Cost Budgets**:
- `SessionSummarizer`, `ConflictDetector`, goal detector, cost budget modules (standalone, not yet wired)
- Config validation for `costBudgets`, SQLite corruption recovery in opencode reasoner
- 103 new tests across 4 test files

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
- **Activity heatmap** — show per-session activity over time in the TUI (sparkline or ASCII chart)
- **Smart scheduling** — batch reasoning calls for low-activity sessions to reduce LLM costs
- **Goal decomposition** — auto-split complex goals into sub-tasks with dependency chains
- **Session handoff** — gracefully migrate a session between reasoner backends mid-task
- **Fleet snapshots** — periodic auto-save of fleet state for time-travel debugging
