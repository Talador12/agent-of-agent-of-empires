# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.208.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- **Full autonomous reasoning pipeline**: rate limit → cache → priority filter → compress → LLM → cost track
- **Autonomous recovery**: playbook auto-executes nudge/pause/escalate on health drop per tick
- **Autonomous scheduling**: dep scheduler auto-activates pending tasks when prerequisites complete per tick
- **Autonomous escalation**: nudge tracker + escalation manager in stuck-task handler
- **Fleet utilization tracking**: active sessions recorded per tick for capacity planning
- 42 intelligence modules, 52 TUI slash commands, 3228 tests

### What shipped in v0.208.0

**v0.208.0 — Deep Integration: Autonomous Reasoning Pipeline + Recovery + Scheduling**

This is a *wiring* release — no new modules, but 8 existing standalone modules now run autonomously in the daemon loop instead of on-demand only:

**Reasoner pipeline gates (wrappedReasoner):**
1. **Fleet rate limiter** — blocks reasoning calls when hourly/daily API spend limits are hit. Returns `wait` action with rate-limit reason. Previously TUI-only.
2. **Observation cache** — SHA-256 content hash check. If identical observation was seen within 5min, returns cached result and skips the LLM call entirely. Previously TUI-only.
3. **Priority filter** — trims the Observation to only the highest-priority sessions (based on health, staleness, error state, user activity). Lower-priority sessions are excluded from the LLM context. Previously TUI-only.
4. **Context compressor** — compresses pane output for sessions with >50 lines. Keeps 30 recent lines detailed, summarizes older lines by importance score. Previously TUI-only.
5. **Cost tracking** — after each reasoning call, records estimated token counts and cost, feeds fleet rate limiter and observation cache. Previously TUI-only.

**Main loop per-tick integration:**
6. **Recovery playbook** — evaluates session health each tick and auto-executes recovery steps (nudge at <60, restart at <40, pause at <20, escalate at <10). Previously TUI-only.
7. **Dep scheduler** — checks for pending tasks with met dependencies each tick and auto-activates them, respecting pool capacity limits. Previously TUI-only.
8. **Fleet utilization** — records active session events each tick for the utilization heatmap. Previously TUI-only.

**Stuck-task handler integration:**
9. **Nudge tracker** — every send_input to a session is now automatically recorded as a nudge. Progress events are cross-referenced to compute effectiveness. Previously TUI-only.
10. **Escalation manager** — stuck sessions now automatically escalate from normal → elevated → critical. Escalation clears on progress or auto-pause. Previously TUI-only.

Modified: `src/index.ts` (major), `AGENTS.md`, `claude.md`, `package.json`
No new test files — all existing 3228 tests pass unchanged. The integration is tested implicitly through the existing daemonTick + loop tests.

### Older versions
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
- **Automatic goal refinement** — learn from completed tasks to improve future goals
- **Predictive scaling** — auto-adjust pool size based on workload patterns
- **Session checkpoint/restore** — save + resume session state across restarts
- **Fleet-wide rollback** — revert all sessions to last known-good snapshot
- **Workflow orchestration** — define multi-session workflows with fan-out/fan-in
- **A/B reasoning** — test two reasoner strategies and compare outcomes
- **Session graduation** — auto-promote sessions from confirm→auto mode based on track record
- **Fleet dashboard export** — generate HTML report from fleet state for sharing
- **Operator approval workflow** — route low-confidence decisions through the approval queue automatically
