<p align="center">
  <h1 align="center">Agent of Agent of Empires (aoaoe)</h1>
  <p align="center">
    <a href="https://github.com/Talador12/agent-of-agent-of-empires/releases"><img src="https://img.shields.io/github/v/release/Talador12/agent-of-agent-of-empires" alt="GitHub release"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  </p>
</p>

An autonomous supervisor that manages [Agent of Empires](https://github.com/njbrake/agent-of-empires) sessions using [OpenCode](https://github.com/anomalyco/opencode) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as the reasoning engine.

> Built on top of [Agent of Empires (AoE)](https://github.com/njbrake/agent-of-empires) by [Nate Brake](https://x.com/natebrake). AoE is the session manager -- aoaoe is the brain that drives it.

## What is this?

[Agent of Empires (AoE)](https://github.com/njbrake/agent-of-empires) manages multiple AI coding agents (Claude Code, OpenCode, Gemini CLI, Codex, etc.) in tmux sessions with git worktrees. It is great at spawning and organizing agents, but someone still needs to watch the tmux panes and intervene when agents get stuck, ask questions, or finish their work.

**aoaoe** is that someone -- except it is an LLM. It polls your AoE sessions, reads agent output, decides when to act, and executes without you needing to be there.

This is the conductor, not the orchestra. AoE manages the sessions. The agents inside do the coding. aoaoe watches everything and steps in when needed.

## Installation

**Prerequisites:**
- [tmux](https://github.com/tmux/tmux/wiki) (required)
- [agent-of-empires](https://github.com/njbrake/agent-of-empires) (`aoe` binary on PATH)
- One of:
  - [OpenCode](https://github.com/anomalyco/opencode) (`opencode` binary on PATH)
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` binary on PATH)

```bash
# Quick install (Linux & macOS)
curl -fsSL \
  https://raw.githubusercontent.com/Talador12/agent-of-agent-of-empires/main/scripts/install.sh \
  | bash

# Homebrew
brew install Talador12/tap/aoaoe

# npm
npm install -g aoaoe

# Build from source
git clone https://github.com/Talador12/agent-of-agent-of-empires
cd agent-of-agent-of-empires && npm install && npm run build
npm link
```

## Quick Start

```bash
# 1. Make sure you have AoE sessions running
aoe

# 2. Start the supervisor
aoaoe

# 3. Or specify a reasoning backend
aoaoe --reasoner opencode
aoaoe --reasoner claude-code
```

## How It Works

```
┌──────────────────────────────────────────────────────┐
│                    aoaoe daemon                      │
│                                                      │
│  ┌───────────┐   ┌──────────────┐   ┌───────────┐   │
│  │  Poller   │──▶│   Reasoner   │──▶│ Executor  │   │
│  │           │   │ ┌──────────┐ │   │           │   │
│  │ aoe CLI + │   │ │ OpenCode │ │   │ tmux send │   │
│  │ tmux cap  │   │ │  server  │ │   │ keys, aoe │   │
│  │           │   │ ├──────────┤ │   │ CLI cmds  │   │
│  │           │   │ │  Claude  │ │   │           │   │
│  │           │   │ │   Code   │ │   │           │   │
│  │           │   │ └──────────┘ │   │           │   │
│  └───────────┘   └──────────────┘   └───────────┘   │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │              Dashboard (optional)              │  │
│  │    opencode web --port 4097 OR plain CLI       │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
    AoE sessions                  LLM Provider
    (tmux panes)              (local or remote)
```

### Three Loops

**Poller** (every N seconds, configurable):
- Calls `aoe status --json` to get all session IDs, statuses, and tools
- For each active session: `tmux capture-pane -t aoe_<name>_<id8> -p -S -100`
- Diffs against previous capture to detect new output (ignores cursor blinks)
- Builds an observation payload: `{ sessions: [...], newOutput: {...} }`

**Reasoner** (on new observations):
- Sends observation to the configured LLM backend
- System prompt defines the supervisor role, policies, and available actions
- Receives back a structured JSON action decision
- Backend-agnostic: same observation format and action schema regardless of backend

**Executor** (on decisions):
- `tmux send-keys -t <session> "<text>" Enter` -- inject a prompt into an agent
- `aoe session start/stop/restart <id>` -- lifecycle management
- `aoe add <path> -t <title> -c <tool> -y` -- spawn new agents
- `aoe remove <id>` -- tear down agents

### Supervisor Behavior

The LLM supervisor follows these policies:
- If an agent is stuck or idle too long, nudge it with context or a rephrased task
- If an agent asks a question and is waiting for input, answer it
- If an agent finishes its task, acknowledge and optionally assign follow-up work
- If a session crashes, restart it
- Do NOT micromanage -- only intervene when there is a clear problem or decision needed

### Available Actions

The reasoner returns structured JSON decisions:

```json
{ "action": "send_input", "session": "<id>", "text": "<prompt>" }
{ "action": "start_session", "session": "<id>" }
{ "action": "stop_session", "session": "<id>" }
{ "action": "create_agent", "path": "<dir>", "title": "<name>", "tool": "<agent>" }
{ "action": "remove_agent", "session": "<id>" }
{ "action": "wait" }
```

## Reasoning Backends

| Backend | Interface | Stateful | Model Flexibility |
|---------|-----------|----------|-------------------|
| **OpenCode** | `opencode serve` + `@opencode-ai/sdk` | Yes (long-running session) | Any provider via OpenCode config (Anthropic, OpenAI, Ollama, etc.) |
| **Claude Code** | `claude --print` subprocess | Via `--resume` | Anthropic models via Claude Code config |

### OpenCode Backend

Runs `opencode serve` as a headless HTTP server. Uses the [OpenCode JS SDK](https://opencode.ai/docs/sdk/) to maintain a long-running session with full context. Supports structured JSON output natively. Works with any model provider configured in OpenCode (remote APIs or local models).

### Claude Code Backend

Calls `claude --print --output-format json` as a subprocess. System prompt injected via `--append-system-prompt`. Session continuity via `--resume <session_id>`. Uses whatever model is configured in Claude Code (defaults to Anthropic models).

## Configuration

`aoaoe.config.json`:
```json
{
  "reasoner": "opencode",
  "pollIntervalMs": 10000,
  "opencode": {
    "port": 4097,
    "model": "anthropic/claude-sonnet-4-20250514"
  },
  "claudeCode": {
    "model": "claude-sonnet-4-20250514",
    "yolo": true,
    "resume": true
  },
  "aoe": {
    "profile": "default"
  },
  "policies": {
    "maxIdleBeforeNudgeMs": 120000,
    "maxErrorsBeforeRestart": 3,
    "autoAnswerPermissions": true
  }
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `reasoner` | `"opencode"` or `"claude-code"` | `"opencode"` |
| `pollIntervalMs` | How often to check AoE sessions (ms) | `10000` |
| `opencode.port` | Port for `opencode serve` | `4097` |
| `opencode.model` | Model in `provider/model` format | (uses OpenCode default) |
| `claudeCode.model` | Anthropic model name | (uses Claude Code default) |
| `claudeCode.yolo` | Skip permissions in Claude Code | `true` |
| `claudeCode.resume` | Maintain session across calls | `true` |
| `aoe.profile` | AoE profile to monitor | `"default"` |
| `policies.maxIdleBeforeNudgeMs` | Nudge idle agents after this long | `120000` |
| `policies.maxErrorsBeforeRestart` | Restart after N consecutive errors | `3` |
| `policies.autoAnswerPermissions` | Auto-approve permission prompts | `true` |

## AoE Integration Points

| Operation | Command | AoE Source |
|-----------|---------|------------|
| List sessions | `aoe list --json` | `cli/list.rs` |
| Session status | `aoe status --json` | `cli/status.rs` |
| Session details | `aoe session show <id> --json` | `cli/session.rs` |
| Capture output | `tmux capture-pane -t aoe_<title>_<id8> -p -S -N` | `tmux/session.rs` |
| Send input | `tmux send-keys -t aoe_<title>_<id8> "<text>" Enter` | standard tmux |
| Start/stop | `aoe session start/stop <id>` | `cli/session.rs` |
| Create agent | `aoe add <path> -t <title> -c <tool> [-w branch] -y` | `cli/add.rs` |
| Remove agent | `aoe remove <id>` | `cli/remove.rs` |

AoE sessions are named `aoe_<sanitized_title>_<first8_of_id>` in tmux. State is stored in `~/.agent-of-empires/profiles/<name>/sessions.json`.

## Tech Stack

- **Runtime**: Node.js / TypeScript
- **LLM (OpenCode)**: `@opencode-ai/sdk` + `opencode serve`
- **LLM (Claude Code)**: `claude --print --output-format json` subprocess
- **AoE**: Child process calls to `aoe` CLI + `tmux`
- **Config**: JSON

## Project Structure

```
src/
  index.ts          # entry point, daemon loop
  config.ts         # config loader and validation
  poller.ts         # aoe CLI + tmux capture-pane wrapper
  executor.ts       # maps action decisions to shell commands
  reasoner/
    index.ts        # common Reasoner interface
    opencode.ts     # OpenCode SDK backend
    claude-code.ts  # Claude Code CLI backend
  types.ts          # shared types (SessionSnapshot, Action, etc.)
```

## Status

Not yet implemented. Build phases:

1. **Scaffolding** -- npm init, tsconfig, Makefile, config loader
2. **Poller** -- aoe CLI + tmux capture, snapshot diffing
3. **Reasoner** -- OpenCode + Claude Code backends behind common interface
4. **Executor** -- action dispatch, rate limiting, safety checks
5. **Dashboard** -- CLI summary output, optional web view
6. **Distribution** -- install script, Homebrew tap, npm publish

## Related Projects

- [Agent of Empires](https://github.com/njbrake/agent-of-empires) -- the session manager this project controls
- [OpenCode](https://github.com/anomalyco/opencode) -- AI coding agent, used as a reasoning backend
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) -- Anthropic's CLI agent, used as a reasoning backend

## License

MIT License -- see [LICENSE](LICENSE) for details.
