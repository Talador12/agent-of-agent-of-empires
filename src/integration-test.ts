#!/usr/bin/env node
/**
 * Integration test for aoaoe — verifies agents execute real tasks.
 *
 * Creates two AoE sessions with opencode (NO yolo mode), explicitly starts
 * opencode in each tmux pane, sends real tasks, and handles permission
 * prompts reactively via pipe-pane hooks — not polling.
 *
 *   Session 1 (basic): creates hello.txt — validates end-to-end execution
 *   Session 2 (prompt-heavy): creates prompt-test.txt in a subdirectory —
 *     exercises mkdir + write permission prompts
 *
 * Permission prompt clearing uses the prompt-watcher module which hooks
 * into tmux pipe-pane. The watcher subprocess fires on ANY pane output
 * (not just newlines), captures the rendered screen, pattern matches, and
 * sends Enter within ~10-50ms. No polling for prompts.
 *
 * Prerequisites: aoe, opencode, tmux on $PATH
 * Run: npm run integration-test
 */

import { execFile as execFileCb, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  startPromptWatcher,
  stopPromptWatcher,
  readPromptStats,
  cleanupWatchers,
} from "./prompt-watcher.js";

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_DIR = "/tmp/aoaoe-itest";
const SESSION_1_TITLE = "aoaoe-itest-basic";
const SESSION_2_TITLE = "aoaoe-itest-prompt";
const TASK_WORKSPACE = join(TEST_DIR, "task-workspace");

// expected output files
const S1_FILE = "hello.txt";
const S1_CONTENT = "Hello from aoaoe";
const S2_FILE = "subdir/prompt-test.txt";
const S2_CONTENT = "Permission test passed";

// timeouts
const SHELL_PROMPT_TIMEOUT_MS = 45_000; // max wait for AoE shell prompt
const OPENCODE_LOAD_WAIT_MS = 15_000;   // wait for opencode TUI after typing "opencode"
const TASK_TIMEOUT_MS = 180_000;         // 3 min max for both tasks to complete
const POLL_MS = 3_000;                   // file-existence check interval (prompts handled by watcher)

// AoE shell prompt characters: λ (U+03BB) and → (U+2192)
const LAMBDA = "\u03bb";
const ARROW = "\u2192";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ExecOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function exec(cmd: string, args: string[], timeoutMs = 30_000, opts?: ExecOpts): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFileCb(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, cwd: opts?.cwd, env: opts?.env },
      (err, stdout, stderr) => {
      if (err) {
        const e = err as { code?: number | string };
        const exitCode = typeof e.code === "number" ? e.code : 1;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
        return;
      }
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      }
    );
  });
}

async function runDaemonBriefly(cwd: string, env: NodeJS.ProcessEnv, ms = 4_000): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("node", [join(process.cwd(), "dist/index.js"), "--observe", "--poll-interval", "2000"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let exited = false;
    const done = (code: number | null) => {
      if (exited) return;
      exited = true;
      resolve(code ?? 1);
    };
    const timer = setTimeout(() => {
      child.kill("SIGINT");
    }, ms);
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code);
    });
    child.on("error", () => {
      clearTimeout(timer);
      done(1);
    });
  });
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

function pass(msg: string) {
  console.log(`  \u2705 ${msg}`);
}

// check if AoE shell prompt (λ ... →) appears anywhere in the capture
function hasShellPrompt(output: string): boolean {
  const lines = output.split("\n").filter((l) => l.trim());
  return lines.some((line) => line.includes(LAMBDA) && line.includes(ARROW));
}

async function captureTmux(tmuxName: string): Promise<string> {
  const cap = await exec("tmux", ["capture-pane", "-t", tmuxName, "-p", "-S", "-100"]);
  return cap.stdout;
}

async function sendKeys(tmuxName: string, text: string): Promise<boolean> {
  const textOk = await exec("tmux", ["send-keys", "-t", tmuxName, "-l", text]);
  if (textOk.exitCode !== 0) return false;
  const enterOk = await exec("tmux", ["send-keys", "-t", tmuxName, "Enter"]);
  return enterOk.exitCode === 0;
}

