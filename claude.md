# aoaoe — Agent of Agent of Empires

## Version: v0.9.0

Autonomous supervisor daemon for [agent-of-empires](https://github.com/njbrake/agent-of-empires) sessions.
Uses OpenCode or Claude Code as its reasoning engine. Observes agents via tmux, decides when to intervene, acts.

## Quick Reference

```bash
npm run build          # tsc -> dist/
npm test               # build + node --test (158 tests, node:test stdlib)
npm start              # run daemon
aoaoe --dry-run        # observe + reason, don't execute
aoaoe --verbose        # verbose logging
aoaoe-chat             # interactive chat UI
```

## Architecture

```
Poller (aoe CLI + tmux capture)
  -> Reasoner (OpenCode SDK or Claude Code subprocess)
    -> Executor (tmux send-keys, aoe CLI commands)
```

Three loops: poll sessions, reason about observations, execute actions. The reasoner
gets a system prompt defining the supervisor role + per-session project context
(auto-discovered AI instruction files from each session's resolved directory).

## Source Layout

| File | Purpose |
|------|---------|
| `src/index.ts` | Main daemon loop — poll/reason/execute cycle, policy tracking |
| `src/config.ts` | Config loader, CLI arg parser, env validation |
| `src/types.ts` | All interfaces — SessionSnapshot, Observation, Action, Reasoner |
| `src/poller.ts` | `aoe list --json` + `tmux capture-pane`, SHA-256 diff detection |
| `src/context.ts` | `resolveProjectDir`, `loadSessionContext`, `loadGlobalContext`, context caching |
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
- **Meta-level**: User runs `aoe` from a parent dir (e.g. `~/repos/`), manually names sessions to match projects. All sessions share the same `path`. `resolveProjectDir()` searches 2 levels deep to find the actual project dir by matching the session title (normalized: spaces/underscores -> hyphens, case-insensitive).

### Context loading — auto-discovery
Instead of a hardcoded file list, `discoverContextFiles()` scans each project root:
1. **Primary files** (always first): `AGENTS.md`, `claude.md`, `CLAUDE.md`
2. **Auto-discovered** via readdir + pattern matching: `*rules` (catches .cursorrules, .windsurfrules, .clinerules, and future tools), `*instructions*` (copilot), `.aider*`, `CODEX.md`, `CONTRIBUTING.md`
3. **Known nested paths**: `.github/copilot-instructions.md`, `.cursor/rules`
4. **User extras**: `config.contextFiles` array for custom paths

Budget: 8KB max per file, 24KB total per directory. Cached 60s.
Parent directory is also checked for primary files (group-level context).
`buildSystemPrompt(globalContext?)` injects global context into the reasoner at init time.

### Policy enforcement
- `maxIdleBeforeNudgeMs` (default 120s) — nudge idle sessions
- `maxErrorsBeforeRestart` (default 3) — restart after N consecutive error polls
- `autoAnswerPermissions` — detect y/n prompts via regex, force reasoning cycle
- Policy violations trigger reasoning even when no output changes detected

### Testing
- 158 tests across 7 files, `node:test` (stdlib, zero deps)
- Pure functions exported for testability: `resolveProjectDir`, `discoverContextFiles`, `parseReasonerResponse`, `validateResult`, `computeTmuxName`, `quickHash`, `extractNewLines`, `deepMerge`, `detectPermissionPrompt`
- Run: `npm test` (builds first, then `node --test --test-reporter spec dist/**/*.test.js`)

## Dependencies
- `@opencode-ai/sdk` — only runtime dep (for OpenCode backend)
- `typescript`, `@types/node` — dev only
- Everything else is Node stdlib (`node:test`, `node:crypto`, `node:child_process`, `node:fs`, `node:readline`)

## CI/CD
- GitHub Actions: build + test on Node 20 + 22
- On tag push (v*): npm publish + GitHub Release (with tarball + SHA256)
- Homebrew tap dispatch (broken — PAT needs `repo` scope)

## What's Next
- Fix Homebrew tap PAT
- End-to-end testing with mock daemon + canned reasoner
- Verify with real 3-session setup (`aoaoe --verbose --dry-run`)
- Smoother UX for meta-level users (auto session naming, project directory config)
