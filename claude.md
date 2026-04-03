# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.209.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Fully autonomous reasoning pipeline with 5 gates (rate limit → cache → priority → compress → LLM)
- Session graduation: auto-promote confirm→auto based on success track record
- Approval workflow: low-confidence + destructive actions routed through approval queue
- Goal refinement: learns from completed tasks to suggest improvements
- Fleet HTML export: self-contained dark-themed dashboard report
- 46 intelligence modules, 52+ TUI commands, 3267 tests

### What shipped in v0.209.0

**v0.209.0 — Trust & Learning: Session Graduation, Approval Workflow, Goal Refinement, Fleet Export**:
- `GraduationManager`: tracks per-session success/failure rates. Auto-promotes sessions from confirm→auto when success rate exceeds 90% after 10+ actions with cooldown. Auto-demotes below 50%. Tracks full promotion history. `/graduation` (ready to wire).
- `filterThroughApproval()`: routes reasoner actions through the approval queue based on confidence level and action type. `wait` and `report_progress` always auto-approved. `remove_agent` and `stop_session` always require approval. Other actions gated by confidence vs threshold. Integrates with existing `ApprovalQueue`.
- `analyzeCompletedTasks()` + `refineGoal()`: extracts keyword patterns, avg duration, avg progress entries from completed tasks. Suggests improvements for new goals: break into steps, add testing, add commit signal, estimated duration. Confidence scales with sample size. `/refine` (ready to wire).
- `generateHtmlReport()`: self-contained HTML with GitHub-dark theme. Summary cards (sessions, active, health, cost, completed), session table (title, status, tool, cost, progress, goal), task table (status, goal, progress, duration). XSS-safe with HTML escaping. `/export` (ready to wire).

New files: `src/session-graduation.ts`, `src/approval-workflow.ts`, `src/goal-refiner.ts`, `src/fleet-export.ts`
Test files: 4 matching test files
Modified: `src/index.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +39 new tests, net 3267 tests across 84 files.

### Older versions
- v0.208.0: deep integration — autonomous reasoning pipeline, recovery, scheduling, escalation wiring
- v0.207.0: template auto-detection, fleet search, nudge tracking, smart allocation
- v0.206.0: session templates, difficulty scoring, smart nudges, fleet utilization
- v0.205.0: session memory, dep graph viz, approval queue, fleet diff
- v0.204.0: lifecycle analytics, cost attribution, goal decomposition, priority reasoning
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
- **Cross-repo impact analysis** — detect when one session breaks another's tests
- **Session forking** — clone a session to try alternative approaches
- **Goal similarity grouping** — auto-detect overlapping goals for coordination
- **Multi-host fleet dashboard** — aggregate data from multiple daemons
- **Predictive scaling** — auto-adjust pool size based on workload patterns
- **Session checkpoint/restore** — save + resume session state across restarts
- **Fleet-wide rollback** — revert all sessions to last known-good snapshot
- **Workflow orchestration** — define multi-session workflows with fan-out/fan-in
- **A/B reasoning** — test two reasoner strategies and compare outcomes
- **Auto-template application** — apply detected templates automatically on session creation
- **Graduation dashboard** — visualize session trust levels and promotion history over time
- **Goal library** — curated reusable goal templates for common tasks
- **Fleet cost allocation tags** — label sessions by team/project for cost attribution
