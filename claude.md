# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.202.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Full task lifecycle: definitions → reconcile → goal injection → monitoring → auto-complete
- 22 intelligence modules running every daemon tick without LLM calls
- 32 TUI slash commands for real-time fleet management
- Adaptive poll interval, fleet SLA monitoring, progress velocity + ETA
- Anomaly detection (z-score), dependency-aware scheduling, session pool limits
- Drift detection, goal progress estimation, reasoner cost tracking
- Budget prediction + enforcement, conflict detection + auto-resolution
- Audit trail + search, activity heatmap, fleet snapshots, notification escalation

### Operator surface (32 TUI commands)
`/supervisor /incident /runbook /progress /health /prompt-template /pin-save /pin-load /pin-presets /activity /conflicts /heatmap /audit /audit-stats /audit-search /fleet-snap /budget-predict /retries /fleet-forecast /priority /escalations /poll-status /drift /goal-progress /pool /reasoner-cost /anomaly /sla /velocity /schedule /cost-summary /session-report`

### What's next
- **Session error state misdetection** — idle opencode UI chrome triggers false error
- **Daemon systemd/launchd integration** — generate service files for boot

### What shipped in v0.202.0

**v0.202.0 — Analytics Layer: Anomaly Detection, Fleet SLA, Velocity Tracking, Dep Scheduling**:
- `detectAnomalies()`: z-score outlier detection across fleet metrics (cost rate, activity rate, error count, idle duration). Needs 3+ sessions for statistics. Flags sessions >2σ from mean. `/anomaly` TUI command.
- `FleetSlaMonitor`: sliding window health tracking with configurable threshold (default 50). Fires SLA breach alerts with cooldown. Records fleet health each tick. Audit-logged on breach. `/sla` TUI command.
- `ProgressVelocityTracker`: records progress % samples per task each tick (from `estimateProgress()`), computes velocity (%/hr) and ETA. Detects trend (accelerating/decelerating/stalled) by comparing first-half vs second-half velocity. `/velocity` TUI command.
- `computeSchedulingActions()`: dependency-aware pool scheduling. Evaluates pending tasks against completion graph and pool capacity. Returns activate/block/skip per task. `/schedule` TUI command.
- SLA monitor and velocity tracker wired into main loop (run every tick after daemonTick).

New files: `src/anomaly-detector.ts`, `src/fleet-sla.ts`, `src/progress-velocity.ts`, `src/dep-scheduler.ts`
Test files: 4 matching test files
Modified: `src/index.ts`, `src/input.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +42 new tests, net 3038 tests across 60 files.

### Older versions
- v0.201.0: drift detection, goal progress, session pool, reasoner cost
- v0.200.0: adaptive poll, fleet forecast, priority queue, notification escalation
- v0.199.0: budget predictor, task retry, audit search
- v0.198.0: activity heatmap, audit trail, fleet snapshots, conflict auto-resolution
- v0.197.0: daemon wiring of intelligence modules
- v0.196.0: standalone intelligence modules
- v0.1–v0.195: scaffolding → full orchestration (195 releases)

## Ideas Backlog
- **Session replay from history** — replay activity timeline for post-mortem
- **Multi-reasoner support** — different backends for different sessions
- **Daemon systemd/launchd integration** — generate service files for boot
- **Session templates** — pre-configured profiles with tailored prompts
- **Smart scheduling** — batch reasoning calls for low-activity sessions
- **Goal decomposition** — auto-split complex goals into sub-tasks
- **Fleet snapshot diffing CLI** — `aoaoe fleet-diff` command
- **Reasoner context pruning** — auto-trim observation history for LLM limits
- **Session memory** — persist per-session learnings across restarts
- **Cross-repo impact analysis** — detect when one session breaks another's tests
- **Priority-aware reasoning** — only send highest-priority sessions to reasoner
- **Session forking** — clone a session to try alternative approaches in parallel
- **Goal similarity grouping** — auto-detect overlapping goals for coordination
- **Fleet-wide rate limiting** — cap total API spend across all sessions
- **Automatic context summarization** — compress old observations before sending to LLM
- **Session health recovery playbook** — auto-execute recovery steps when health drops
- **Multi-host fleet dashboard** — aggregate data from multiple aoaoe daemons
- **LLM response caching** — deduplicate identical observations to save API calls
