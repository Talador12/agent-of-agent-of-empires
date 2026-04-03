# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.207.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Full task lifecycle with 42 intelligence modules, 52 TUI slash commands
- Template auto-detection from repo file patterns
- Fleet-wide ranked search across all session outputs
- Nudge effectiveness tracking with response time metrics
- Difficulty-weighted pool slot allocation
- Everything from v0.196–v0.206

### Operator surface (52 TUI commands)
All 48 from v0.206 + `/detect-template /fleet-search /nudge-stats /allocation`

### What shipped in v0.207.0

**v0.207.0 — Automation Layer: Template Auto-Detection, Fleet Search, Nudge Tracking, Smart Allocation**:
- `detectTemplate()`: infers session template (frontend/backend/infra/data/docs/security) from repo file patterns. Matches against file markers (package.json→frontend, go.mod→backend, .tf→infra, .ipynb→data, etc.). Returns confidence score + signal list. `detectAndResolveTemplate()` returns full SessionTemplate. `/detect-template <name>`.
- `searchFleet()`: ranked full-text search across all session outputs simultaneously. Case-insensitive substring + regex support (`/pattern/`). Scores exact case matches higher, boosts recent lines. Returns match positions, per-session hit counts. `/fleet-search <query>`.
- `NudgeTracker`: measures if nudges lead to progress resumption within a configurable window (default 30min). Tracks per-session nudge→progress pairs. `getReport()` computes effectiveness rate, avg response time. `/nudge-stats`.
- `computeAllocation()`: uses difficulty scores to weight pool slot allocation. Harder tasks get proportionally more slots. Labels: prioritize/normal/deprioritize based on deviation from fleet average. `/allocation`.

New files: `src/template-detector.ts`, `src/fleet-search.ts`, `src/nudge-tracker.ts`, `src/difficulty-allocator.ts`
Test files: 4 matching test files
Modified: `src/index.ts`, `src/input.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +40 new tests, net 3228 tests across 80 files.

### Older versions
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
- **Automatic goal refinement** — learn from completed tasks to improve future goals
- **Predictive scaling** — auto-adjust pool size based on workload patterns
- **Session checkpoint/restore** — save + resume session state across restarts
- **Fleet-wide rollback** — revert all sessions to last known-good snapshot
- **Utilization-based quiet hours** — auto-set quiet hours from low-utilization periods
- **Workflow orchestration** — define multi-session workflows with fan-out/fan-in
- **A/B reasoning** — test two reasoner strategies and compare outcomes
- **Session graduation** — auto-promote sessions from confirm→auto mode based on track record
- **Fleet dashboard export** — generate HTML report from fleet state for sharing
