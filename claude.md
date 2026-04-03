# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v1.2.0

## Current Focus

v1.0 shipped and tagged. v1.1 added production infrastructure. v1.2 wires v1.1 modules into the daemon loop with CLI subcommands.

### What shipped in v1.2.0

**v1.2.0 — Full Wiring: Service, Completions, Replay, Workflow Live in Daemon**:
- **`aoaoe service` CLI subcommand** — detects platform (macOS/Linux), generates launchd plist or systemd unit file, writes to `~/.aoaoe/`, prints install instructions. `/service` TUI command.
- **`aoaoe completions <bash|zsh|fish>` CLI subcommand** — generates shell autocomplete scripts for all 18 CLI commands + 14 flags. Usage: `eval "$(aoaoe completions bash)"`.
- **`/session-replay <name>` TUI command** — reconstructs a session's activity timeline from the audit trail. Shows chronological events with icons, time gaps, and type-based summary.
- **`/workflow` TUI command** — shows active workflow state with stage icons and task statuses.
- **Workflow engine wired into main loop** — `advanceWorkflow()` runs every tick. Auto-activates next stage tasks when all current stage tasks complete. Detects stage failures. Logs all state changes to audit trail.
- **Workflow → task manager integration** — `activate_task` actions from the workflow engine directly set pending tasks to active status.

Modified: `src/index.ts`, `src/input.ts`, `src/config.ts`, `AGENTS.md`, `claude.md`, `package.json`
No new test files — all 3332 existing tests pass.

### Operator surface (58 TUI commands)
All 55 previous + `/service /session-replay /workflow`

### CLI subcommands (20 total)
All previous + `service`, `completions`

### Full release history
- v1.2.0: wire v1.1 modules + CLI subcommands
- v1.1.0: service files, completions, session replay, workflow engine
- v1.0.0: production release — bug fixes, integration tests, v1 tag
- v0.211.0–v0.196.0: 16 releases building intelligence platform
- v0.1–v0.195: scaffolding → full orchestration

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
- **Cross-workflow dependencies** — chain workflows together
- **Workflow cost forecasting** — estimate total workflow cost before starting
