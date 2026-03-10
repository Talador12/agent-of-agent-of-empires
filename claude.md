# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.10.0

## Current Focus

Release v0.10.0: e2e test infrastructure, CLI UX for running safely alongside
active sessions, CI fixes.

## Working Items

### CLI/README onboarding UX
- **Status:** Done
- Added "Try It Safely" section to README with comparison table
- Improved --help: shows progression (test-context -> --dry-run -> full mode)
- Added test-context to README Daemon CLI section (was missing)
- Improved --dry-run description (clarifies: costs tokens, never touches sessions)
- Fixed npm test glob (was missing root-level test files, only ran 43/158)

### E2e testing with mock daemon
- **Status:** Done
- Extracted `loop.ts` — testable tick() that accepts PollerLike/Reasoner/ExecutorLike interfaces
- MockPoller, MockReasoner, MockExecutor with queued responses
- 15 tests covering: full observe->reason->execute loop, dry-run mode, user message injection,
  policy enforcement (idle, error accumulation, permission prompts), multi-tick sequences,
  wait-only skipping, policy state pruning, error recovery
- 173 tests total across 8 files, all passing

### Fix Homebrew tap PAT
- **Status:** Todo
- `HOMEBREW_TAP_TOKEN` PAT needs `repo` scope for `peter-evans/repository-dispatch`
- Once fixed, re-run release workflow to trigger tap update

### Meta-level UX improvements
- **Status:** Todo
- Auto session naming (match session titles to project directories)
- Project directory config (explicit mapping instead of heuristic search)
- Better onboarding for users who run `aoe` from a parent directory

## Completed

- v0.10.0: E2e loop tests with mock infrastructure, "Try It Safely" README section,
  CLI help improvements, CI test glob fix, two-file AI Working Context propagation
- v0.9.0: Auto-discovery of AI instruction files, `resolveProjectDir`, cross-platform inode de-dupe, `test-context` subcommand
- v0.8.0: Title-based project directory resolution for meta-level aoe usage
- v0.7.0: AGENTS.md + claude.md context loading, global + per-session context
- 173 tests across 8 files, all passing (added loop.test.ts with 15 e2e tests)
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
- Created `AGENTS.md`, removed `.claude/` scratchpad system
- Propagated two-file AI Working Context across all repos
