# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v1.5.0

## What shipped in v1.5.0

**v1.5.0 — Deep Wiring: Multi-Reasoner, Token Quotas, Checkpoints, Workflow Templates Live**:
- **Token quotas wired into reasoning pipeline** — new gate 0 (before fleet rate limiter). Per-model token quotas block reasoning calls when a model's hourly input/output token budget is exceeded. Token usage recorded after every LLM call alongside cost tracking. `/token-quota` TUI command.
- **Checkpoint save on daemon shutdown** — SIGINT/SIGTERM handler now serializes daemon state (graduation levels, cache stats, poll interval) to `~/.aoaoe/checkpoints/daemon-state.json` before exit. Audit-logged. `/checkpoint` TUI command shows last checkpoint info.
- **Multi-reasoner assignments** — `/multi-reasoner` TUI command shows which backend each session would use based on config overrides, template mappings, and difficulty routing.
- **Workflow templates** — `/workflow-new <template> [prefix]` TUI command creates a workflow from built-in templates (ci-cd, feature-dev, refactor, incident-response, multi-repo). Workflow auto-advances per tick via the already-wired workflow engine.
- **8-gate reasoning pipeline** — token quota (gate 0) added before fleet rate limiter, making the full chain: token quota → rate limit → cache → priority filter → compress → LLM → approval → cost+token track.

62 TUI commands. 59 source modules. 3387 tests. 0 runtime deps.

### Older versions
- v1.4.0: multi-reasoner, workflow templates, session checkpoints, token quotas (standalone)
- v1.3.0: README update, property-based fuzz testing
- v1.2.0: wire v1.1 modules + CLI subcommands
- v1.1.0: service files, completions, session replay, workflow engine
- v1.0.0: production release — bug fixes, integration tests, v1 tag
- v0.196–v0.211: 16 releases building 51 intelligence modules

## Ideas Backlog
- **A/B reasoning** — run two backends on same observation, compare outcomes
- **Fleet federation** — coordinate across multiple aoaoe daemons via HTTP
- **Web dashboard v2** — real-time browser UI via SSE from daemon
- **Reasoner plugin system** — load custom backends as ESM modules
- **Workflow cost forecasting** — estimate total workflow cost before starting
- **Session replay TUI player** — animated step-through with timing controls
- **Checkpoint restore on startup** — auto-restore graduation/escalation state from disk
- **Multi-reasoner parallel calls** — split observation and call backends concurrently
- **Workflow retry policies** — auto-retry failed stages with configurable strategies
- **Cross-workflow dependencies** — chain workflows together
