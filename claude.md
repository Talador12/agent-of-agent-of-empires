# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.9.0

## Current Focus

UX improvements for safely running alongside active sessions. CLI help and README
now clearly document the test-context -> dry-run -> full mode progression.

## Working Items

### CLI/README onboarding UX
- **Status:** Done
- Added "Try It Safely" section to README with comparison table
- Improved --help: shows progression (test-context -> --dry-run -> full mode)
- Added test-context to README Daemon CLI section (was missing)
- Improved --dry-run description (clarifies: costs tokens, never touches sessions)
- Fixed npm test glob (was missing root-level test files, only ran 43/158)

### Fix Homebrew tap PAT
- **Status:** Todo
- `HOMEBREW_TAP_TOKEN` PAT needs `repo` scope for `peter-evans/repository-dispatch`
- Once fixed, re-run release workflow to trigger tap update

### End-to-end testing with mock daemon
- **Status:** Todo
- Mock-based: canned reasoner responses, verify daemon + chat integration
- Goal: test the full observe -> reason -> execute loop without a live LLM

### Meta-level UX improvements
- **Status:** Todo
- Auto session naming (match session titles to project directories)
- Project directory config (explicit mapping instead of heuristic search)
- Better onboarding for users who run `aoe` from a parent directory

## Completed

- v0.9.0: Auto-discovery of AI instruction files, `resolveProjectDir`, cross-platform inode de-dupe, `test-context` subcommand
- v0.8.0: Title-based project directory resolution for meta-level aoe usage
- v0.7.0: AGENTS.md + claude.md context loading, global + per-session context
- 158 tests across 7 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
- Created `AGENTS.md`, removed `.claude/` scratchpad system
- Propagated two-file AI Working Context across all repos
