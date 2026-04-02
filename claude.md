# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.203.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Full task lifecycle with 26 intelligence modules, 35 TUI slash commands
- LLM response caching, fleet-wide rate limiting, context compression
- Recovery playbooks with auto-execute on health drop
- Everything from v0.196–v0.202: summarization, conflicts, budgets, heatmaps, audit, fleet snapshots, predictions, retries, adaptive poll, forecasts, priority queue, escalation, drift, progress, pools, reasoner cost, anomalies, SLA, velocity, dep scheduling

### Operator surface (35 TUI commands)
`/supervisor /incident /runbook /progress /health /prompt-template /pin-save /pin-load /pin-presets /activity /conflicts /heatmap /audit /audit-stats /audit-search /fleet-snap /budget-predict /retries /fleet-forecast /priority /escalations /poll-status /drift /goal-progress /pool /reasoner-cost /anomaly /sla /velocity /schedule /cost-summary /session-report /cache /rate-limit /recovery`

### What shipped in v0.203.0

**v0.203.0 — Efficiency Layer: LLM Caching, Rate Limiting, Context Compression, Recovery Playbooks**:
- `ObservationCache`: SHA-256 content hash deduplication. Strips timestamps before hashing so identical observations hit cache regardless of when polled. 5min TTL, 100 entries max, LRU eviction. Tracks hit/miss stats. `/cache`.
- `FleetRateLimiter`: caps fleet-wide API spend at hourly + daily limits (default $10/hr, $100/day). Blocks reasoning with configurable cooldown when limits exceeded. Prunes 25h window. `/rate-limit`.
- `compressObservation()` + `compressToTokenBudget()`: compresses old observation lines into scored summaries (error=10, git=8, tests=7, status=5), keeping recent lines detailed. Progressive compression to fit token budgets. `estimateTokens()` at ~4 chars/token. Usable pre-reasoning to reduce LLM context.
- `RecoveryPlaybookManager`: auto-execute recovery steps when health drops. Default 4-step playbook: nudge (health<60) → restart (health<40) → pause (health<20) → escalate (health<10). Resets triggers on health recovery (+10 above threshold). Respects maxRetries per step. Accepts custom playbooks. `/recovery`.

New files: `src/observation-cache.ts`, `src/fleet-rate-limiter.ts`, `src/context-compressor.ts`, `src/recovery-playbook.ts`
Test files: 4 matching test files
Modified: `src/index.ts`, `src/input.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +45 new tests, net 3083 tests across 64 files.

### Older versions
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
- **Goal decomposition** — auto-split complex goals into sub-tasks
- **Fleet snapshot diffing CLI** — `aoaoe fleet-diff` command
- **Session memory** — persist per-session learnings across restarts
- **Cross-repo impact analysis** — detect when one session breaks another's tests
- **Priority-aware reasoning** — only send highest-priority sessions to reasoner
- **Session forking** — clone a session to try alternative approaches
- **Goal similarity grouping** — auto-detect overlapping goals for coordination
- **Multi-host fleet dashboard** — aggregate data from multiple aoaoe daemons
- **Automatic goal refinement** — learn from completed tasks to improve future goals
- **Session lifecycle analytics** — track creation-to-completion patterns over time
- **Cost attribution reports** — break down spend by goal, repo, and time period
- **Predictive scaling** — auto-adjust pool size based on workload patterns
