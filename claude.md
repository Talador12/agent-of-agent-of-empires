# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.24.0

## Current Focus

Correctness fixes for real-world reliability. 451 tests across 19 files. Fixed
repeated-line false negatives, prompt truncation direction, rate limit on failure,
deepMerge clearing. Next: meta-level UX improvements or feature work.

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
- `waitForInput` busy-loops with 500ms sleep (could use fs.watch)
- `formatObservation` byte/char budget mismatch (ctx.slice vs Buffer.byteLength)
- `OpencodeReasoner.shutdown()` doesn't clean up orphaned servers from prior runs
- `daemon-state.ts` does sync mkdirSync+writeFileSync on every phase change (could cache/debounce)
- `ClaudeCodeReasoner.tryExtractSessionId` regex is fragile (could match git hashes)

## Completed

- v0.24.0: Correctness — 7 fixes, 9 new tests (451 total):
  - HIGH: poller.ts — rewrote `extractNewLines` algorithm. Old approach used
    `lastIndexOf` on joined anchor string, causing false negatives when repeated
    lines (build progress, test output) appeared multiple times. New algorithm
    does line-by-line backward scan, skipping blank lines, finding the true
    overlap boundary. 4 new regression tests for repeated-line scenarios.
  - HIGH: prompt.ts — fixed `formatObservation` truncation direction. Previously
    truncated from the end (losing operator message + changes = most important
    real-time data). Now identifies the project context section and trims it first,
    preserving changes and operator messages. 2 new tests.
  - HIGH: config.ts — fixed `deepMerge` not handling empty objects. Overriding
    `sessionDirs: {}` was silently ignored because recursive merge kept existing
    keys. Now empty objects replace rather than merge. 3 new tests.
  - MEDIUM: executor.ts — fixed `markAction` called on failure for start/stop/
    restart/remove/create_agent. Failed actions triggered 30s cooldown, blocking
    retries. Now only marks on success (consistent with send_input fix in v0.22.0).
  - LOW: index.ts — `InterruptError` now sets `this.name = "InterruptError"` for
    proper error serialization.
  - LOW: index.ts — removed unused `ActionLogEntry` type import.
  - LOW: poller.ts — `extractNewLines` dead branch removed (unreachable
    `prevLines.length === 0` check since `"".split("\n")` returns `[""]`).
- v0.23.0: Code quality — 6 improvements, 8 new tests (442 total):
  - LRU cache eviction, shared session listing, testable CLI args, path escaping
- v0.22.0: Reliability + resilience — 8 fixes, 8 new tests (434 total):
  - String-aware JSON parser, server health monitoring, resource leak fixes
- v0.21.0: Hardening — 10 fixes, 6 new tests (426 total):
  - Orphan prevention, prompt budget, shutdown handler, race fixes
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
- 451 tests across 19 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
