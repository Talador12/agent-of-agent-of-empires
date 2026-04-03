# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Supervisor Notes
- When aoaoe is started via `npm start` or `npm run build && node dist/index.js`, the initial pane output shows a build/compile spinner followed by live daemon output (TUI, polling logs, etc.). This is **normal** — it is not a build error. Do not attempt to restart or fix it.

## Version: v1.1.0

## Current Focus

The v1.0 milestone is shipped. v1.1 adds production infrastructure: service files for boot start, shell completions, session replay, and workflow orchestration.

### What shipped in v1.1.0

**v1.1.0 — Production Infrastructure: Service Files, Completions, Replay, Workflows**:
- `generateSystemdUnit()` + `generateLaunchdPlist()`: auto-detect platform and generate appropriate service file. systemd unit with `Restart=on-failure`, journal logging, env vars. launchd plist with `RunAtLoad`, `KeepAlive`, throttle interval. `installService()` writes file + returns copy/enable/start instructions. `aoaoe service` CLI command (ready to wire).
- `generateCompletion("bash"|"zsh"|"fish")`: shell autocomplete for all 18 CLI commands, 14 CLI flags, and 55 TUI slash commands. Bash uses `compgen`/`COMPREPLY`, zsh uses `_describe`/`compdef`, fish uses `complete -c`. `aoaoe completions <shell>` CLI command (ready to wire).
- `buildSessionReplay()`: reconstructs a session's activity timeline from the audit trail. Produces chronological events with icons, time gaps, and type-based summaries. `formatReplay()` for detailed view, `summarizeReplay()` for quick post-mortem overview. `/replay <name>` TUI command (ready to wire).
- `WorkflowEngine`: define multi-session workflows as a DAG of stages. Stages execute sequentially; tasks within a stage execute in parallel (fan-out). `advanceWorkflow()` checks live task states and auto-activates next stage when all tasks complete (fan-in). Detects stage failures. `formatWorkflow()` for ASCII visualization. `/workflow` TUI command (ready to wire).

New files: `src/service-generator.ts`, `src/cli-completions.ts`, `src/session-replay.ts`, `src/workflow-engine.ts`
Test files: 4 matching test files
Modified: `AGENTS.md`, `claude.md`, `package.json`
Test changes: +28 new tests, net 3332 tests across 90 files.

### Full Architecture

```
                          ┌─ Rate Limit ─┐
Observation ──────────────┤  Cache       ├── LLM Reasoner
  │                       │  Priority    │        │
  │                       │  Compress    │        ▼
  │                       └──────────────┘  Approval Gate
  │                                              │
  ├─ Summarize ── Conflict Detect ── Goal Detect ── Budget Enforce
  ├─ Heatmap ── Escalation ── Graduation ── Cost Track
  ├─ Audit ── Fleet Snap ── SLA Monitor ── Velocity
  ├─ Recovery Playbook ── Dep Scheduler ── Pool Manager
  └─ Workflow Engine ── Session Replay ── Fleet Export
```

55 intelligence modules. 55 TUI commands. 3332 tests. Zero runtime deps.

### Older versions
- v1.0.0: production release — bug fixes, integration tests, v1 tag
- v0.211.0: pipeline integration test suite
- v0.210.0: deep integration pass 2
- v0.209.0: session graduation, approval workflow, goal refinement, fleet export
- v0.208.0: deep integration — autonomous reasoning pipeline
- v0.207.0–v0.196.0: 12 releases building intelligence modules
- v0.1–v0.195: scaffolding → full orchestration

## Ideas Backlog (v2.0)
- **Multi-reasoner support** — different backends for different sessions
- **A/B reasoning** — compare two reasoner strategies on same observation
- **Cross-repo impact analysis** — detect when one session breaks another's tests
- **Multi-host fleet dashboard** — aggregate state across daemons via HTTP
- **Property-based testing** — fuzz intelligence modules with random inputs
- **Web dashboard v2** — real-time browser UI via SSE from daemon
- **Workflow templates** — pre-built workflow definitions for common patterns (CI/CD, feature dev)
- **Session replay TUI player** — animated step-through with timing
- **Reasoner plugin system** — load custom reasoner backends as ESM modules
- **Fleet federation** — coordinate across multiple aoaoe daemons
