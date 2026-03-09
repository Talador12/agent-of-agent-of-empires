<p align="center">
  <h1 align="center">Agent of Agent of Empires (aoaoe)</h1>
  <p align="center">
    <a href="https://www.npmjs.com/package/aoaoe"><img src="https://img.shields.io/npm/v/aoaoe" alt="npm version"></a>
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

## Prerequisites

You need these installed first:

| Tool | What it does | Install |
|------|-------------|---------|
| [tmux](https://github.com/tmux/tmux/wiki) | Terminal multiplexer (AoE uses it) | `brew install tmux` |
| [Agent of Empires](https://github.com/njbrake/agent-of-empires) | Manages AI agent sessions | See AoE README |
| [OpenCode](https://github.com/anomalyco/opencode) **or** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | LLM reasoning backend | `npm i -g @anthropic-ai/claude-code` or see OpenCode docs |

Verify they're on your PATH:

```bash
aoe --version       # agent-of-empires
tmux -V             # tmux
opencode --version  # if using OpenCode backend
claude --version    # if using Claude Code backend
```

## Install

Pick one:

```bash
# npm (recommended)
npm install -g aoaoe

# Homebrew
brew install Talador12/tap/aoaoe

# curl
curl -fsSL https://raw.githubusercontent.com/Talador12/agent-of-agent-of-empires/main/scripts/install.sh | bash

# from source
git clone https://github.com/Talador12/agent-of-agent-of-empires
cd agent-of-agent-of-empires && npm install && npm run build && npm link
```

Verify:

```bash
aoaoe --version
```

## Quick Start

aoaoe has two parts: a **daemon** (the brain) and a **chat UI** (your window into it). Here's how to get both running.

### Step 1: Have AoE sessions running

You need at least one AoE session for aoaoe to supervise. If you don't have any yet:

```bash
aoe add ./my-project -t my-agent -c "opencode"   # add an agent
aoe session start my-agent                         # start it
aoe                                                # enter AoE TUI to verify
```

### Step 2: Register aoaoe as an AoE session (one-time)

This adds aoaoe's chat UI as a session inside AoE, so you can access it alongside your agents:

```bash
aoaoe register
```

This creates a session called "aoaoe" that runs the interactive chat UI. You only need to do this once.

### Step 3: Start the daemon

In a separate terminal (or tmux pane, or backgrounded):

```bash
aoaoe
```

The daemon starts polling your AoE sessions, reasoning about what it sees, and executing actions. It logs to stderr so you can watch it work.

### Step 4: Enter the chat UI

```bash
aoe session start aoaoe    # start the aoaoe session (if not already running)
aoe                        # enter AoE TUI, then select "aoaoe"
```

You're now in the chat UI. Type messages to the reasoner, run `/overview` to see what all agents are doing, or press ESC ESC to interrupt the current reasoning cycle.

### Minimal example (all steps)

```bash
# Terminal 1: start the daemon
aoaoe

# Terminal 2: register + start + enter
aoaoe register
aoe session start aoaoe
aoe    # select "aoaoe" in the TUI
```

### Using a different reasoning backend

```bash
# Use Claude Code instead of OpenCode
aoaoe --reasoner claude-code

# Use a specific model
aoaoe --reasoner opencode --model anthropic/claude-sonnet-4-20250514
aoaoe --reasoner claude-code --model claude-sonnet-4-20250514
```

## Chat UI Commands

Once inside the chat UI (via `aoe` -> select "aoaoe"):

| Command | What it does |
|---------|-------------|
| `/overview` | Show all AoE sessions with tasks, model, tokens, cost. **Works without the daemon.** |
| `/tasks` | Alias for `/overview` |
| `/status` | Daemon connection status + countdown to next reasoning cycle |
| `/interrupt` | Interrupt the current reasoner call |
| `/dashboard` | Request full dashboard output from daemon |
| `/pause` | Pause the daemon (stops reasoning) |
| `/resume` | Resume after pause |
| `/verbose` | Toggle verbose logging |
| `/clear` | Clear the screen |
| `/help` | Show all commands |
| ESC ESC | Interrupt the reasoner (same as `/interrupt`) |
| _(any text)_ | Send a message to the reasoner -- included in the next reasoning cycle |

### How `/overview` works

`/overview` captures every AoE pane directly via tmux and parses:
- **Tasks**: OpenCode TODO items (`[*]` done, `[.]` in progress, `[o]` pending)
- **Model**: Which LLM the agent is using (e.g. "Claude Opus 4.6")
- **Context**: Token count and cost
- **Last line**: Most recent meaningful output

This works **standalone** -- you don't need the daemon running.

### How interrupt works

When the daemon is reasoning, press **ESC ESC** (or type `/interrupt`) to stop the current LLM call. The daemon will pause and wait for your input. Type a message and it will be included in the next reasoning cycle. This is useful when you want to redirect the supervisor's attention.

## Daemon CLI

```
aoaoe [command] [options]

commands:
  (none)         start the supervisor daemon
  register       register aoaoe as an AoE session (one-time setup)
  attach         enter the reasoner console (Ctrl+B D to detach)

daemon options:
  --reasoner <opencode|claude-code>  reasoning backend (default: opencode)
  --poll-interval <ms>               poll interval in ms (default: 10000)
  --port <number>                    opencode server port (default: 4097)
  --model <model>                    model to use
  --profile <name>                   aoe profile (default: default)
  --dry-run                          observe + reason but don't execute
  --verbose, -v                      verbose logging
  --help, -h                         show help
  --version                          show version

register options:
  --title, -t <name>                 session title in AoE (default: aoaoe)
```

## Configuration

Create `aoaoe.config.json` in the directory where you run the daemon (optional -- defaults work fine):

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
| `opencode.model` | Model in `provider/model` format | (OpenCode default) |
| `claudeCode.model` | Anthropic model name | (Claude Code default) |
| `claudeCode.yolo` | Skip permissions in Claude Code | `true` |
| `claudeCode.resume` | Maintain session across calls | `true` |
| `aoe.profile` | AoE profile to monitor | `"default"` |
| `policies.maxIdleBeforeNudgeMs` | Nudge idle agents after this long | `120000` |
| `policies.maxErrorsBeforeRestart` | Restart after N consecutive errors | `3` |
| `policies.autoAnswerPermissions` | Auto-approve permission prompts | `true` |

Also reads `.aoaoe.json` as an alternative config filename.

## How It Works

```
┌──────────────────────────────────────────────────────┐
│                    aoaoe daemon                      │
│                                                      │
│  ┌───────────┐   ┌─────��────────┐   ┌───────────┐    │
│  │  Poller   │──▶│   Reasoner   │──▶│ Executor  │    │
│  │           │   │ ┌──────────┐ │   │           │    │
│  │ aoe CLI + │   │ │ OpenCode │ │   │ tmux send │    │
│  │ tmux cap  │   │ │  server  │ │   │ keys, aoe │    │
│  │           │   │ ├──────────┤ │   │ CLI cmds  │    │
│  │           │   │ │  Claude  │ │   │           │    │
│  │           │   │ │   Code   │ │   │           │    │
│  │           │   │ └──────────┘ │   │           │    │
│  └───────────��   └──────────────┘   └───────────┘    │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │           Chat UI (aoaoe-chat)                 │  │
│  │    runs inside AoE tmux pane, reads state      │  │
│  │    from ~/.aoaoe/ via file-based IPC           │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
    AoE sessions                  LLM Provider
    (tmux panes)              (local or remote)
```

### Three loops

**Poller** (every N seconds, configurable):
- Calls `aoe list --json` to get all session IDs, statuses, and tools
- For each active session: `tmux capture-pane -t <session> -p -S -100`
- Diffs against previous capture to detect new output
- Builds an observation payload

**Reasoner** (on new observations):
- Sends observation to the configured LLM backend
- System prompt defines the supervisor role, policies, and available actions
- Receives back a structured JSON action decision

**Executor** (on decisions):
- `tmux send-keys` -- inject a prompt into an agent
- `aoe session start/stop/restart` -- lifecycle management
- `aoe add` / `aoe remove` -- spawn or tear down agents

### Supervisor behavior

The LLM supervisor follows these policies:
- If an agent is stuck or idle too long, nudge it with context or a rephrased task
- If an agent asks a question and is waiting for input, answer it
- If an agent finishes its task, acknowledge and optionally assign follow-up work
- If a session crashes, restart it
- Do NOT micromanage -- only intervene when there is a clear problem or decision needed

### Available actions

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
| **OpenCode** | `opencode serve` + SDK | Yes (long-running session) | Any provider via OpenCode config |
| **Claude Code** | `claude --print` subprocess | Via `--resume` | Anthropic models |

### OpenCode backend

Runs `opencode serve` as a headless HTTP server. Uses the [OpenCode JS SDK](https://opencode.ai/docs/sdk/) to maintain a long-running session with full context. Works with any model provider configured in OpenCode (Anthropic, OpenAI, Ollama, etc.).

### Claude Code backend

Calls `claude --print --output-format json` as a subprocess. System prompt injected via `--append-system-prompt`. Session continuity via `--resume <session_id>`.

## IPC and State Files

The daemon and chat UI communicate via files in `~/.aoaoe/`:

| File | Written by | Read by | Purpose |
|------|-----------|---------|---------|
| `daemon-state.json` | daemon | chat UI | Current phase, countdown, per-session state |
| `conversation.log` | daemon | chat UI | Observations, reasoning, actions log |
| `pending-input.txt` | chat UI | daemon | User messages queued for next reasoning cycle |
| `interrupt` | chat UI | daemon | Flag file -- presence triggers interrupt |
| `chat.pid` | chat UI | daemon | Chat process PID for detection |
| `actions.log` | daemon | -- | Persistent action history (JSONL) |

## Project Structure

```
src/
  index.ts          # daemon entry point, main loop, register/attach subcommands
  chat.ts           # interactive chat UI (aoaoe-chat binary)
  config.ts         # config loader and CLI arg parser
  daemon-state.ts   # shared IPC state file + interrupt flag
  task-parser.ts    # parse OpenCode TODO patterns, model, tokens, cost from tmux
  console.ts        # conversation log + file-based IPC
  poller.ts         # aoe CLI + tmux capture-pane wrapper
  executor.ts       # maps action decisions to shell commands
  dashboard.ts      # periodic CLI status table with task column
  input.ts          # stdin readline listener with inject() for post-interrupt
  shell.ts          # exec() wrappers with AbortSignal support
  types.ts          # shared types (SessionSnapshot, Action, DaemonState, etc.)
  reasoner/
    index.ts        # common Reasoner interface + factory
    prompt.ts       # system prompt + observation formatting
    opencode.ts     # OpenCode SDK backend
    claude-code.ts  # Claude Code CLI backend
```

## Related Projects

- [Agent of Empires](https://github.com/njbrake/agent-of-empires) -- the session manager this project controls
- [OpenCode](https://github.com/anomalyco/opencode) -- AI coding agent, used as a reasoning backend
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) -- Anthropic's CLI agent, used as a reasoning backend

## License

MIT License -- see [LICENSE](LICENSE) for details.
