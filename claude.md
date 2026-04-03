# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.210.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- **Fully autonomous 7-gate reasoning pipeline**: rate limit → cache → priority filter → compress → LLM → approval gate → cost track
- **Session graduation** wired into main loop: auto-promotes/demotes per tick based on success rate
- **Approval workflow** wired into reasoner: destructive + low-confidence actions require human approval
- **Goal refinement** available via `/refine` for active goal improvement suggestions
- **Fleet HTML export** via `/export` generates shareable dark-themed dashboard reports
- 46 intelligence modules, 55 TUI slash commands, 3267 tests

### Operator surface (55 TUI commands)
All previous 52 + `/graduation /refine /export`

### What shipped in v0.210.0

**v0.210.0 — Deep Integration Pass 2: Graduation, Approval Workflow, Goal Refiner, Fleet Export Wired**

Like v0.208, this is a *wiring* release — the 4 modules from v0.209 are now autonomous:

**Reasoner pipeline — new gate 6 (approval workflow):**
- After LLM returns actions but before execution, `filterThroughApproval()` gates risky actions. `wait`/`report_progress` always auto-approved. `remove_agent`/`stop_session` always require human approval. Low-confidence actions from the LLM are queued for operator review via the existing ApprovalQueue. Active in `confirm` mode or when confidence is "low".

**Execution results — graduation tracking:**
- Every executed action's success/failure is recorded into `GraduationManager` per session. The manager maintains running success rates.

**Main loop per-tick — graduation evaluation:**
- `GraduationManager.evaluate()` runs each tick for every session. Sessions with 90%+ success rate after 10+ actions auto-promote (observe→confirm→auto). Sessions with <50% auto-demote. Promotions/demotions logged to TUI + audit trail.

**New TUI commands:**
- `/graduation` — show all session trust levels, success rates, promotion history
- `/refine <name>` — analyze completed tasks and suggest improvements for a task's goal
- `/export` — generate self-contained HTML fleet report at `~/.aoaoe/fleet-report-YYYY-MM-DD.html`

Modified: `src/index.ts` (major), `src/input.ts`, `AGENTS.md`, `claude.md`, `package.json`
No new test files — all 3267 existing tests pass.

### Older versions
- v0.209.0: session graduation, approval workflow, goal refinement, fleet HTML export (standalone modules)
- v0.208.0: deep integration — autonomous reasoning pipeline, recovery, scheduling, escalation wiring
- v0.207.0–v0.196.0: 12 releases building 51 intelligence modules
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
- **Auto-template application** — apply detected templates on session creation
- **Goal library** — curated reusable goal templates for common tasks
- **Graduation-aware pool scheduling** — prioritize graduated (auto-mode) sessions for harder tasks
- **Fleet cost projections** — weekly/monthly cost projections from velocity + burn rate data
