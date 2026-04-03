# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v1.6.0

## What shipped in v1.6.0

**v1.6.0 — A/B Reasoning, Workflow Cost Forecasting, Workflow Chains, Checkpoint Restore**:
- `ABReasoningTracker` + `compareResults()`: run two backends on same observation, score by non-wait action count (+2), confidence level (+1), focus (+1). Tracks wins/losses/ties over time. `/ab-reasoning` ready to wire.
- `forecastWorkflowCost()`: estimates total workflow USD + hours from per-stage task difficulty scores. Scales cost by difficulty/5 × rate × hours. Parallel tasks use max duration; sequential stages sum. `/workflow-forecast` ready to wire.
- `WorkflowChain` + `advanceChain()`: chain multiple workflows with cross-workflow dependencies. Activates workflows when deps complete. Detects failure propagation. Supports parallel entries with no deps. `/workflow-chain` ready to wire.
- **Checkpoint restore on startup**: daemon loads last checkpoint from `~/.aoaoe/checkpoints/` on start (if <30min old), logs restoration to audit trail.

New files: `src/ab-reasoning.ts`, `src/workflow-cost-forecast.ts`, `src/workflow-chain.ts`
Test files: 3 matching test files
Modified: `src/index.ts`, `AGENTS.md`, `claude.md`, `package.json`
Test changes: +22 new tests, net 3409 tests across 98 files.

### Stats
62 source modules, 62 test files, 62 TUI commands, 3409 tests, 8-gate pipeline, 0 runtime deps.

## Ideas Backlog
- **Wire A/B reasoning into daemon** — split every Nth observation to both backends
- **Wire workflow chain into main loop** — auto-advance chains per tick
- **Wire workflow cost forecast into /workflow-new** — show estimate before creating
- **Fleet federation** — coordinate across multiple aoaoe daemons via HTTP
- **Web dashboard v2** — real-time browser UI via SSE from daemon
- **Reasoner plugin system** — load custom backends as ESM modules
- **Session replay TUI player** — animated step-through with timing controls
- **Multi-reasoner parallel calls** — call backends concurrently, merge results
- **Workflow retry policies** — auto-retry failed stages with configurable strategies
- **Workflow visualization** — ASCII DAG rendering for workflow chains
