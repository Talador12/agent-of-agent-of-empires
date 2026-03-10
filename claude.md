# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.25.3

## Current Focus

Fast permission approval cooldown. 477 tests across 19 files. Permission
approvals (Enter-only actions) now use a 1.5s cooldown instead of 30s. OpenCode
has multi-step permission flows (mkdir → dir access → edit → run) that each need
a separate Enter — at 30s between steps that took 2+ minutes per agent. Now
completes in ~6s. Session rotation (v0.25.2) and permission approval (v0.25.1)
also working. Daemon is live supervising FizzBuzz collaboration across 2 test
sessions.

## Working Items

### Remaining backlog
- `OpencodeReasoner.shutdown()` doesn't clean up orphaned servers from prior runs
- `index.ts` dynamic imports in `testContext` that could be static
- `types.ts` `AoeSession.status` is `string` instead of union type
- Meta-level UX improvements (auto session naming, onboarding)

## Completed

- v0.25.3: Fast permission cooldown — 3 new tests (477 total):
  - Permission approvals (Enter-only) now use PERMISSION_COOLDOWN_MS (1.5s)
    instead of the default 30s actionCooldownMs. Multi-step permission flows
    (mkdir → dir access → edit → run command) now complete in ~6s per agent
    instead of 2+ minutes. Non-permission actions still use normal 30s cooldown.
  - Tracks `lastActionWasPermission` per session. `markAction(id, true)` for
    permission approvals, `isRateLimited()` checks this to pick the right cooldown.
  - 3 new tests: constant validation, fast→normal cooldown transition, normal
    cooldown after non-permission action.
- v0.25.2: Session rotation + abort-reset — 7 new tests (474 total):
  - Rotate opencode SDK session after 7 reasoning calls to prevent timeouts.
  - Fixed abort not resetting session (caused infinite timeout loop).
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
- 477 tests across 19 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
