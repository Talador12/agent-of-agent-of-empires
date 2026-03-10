# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.20.0

## Current Focus

Code audit fixes and hardening. 420 tests across 19 files. All audit issues
from v0.19.0 have been resolved. Next: meta-level UX improvements or feature work.

## Working Items

### Fix Homebrew tap PAT
- **Status:** Todo
- `HOMEBREW_TAP_TOKEN` PAT needs `repo` scope for `peter-evans/repository-dispatch`
- Once fixed, re-run release workflow to trigger tap update

### Meta-level UX improvements
- **Status:** Todo
- Auto session naming (match session titles to project directories)
- Better onboarding for users who run `aoe` from a parent directory

### Remaining backlog
- `deepMerge` doesn't handle clearing `sessionDirs` to `{}`
- Prompt budget uses `Buffer.byteLength` but truncates by character count
- Duplicated session listing logic between `chat.ts` and `poller.ts`

## Completed

- v0.20.0: Code audit fixes — 8 issues resolved, 21 new tests (420 total):
  - poller: Promise.all → Promise.allSettled for status fetches so one failing
    getSessionStatus doesn't lose all sessions (includes fallback with "unknown" status)
  - poller: verbose logging for tmux capture failures (was silent even in verbose mode)
  - executor: startSession/stopSession/removeAgent now resolve session IDs via
    resolveSessionId() before passing to aoe CLI and markAction(), fixing rate limit
    bypass when LLM uses title or prefix instead of full ID
  - executor: create_agent now rate-limited by title bucket, preventing LLM spam
  - executor: create_agent validates path exists as directory and tool is a known
    AoE tool name (opencode, claude-code, cursor, windsurf, aider, codex, cline)
  - config: validates maxIdleBeforeNudgeMs (must be >= pollIntervalMs, finite) and
    actionCooldownMs (must be >= 1000ms if provided, finite) — prevents 0-value
    configs that would disable rate limiting or flag every session as idle
  - shell: SIGKILL fallback timer is now cleared when child exits before it fires,
    preventing event loop leak
  - context: removed redundant existsSync before statSync in readContextFile
    (try/catch already handles ENOENT)
- v0.19.0: shell.ts test coverage — 18 tests. 399 tests across 19 files.
- v0.18.0: Chat + IPC test coverage — chat.test.ts (36 tests), ipc.test.ts (12
  tests). 381 tests.
- v0.17.0: AbortSignal cancellation — withTimeoutAndInterrupt factory pattern,
  signal passed to both reasoner backends. 334 tests.
- v0.16.0: IPC hardening + chat.ts async rewrite. 323 tests.
- v0.15.0: 5 new test files + ANSI stripping. 313 tests.
- v0.14.0: Prompt budget, send_input cap, DRY session resolution. 215 tests.
- v0.13.0: Audit fixes, stale SDK recovery, signal capture. 213 tests.
- v0.12.0: Balanced-brace JSON, log rotation, TOCTOU fix. 200 tests.
- v0.11.1: Reliability hardening, tmux literal mode, config validation. 193 tests.
- v0.11.0: sessionDirs, daemonTick refactor. 193 tests.
- v0.10.0: E2e loop tests, CI test glob fix.
- v0.9.0: Auto-discovery, resolveProjectDir, test-context.
- 420 tests across 19 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
