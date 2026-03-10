# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.25.0

## Current Focus

Reliability and correctness fixes. 464 tests across 19 files. Fixed byte/char
budget mismatch, first-poll blindness, session ID regex, mkdirSync redundancy.
Next: start daemon in full autonomous mode.

## Working Items

### Start daemon in full autonomous mode
- **Status:** Next
- Run from `/Users/kadler/Documents/repos` for project dir resolution
- Command: `node /Users/kadler/Documents/repos/github/agent-of-agent-of-empires/dist/index.js --verbose`

### Remaining backlog
- `OpencodeReasoner.shutdown()` doesn't clean up orphaned servers from prior runs
- `Poller.diffSnapshots` first-poll initial capture could be configurable (lines count)
- `index.ts` dynamic imports in `testContext` that could be static
- `types.ts` `AoeSession.status` is `string` instead of union type
- Meta-level UX improvements (auto session naming, onboarding)

## Completed

- v0.25.0: Reliability — 4 fixes, 13 new tests (464 total):
  - HIGH: prompt.ts — fixed byte/char budget mismatch. `ctx.slice(0, budget)`
    used character index but budget was in bytes. Multi-byte chars (emoji, CJK)
    would overshoot the byte limit. Added `sliceToByteLimit()` using binary search
    to find the character boundary that fits within the byte budget. Applied to all
    3 truncation sites in formatObservation. 9 new tests.
  - MEDIUM: poller.ts — fixed first-poll blindness. `diffSnapshots()` skipped all
    sessions on first poll (no previous snapshot = continue). Reasoner never saw
    initial agent state. Now reports last 20 lines of each session's output as
    `[initial capture]` on first poll.
  - LOW: daemon-state.ts — cached `mkdirSync` call. Previously called
    `mkdirSync(AOAOE_DIR, { recursive: true })` on every `writeState()` and
    `requestInterrupt()`. Now only calls once per process via `ensureDir()`.
  - LOW: claude-code.ts — widened `tryExtractSessionId` regex. Old pattern
    `([a-f0-9-]+)` only matched hex + hyphens. New pattern `([a-zA-Z0-9_-]{8,})`
    accepts alphanumeric + underscores with 8-char minimum to avoid git hash
    false positives. 4 new tests.
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
- 464 tests across 19 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
