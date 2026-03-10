# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.19.0

## Current Focus

Comprehensive test coverage. 399 tests across 19 files. All source modules
now have corresponding test files. Next: meta-level UX improvements or
feature work.

## Working Items

### Fix Homebrew tap PAT
- **Status:** Todo
- `HOMEBREW_TAP_TOKEN` PAT needs `repo` scope for `peter-evans/repository-dispatch`
- Once fixed, re-run release workflow to trigger tap update

### Meta-level UX improvements
- **Status:** Todo
- Auto session naming (match session titles to project directories)
- Better onboarding for users who run `aoe` from a parent directory

## Completed

- v0.19.0: shell.ts test coverage — new shell.test.ts with 18 tests covering
  exec() basic execution (stdout, stderr, exit codes, ENOENT, args, empty output,
  large output), timeout behavior (kill on exceed, complete before timeout),
  AbortSignal integration (abort running process, no interference when not aborted,
  pre-aborted signal), execQuiet (success/failure/nonexistent), and sleep (duration,
  immediate, returns promise). Also extracted pure functions from chat.ts for
  testability and guarded main() entry point. 399 tests across 19 files.
- v0.18.0: Chat + IPC test coverage — chat.test.ts (36 tests), ipc.test.ts (12
  tests). Extracted isDaemonRunningFromState, getCountdownFromState,
  buildStatusLineFromState, colorize as exported pure functions. 381 tests.
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
- 399 tests across 19 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