function lastNonEmptyLine(output: string): string {
  return output.split("\n").filter((l) => l.trim()).pop() ?? "(empty)";
}

function tailLines(output: string, n: number): string[] {
  return output.split("\n").filter((l) => l.trim()).slice(-n);
}

// ── Session Management ──────────────────────────────────────────────────────

interface TestSession {
  id: string;
  title: string;
  tmuxName: string;
  dir: string;
  targetFile: string;
  expectedContent: string;
  watcherLogFile: string;
  // tracking
  completed: boolean;
  completedAtMs: number;
}

async function createSession(
  dir: string,
  title: string,
  targetFile: string,
  expectedContent: string
): Promise<TestSession> {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "AGENTS.md"),
    `# ${title}\nIntegration test. Do exactly what is asked, nothing more.\n`
  );

  // init git repo — opencode expects a git context
  await exec("git", ["init", dir]);
  await exec("git", ["-C", dir, "add", "."]);
  await exec("git", ["-C", dir, "commit", "-m", "init", "--allow-empty"]);

  // NO -y flag — prompt-watcher handles permission prompts reactively
  const result = await exec("aoe", ["add", dir, "-t", title, "-c", "opencode"]);
  if (result.exitCode !== 0) {
    throw new Error(`aoe add failed for ${title}: ${result.stderr}`);
  }

  const list = await exec("aoe", ["list", "--json"]);
  const sessions = JSON.parse(list.stdout) as Array<{ id: string; title: string }>;
  const found = sessions.find((s) => s.title === title);
  if (!found) throw new Error(`session "${title}" not found in aoe list`);

  const sanitized = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);
  const tmuxName = `aoe_${sanitized}_${found.id.slice(0, 8)}`;

  return {
    id: found.id,
    title,
    tmuxName,
    dir,
    targetFile: join(dir, targetFile),
    expectedContent,
    watcherLogFile: "", // set when watcher starts
    completed: false,
    completedAtMs: 0,
  };
}

// poll until the AoE shell prompt (λ ... →) is visible in the pane
async function waitForShellPrompt(s: TestSession): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < SHELL_PROMPT_TIMEOUT_MS) {
    const output = await captureTmux(s.tmuxName);
    if (hasShellPrompt(output)) {
      return;
    }
    await sleep(2_000);
  }
  // timeout — dump what we see for debugging
  const output = await captureTmux(s.tmuxName);
  const tail = tailLines(output, 5).join("\n    ");
  throw new Error(
    `Shell prompt did not appear in ${s.title} within ${SHELL_PROMPT_TIMEOUT_MS / 1000}s.\n` +
    `  Last output:\n    ${tail}`
  );
}

