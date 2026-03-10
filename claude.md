# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.11.0

## Current Focus

Post v0.11.0: reliability hardening — action validation, tmux injection prevention,
config validation, error logging, shared parse module. 193 tests.

## Working Items

### Reliability hardening
- **Status:** Done
- Per-action-type field validation (send_input requires session+text, etc.)
- Extracted shared `reasoner/parse.ts` — both backends use it, no more duplication
- tmux send-keys uses `-l` (literal) flag to prevent LLM control sequence injection
- Config validation at startup (reasoner, pollIntervalMs, port, policies)
- CLI arg bounds checking (--reasoner without value no longer crashes)
- `withTimeoutAndInterrupt` logs errors instead of silently swallowing
- OpenCode server process killed on init timeout (no more orphans)
- Poller uses `Promise.allSettled` (one session failure doesn't lose all captures)
- Loop passes only non-wait actions to executor
- 5 new action validation tests

### Fix Homebrew tap PAT
- **Status:** Todo
- `HOMEBREW_TAP_TOKEN` PAT needs `repo` scope for `peter-evans/repository-dispatch`
- Once fixed, re-run release workflow to trigger tap update

### Meta-level UX improvements
- **Status:** Todo
- Auto session naming (match session titles to project directories)
- Better onboarding for users who run `aoe` from a parent directory

## Completed

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
