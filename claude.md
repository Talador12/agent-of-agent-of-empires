# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v0.211.0

## Current Focus

North-star goal: aoaoe should let one reasoner run AoE for any number of sessions/tasks, make its actions obvious, and make it trivial for a human to step in with new info or new tasks at any time.

### What's working end-to-end now
- Fully autonomous 7-gate reasoning pipeline — **now integration-tested end-to-end**
- 46 intelligence modules, 55 TUI slash commands, 3295 tests (28 new integration tests)
- Pipeline integration test suite proves the full wiring: cache → filter → compress → LLM → approval → cost track → graduation → recovery → scheduling → escalation → SLA → budgets → completion detection → summarization → conflicts → velocity → goal refinement

### What shipped in v0.211.0

**v0.211.0 — Pipeline Integration Test Suite: Proving the Wiring Works**

28 new integration tests that exercise the full autonomous pipeline end-to-end using real module instances (not mocks):

1. **Reasoning gate chain (6 tests):**
   - Rate limiter blocks when hourly budget exhausted
   - Observation cache returns hit for duplicate observations
   - Priority filter excludes low-priority sessions, computes savings
   - Context compressor reduces 100-line output to compact form
   - Approval workflow gates destructive actions through queue
   - Full 5-step pipeline chain: rate limit → cache → filter → compress → approval → cost track

2. **Graduation lifecycle (3 tests):**
   - Promotes session after 10+ successes at 90%+ rate
   - Demotes session after failure rate drops below 50%
   - Graduation + approval interact: demoted sessions are more restricted

3. **Recovery playbook (2 tests):**
   - Triggers nudge at health 55, pause at 15
   - Resets and re-triggers after health recovery

4. **Dependency scheduling (3 tests):**
   - Activates task when prerequisite completes
   - Blocks when prerequisite still active
   - Respects pool capacity limits

5. **Nudge effectiveness + escalation (3 tests):**
   - Tracks nudge → progress correlation with response time
   - Escalation progresses normal → elevated → critical
   - Escalation clears on progress

6. **Fleet SLA (2 tests):**
   - Detects breach when health drops below threshold
   - Respects alert cooldown

7. **Budget enforcement + prediction (2 tests):**
   - Auto-identifies over-budget sessions
   - Predictor estimates exhaustion time from burn rate

8. **Goal completion (1 test):**
   - Detects completion from git push + tests passing + done message

9. **Summarizer + conflicts (2 tests):**
   - Summarizes session activity from output
   - Detects cross-session file conflicts

10. **Velocity tracking (1 test):**
    - Computes velocity from progress samples

11. **Goal refinement (1 test):**
    - Suggests improvements based on completed task patterns

12. **Full multi-module scenario (1 test):**
    - Simulates a complete daemon tick with ALL intelligence modules active simultaneously: 3 sessions (healthy, testing, erroring), SLA check, recovery actions, rate limit, LLM simulation, approval, graduation, velocity — verifies they all compose correctly.

New file: `src/pipeline-integration.test.ts` (28 tests)
Modified: `AGENTS.md`, `claude.md`, `package.json`
Test changes: +28 new tests, net 3295 tests across 85 files.

### Older versions
- v0.210.0: deep integration pass 2 — graduation, approval, refiner, export wired
- v0.209.0: session graduation, approval workflow, goal refinement, fleet HTML export
- v0.208.0: deep integration — autonomous reasoning pipeline, recovery, scheduling, escalation
- v0.207.0–v0.196.0: 12 releases building 51 intelligence modules
- v0.1–v0.195: scaffolding → full orchestration (195 releases)

## Ideas Backlog
- **Fix real blockers** — session error misdetection, legacy dashboard paths, task-session linking
- **Cut v1.0.0** — squash, tag, proper release notes, npm publish
- **Session replay from history** — replay activity timeline for post-mortem
- **Multi-reasoner support** — different backends for different sessions
- **Daemon systemd/launchd integration** — generate service files for boot
- **Workflow orchestration** — define multi-session workflows with fan-out/fan-in
- **A/B reasoning** — test two reasoner strategies and compare outcomes
- **Cross-repo impact analysis** — detect when one session breaks another's tests
- **Graduation-aware pool scheduling** — prioritize graduated sessions for harder tasks
- **Fleet cost projections** — weekly/monthly projections from velocity + burn rate
- **Mutation testing** — verify test quality by introducing bugs and checking test failures
- **Property-based testing** — fuzz intelligence modules with random inputs
- **Load testing** — simulate 50+ concurrent sessions to find bottlenecks
- **CLI completions** — shell autocomplete for all aoaoe commands and TUI slash commands
