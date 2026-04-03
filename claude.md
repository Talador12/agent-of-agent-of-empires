# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v1.4.0

## Status: Active development

### What shipped in v1.4.0

**v1.4.0 — Multi-Reasoner, Workflow Templates, Checkpoints, Token Quotas**:
- `multi-reasoner.ts`: route sessions to different LLM backends. `assignReasonerBackends()` uses explicit overrides → template mappings → difficulty-based routing (hard→premium, easy→economy). `routeObservation()` splits observation by backend. `mergeReasonerResults()` combines responses.
- `workflow-templates.ts`: 5 built-in workflow templates: ci-cd (build→test→deploy), feature-dev (implement→test→review→merge), refactor (analyze→refactor→test→cleanup), incident-response (triage→fix→test→postmortem), multi-repo (parallel→integration→release). `instantiateWorkflow()` creates unique session titles.
- `session-checkpoint.ts`: serialize transient daemon state (graduation, escalation, velocity, nudges, budgets, cache stats, SLA, poll interval) to `~/.aoaoe/checkpoints/`. `saveCheckpoint()` + `loadCheckpoint()` + `shouldRestoreCheckpoint()` for daemon restart continuity.
- `token-quota.ts`: per-model token quotas. `TokenQuotaManager` tracks input/output tokens per model in hourly windows. `isBlocked()` checks quota, `getStatus()` reports usage percentages. Complements USD-based fleet rate limiter with token-level granularity.

New files: 4 source + 4 test files
Modified: `AGENTS.md`, `claude.md`, `package.json`
Test changes: +29 new tests, net 3387 tests across 95 files.

### Stats
- 59 source modules, 58 test files, 58 TUI commands, 20 CLI subcommands, 3387 tests, 0 runtime deps

## Ideas Backlog
- **Wire multi-reasoner into daemon** — split observations and call backends in parallel
- **Wire token quotas into reasoning pipeline** — block per-model when over quota
- **Wire checkpoint save/restore into daemon startup/shutdown**
- **Wire workflow templates into /workflow-new TUI command**
- **A/B reasoning** — compare two backends on same observation, track which performs better
- **Fleet federation** — coordinate across multiple aoaoe daemons via HTTP
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Workflow cost forecasting** — estimate total workflow cost before starting
- **Session replay TUI player** — animated step-through with timing controls
