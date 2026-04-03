# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.204.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Full task lifecycle with 30 intelligence modules, 38 TUI slash commands
- Task lifecycle analytics, cost attribution reports, goal decomposition, priority-aware reasoning
- LLM caching, fleet rate limiting, context compression, recovery playbooks
- Everything from v0.196–v0.203

### Operator surface (38 TUI commands)
`/supervisor /incident /runbook /progress /health /prompt-template /pin-save /pin-load /pin-presets /activity /conflicts /heatmap /audit /audit-stats /audit-search /fleet-snap /budget-predict /retries /fleet-forecast /priority /escalations /poll-status /drift /goal-progress /pool /reasoner-cost /anomaly /sla /velocity /schedule /cost-summary /session-report /cache /rate-limit /recovery /lifecycle /cost-report /decompose`

### What shipped in v0.204.0

**v0.204.0 — Intelligence Platform: Lifecycle Analytics, Cost Attribution, Goal Decomposition, Priority Reasoning**:
- `buildLifecycleRecords()` + `computeLifecycleStats()`: task lifecycle analytics — throughput (tasks/day), avg/median duration, success rate, longest/fastest task, avg progress entries. `/lifecycle`.
- `buildCostAttributions()` + `computeCostReport()`: cost attribution — by repo, by status, top spenders, efficiency ranking (cost per progress entry: high/medium/low). `/cost-report`.
- `decomposeGoal()`: auto-split complex goals into sub-tasks. Detects numbered steps (sequential deps), bullet points (parallel unless "then"/"after" markers), and sequential markers. Produces SubGoal graph with dependency chains and parallel groups. `subGoalsToTaskDefs()` converts to TaskDefinitions. `/decompose <target>`.
- `filterByPriority()`: priority-aware observation filtering. Trims Observation to only highest-priority sessions before sending to reasoner. Configurable max sessions per call, minimum priority threshold, always-include-changed. `computeSavings()` reports tokens saved.

New files: `src/lifecycle-analytics.ts`, `src/cost-attribution.ts`, `src/goal-decomposer.ts`, `src/priority-reasoning.ts`
Test files: 4 matching test files
Modified: `src/index.ts`, `src/input.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +35 new tests, net 3118 tests across 68 files.

### Older versions
- v0.203.0: LLM caching, fleet rate limiting, context compression, recovery playbooks
- v0.202.0: anomaly detection, fleet SLA, velocity tracking, dep scheduling
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
- **Fleet snapshot diffing CLI** — `aoaoe fleet-diff` command
- **Session memory** — persist per-session learnings across restarts
- **Cross-repo impact analysis** — detect when one session breaks another's tests
- **Session forking** — clone a session to try alternative approaches
- **Goal similarity grouping** — auto-detect overlapping goals for coordination
- **Multi-host fleet dashboard** — aggregate data from multiple daemons
- **Automatic goal refinement** — learn from completed tasks to improve future goals
- **Predictive scaling** — auto-adjust pool size based on workload patterns
- **Session checkpoint/restore** — save + resume session state across daemon restarts
- **Dependency graph visualization** — ASCII/SVG task dependency visualization
- **Fleet-wide rollback** — revert all sessions to last known-good fleet snapshot
- **Operator approval queue** — batch pending decisions for async human review
