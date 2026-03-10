# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.18.0

## Current Focus

Chat + IPC testing complete. 381 tests across 18 files. Next: meta-level UX
improvements, shell.ts test coverage, or feature work.

## Working Items

### Fix Homebrew tap PAT
- **Status:** Todo
- `HOMEBREW_TAP_TOKEN` PAT needs `repo` scope for `peter-evans/repository-dispatch`
- Once fixed, re-run release workflow to trigger tap update

### Meta-level UX improvements
- **Status:** Todo
- Auto session naming (match session titles to project directories)
- Better onboarding for users who run `aoe` from a parent directory

### shell.ts test coverage
- **Status:** Todo
- Tests for exec() AbortSignal handling, timeout behavior, execQuiet

## Completed

- v0.18.0: Chat + IPC test coverage — extracted pure functions from chat.ts
  for testability: isDaemonRunningFromState, getCountdownFromState,
  buildStatusLineFromState (all accept state + timestamp params instead of
  reading global state). Exported colorize. Guarded chat.ts main() with
  entry-point check so importing for tests doesn't start the UI. New
  chat.test.ts (36 tests: colorize 9, isDaemonRunning 7, getCountdown 7,
  buildStatusLine 10, plus edge cases). New ipc.test.ts (12 tests: daemon
  state round-trip 5, interrupt flag 3, session state building 2, conversation
  log colorization 2, full daemon lifecycle simulation 2). 381 tests across
  18 files.
- v0.17.0: AbortSignal cancellation — `withTimeoutAndInterrupt` refactored from
  raw `Promise<T>` to factory `(signal: AbortSignal) => Promise<T>`, creates
  `AbortController` and passes signal through to both OpenCode (fetch) and Claude
  Code (exec) backends. Renamed `console_` to `reasonerConsole` in index.ts.
  Fixed hardcoded 30s in executor.test.ts. New abort-signal.test.ts with 11
  tests. 334 tests across 16 files.
- v0.16.0: IPC hardening + chat modernization — atomic rename-based drain in
  console.ts, opencode server PID file, chat.ts async rewrite, fs.watch,
  DRY computeTmuxName import, tryExtractSessionId logging, console.test.ts
  with 10 tests. 323 tests total.
- v0.15.0: test coverage expansion — 5 new test files (dashboard, claude-code,
  reasoner-factory, daemon-state, input), ANSI stripping in poller. 313 tests.
- v0.14.0: robustness — prompt budget, send_input cap, DRY session resolution,
  configurable cooldown, auto-prune stale rate limit entries. 215 tests.
- v0.13.0: audit fixes — test-context in parseCliArgs, stale SDK session
  auto-recovery, shell.ts signal capture, edge case tests. 213 tests.
- v0.12.0: audit fixes — balanced-brace JSON extraction, log rotation, TOCTOU
  race fix, rate limit normalization. 200 tests.
- v0.11.1: reliability hardening — per-action-type field validation, tmux literal
  mode, config validation, CLI bounds checking, Promise.allSettled, shared
  parse.ts. 193 tests.
- v0.11.0: sessionDirs config, daemonTick refactor using loop.ts. 193 tests.
- v0.10.0: E2e loop tests, "Try It Safely" README, CI test glob fix.
- v0.9.0: Auto-discovery of AI instruction files, resolveProjectDir, test-context.
- v0.8.0: Title-based project directory resolution.
- v0.7.0: AGENTS.md + claude.md context loading.
- 381 tests across 18 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