// verify opencode took over the pane (shell prompt gone, no shell errors)
async function verifyOpencodeRunning(s: TestSession): Promise<void> {
  const output = await captureTmux(s.tmuxName);

  // fatal: opencode binary not found
  if (output.includes("command not found: opencode")) {
    throw new Error(`opencode not found on PATH inside ${s.title} tmux pane`);
  }

  // if shell prompt is the last line, opencode either never started or exited
  if (hasShellPrompt(output)) {
    const tail = tailLines(output, 8).join("\n    ");
    throw new Error(
      `opencode not running in ${s.title} (shell prompt still visible after wait).\n` +
      `  This usually means opencode started and exited immediately.\n` +
      `  Last output:\n    ${tail}`
    );
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup(titles: string[], sessions: TestSession[]): Promise<void> {
  log("Cleanup...");

  // stop prompt watchers first
  for (const s of sessions) {
    if (s.tmuxName) {
      try { stopPromptWatcher(s.tmuxName); } catch {}
    }
  }

  const list = await exec("aoe", ["list", "--json"]);
  if (list.exitCode === 0) {
    try {
      const aoeList = JSON.parse(list.stdout) as Array<{ id: string; title: string }>;
      for (const s of aoeList) {
        if (titles.includes(s.title)) {
          await exec("bash", ["-c", `echo "y" | aoe remove ${s.id}`]);
          log(`  removed session: ${s.title}`);
        }
      }
    } catch {}
  }

  // clean up watcher temp files
  cleanupWatchers();

  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}

  pass("Cleanup complete");
}

async function verifyTaskImportAndSync(sessions: TestSession[]): Promise<void> {
  log("Verifying task import/sync across daemon restarts...");
  mkdirSync(TASK_WORKSPACE, { recursive: true });

  const taskFile = join(TASK_WORKSPACE, "aoaoe.tasks.json");
  writeFileSync(taskFile, "[]\n");
  const homeDir = process.env.HOME || "";
  const stateFile = homeDir ? join(homeDir, ".aoaoe", "task-state.json") : "";
  const hadStateBackup = stateFile && existsSync(stateFile);
  const stateBackup = hadStateBackup ? readFileSync(stateFile, "utf-8") : "";
  const cliBase = [join(process.cwd(), "dist/index.js")];
  try {
    const newTask = await exec(
      "node",
      [...cliBase, "task", "new", "itest-existing", sessions[0].dir, "--mode", "existing"],
      30_000,
      { cwd: TASK_WORKSPACE }
    );
    if (newTask.exitCode !== 0) {
      throw new Error(`task new failed in sync test: ${newTask.stderr || newTask.stdout}`);
    }

    const editTask = await exec(
      "node",
      [...cliBase, "task", "edit", "itest-existing", "Integration sync updated goal"],
      30_000,
      { cwd: TASK_WORKSPACE }
    );
    if (editTask.exitCode !== 0) {
      throw new Error(`task edit failed in sync test: ${editTask.stderr || editTask.stdout}`);
    }

    const firstRunExit = await runDaemonBriefly(TASK_WORKSPACE, process.env, 4_500);
    if (firstRunExit !== 0) {
      throw new Error(`daemon first startup failed in sync test (exit ${firstRunExit})`);
    }

    const secondRunExit = await runDaemonBriefly(TASK_WORKSPACE, process.env, 3_500);
    if (secondRunExit !== 0) {
      throw new Error(`daemon second startup failed in sync test (exit ${secondRunExit})`);
    }

    const defs = JSON.parse(readFileSync(taskFile, "utf-8")) as Array<{
      sessionTitle?: string;
      sessionMode?: string;
      goal?: string;
    }>;

    const hasUpdatedGoal = defs.some((d) => d.sessionTitle === "itest-existing" && d.goal === "Integration sync updated goal");
    if (!hasUpdatedGoal) throw new Error("task sync test: edited goal not persisted to aoaoe.tasks.json");

    const s1Count = defs.filter((d) => d.sessionTitle === SESSION_1_TITLE).length;
    const s2Count = defs.filter((d) => d.sessionTitle === SESSION_2_TITLE).length;
    if (s1Count !== 1 || s2Count !== 1) {
      throw new Error(`task import test failed: expected one imported entry per session, got ${SESSION_1_TITLE}=${s1Count}, ${SESSION_2_TITLE}=${s2Count}`);
    }

    const importedModesOk = defs
      .filter((d) => d.sessionTitle === SESSION_1_TITLE || d.sessionTitle === SESSION_2_TITLE)
      .every((d) => d.sessionMode === "existing");
    if (!importedModesOk) {
      throw new Error("task import test failed: imported sessions should be sessionMode=existing");
    }

    pass("Task import/sync verified: updates persisted, sessions imported once, reload is stable");
  } finally {
    if (stateFile) {
      if (hadStateBackup) writeFileSync(stateFile, stateBackup);
      else rmSync(stateFile, { force: true });
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("  aoaoe integration test");
  console.log("  2 sessions, real tasks, reactive prompt clearing (pipe-pane hooks, no polling)");
  console.log("  ──────────────────────────────────────────────────────────────────────────────");
  console.log("");

  const startTime = Date.now();
  const sessionTitles = [SESSION_1_TITLE, SESSION_2_TITLE];
  let sessions: TestSession[] = [];
  let exitCode = 0;
  let cleanedUp = false;

  const runCleanup = async (reason?: string): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (reason) {
      log("");
      log(`Received ${reason}; running emergency cleanup...`);
    }
    await cleanup(sessionTitles, sessions);
  };

  process.once("SIGINT", () => {
    void runCleanup("SIGINT").finally(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    void runCleanup("SIGTERM").finally(() => process.exit(143));
  });

  try {
    // ── Phase 0: Prerequisites ────────────────────────────────────────────
    log("Checking prerequisites...");
    for (const tool of ["aoe", "opencode", "tmux"]) {
      const r = await exec("which", [tool]);
      if (r.exitCode !== 0) throw new Error(`${tool} not found on PATH`);
    }
    const aoeCheck = await exec("aoe", ["list", "--json"]);
    if (aoeCheck.exitCode !== 0) throw new Error("aoe list --json failed");
    pass("aoe, opencode, tmux available");

    // clean up leftovers from a previous run
    rmSync(TEST_DIR, { recursive: true, force: true });
    cleanupWatchers();

    // ── Phase 1: Create sessions (no YOLO) ────────────────────────────────
    log("Creating sessions (no YOLO — pipe-pane watchers clear prompts)...");

    const s1 = await createSession(
      join(TEST_DIR, "project-basic"), SESSION_1_TITLE, S1_FILE, S1_CONTENT
    );
    const s2 = await createSession(
      join(TEST_DIR, "project-prompt"), SESSION_2_TITLE, S2_FILE, S2_CONTENT
    );
    sessions = [s1, s2];

    // start tmux panes
    await exec("aoe", ["session", "start", s1.id]);
    await exec("aoe", ["session", "start", s2.id]);

    for (const s of sessions) {
      const check = await exec("tmux", ["has-session", "-t", s.tmuxName]);
      if (check.exitCode !== 0) throw new Error(`tmux session ${s.tmuxName} not found`);
    }
    pass(`Sessions created: ${s1.title} (${s1.id.slice(0, 8)}), ${s2.title} (${s2.id.slice(0, 8)})`);

    // ── Phase 2: Task import/sync integration checks ──────────────────────
    await verifyTaskImportAndSync(sessions);

    // ── Phase 3: Start opencode in each pane ──────────────────────────────
    // AoE opens a shell (not the tool). We must wait for the shell prompt,
    // then type "opencode" to launch it. This takes ~11s for the shell to
    // initialize (SSH agent, banner) plus ~15s for opencode to load.

    log("Waiting for AoE shell prompts...");
    await waitForShellPrompt(s1);
    log(`  ${s1.title}: shell ready`);
    await waitForShellPrompt(s2);
    log(`  ${s2.title}: shell ready`);
    pass("Both shell prompts visible");

    log("Launching opencode in both panes...");
    await sendKeys(s1.tmuxName, "opencode");
    await sendKeys(s2.tmuxName, "opencode");
    log(`  Waiting ${OPENCODE_LOAD_WAIT_MS / 1000}s for opencode TUI to load...`);
    await sleep(OPENCODE_LOAD_WAIT_MS);

    await verifyOpencodeRunning(s1);
    log(`  ${s1.title}: opencode running`);
    await verifyOpencodeRunning(s2);
    log(`  ${s2.title}: opencode running`);
    pass("opencode running in both panes");

    // ── Phase 4: Start prompt watchers + send tasks ───────────────────────
    // Attach pipe-pane watchers BEFORE sending tasks so they're ready to
    // catch the very first permission prompt.
    log("Starting pipe-pane prompt watchers...");
    s1.watcherLogFile = startPromptWatcher(s1.tmuxName);
    s2.watcherLogFile = startPromptWatcher(s2.tmuxName);
    pass("Prompt watchers attached (reactive, no polling)");

    log("Sending tasks to both agents...");

    const task1 = `Create a file called ${S1_FILE} with exactly this content: ${S1_CONTENT}`;
    log(`  -> ${s1.title}: "${task1}"`);
    if (!await sendKeys(s1.tmuxName, task1)) throw new Error(`send-keys failed for ${s1.title}`);

    await sleep(1_500);

    const task2 = `Create the directory subdir/ then create a file called ${S2_FILE} with exactly this content: ${S2_CONTENT}`;
    log(`  -> ${s2.title}: "${task2}"`);
    if (!await sendKeys(s2.tmuxName, task2)) throw new Error(`send-keys failed for ${s2.title}`);

    // ── Phase 5: Wait for task completion ─────────────────────────────────
    // Prompt clearing is fully handled by the pipe-pane watchers.
    // This loop only checks for file creation (success) and crashes (early fail).
    log("");
    log("Waiting for tasks to complete (prompts cleared reactively by watchers)...");
    log("");

    let elapsed = 0;

    while (elapsed < TASK_TIMEOUT_MS) {
      await sleep(POLL_MS);
      elapsed += POLL_MS;

      let allDone = true;

      for (const s of sessions) {
        if (s.completed) continue;
        allDone = false;

        // early fail: task went to shell instead of opencode
        const output = await captureTmux(s.tmuxName);
        if (output.includes("command not found")) {
          const tail = tailLines(output, 5).join("\n    ");
          throw new Error(
            `${s.title}: "command not found" detected — task sent to shell, not opencode.\n` +
            `  opencode likely crashed. Last output:\n    ${tail}`
          );
        }

        // check for task completion (file exists with expected content)
        if (existsSync(s.targetFile)) {
          try {
            const content = readFileSync(s.targetFile, "utf-8");
            if (content.includes(s.expectedContent)) {
              s.completed = true;
              s.completedAtMs = elapsed;
              const stats = readPromptStats(s.watcherLogFile);
              log(`  [${s.title}] DONE in ${(elapsed / 1000).toFixed(0)}s ` +
                `(${stats.count} prompts cleared by watcher)`);
              continue;
            }
          } catch {}
        }

        // periodic progress (every ~15s)
        if (elapsed % 15_000 < POLL_MS) {
          const stats = readPromptStats(s.watcherLogFile);
          log(`  [${s.title}] ${(elapsed / 1000).toFixed(0)}s elapsed, ` +
            `${stats.count} prompts cleared, ` +
            `last: ${lastNonEmptyLine(output).slice(0, 80)}`);
        }
      }

      if (allDone) break;
    }

    // ── Phase 6: Results ──────────────────────────────────────────────────
    log("");
    log("Results");
    log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");

    let totalPrompts = 0;

    for (const s of sessions) {
      const stats = readPromptStats(s.watcherLogFile);
      totalPrompts += stats.count;

      if (s.completed) {
        pass(`${s.title}: file created in ${(s.completedAtMs / 1000).toFixed(0)}s, ` +
          `${stats.count} prompts cleared by watcher`);
        if (stats.lines.length > 0) {
          for (const line of stats.lines) {
            log(`    ${line}`);
          }
        }
      } else {
        const output = await captureTmux(s.tmuxName);
        const tail = tailLines(output, 8);
        console.error(`  \u274c ${s.title}: task did not complete in ${(TASK_TIMEOUT_MS / 1000).toFixed(0)}s`);
        console.error(`     prompts cleared by watcher: ${stats.count}`);
        console.error(`     file exists: ${existsSync(s.targetFile)}`);
        console.error(`     last output:`);
        for (const line of tail) {
          console.error(`       ${line.slice(0, 120)}`);
        }
        if (stats.lines.length > 0) {
          console.error(`     watcher log:`);
          for (const line of stats.lines) {
            console.error(`       ${line}`);
          }
        }
        exitCode = 1;
      }
    }

    if (totalPrompts > 0) {
      pass(`Total: ${totalPrompts} permission prompts cleared reactively by pipe-pane watchers`);
    } else {
      log("  (no permission prompts appeared — check opencode permission settings)");
    }

  } catch (err) {
    console.error(`\n  error: ${err}`);
    exitCode = 1;
  } finally {
    if (!cleanedUp) {
      log("");
      await cleanup(sessionTitles, sessions);
      cleanedUp = true;
    }
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("");
  console.log(`  ${exitCode === 0 ? "PASSED" : "FAILED"} in ${totalSec}s`);
  console.log("");
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
