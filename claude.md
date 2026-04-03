# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.205.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Full task lifecycle with 34 intelligence modules, 44 TUI slash commands
- Session memory persists learnings across restarts
- ASCII dependency graph visualization with cycle detection
- Operator approval queue for batched async human review
- Fleet snapshot diffing for time-travel comparison
- Everything from v0.196–v0.204

### Operator surface (44 TUI commands)
`/supervisor /incident /runbook /progress /health /prompt-template /pin-save /pin-load /pin-presets /activity /conflicts /heatmap /audit /audit-stats /audit-search /fleet-snap /budget-predict /retries /fleet-forecast /priority /escalations /poll-status /drift /goal-progress /pool /reasoner-cost /anomaly /sla /velocity /schedule /cost-summary /session-report /cache /rate-limit /recovery /lifecycle /cost-report /decompose /memory /dep-graph /approvals /approve /reject /fleet-diff`

### What shipped in v0.205.0

**v0.205.0 — Persistence & Coordination: Session Memory, Dep Graph Viz, Approval Queue, Fleet Diff**:
- `SessionMemory`: persistent per-session learnings stored as JSON at `~/.aoaoe/session-memory/`. Categories: error_pattern, success_pattern, context_hint, preference, warning. `getMemoryContext()` builds compact reasoner-ready text from stored memories. `rememberForSession()` auto-trims to 50 entries. `/memory <name>`.
- `buildGraph()` + `renderGraph()`: ASCII dependency graph with topological depth layout. Status icons (✓▶✗⏸○), dependency arrows, depth grouping. `detectCycles()` finds circular dependencies via DFS. `formatCycles()` shows cycle paths. `/dep-graph`.
- `ApprovalQueue`: batch pending decisions for async human review. `enqueue()` with confidence level, `approve(id)`, `reject(id)`, `approveAll()`, `rejectAll()`. Auto-expires after 30min, caps at 50 pending. `consumeApproved()` for daemon to execute. `/approvals`, `/approve <id|all>`, `/reject <id|all>`.
- `compareLatestSnapshots()` + `formatFleetDiff()`: compares two most recent fleet snapshots showing health/cost deltas, session changes, task completions. Wraps existing `diffFleetSnapshots()` with CLI ergonomics. `/fleet-diff`.

New files: `src/session-memory.ts`, `src/dep-graph-viz.ts`, `src/approval-queue.ts`, `src/fleet-diff.ts`
Test files: 4 matching test files
Modified: `src/index.ts`, `src/input.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +31 new tests, net 3149 tests across 72 files.

### Older versions
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
- **Session templates** — pre-configured profiles with tailored prompts
- **Cross-repo impact analysis** — detect when one session breaks another's tests
- **Session forking** — clone a session to try alternative approaches
- **Goal similarity grouping** — auto-detect overlapping goals for coordination
- **Multi-host fleet dashboard** — aggregate data from multiple daemons
- **Automatic goal refinement** — learn from completed tasks to improve future goals
- **Predictive scaling** — auto-adjust pool size based on workload patterns
- **Session checkpoint/restore** — save + resume session state across daemon restarts
- **Fleet-wide rollback** — revert all sessions to last known-good fleet snapshot
- **Intelligent nudge generation** — use session memory to craft context-aware nudges
- **Task difficulty scoring** — estimate complexity before assignment for better scheduling
- **Fleet utilization heatmap** — per-hour activity across the fleet for capacity planning
- **Session output archival** — compress + archive old session outputs to R2/S3
