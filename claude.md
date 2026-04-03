# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v1.2.0

## Status: PARKED — feature-complete, ready for production use

The project reached v1.0.0 and continued through v1.2.0 with production infrastructure.
It is now feature-complete for its intended purpose and parked for future work as needed.

### What's built
- **55 intelligence modules** running without LLM calls
- **58 TUI slash commands** for real-time fleet management
- **20 CLI subcommands** including `service`, `completions`, `doctor`, `backup/restore`
- **7-gate autonomous reasoning pipeline**: rate limit → cache → priority filter → compress → LLM → approval gate → cost track
- **Workflow engine** with fan-out/fan-in multi-session orchestration
- **Session graduation**: trust ladder (observe → confirm → auto)
- **Recovery playbook**: auto-nudge/restart/pause/escalate on health drop
- **3332 tests** (unit + integration), zero runtime dependencies
- **systemd/launchd service files** for daemon boot start
- **Shell completions** (bash, zsh, fish)

### If resuming work
Consult `AGENTS.md` for the full source layout, module descriptions, and architecture.
The Ideas Backlog below has v2.0 candidates. The most impactful next work would be:
1. Multi-reasoner support (assign different LLM backends per session)
2. Web dashboard v2 (real-time browser UI)
3. Property-based testing (fuzz the intelligence modules)

## Ideas Backlog (v2.0)
- **Multi-reasoner support** — different backends for different sessions
- **A/B reasoning** — compare two reasoner strategies on same observation
- **Cross-repo impact analysis** — detect when one session breaks another
- **Multi-host fleet dashboard** — aggregate state across daemons via HTTP
- **Property-based testing** — fuzz intelligence modules with random inputs
- **Web dashboard v2** — real-time browser UI via SSE from daemon
- **Workflow templates** — pre-built workflow definitions for common patterns
- **Session replay TUI player** — animated step-through with timing
- **Reasoner plugin system** — load custom reasoner backends as ESM modules
- **Fleet federation** — coordinate across multiple aoaoe daemons
- **Smart workflow generation** — auto-create workflows from goal decomposition
- **Workflow retry policies** — auto-retry failed stages with configurable strategies
