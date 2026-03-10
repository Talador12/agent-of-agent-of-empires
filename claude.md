# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.25.1

## Current Focus

Permission prompt approval fix. 467 tests across 19 files. The daemon can now
autonomously approve OpenCode permission prompts by sending bare Enter keypresses.
Daemon is running live in full autonomous mode supervising 3 AoE sessions.

## Working Items

### Investigate reasoner timeout after ~7 polls
- **Status:** Next
- OpenCode SDK backend consistently times out at 90s starting around poll #8
- Restarting the daemon (fresh session) fixes it temporarily
- Likely caused by context accumulation in the opencode conversation session
- May need session rotation or context pruning

### Remaining backlog
- `OpencodeReasoner.shutdown()` doesn't clean up orphaned servers from prior runs
- 30s cooldown too slow for multi-step permission flows (consider shorter cooldown for approvals)
- `index.ts` dynamic imports in `testContext` that could be static
- `types.ts` `AoeSession.status` is `string` instead of union type
- Meta-level UX improvements (auto session naming, onboarding)

## Completed

- v0.25.1: Permission prompt approval fix — 3 new tests (467 total):
  - CRITICAL: executor.ts — allow empty text for permission prompt approval.
    Old behavior: `if (!text.trim())` rejected all empty/whitespace input.
    New behavior: empty text sends bare `Enter` via tmux (no literal text),
    tracks as `(approved permission prompt)`. This was the main blocker
    preventing the daemon from autonomously approving OpenCode's multi-step
    permission flows (mkdir → dir access → edit → run command).
  - 3 new tests for Enter-only detection logic in executor.test.ts.
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
- v0.24.0: Correctness — 7 fixes, 9 new tests (451 total)
- v0.23.0: Code quality — 6 improvements, 8 new tests (442 total)
- v0.22.0: Reliability + resilience — 8 fixes, 8 new tests (434 total)
- v0.21.0: Hardening — 10 fixes, 6 new tests (426 total)
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
- 467 tests across 19 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
