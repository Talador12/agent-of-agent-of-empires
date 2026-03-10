# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.11.1

## Current Focus

Post v0.11.1: address audit findings — greedy regex in parse.ts, unbounded
action log, rate limiting normalization, TOCTOU race in daemon-state.

## Working Items

### Audit findings (medium priority)
- **Status:** Todo
- Greedy regex `\{[\s\S]*\}` in parse.ts could match wrong JSON block — use non-greedy or iterate
- Rate limiting uses raw session ID but LLM may send title — normalize through resolver
- Unbounded `~/.aoaoe/actions.log` — needs rotation
- `daemon-state.ts` TOCTOU race on interrupt file — just try unlink and catch ENOENT

### Audit findings (low priority)
- **Status:** Todo
- `test-context` subcommand not handled in `parseCliArgs()` (inconsistent)
- Dynamic `import("node:fs")` inside loop in testContext
- OpenCode SDK session never recreated after server restart (stale sessionId)
- `shell.ts` exit code extraction uses `err.code` (string) instead of `err.status`
- Missing test coverage: tick() error propagation, config edge cases

### Fix Homebrew tap PAT
- **Status:** Todo
- `HOMEBREW_TAP_TOKEN` PAT needs `repo` scope for `peter-evans/repository-dispatch`
- Once fixed, re-run release workflow to trigger tap update

### Meta-level UX improvements
- **Status:** Todo
- Auto session naming (match session titles to project directories)
- Better onboarding for users who run `aoe` from a parent directory

## Completed

- v0.11.1: reliability hardening — per-action-type field validation, tmux literal
  mode (injection prevention), config validation at startup, CLI bounds checking,
  error logging in withTimeoutAndInterrupt, orphan process cleanup, Promise.allSettled
  in poller, shared reasoner/parse.ts, 193 tests
- v0.11.0: sessionDirs config, daemonTick refactor using loop.ts,
  resolveProjectDirWithSource diagnostics, reliability hardening, 193 tests
- v0.10.0: E2e loop tests with mock infrastructure, "Try It Safely" README section,
  CLI help improvements, CI test glob fix, two-file AI Working Context propagation
- v0.9.0: Auto-discovery of AI instruction files, `resolveProjectDir`, cross-platform inode de-dupe, `test-context` subcommand
- v0.8.0: Title-based project directory resolution for meta-level aoe usage
- v0.7.0: AGENTS.md + claude.md context loading, global + per-session context
- 193 tests across 9 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
- Created `AGENTS.md`, removed `.claude/` scratchpad system
- Propagated two-file AI Working Context across all repos
