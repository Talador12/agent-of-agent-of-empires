# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.206.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Full task lifecycle with 38 intelligence modules, 48 TUI slash commands
- 6 built-in session templates (frontend, backend, infra, data, docs, security)
- Task difficulty scoring with complexity estimation + hour estimates
- Context-aware nudge generation using session memory + activity data
- Fleet utilization heatmap by hour-of-day for capacity planning
- Everything from v0.196–v0.205

### Operator surface (48 TUI commands)
`/supervisor /incident /runbook /progress /health /prompt-template /pin-save /pin-load /pin-presets /activity /conflicts /heatmap /audit /audit-stats /audit-search /fleet-snap /budget-predict /retries /fleet-forecast /priority /escalations /poll-status /drift /goal-progress /pool /reasoner-cost /anomaly /sla /velocity /schedule /cost-summary /session-report /cache /rate-limit /recovery /lifecycle /cost-report /decompose /memory /dep-graph /approvals /approve /reject /fleet-diff /template /difficulty /smart-nudge /utilization`

### What shipped in v0.206.0

**v0.206.0 — User Experience Layer: Session Templates, Difficulty Scoring, Smart Nudges, Fleet Utilization**:
- `BUILTIN_TEMPLATES`: 6 session templates (frontend, backend, infra, data, docs, security) with tailored prompt hints, policy overrides, suggested tools, and tags. `applyTemplate()` merges template hints into task goals. `findTemplate()` by name, `formatTemplateDetail()` for inspection. `/template [name]`.
- `scoreDifficulty()`: multi-signal complexity estimation from goal text. Scores 1-10 based on goal length, sub-task count, complexity keywords (refactor, migrate, distributed, etc.), simplicity keywords, and progress rate. Produces labels (trivial/easy/moderate/hard/complex) + hour estimates. `/difficulty`.
- `generateNudge()` + `buildNudgeContext()`: context-aware nudge messages using session memory (error patterns, success patterns), recent activity, last progress, and idle time. References specific patterns instead of generic "are you stuck?". `/smart-nudge <name>`.
- `FleetUtilizationTracker`: records activity events per hour-of-day over a 24h rolling window. `getReport()` computes peak/quiet hours, avg events/hr, unique sessions per hour. `formatHeatmap()` renders ASCII sparkline + top-5 hours bar chart. `/utilization`.

New files: `src/session-templates.ts`, `src/difficulty-scorer.ts`, `src/smart-nudge.ts`, `src/fleet-utilization.ts`
Test files: 4 matching test files
Modified: `src/index.ts`, `src/input.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +39 new tests, net 3188 tests across 76 files.

### Older versions
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
- **Template auto-detection** — infer session template from repo file patterns
- **Difficulty-based pool allocation** — assign more resources to harder tasks
- **Nudge effectiveness tracking** — measure if nudges lead to progress resumption
- **Fleet-wide search** — search across all session outputs simultaneously
