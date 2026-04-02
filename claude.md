# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.198.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Task definitions → session reconcile → goal injection → reasoner monitoring → progress/completion lifecycle
- Profile-aware session discovery and lifecycle across multiple AoE profiles
- Periodic reconcile in daemon loop (every ~6 polls) auto-adopts new sessions
- Stuck-task detection (⚠ POSSIBLY STUCK after 30min) + auto-pause after N nudges
- Task dependency graph: `dependsOn` with cascading activation
- Health scoring (0-100 per session) with fleet average
- Session output summarization — live plain-English activity digests via `/activity`
- Cross-session conflict detection + auto-resolution — `/conflicts`
- Goal completion auto-detect — auto-completes tasks per-tick
- Cost budget enforcement — auto-pauses tasks exceeding budget per-tick
- Activity heatmap — per-session sparklines over time via `/heatmap`
- Structured audit trail — all daemon decisions logged as JSONL via `/audit`
- Fleet snapshots — periodic auto-save for time-travel debugging via `/fleet-snap`

### Operator surface
- Interactive: `/supervisor`, `/incident`, `/runbook`, `/progress`, `/health`, `/prompt-template`, `/pin-save/load/presets`, `/activity`, `/conflicts`, `/heatmap`, `/audit`, `/audit-stats`, `/fleet-snap`
- CLI: `aoaoe tasks/progress/health/summary/supervisor/incident/runbook/adopt/doctor`
- All JSON-capable: `--json`, `--ndjson`, `--watch`, `--changes-only`, `--heartbeat`, `--follow`
- Fleet management: `task start-all/stop-all/pause-all/resume-all`
- Templates: 6 task templates, 5 prompt templates, user-extensible

### What's next — real blockers to daily use
- **Session error state misdetection** — idle opencode UI chrome triggers false error status
- **Legacy dashboard uses repo paths not session titles** — daemonTick status table still shows truncated paths
- **Task-session linking not shown in dashboard** — task column shows `-` for everything
- **Notification escalation** — stuck tasks escalate from Slack channel → DM → SMS webhook
- **Daemon systemd/launchd integration** — generate service files for boot start + crash restart

### Shipped
- ~~**Web dashboard**~~ — `aoaoe web`
- ~~**Multi-machine coordination**~~ — `aoaoe sync`
- ~~**Session output summarization**~~ — wired into daemon loop + `/activity`
- ~~**Cross-session conflict detection + auto-resolution**~~ — wired + `/conflicts`
- ~~**Goal completion detection**~~ — wired, auto-completes per-tick
- ~~**Session cost budgets**~~ — wired, auto-pauses per-tick
- ~~**Activity heatmap**~~ — sparklines via `/heatmap`
- ~~**Audit trail export**~~ — JSONL via `/audit` + `/audit-stats`
- ~~**Fleet snapshots**~~ — periodic auto-save + `/fleet-snap`
- ~~**Conflict auto-resolution**~~ — auto-pauses lower-priority session on file conflict

### What shipped in v0.198.0

**v0.198.0 — Observability Layer: Heatmap, Audit Trail, Fleet Snapshots, Conflict Auto-Resolution**:
- `ActivityTracker` class: records change events per session in 1-minute time buckets (30-bucket window), renders Unicode sparklines (▁▂▃▄▅▆▇█) with peak rate and total events. Wired into daemon loop — every `observation.changes` entry records an event. New `/heatmap` TUI command.
- `audit-trail.ts`: structured JSONL audit log at `~/.aoaoe/audit-trail.jsonl`. Records every auto-completion, budget pause, conflict detection, and daemon start. Auto-rotates at 50MB. `readRecentAuditEntries()`, `auditStats()`, `formatAuditEntries()`. New `/audit [N]` and `/audit-stats` TUI commands.
- `fleet-snapshot.ts`: captures full fleet state (sessions, tasks, health scores, costs, activity summaries) into timestamped JSON files at `~/.aoaoe/fleet-snapshots/`. Auto-saves every ~10min (60 polls). `diffFleetSnapshots()` for time-travel comparison. Max 100 snapshots with auto-pruning. New `/fleet-snap` TUI command for manual trigger.
- `ConflictDetector.resolveConflicts()`: auto-resolution of file conflicts. When two sessions edit the same file, the lower-priority session is auto-paused. Priority uses explicit `sessionPriority` map or falls back to edit count (more edits = more invested = keeps running). Deduplicates pause targets across multiple concurrent conflicts. Wired into daemon loop with audit logging.
- All new daemon actions (auto-complete, budget pause, conflict detect/resolve) now emit audit entries with structured `data` payloads.

New files: `src/activity-heatmap.ts`, `src/audit-trail.ts`, `src/fleet-snapshot.ts`
Test files: `src/activity-heatmap.test.ts`, `src/audit-trail.test.ts`, `src/fleet-snapshot.test.ts`
Modified: `src/index.ts`, `src/input.ts`, `src/conflict-detector.ts`, `src/conflict-detector.test.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +43 new tests (5 conflict auto-resolution, 11 heatmap, 8 audit, 13 fleet snapshot, 6 shouldTakeSnapshot), net 2872 tests across 45 files.

### What shipped in v0.197.0

**v0.197.0 — Daemon Wiring: Intelligence Modules Live in the Loop**:
- All four v0.196 intelligence modules wired into daemonTick
- `/activity`, `/conflicts` TUI commands
- SessionSummarizer FAIL false-positive fix

### What shipped in v0.196.0

**v0.196.0 — Intelligence Layer**:
- SessionSummarizer, ConflictDetector, goal detector, cost budget modules (standalone)
- Config validation, SQLite corruption recovery

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
- **Session templates** — pre-configured session profiles (frontend, backend, infra) with tailored prompts
- **Smart scheduling** — batch reasoning calls for low-activity sessions to reduce LLM costs
- **Goal decomposition** — auto-split complex goals into sub-tasks with dependency chains
- **Session handoff** — gracefully migrate a session between reasoner backends mid-task
- **Fleet snapshot diffing CLI** — `aoaoe fleet-diff` to compare two snapshots from the command line
- **Audit trail search** — filter audit entries by type, session, time range, keyword
- **Heatmap overlay in TUI** — embed sparklines directly in the session panel header
- **Predictive budget alerts** — estimate when a session will exceed budget based on burn rate
- **Task retry with backoff** — auto-retry failed tasks with exponential backoff and jitter
- **Session dependency inference** — auto-detect implicit dependencies from import graphs
