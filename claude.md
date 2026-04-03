# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v1.8.0

## What shipped in v1.8.0

**v1.8.0 — Stress Tests + v1.6 Wiring: /ab-stats, /workflow-chain, /workflow-forecast**:
- **16 stress tests** across 14 modules: graduation rapid cycling (200 iterations), SLA oscillating health (100 ticks), cache eviction (200 entries), rate limiter burst (50 costs), token quota multi-model (5 models), escalation to critical (10 sessions), nudge tracker (20 sessions), adaptive poll bounds (200 transitions), approval queue overflow (100 items), context compression edge cases, computeStats extremes, A/B 50 ties, workflow chain diamond dependency. **Zero bugs found under stress.**
- **v1.6 modules fully wired**: `/ab-stats`, `/workflow-chain`, `/workflow-forecast`, cost forecast auto-shown on `/workflow-new`, workflow chain auto-advance per tick in main loop.

65 TUI commands. 62 source modules. 3425 tests. 0 runtime deps.
