# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.201.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Full task lifecycle: definitions → reconcile → goal injection → monitoring → auto-complete
- 18 intelligence modules running every daemon tick without LLM calls
- Session summarization, conflict detection + auto-resolution, goal completion, cost budgets
- Activity heatmap, audit trail + search, fleet snapshots, budget prediction
- Task auto-retry with backoff, adaptive poll interval, fleet cost forecasting
- Session priority queue, notification escalation
- **Drift detection** — alerts when sessions diverge from goals — `/drift`
- **Goal progress estimation** — multi-signal % completion — `/goal-progress`
- **Session pool limits** — concurrent session cap with queuing — `/pool`
- **Reasoner cost tracking** — per-call token usage + cost — `/reasoner-cost`

### Operator surface (28 TUI commands)
`/supervisor`, `/incident`, `/runbook`, `/progress`, `/health`, `/prompt-template`, `/pin-save/load/presets`, `/activity`, `/conflicts`, `/heatmap`, `/audit`, `/audit-stats`, `/audit-search`, `/fleet-snap`, `/budget-predict`, `/retries`, `/fleet-forecast`, `/priority`, `/escalations`, `/poll-status`, `/drift`, `/goal-progress`, `/pool`, `/reasoner-cost`

CLI: `aoaoe tasks/progress/health/summary/supervisor/incident/runbook/adopt/doctor`

### What's next
- **Session error state misdetection** — idle opencode UI chrome triggers false error
- **Daemon systemd/launchd integration** — generate service files for boot

### What shipped in v0.201.0

**v0.201.0 — Insight Layer: Drift Detection, Progress Estimation, Pool Limits, Reasoner Cost**:
- `detectDrift()`: keyword overlap heuristic comparing goal text against recent session output. Extracts meaningful keywords (strips stop words), computes overlap ratio, flags sessions below 15% as drifted. `/drift` TUI command checks all active tasks.
- `estimateProgress()`: multi-signal % completion estimator. Weighs 5 signals: bullet-point goal items matched in progress (weight 3), progress entry count vs expected (weight 2), elapsed time vs typical duration (weight 1), output patterns like git push (weight 2) and tests passing (weight 1). Produces ASCII progress bars (█░) with confidence indicators. `/goal-progress` TUI command.
- `SessionPoolManager`: caps concurrent active sessions (default 5). `getStatus()` reports active/pending/available slots. `getActivatable()` returns pending tasks eligible for activation (oldest `createdAt` first, respects `dependsOn`). `shouldBlock()` checks capacity. `/pool` TUI command with visual pool indicator (●○⊘).
- `ReasonerCostTracker`: records input/output token counts per reasoning call with estimated USD cost (default Claude Sonnet 4 pricing: $3/$15 per M tokens). `getSummary()` computes totals, averages, calls/hr, cost/hr over a 2-hour window. `parseTokenUsage()` extracts token counts from text patterns. `/reasoner-cost` TUI command.
- All four wired as on-demand TUI commands via `/drift`, `/goal-progress`, `/pool`, `/reasoner-cost`.

New files: `src/drift-detector.ts`, `src/goal-progress.ts`, `src/session-pool.ts`, `src/reasoner-cost.ts`
Test files: `src/drift-detector.test.ts`, `src/goal-progress.test.ts`, `src/session-pool.test.ts`, `src/reasoner-cost.test.ts`
Modified: `src/index.ts`, `src/input.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +47 new tests, net 2996 tests across 56 files.

### Older versions
- v0.200.0: adaptive poll, fleet forecast, priority queue, notification escalation
- v0.199.0: budget predictor, task retry, audit search
- v0.198.0: activity heatmap, audit trail, fleet snapshots, conflict auto-resolution
- v0.197.0: daemon wiring of all intelligence modules
- v0.196.0: standalone intelligence modules
- v0.1–v0.195: scaffolding → full orchestration (195 releases)

## Ideas Backlog

- **Session replay from history** — replay activity timeline for post-mortem
- **Multi-reasoner support** — different backends for different sessions
- **Daemon systemd/launchd integration** — generate service files for boot
- **Auto-restart on config change** — detect config changes, hot-apply
- **Session templates** — pre-configured profiles with tailored prompts
- **Smart scheduling** — batch reasoning calls for low-activity sessions
- **Goal decomposition** — auto-split complex goals into sub-tasks
- **Fleet snapshot diffing CLI** — `aoaoe fleet-diff` command
- **Session dependency inference** — detect dependencies from import graphs
- **Reasoner context pruning** — auto-trim observation history for LLM limits
- **Session memory** — persist per-session learnings across restarts
- **Cross-repo impact analysis** — detect when one session breaks another's tests
- **Priority-aware reasoning** — only send highest-priority sessions to reasoner
- **Session forking** — clone a session to try alternative approaches in parallel
- **Progress velocity tracking** — track completion rate over time for ETA refinement
- **Anomaly detection** — flag sessions with unusual cost/activity patterns
- **Dependency-aware pool scheduling** — activate dependent tasks when prerequisites complete
- **Fleet health SLA** — alert when fleet health drops below configured threshold
- **Goal similarity grouping** — auto-detect sessions with overlapping goals for coordination
