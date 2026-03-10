# Agent Guidelines for aoaoe

## Overview

aoaoe (Agent of Agent of Empires) is an autonomous supervisor daemon for
[agent-of-empires](https://github.com/njbrake/agent-of-empires) sessions.
Uses OpenCode or Claude Code as its reasoning engine. Observes agents via
tmux, decides when to intervene, acts.

## Quick Reference

```bash
npm run build            # tsc -> dist/
npm test                 # build + node --test (158 tests, node:test stdlib)
npm start                # run daemon
aoaoe --dry-run          # observe + reason, don't execute
aoaoe --verbose          # verbose logging
aoaoe test-context       # safe read-only scan of sessions + context discovery
aoaoe-chat               # interactive chat UI
```

## Architecture

```
Poller (aoe CLI + tmux capture)
  -> Reasoner (OpenCode SDK or Claude Code subprocess)
    -> Executor (tmux send-keys, aoe CLI commands)
```

Three loops: poll sessions, reason about observations, execute actions. The
reasoner gets a system prompt defining the supervisor role + per-session
project context (auto-discovered AI instruction files from each session's
resolved directory).

## Source Layout

| File | Purpose |
|------|---------|
| `src/index.ts` | Main daemon loop, subcommands (attach, register, test-context) |
| `src/config.ts` | Config loader, CLI arg parser, env validation |
| `src/types.ts` | All interfaces — SessionSnapshot, Observation, Action, Reasoner |
| `src/poller.ts` | `aoe list --json` + `tmux capture-pane`, SHA-256 diff detection |
| `src/context.ts` | `discoverContextFiles`, `resolveProjectDir`, `loadSessionContext`, caching |
| `src/executor.ts` | Action dispatch — send_input, start/stop/restart, create/remove agent |
| `src/reasoner/index.ts` | `createReasoner()` factory |
| `src/reasoner/prompt.ts` | `buildSystemPrompt()`, `formatObservation()`, `detectPermissionPrompt()` |
| `src/reasoner/opencode.ts` | OpenCode SDK backend (HTTP to `opencode serve`) |
| `src/reasoner/claude-code.ts` | Claude Code subprocess backend (`claude --print`) |
| `src/chat.ts` | Interactive chat UI entry point (`aoaoe-chat`) |
| `src/dashboard.ts` | CLI status table with per-pane tasks + countdown |
| `src/daemon-state.ts` | IPC state file (`~/.aoaoe/daemon-state.json`) + interrupt flag |
| `src/task-parser.ts` | Parse OpenCode TODO patterns, model/context/cost from pane output |
| `src/console.ts` | Conversation log + file-based IPC |
| `src/input.ts` | Stdin listener with inject() for post-interrupt text |
| `src/shell.ts` | Child process helpers |

## Key Design Decisions

### Two usage modes for aoe
- **Single-repo**: User runs `aoe` from inside a project. `session.path` points to the project directly.
- **Meta-level**: User runs `aoe` from a parent dir (e.g. `~/repos/`), manually names sessions to match projects. All sessions share the same `path`. `resolveProjectDir()` searches 2 levels deep to find the actual project dir by matching the session title.

### Context loading
Auto-discovers AI instruction files from each session's project directory.
One `readdir` call, pattern match, done. Loads `AGENTS.md` + `claude.md`
first, then other AI tool files (`*rules`, `*instructions*`, `.aider*`,
`CODEX.md`, `CONTRIBUTING.md`), known nested paths, user extras, and
parent directory group-level `claude.md`.

De-duplication uses device+inode (handles macOS/Windows case-insensitive FS
and Linux case-sensitive FS correctly). Budget: 8KB per file, 24KB per
directory, cached 60s.

### Testing
- 173 tests across 8 files, `node:test` (stdlib, zero deps)
- Includes e2e loop tests with MockPoller/MockReasoner/MockExecutor
- Run: `npm test`

## Dependencies
- `@opencode-ai/sdk` — only runtime dep (for OpenCode backend)
- `typescript`, `@types/node` — dev only
- Everything else is Node stdlib

## CI/CD
- GitHub Actions: build + test on Node 20 + 22
- On tag push (v*): npm publish + GitHub Release
- Homebrew tap dispatch (broken — PAT needs `repo` scope)

## AI Working Context

Two files per repo:
- **`AGENTS.md`** (this file) — how to work on this project. Stable, changes slowly.
- **`claude.md`** — what we're working on. Status, roadmap, what's next. Update every commit.
