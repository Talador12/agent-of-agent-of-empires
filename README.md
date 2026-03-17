<p align="center">
  <h1 align="center">Agent of Agent of Empires (aoaoe)</h1>
  <p align="center">
    <a href="https://github.com/Talador12/agent-of-agent-of-empires/actions/workflows/ci.yml"><img src="https://github.com/Talador12/agent-of-agent-of-empires/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://www.npmjs.com/package/aoaoe"><img src="https://img.shields.io/npm/v/aoaoe" alt="npm version"></a>
    <a href="https://github.com/Talador12/agent-of-agent-of-empires/releases"><img src="https://img.shields.io/github/v/release/Talador12/agent-of-agent-of-empires" alt="GitHub release"></a>
    <img src="https://img.shields.io/badge/tests-1478-brightgreen" alt="tests">
    <img src="https://img.shields.io/badge/node-%3E%3D20-blue" alt="Node.js >= 20">
    <img src="https://img.shields.io/badge/runtime%20deps-0-brightgreen" alt="zero runtime dependencies">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  </p>
</p>

An autonomous supervisor for [Agent of Empires](https://github.com/njbrake/agent-of-empires) sessions. Uses [OpenCode](https://github.com/anomalyco/opencode) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as the reasoning engine.

**This project is a companion to [Agent of Empires (AoE)](https://github.com/njbrake/agent-of-empires) by [Nate Brake](https://x.com/natebrake).** AoE is the foundation -- it manages multiple AI coding agents in tmux sessions with git worktrees. aoaoe adds an autonomous supervisor layer on top. You need AoE running first; aoaoe plugs into it.

## What is this?

[AoE](https://github.com/njbrake/agent-of-empires) is great at spawning and organizing agents, but someone still needs to watch the tmux panes and intervene when agents get stuck, ask questions, or finish their work.

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

## Try It Alongside Running Sessions

Already have AoE sessions running? aoaoe is designed to run safely alongside them. Start with zero-risk commands and work your way up:

### 1. See what aoaoe sees (read-only, no LLM)

```bash
aoaoe test-context
```

Lists all your AoE sessions, resolves project directories, discovers context files (AGENTS.md, claude.md, etc.), and reports sizes. **No LLM calls, no tmux writes, no side effects.** This is just a diagnostic scan.

### 2. Full loop, actions only logged (costs LLM tokens)

```bash
aoaoe --dry-run
```

Runs the complete observe-reason-execute pipeline -- polls sessions, captures tmux output, calls the LLM for decisions -- but **never executes actions**. Instead of typing into your agents' tmux panes, it logs what it *would* do. Use this to verify the supervisor makes reasonable decisions before letting it act.

### 3. Full autonomous mode

```bash
aoaoe
```

The real deal. Polls, reasons, and executes -- sending keystrokes to agents, restarting crashed sessions, etc. You can still interrupt at any time with ESC ESC in the chat UI.

| Mode | Reads sessions? | Calls LLM? | Touches agents? |
|------|:-:|:-:|:-:|
| `test-context` | Yes | No | No |
| `--observe` | Yes | No | No |
| `--dry-run` | Yes | Yes | No |
| `--confirm` | Yes | Yes | You approve each action |
| `aoaoe` | Yes | Yes | Yes |

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

## Task System

aoaoe can automatically create and manage AoE sessions from a task list. Define repos you want to work on in `aoaoe.tasks.json` (next to your config file):

```json
[
  { "repo": "github/adventure", "tool": "opencode", "goal": "Continue the roadmap in claude.md" },
  { "repo": "github/cloud-hypervisor", "goal": "Address PR review feedback" },
  { "repo": "cc/cloudchamber" }
]
```

| Field | Required | Description |
|-------|:--------:|-------------|
| `repo` | Yes | Path to the project directory (relative to cwd or absolute) |
| `tool` | No | Agent tool to use (`opencode`, `claude-code`, etc.). Default: `opencode` |
| `goal` | No | Goal text injected into the supervisor's context for this task |

When the daemon starts, it reconciles sessions automatically: creates new AoE sessions for tasks that don't have one, links existing sessions to matching tasks. Progress is tracked persistently in `~/.aoaoe/task-state.json` and survives session cleanup.

The supervisor can report progress milestones and mark tasks complete via two special actions:
- `report_progress` — logs a milestone summary to persistent state
- `complete_task` — marks the task done and cleans up the session

View task status:

```bash
aoaoe tasks    # show task progress table
```

## Daemon TUI Commands

The daemon runs an interactive TUI with a rich command set. These commands are available when the daemon is running (started with `aoaoe`).

### Talking to the AI

| Command | What it does |
|---------|-------------|
| _(any text)_ | Send a message -- queued for the next reasoning cycle |
| `!message` | Insist -- interrupt + deliver message immediately |
| `/insist <msg>` | Same as `!message` |
| `/explain` | Ask the AI to explain what's happening right now |

### Controls

| Command | What it does |
|---------|-------------|
| `/pause` | Pause the supervisor (stops reasoning) |
| `/resume` | Resume after pause |
| `/interrupt` | Interrupt the AI mid-thought |
| ESC ESC | Same as `/interrupt` (shortcut) |

### Navigation

| Command | What it does |
|---------|-------------|
| `1`-`9` | Quick-switch: jump to session N |
| `/view [N\|name]` | Drill into a session's live output (default: 1) |
| `/back` | Return to overview from drill-down |
| `/sort [mode]` | Sort sessions: `status`, `name`, `activity`, `default` (no arg = cycle) |
| `/compact` | Toggle compact mode (dense session panel) |
| `/pin [N\|name]` | Pin/unpin a session to the top |
| `/bell` | Toggle terminal bell on errors/completions |
| `/focus` | Toggle focus mode (show only pinned sessions) |
| `/mute [N\|name]` | Mute/unmute a session's activity entries |
| `/unmute-all` | Unmute all sessions at once |
| `/filter [tag]` | Filter activity by tag -- presets: `errors`, `actions`, `system` (no arg = clear) |
| `/who` | Show fleet status (all sessions at a glance) |
| `/uptime` | Show session uptimes |
| `/auto-pin` | Toggle auto-pin on error |
| `/note N\|name text` | Attach a note to a session (no text = clear) |
| `/notes` | List all session notes |
| `/clip [N]` | Copy last N activity entries to clipboard (default 20) |
| `/diff N` | Show activity since bookmark N |
| `/mark` | Bookmark current activity position |
| `/jump N` | Jump to bookmark N |
| `/marks` | List all bookmarks |
| `/search <pattern>` | Filter activity entries by substring (no arg = clear) |
| Click session | Click an agent card to drill down (click again to go back) |
| Mouse wheel | Scroll activity (overview) or session output (drill-down) |
| PgUp / PgDn | Scroll through activity or session output |
| Home / End | Jump to oldest / return to live |

### Info

| Command | What it does |
|---------|-------------|
| `/status` | Show daemon state |
| `/dashboard` | Show full dashboard |
| `/tasks` | Show task progress table |
| `/task [sub] [args]` | Task management (list, start, stop, edit, new, rm) |

### Other

| Command | What it does |
|---------|-------------|
| `/verbose` | Toggle detailed logging |
| `/clear` | Clear the screen |
| `/help` | Show all commands |

### TUI Features

- **Activity sparkline** -- 10-minute activity rate chart in the separator bar (Unicode blocks with color gradient)
- **Session cards** -- per-session status with pin `▲`, mute `◌`, note `✎` indicators
- **Sticky preferences** -- sort mode, compact, focus, bell, auto-pin, and tag filter persist across restarts (`~/.aoaoe/tui-prefs.json`)
- **Filter pipeline** -- mute, tag filter, and search compose: mute → tag → search
- **Activity heatmap** -- 24-hour colored block chart via `aoaoe stats`
- **Bookmarks** -- mark positions in the activity stream, jump back to them, diff since a bookmark
- **Clipboard export** -- `/clip` copies activity to system clipboard (macOS) or `~/.aoaoe/clip.txt`

## Chat UI Commands

The chat UI (`aoaoe-chat`) runs inside an AoE tmux pane. Register it with `aoaoe register`, then access via `aoe` -> select "aoaoe".

| Command | What it does |
|---------|-------------|
| `/overview` | Show all AoE sessions with tasks, model, tokens, cost. **Works without the daemon.** |
| `/tasks` | Alias for `/overview` |
| `/status` | Daemon connection status + countdown to next reasoning cycle |
| `/interrupt` | Interrupt the current reasoner call |
| `/dashboard` | Request full dashboard output from daemon |
| `/pause` | Pause the daemon (stops reasoning) |
| `/resume` | Resume after pause |
| `/sessions` | Instant session list from daemon state (no tmux capture needed) |
| `/explain` | Ask the AI to explain what's happening right now in plain English |
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
  (none)         start the supervisor daemon (interactive TUI)
  init           detect tools + sessions, import history, generate config
  status         quick daemon health check (is it running? what's it doing?)
  config         show the effective resolved config (defaults + file)
  config --validate  validate config + check tool availability
  config --diff  show only fields that differ from defaults
  notify-test    send a test notification to configured webhooks
  doctor         comprehensive health check (config, tools, daemon, disk)
  logs           show recent conversation log entries
  logs --actions show action log entries (from ~/.aoaoe/actions.log)
  logs --grep <pattern>  filter log entries by substring or regex
  logs -n <count>        number of entries to show (default: 50)
  export         export session timeline as JSON or Markdown for post-mortems
  export --format <json|markdown>  output format (default: json)
  export --output <file>           write to file (default: stdout)
  export --last <duration>         time window: 1h, 6h, 24h, 7d (default: 24h)
  task           manage tasks and sessions (list, start, stop, new, rm, edit)
  tasks          show task progress (from aoaoe.tasks.json)
  history        review recent actions (from ~/.aoaoe/actions.log)
  test-context   scan sessions + context files (read-only, no LLM, safe)
  test           run integration tests (requires aoe, opencode, tmux)
  register       register aoaoe as an AoE session (one-time setup)

options:
  --reasoner <opencode|claude-code>  reasoning backend (default: opencode)
  --poll-interval <ms>               poll interval in ms (default: 10000)
  --port <number>                    opencode server port (default: 4097)
  --health-port <number>             start HTTP health check server on this port
  --model <model>                    model to use
  --profile <name>                   aoe profile (default: default)
  --dry-run                          run full loop but only log actions (costs
                                     LLM tokens, but never touches sessions)
  --observe                          observe only — no LLM calls, no execution,
                                      zero cost. shows what the daemon sees.
  --confirm                          ask before each action — the AI proposes,
                                      you approve with y/n before it runs.
  --verbose, -v                      verbose logging
  --help, -h                         show help
  --version                          show version

init options:
  --force, -f                        overwrite existing config

register options:
  --title, -t <name>                 session title in AoE (default: aoaoe)
```

## Configuration

Config lives at `~/.aoaoe/aoaoe.config.json` (canonical, written by `aoaoe init`). A local `aoaoe.config.json` in cwd overrides for development. Defaults work fine without a config file:

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
  },
  "sessionDirs": {
    "adventure": "github/adventure",
    "cloudchamber": "cc/cloudchamber"
  },
  "contextFiles": [],
  "notifications": {
    "webhookUrl": "https://example.com/webhook",
    "slackWebhookUrl": "https://hooks.slack.com/services/T.../B.../xxx",
    "events": ["session_error", "session_done", "daemon_started", "daemon_stopped"]
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
| `policies.allowDestructive` | Allow `remove_agent` and `stop_session` actions | `false` |
| `policies.userActivityThresholdMs` | Ignore sessions with recent human keystrokes | `30000` |
| `policies.actionCooldownMs` | Minimum ms between actions on the same session | `30000` |
| `protectedSessions` | Session titles that are observe-only (no actions) | `[]` |
| `sessionDirs` | Map session titles to project directories (relative to cwd or absolute). Bypasses heuristic directory search. | `{}` |
| `contextFiles` | Extra AI instruction file paths to load from each project root | `[]` |
| `captureLinesCount` | Number of tmux lines to capture per session (`-S` flag) | `100` |
| `healthPort` | Start HTTP health check server on this port (e.g. `4098`). GET `/health` returns JSON status. | (none) |
| `notifications.webhookUrl` | Generic webhook URL (POST JSON) | (none) |
| `notifications.slackWebhookUrl` | Slack incoming webhook URL (block kit format) | (none) |
| `notifications.events` | Filter which events fire (omit to send all). Valid: `session_error`, `session_done`, `action_executed`, `action_failed`, `daemon_started`, `daemon_stopped` | (all) |
| `notifications.maxRetries` | Retry failed webhook deliveries with exponential backoff (1s, 2s, 4s, ...) | `0` (no retry) |
| `tuiHistoryRetentionDays` | How many days of TUI history to replay on startup (1-365) | `7` |

Also reads `.aoaoe.json` as an alternative config filename.

### `sessionDirs` — explicit project directory mapping

By default, aoaoe resolves project directories by searching subdirectories (up to 2 levels deep) for a folder name matching each session title. This works great for standard layouts like `repos/github/adventure/`.

For non-standard layouts or when the session title doesn't match the directory name, use `sessionDirs` to provide explicit mappings:

```json
{
  "sessionDirs": {
    "adventure": "github/adventure",
    "cloudchamber": "cc/cloudchamber",
    "my-agent": "/absolute/path/to/project"
  }
}
```

Paths can be relative (resolved from the directory where you run `aoaoe`) or absolute. Case-insensitive matching is used for session title lookup. If a mapped path doesn't exist on disk, aoaoe falls back to heuristic search.

Use `aoaoe test-context` to verify resolution.

### `notifications` — webhook alerts for daemon events

aoaoe can send webhook notifications when significant events occur (session errors, task completions, daemon start/stop). Supports generic JSON webhooks and Slack incoming webhooks with block kit formatting.

```json
{
  "notifications": {
    "webhookUrl": "https://example.com/webhook",
    "slackWebhookUrl": "https://hooks.slack.com/services/T.../B.../xxx",
    "events": ["session_error", "session_done", "daemon_started", "daemon_stopped"]
  }
}
```

Both webhook URLs are optional — configure one or both. The `events` array filters which event types fire (omit it to receive all events). Notifications are fire-and-forget with a 5s timeout and 60s rate limiting per event+session combo to prevent spam.

Run `aoaoe notify-test` to verify your webhook configuration.

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
{ "action": "report_progress", "session": "<id>", "summary": "<milestone>" }
{ "action": "complete_task", "session": "<id>", "summary": "<final status>" }
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
  index.ts            # daemon entry point, main loop, subcommands
  loop.ts             # extracted tick logic (poll->reason->execute), testable with mocks
  chat.ts             # interactive chat UI (aoaoe-chat binary)
  config.ts           # config loader and CLI arg parser
  config-watcher.ts   # config hot-reload via fs.watch, safe field merge
  types.ts            # shared types (SessionSnapshot, Action, DaemonState, etc.)
  poller.ts           # aoe CLI + tmux capture-pane wrapper
  executor.ts         # maps action decisions to shell commands
  console.ts          # conversation log + file-based IPC
  dashboard.ts        # periodic CLI status table with task column
  daemon-state.ts     # shared IPC state file + interrupt flag
  tui.ts              # in-place terminal UI (alternate screen, scroll, sparklines, cards)
  tui-history.ts      # persisted TUI history (JSONL file with rotation, replay on startup)
  input.ts            # stdin readline + keypress handlers (all /commands live here)
  init.ts             # `aoaoe init`: auto-discover tools, sessions, generate config
  notify.ts           # webhook + Slack notification dispatcher for daemon events
  health.ts           # HTTP health check endpoint (GET /health JSON status)
  colors.ts           # shared ANSI color/style constants
  context.ts          # discoverContextFiles, resolveProjectDir, loadSessionContext
  activity.ts         # detect human keystrokes in tmux sessions
  prompt-watcher.ts   # reactive permission prompt clearing via tmux pipe-pane
  task-manager.ts     # task orchestration: definitions, persistent state
  task-cli.ts         # `aoaoe task` subcommand: list, start, stop, new, rm, edit
  task-parser.ts      # parse OpenCode TODO patterns, model, tokens, cost from tmux
  message.ts          # classifyMessages, formatUserMessages, shouldSkipSleep
  wake.ts             # wakeableSleep with fs.watch for instant message delivery
  shell.ts            # exec() wrappers with AbortSignal support
  export.ts           # timeline export (JSON/Markdown) from actions + history
  tail.ts             # `aoaoe tail`: live-stream daemon activity to another terminal
  stats.ts            # `aoaoe stats`: aggregate statistics + activity heatmap
  replay.ts           # `aoaoe replay`: play back tui-history.jsonl with timing
  reasoner/
    index.ts          # common Reasoner interface + factory
    prompt.ts         # system prompt + observation formatting
    parse.ts          # response parsing, JSON extraction, action validation
    opencode.ts       # OpenCode SDK backend
    claude-code.ts    # Claude Code CLI backend
```

## Related Projects

- [Agent of Empires](https://github.com/njbrake/agent-of-empires) -- the session manager this project controls
- [OpenCode](https://github.com/anomalyco/opencode) -- AI coding agent, used as a reasoning backend
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) -- Anthropic's CLI agent, used as a reasoning backend

## License

MIT License -- see [LICENSE](LICENSE) for details.
