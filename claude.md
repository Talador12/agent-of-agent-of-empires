# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v1.0.0

## v1.0.0 — The Milestone Release

This is it. From scaffolding to a fully autonomous fleet operations platform in 212+ releases.

### What v1.0.0 ships
- **51 intelligence modules** running without LLM calls
- **55 TUI slash commands** for real-time fleet management
- **7-gate autonomous reasoning pipeline**: rate limit → cache → priority filter → compress → LLM → approval gate → cost track
- **Autonomous recovery**: health-based playbook with nudge → restart → pause → escalate
- **Autonomous scheduling**: dependency-aware task activation with pool limits
- **Session graduation**: trust ladder — sessions earn their way from confirm → auto
- **Approval workflow**: destructive + low-confidence actions gated through human review
- **Goal refinement**: learns from completed tasks to suggest improvements
- **3304 tests** (unit + integration), zero runtime dependencies
- **Bug fixes**: session error state misdetection (idle UI chrome no longer triggers false errors), dashboard task-session linking

### What shipped in v1.0.0

**v1.0.0 — Production Release: Bug Fixes + Integration Tests + v1 Tag**:
- **Fixed: session error state misdetection** — `Poller.correctErrorMisdetection()` cross-references AoE's reported "error" status with actual pane output. If the output looks like normal opencode idle chrome (model info, token counts, prompt chars, box-drawing) with no real error indicators (error:, panic, FATAL, stack trace, Traceback), overrides to "idle". 9 new tests.
- **Fixed: dashboard task-session linking** — session table now falls back to task manager goal when `currentTask` is empty, showing `[~] implement auth` instead of `-`.
- **Integration test suite** (v0.211.0): 28 tests proving the full autonomous pipeline works end-to-end.
- **Version bump**: 0.211.0 → 1.0.0

Modified: `src/poller.ts`, `src/dashboard.ts`, `AGENTS.md`, `claude.md`, `package.json`
New file: `src/error-correction.test.ts` (9 tests)
Net: 3304 tests across 86 files.

### Architecture Summary

```
Observation → [Rate Limit] → [Cache] → [Priority Filter] → [Compress] → LLM Reasoner
    ↓                                                                         ↓
[Summarize]     [Conflict Detect]     [Goal Detect]     [Budget Enforce]   [Approval Gate]
    ↓                  ↓                   ↓                  ↓                 ↓
[Heatmap]      [Auto-Resolve]      [Auto-Complete]     [Auto-Pause]     [Execute Actions]
    ↓                  ↓                   ↓                  ↓                 ↓
[Audit]        [Escalation]        [Graduation]        [Cost Track]     [Recovery Playbook]
    ↓                  ↓                   ↓                  ↓                 ↓
[Fleet Snap]   [SLA Monitor]      [Velocity Track]    [Dep Scheduler]   [Fleet Utilization]
```

### Full Release History
- v1.0.0: production release — bug fixes, integration tests
- v0.211.0: pipeline integration test suite
- v0.210.0: deep integration pass 2 — graduation, approval, refiner, export wired
- v0.209.0: session graduation, approval workflow, goal refinement, fleet HTML export
- v0.208.0: deep integration — autonomous reasoning pipeline, recovery, scheduling
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
- v0.1–v0.195: scaffolding → full orchestration

## Ideas Backlog (v2.0)
- **Multi-reasoner support** — different backends for different sessions
- **Daemon systemd/launchd integration** — generate service files
- **Session replay from history** — post-mortem timeline replay
- **Workflow orchestration** — fan-out/fan-in multi-session workflows
- **A/B reasoning** — compare two reasoner strategies
- **Cross-repo impact analysis** — detect when one session breaks another
- **Multi-host fleet dashboard** — aggregate across daemons
- **CLI completions** — shell autocomplete for commands
- **Property-based testing** — fuzz modules with random inputs
- **Web dashboard v2** — real-time browser UI via SSE
