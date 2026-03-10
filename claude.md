# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.25.2

## Current Focus

Session rotation fix for reasoner timeouts. 474 tests across 19 files. The
opencode SDK backend now rotates to a fresh session every 7 reasoning calls,
preventing unbounded context accumulation that caused consistent 90s timeouts
after ~15 polls. Also fixed abort not resetting the session (caused infinite
timeout loops). Daemon is running live in full autonomous mode.

## Working Items

### Remaining backlog
- `OpencodeReasoner.shutdown()` doesn't clean up orphaned servers from prior runs
- 30s cooldown too slow for multi-step permission flows (consider shorter cooldown for approvals)
- `index.ts` dynamic imports in `testContext` that could be static
- `types.ts` `AoeSession.status` is `string` instead of union type
- Meta-level UX improvements (auto session naming, onboarding)

## Completed

- v0.25.2: Session rotation + abort-reset fix — 7 new tests (474 total):
  - HIGH: opencode.ts — added session rotation after MAX_SESSION_MESSAGES (7)
    reasoning calls. Each observation can be up to 100KB; after ~15 messages the
    opencode conversation history grew so large the LLM couldn't respond within
    90s. Now rotates to a fresh session proactively, re-sending the system prompt.
    Observed breaking point was poll #17; rotation at 7 gives 2x safety margin.
  - HIGH: opencode.ts — fixed abort not resetting session. When the 90s timeout
    fired, the AbortSignal early-return in decideViaSDK skipped the sessionId
    reset, so the next call reused the same bloated session → timeout again →
    infinite loop. Now resets session on all abort/timeout paths.
  - Extracted `resetSession()` helper for consistent session/messageCount cleanup.
  - 7 new tests with mock HTTP server: session creation, reuse within limit,
    rotation at threshold, multiple rotations, abort-resets-session, constant
    sanity check, error recovery with fresh session.
- v0.25.1: Permission prompt approval — empty text sends bare Enter (467 total)
- v0.25.0: Reliability — byte/char budget, first-poll blindness (464 total)
- v0.24.0: Correctness — 7 fixes, extractNewLines rewrite (451 total)
- v0.23.0: Code quality — LRU cache, shared session listing (442 total)
- v0.22.0: Reliability + resilience — string-aware JSON parser (434 total)
- v0.21.0: Hardening — orphan prevention, prompt budget (426 total)
- v0.20.0: Code audit fixes — 8 issues resolved (420 total)
- v0.19.0: shell.ts test coverage (399 total)
- v0.18.0: Chat + IPC test coverage (381 total)
- v0.17.0: AbortSignal cancellation (334 total)
- v0.16.0: IPC hardening + chat.ts async rewrite (323 total)
- v0.15.0: 5 new test files + ANSI stripping (313 total)
- v0.14.0: Prompt budget, send_input cap (215 total)
- v0.13.0: Audit fixes, stale SDK recovery (213 total)
- v0.12.0: Balanced-brace JSON, log rotation (200 total)
- v0.11.1: Reliability hardening, tmux literal mode (193 total)
- v0.11.0: sessionDirs, daemonTick refactor (193 total)
- v0.10.0: E2e loop tests, CI test glob fix
- v0.9.0: Auto-discovery, resolveProjectDir, test-context
- 474 tests across 19 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
