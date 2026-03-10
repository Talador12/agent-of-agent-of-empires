# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.22.0

## Current Focus

Reliability and resilience improvements. 434 tests across 19 files. JSON parser,
server health monitoring, resource leak prevention, and rate limiting fixes.
Next: meta-level UX improvements or feature work.

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
- Duplicated session listing logic between `chat.ts` and `poller.ts`
- Unbounded context cache growth (needs max size + eviction)
- `parseCliArgs` calls `process.exit(1)` in `nextArg` (untestable)
- `waitForInput` busy-loops with 500ms sleep (could use fs.watch)
- `console.ts` INPUT_LOOP_SCRIPT has unescaped path interpolation
- `poller.ts` `extractNewLines` lastIndexOf can produce false negatives with repeated lines

## Completed

- v0.22.0: Reliability + resilience — 8 fixes, 8 new tests (434 total):
  - HIGH: parse.ts — string-literal-aware brace counting in `extractFirstValidJson`.
    Braces inside JSON strings (e.g. `{"text": "use { and }"}`) no longer break
    the balanced-brace scanner. Handles escaped quotes too.
  - HIGH: chat.ts — `listAoeSessions` `Promise.all` -> `Promise.allSettled` so one
    failing session status fetch doesn't lose all sessions in /overview
  - HIGH: opencode.ts — added `error`/`exit` event listeners on spawned server process.
    On unexpected death: nulls client + sessionId, logs the event. Next `decide()`
    attempts reconnect before falling back to CLI.
  - MEDIUM: opencode.ts — PID file only deleted in `shutdown()` if we started the server
    (prevents deleting another instance's PID file)
  - MEDIUM: daemon-state.ts — `buildSessionStates` prunes `sessionTasks` Map entries
    for sessions that no longer exist (prevents unbounded memory growth)
  - MEDIUM: chat.ts — `onLogChange` resets `lastSize` to 0 on file error/delete so
    new content isn't missed after daemon restart clears conversation.log
  - MEDIUM: executor.ts — `sendInput` only calls `markAction` (triggers cooldown) on
    success. Failed sends are immediately retryable instead of blocked for 30s.
  - LOW: index.ts — removed dead `loadSessionContext` import
- v0.21.0: Hardening — 10 fixes, 6 new tests (426 total):
  - orphan prevention (opencode.ts), prompt budget (prompt.ts), shutdown handler
    (index.ts), TOCTOU race (console.ts), stale threshold (chat.ts), noisy log
    (claude-code.ts), command re-injection (index.ts), unknown flag warning
    (config.ts), parameter mutation (executor.ts)
- v0.20.0: Code audit fixes — 8 issues resolved, 21 new tests (420 total)
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
- 434 tests across 19 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
