# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.193.0

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

### Operator surface
- Interactive: `/supervisor`, `/incident`, `/runbook`, `/progress`, `/health`, `/prompt-template`, `/pin-save/load/presets`
- CLI: `aoaoe tasks/progress/health/summary/supervisor/incident/runbook/adopt/doctor`
- All JSON-capable: `--json`, `--ndjson`, `--watch`, `--changes-only`, `--heartbeat`, `--follow`
- Fleet management: `task start-all/stop-all/pause-all/resume-all`
- Templates: 6 task templates, 5 prompt templates, user-extensible
- Quick step-in: `/task <session> :: <goal>` with immediate goal injection

### What's next
The orchestration loop is complete. Only remaining big-ticket item:
- **Web dashboard** — browser UI for visual fleet monitoring (not started, large effort)
- ~~**Multi-machine coordination**~~ — shipped: `aoaoe sync init/push/pull/diff/status`

### What shipped in v0.186.0

**v0.186.0 — Task Dependencies + Progress Digest + CLI Enrichment**:
- Task dependency graph: `dependsOn` field in task definitions, cascading activation on completion
- Init now generates `aoaoe.tasks.json` from imported sessions (+ fixed state key bug)
- `/progress` interactive command + `aoaoe progress` CLI for per-session accomplishment digest
- `aoaoe tasks --json` and `aoaoe progress --json` with live AoE session status enrichment
- All JSON outputs include `liveStatus` from real-time `aoe list` probe

Modified: `src/types.ts`, `src/task-manager.ts`, `src/task-manager.test.ts`, `src/reasoner/prompt.ts`, `src/reasoner/prompt.test.ts`, `src/config.ts`, `src/config.test.ts`, `src/index.ts`, `src/input.ts`, `src/tui.ts`, `src/init.ts`, `claude.md`
Test changes: +22 new tests, net 2635 tests across 37 files.

### What shipped in v0.185.0

**v0.185.0 — Multi-Session Orchestration + Goal Injection**:
- Task state keyed by `repo+sessionTitle` — meta-mode sessions no longer collide
- Profile-aware session discovery/lifecycle across multiple AoE profiles
- Periodic task/session reconcile in daemon loop (every ~6 polls)
- Goal injection on reconcile: newly linked/created sessions get their goal sent via tmux
- Goal injection on edit: `/task edit` and `/task <session> :: <goal>` inject immediately
- Stuck-task detection in reasoner prompt (⚠ POSSIBLY STUCK after 30min idle)
- Supervisor event history with persistent JSONL storage (`~/.aoaoe/supervisor-history.jsonl`)
- New commands: `/supervisor`, `/incident`, `/runbook` (interactive + CLI)
- All support `--json`, `--ndjson`, `--watch`, `--changes-only`, `--heartbeat`, `--follow`
- `aoaoe supervisor`, `aoaoe incident`, `aoaoe runbook` top-level CLI subcommands
- README operator playbook + incident streaming examples

Modified: `src/task-manager.ts`, `src/task-cli.ts`, `src/executor.ts`, `src/index.ts`, `src/config.ts`, `src/input.ts`, `src/tui.ts`, `src/poller.ts`, `src/types.ts`, `src/reasoner/prompt.ts`, `src/supervisor-history.ts`, `README.md`, `claude.md`
Test changes: +47 new tests, net 2613 tests across 37 files.

### Older versions (v0.1.0 → v0.184.0)

192 releases from scaffolding through full orchestration. Key milestones:
- v0.1–v0.9: scaffolding, poller, reasoner, executor, dashboard, npm publish
- v0.10–v0.50: loop tests, session resolution, context loading, TUI
- v0.51–v0.100: policy enforcement, notifications, config hot-reload, stats
- v0.101–v0.150: health endpoint, export, replay, tail, prompt watcher
- v0.151–v0.184: alert patterns, lifecycle hooks, relay rules, OOM detection, trust ladder

Full history: `git log --oneline` or check GitHub Releases.
