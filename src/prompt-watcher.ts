/**
 * Reactive permission prompt watcher using tmux pipe-pane.
 *
 * Instead of polling tmux output and regex-matching on a timer, this hooks
 * into tmux's pipe-pane mechanism to stream pane output to a Node.js
 * subprocess. The subprocess fires on ANY stdin data (not just newlines —
 * critical for TUI apps that use cursor positioning), captures the rendered
 * screen via capture-pane, pattern matches, and sends Enter immediately.
 *
 * Flow:
 *   pane output → pipe-pane → watcher stdin → data event →
 *   capture-pane (rendered screen) → regex match → send-keys Enter
 *
 * Why capture-pane instead of parsing pipe-pane output directly?
 *   TUI apps (opencode, Claude Code) write raw VT100 escape sequences.
 *   capture-pane returns the rendered screen — clean text, no ANSI.
 *
 * Why Node.js instead of bash?
 *   TUI output uses cursor positioning without \n — bash `read -r` blocks
 *   until a newline arrives. Node.js `stdin.on('data')` fires on any byte.
 *   Also avoids macOS bash 3.2 compatibility issues (no `read -N`).
 *
 * Latency: ~10-50ms from prompt render to Enter sent.
 */

import { execFileSync } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

const WATCHER_DIR = "/tmp/aoaoe-watchers";

// Generate the watcher script that runs as a standalone Node.js process.
// CommonJS (.cjs) because the main project is ESM ("type": "module")
// and this script runs standalone outside the build system.
//
// Escaping rules (template literal → .cjs file → JS runtime):
//   \\b in template → \b in file → regex word boundary
//   \\n in template → \n in file → newline character
//   \\/ in template → \/ in file → literal slash in regex
function generateWatcherScript(): string {
  return `'use strict';
const { execFile } = require('child_process');
const { appendFileSync } = require('fs');

const pane = process.argv[2];
const logFile = process.argv[3];
if (!pane) process.exit(1);

// permission prompt patterns — matches rendered screen content
const PATTERNS = [
  /Permission required/i,
  /Allow once/i,
  /\\b(?:allow|deny|permit)\\b.*\\?\\s*$/im,
  /\\b(?:y\\/n|yes\\/no)\\b/im,
  /\\bdo you want to (?:continue|proceed)\\b/im,
  /\\b(?:approve|reject)\\b.*\\?\\s*$/im,
];

let lastClearedAt = 0;
let checking = false;
let pendingCheck = false;

function checkAndClear() {
  if (checking) { pendingCheck = true; return; }
  checking = true;
  pendingCheck = false;

  execFile('tmux', ['capture-pane', '-t', pane, '-p', '-S', '-15'],
    { timeout: 3000 }, (err, stdout) => {
      checking = false;
      if (!err && stdout && PATTERNS.some(function(p) { return p.test(stdout); })) {
        var now = Date.now();
        if (now - lastClearedAt >= 500) {
          lastClearedAt = now;
          execFile('tmux', ['send-keys', '-t', pane, 'Enter'],
            { timeout: 2000 }, function() {});
          if (logFile) {
            try {
              var line = stdout.split('\\n')
                .filter(function(l) { return PATTERNS.some(function(p) { return p.test(l); }); })
                .pop() || '';
              appendFileSync(logFile,
                new Date().toISOString() + ' CLEARED: ' + line.trim().slice(0, 120) + '\\n');
            } catch(e) {}
          }
        }
      }
      // if data arrived while we were checking, re-check after a brief
      // delay (lets the screen update after Enter was sent)
      if (pendingCheck) {
        pendingCheck = false;
        setTimeout(checkAndClear, 100);
      }
    });
}

// stdin data = pane output changed.
// Node.js fires 'data' on ANY data, not just newlines —
// critical for TUI apps that use cursor positioning without \\n.
process.stdin.on('data', checkAndClear);
process.stdin.resume();
`;
}

let watcherScriptPath: string | null = null;

function ensureWatcherScript(): string {
  if (watcherScriptPath && existsSync(watcherScriptPath))
    return watcherScriptPath;
  mkdirSync(WATCHER_DIR, { recursive: true });
  watcherScriptPath = join(WATCHER_DIR, "aoaoe-watcher.cjs");
  writeFileSync(watcherScriptPath, generateWatcherScript());
  return watcherScriptPath;
}

/**
 * Start watching a tmux pane for permission prompts.
 * Hooks into pipe-pane — fires on any output, not polling.
 * Returns the log file path for reading stats later.
 */
export function startPromptWatcher(
  tmuxName: string,
  logFile?: string
): string {
  const scriptPath = ensureWatcherScript();
  const log = logFile ?? join(WATCHER_DIR, `${tmuxName}.log`);
  const nodeBin = process.execPath; // use the same node binary

  // initialize empty log
  writeFileSync(log, "");

  // pipe-pane sends all pane output to the command's stdin.
  // tmux runs this through /bin/sh -c, so we single-quote paths.
  execFileSync("tmux", [
    "pipe-pane",
    "-t",
    tmuxName,
    `'${nodeBin}' '${scriptPath}' '${tmuxName}' '${log}'`,
  ]);

  return log;
}

/**
 * Stop watching a tmux pane.
 * Calling pipe-pane with no command disables piping.
 */
export function stopPromptWatcher(tmuxName: string): void {
  try {
    execFileSync("tmux", ["pipe-pane", "-t", tmuxName]);
  } catch {
    // pane might already be gone
  }
}

/**
 * Read clearing stats from a watcher log file.
 */
export function readPromptStats(
  logFile: string
): { count: number; lines: string[] } {
  if (!existsSync(logFile)) return { count: 0, lines: [] };
  const content = readFileSync(logFile, "utf-8").trim();
  if (!content) return { count: 0, lines: [] };
  const lines = content.split("\n").filter(Boolean);
  return { count: lines.length, lines };
}

/**
 * Clean up all watcher temp files.
 */
export function cleanupWatchers(): void {
  try {
    rmSync(WATCHER_DIR, { recursive: true, force: true });
  } catch {
    // best effort
  }
  watcherScriptPath = null;
}
