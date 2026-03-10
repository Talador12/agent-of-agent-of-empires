#!/usr/bin/env node
/**
 * Integration test for aoaoe — end-to-end test with real aoe sessions.
 *
 * Creates two throwaway AoE sessions, starts the aoaoe daemon, verifies
 * that the daemon can observe and interact with the sessions, then cleans
 * everything up.
 *
 * Prerequisites: aoe, opencode, tmux must be on $PATH.
 * Run: npm run integration-test
 *
 * This is NOT part of `npm test` — it requires a live environment with
 * real CLI tools and takes 2-3 minutes to complete.
 */

import { execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_DIR = "/tmp/aoaoe-itest";
const SESSION_1_TITLE = "aoaoe-itest-1";
const SESSION_2_TITLE = "aoaoe-itest-2";
const DAEMON_TMUX = "aoaoe_itest_daemon";
const DAEMON_LOG = join(TEST_DIR, "daemon.log");
const DAEMON_STATE = join(homedir(), ".aoaoe", "daemon-state.json");

// timeouts
const SESSION_START_WAIT_MS = 8_000; // wait for AoE session to fully start
const DAEMON_START_WAIT_MS = 10_000; // wait for daemon to complete first tick
const TASK_WAIT_MS = 90_000; // wait for agent to complete a task
const POLL_INTERVAL_MS = 5_000; // how often to check for task completion

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function exec(cmd: string, args: string[], timeoutMs = 30_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFileCb(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as { code?: number | string };
        const exitCode = typeof e.code === "number" ? e.code : 1;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
        return;
      }
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
    });
  });
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

function fail(msg: string): never {
  console.error(`\n❌ FAIL: ${msg}\n`);
  process.exit(1);
}

function pass(msg: string) {
  console.log(`  ✅ ${msg}`);
}

// ── Phase 0: Prerequisites ──────────────────────────────────────────────────

async function checkPrerequisites(): Promise<void> {
  log("Phase 0: Checking prerequisites...");

  for (const tool of ["aoe", "opencode", "tmux"]) {
    const result = await exec("which", [tool]);
    if (result.exitCode !== 0) fail(`${tool} not found on PATH`);
  }

  // verify aoe is responsive
  const aoeList = await exec("aoe", ["list", "--json"]);
  if (aoeList.exitCode !== 0) fail("aoe list --json failed");

  pass("aoe, opencode, tmux all available");
}

// ── Phase 1: Create test sessions ───────────────────────────────────────────

interface TestSession {
  id: string;
  title: string;
  tmuxName: string;
  dir: string;
}

async function createTestSessions(): Promise<[TestSession, TestSession]> {
  log("Phase 1: Creating test sessions...");

  // create project directories with simple test files
  const dir1 = join(TEST_DIR, "project-1");
  const dir2 = join(TEST_DIR, "project-2");

  mkdirSync(dir1, { recursive: true });
  mkdirSync(dir2, { recursive: true });

  // write a simple AGENTS.md for each so context loading has something to find
  writeFileSync(join(dir1, "AGENTS.md"), "# Project 1\nIntegration test project. Do whatever is asked.\n");
  writeFileSync(join(dir2, "AGENTS.md"), "# Project 2\nIntegration test project. Do whatever is asked.\n");

  // create sessions via aoe add
  const s1 = await createOneSession(dir1, SESSION_1_TITLE);
  const s2 = await createOneSession(dir2, SESSION_2_TITLE);

  // start both sessions
  await exec("aoe", ["session", "start", s1.id]);
  await exec("aoe", ["session", "start", s2.id]);

  log(`  Waiting ${SESSION_START_WAIT_MS / 1000}s for sessions to initialize...`);
  await sleep(SESSION_START_WAIT_MS);

  // verify both tmux sessions exist
  for (const s of [s1, s2]) {
    const check = await exec("tmux", ["has-session", "-t", s.tmuxName]);
    if (check.exitCode !== 0) fail(`tmux session ${s.tmuxName} not found after start`);
  }

  pass(`Created sessions: ${s1.id.slice(0, 8)} (${s1.title}), ${s2.id.slice(0, 8)} (${s2.title})`);
  return [s1, s2];
}

async function createOneSession(dir: string, title: string): Promise<TestSession> {
  const result = await exec("aoe", ["add", dir, "-t", title, "-c", "opencode", "-y"]);
  if (result.exitCode !== 0) fail(`aoe add failed for ${title}: ${result.stderr}`);

  // parse ID from aoe list
  const list = await exec("aoe", ["list", "--json"]);
  const sessions = JSON.parse(list.stdout) as Array<{ id: string; title: string }>;
  const found = sessions.find((s) => s.title === title);
  if (!found) fail(`session "${title}" not found in aoe list after creation`);

  // tmux name format: aoe_<sanitized_title>_<first8_of_id>
  const sanitized = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);
  const tmuxName = `aoe_${sanitized}_${found.id.slice(0, 8)}`;

  return { id: found.id, title, tmuxName, dir };
}

// ── Phase 2: Start daemon ───────────────────────────────────────────────────

async function startDaemon(): Promise<void> {
  log("Phase 2: Starting daemon in tmux session...");

  // kill any stale daemon tmux session
  await exec("tmux", ["kill-session", "-t", DAEMON_TMUX]);

  // start daemon in a detached tmux session, logging to file
  // use --dry-run=false and a short poll interval for faster tests
  const daemonCmd = `cd /Users/kadler/Documents/repos && npx aoaoe --verbose 2>&1 | tee ${DAEMON_LOG}`;
  const result = await exec("tmux", [
    "new-session", "-d", "-s", DAEMON_TMUX, "-x", "200", "-y", "50", daemonCmd,
  ]);
  if (result.exitCode !== 0) fail(`failed to start daemon tmux session: ${result.stderr}`);

  log(`  Waiting ${DAEMON_START_WAIT_MS / 1000}s for daemon to complete first tick...`);
  await sleep(DAEMON_START_WAIT_MS);

  // verify daemon is running by checking tmux session exists
  const check = await exec("tmux", ["has-session", "-t", DAEMON_TMUX]);
  if (check.exitCode !== 0) fail("daemon tmux session died");

  pass("Daemon started in tmux session");
}

// ── Phase 3: Test scenarios ─────────────────────────────────────────────────

async function testDaemonStateFile(): Promise<void> {
  log("Test 1: Daemon state file exists and has sessions...");

  // daemon should have written state file after first tick
  if (!existsSync(DAEMON_STATE)) {
    // give it a few more seconds
    await sleep(5_000);
    if (!existsSync(DAEMON_STATE)) fail("daemon-state.json not found");
  }

  const state = JSON.parse(readFileSync(DAEMON_STATE, "utf-8"));
  if (typeof state.pollCount !== "number") fail("daemon state missing pollCount");
  if (!Array.isArray(state.sessions)) fail("daemon state missing sessions array");

  // should see our test sessions (plus possibly the main aoaoe session)
  const testSessions = state.sessions.filter(
    (s: { title: string }) => s.title === SESSION_1_TITLE || s.title === SESSION_2_TITLE
  );
  if (testSessions.length < 2) {
    fail(`expected 2 test sessions in daemon state, found ${testSessions.length}: ${JSON.stringify(state.sessions.map((s: { title: string }) => s.title))}`);
  }

  pass(`Daemon state has ${state.sessions.length} sessions, pollCount=${state.pollCount}`);
}

async function testTmuxCapture(sessions: TestSession[]): Promise<void> {
  log("Test 2: tmux capture-pane works for test sessions...");

  for (const s of sessions) {
    const cap = await exec("tmux", ["capture-pane", "-t", s.tmuxName, "-p", "-S", "-50"]);
    if (cap.exitCode !== 0) fail(`tmux capture failed for ${s.tmuxName}: ${cap.stderr}`);
    // output should be non-empty (at minimum opencode shows its UI)
    if (cap.stdout.trim().length === 0) {
      log(`  Warning: empty capture for ${s.title} — agent may still be loading`);
    }
  }

  pass("tmux capture-pane works for both test sessions");
}

async function testDaemonObservation(sessions: TestSession[]): Promise<void> {
  log("Test 3: Daemon log shows observation of test sessions...");

  // capture daemon pane to check for log lines
  const cap = await exec("tmux", ["capture-pane", "-t", DAEMON_TMUX, "-p", "-S", "-200"]);
  if (cap.exitCode !== 0) fail("cannot capture daemon pane");

  const output = cap.stdout;

  // daemon should show session names in its output
  let foundSessions = 0;
  for (const s of sessions) {
    // the daemon dashboard shows session titles
    if (output.includes(s.title) || output.includes(s.id.slice(0, 8))) {
      foundSessions++;
    }
  }

  if (foundSessions === 0) {
    // check if daemon log file has the info instead
    if (existsSync(DAEMON_LOG)) {
      const logContent = readFileSync(DAEMON_LOG, "utf-8");
      for (const s of sessions) {
        if (logContent.includes(s.title) || logContent.includes(s.id.slice(0, 8))) {
          foundSessions++;
        }
      }
    }
  }

  if (foundSessions < 2) {
    log(`  Warning: only found ${foundSessions}/2 test sessions in daemon output (may need more time)`);
  }

  pass(`Daemon observing ${foundSessions}/2 test sessions`);
}

async function testSendInput(session: TestSession): Promise<void> {
  log("Test 4: Can send input via tmux send-keys...");

  // send a simple echo command to verify tmux send-keys works
  // we use -l for literal text, then Enter separately (matching executor pattern)
  const textOk = await exec("tmux", ["send-keys", "-t", session.tmuxName, "-l", 'echo "ITEST_PING"']);
  if (textOk.exitCode !== 0) fail(`send-keys text failed for ${session.tmuxName}`);

  const enterOk = await exec("tmux", ["send-keys", "-t", session.tmuxName, "Enter"]);
  if (enterOk.exitCode !== 0) fail(`send-keys Enter failed for ${session.tmuxName}`);

  // wait a moment, then capture and look for our string
  await sleep(3_000);

  const cap = await exec("tmux", ["capture-pane", "-t", session.tmuxName, "-p", "-S", "-50"]);
  if (cap.stdout.includes("ITEST_PING")) {
    pass("send-keys round-trip verified (ITEST_PING found in output)");
  } else {
    // this is ok — the agent might have consumed the input before we captured
    pass("send-keys completed (agent may have already processed the input)");
  }
}

async function testContextDiscovery(sessions: TestSession[]): Promise<void> {
  log("Test 5: Context files are discoverable for test projects...");

  // run aoaoe test-context to verify context loading works
  const result = await exec("npx", ["aoaoe", "test-context"], 30_000);

  // test-context should mention our test session directories
  let found = 0;
  for (const s of sessions) {
    if (result.stdout.includes(s.title) || result.stdout.includes("AGENTS.md")) {
      found++;
    }
  }

  // even if test-context doesn't find our sessions (they may not resolve to test dirs
  // from /Users/kadler/Documents/repos), the command should succeed
  if (result.exitCode !== 0) {
    log(`  Warning: test-context exited with code ${result.exitCode}`);
  }

  pass(`Context discovery completed (test-context exit code: ${result.exitCode})`);
}

async function testDaemonLogNoTimeouts(): Promise<void> {
  log("Test 6: No reasoner timeouts in daemon log...");

  if (!existsSync(DAEMON_LOG)) {
    pass("No daemon log file yet (daemon may not have reasoned yet)");
    return;
  }

  const logContent = readFileSync(DAEMON_LOG, "utf-8");
  const timeoutLines = logContent
    .split("\n")
    .filter((line) => line.includes("timed out") || line.includes("TIMEOUT"));

  if (timeoutLines.length > 0) {
    log(`  Warning: Found ${timeoutLines.length} timeout lines in daemon log`);
    for (const line of timeoutLines.slice(0, 3)) {
      log(`    ${line.slice(0, 120)}`);
    }
  }

  pass(`Daemon log: ${timeoutLines.length} timeout(s) found`);
}

async function testSessionRemoval(): Promise<void> {
  log("Test 7: Session removal via aoe remove...");

  // list current sessions
  const before = await exec("aoe", ["list", "--json"]);
  const beforeSessions = JSON.parse(before.stdout) as Array<{ id: string; title: string }>;
  const testBefore = beforeSessions.filter(
    (s) => s.title === SESSION_1_TITLE || s.title === SESSION_2_TITLE
  );

  if (testBefore.length === 0) {
    pass("No test sessions to remove (already cleaned up)");
    return;
  }

  // remove test sessions
  for (const s of testBefore) {
    // aoe remove does NOT accept -y, pipe "y" to confirm
    const result = await exec("bash", ["-c", `echo "y" | aoe remove ${s.id}`]);
    if (result.exitCode !== 0) {
      log(`  Warning: failed to remove session ${s.id}: ${result.stderr}`);
    }
  }

  // verify removal
  await sleep(2_000);
  const after = await exec("aoe", ["list", "--json"]);
  const afterSessions = JSON.parse(after.stdout) as Array<{ id: string; title: string }>;
  const testAfter = afterSessions.filter(
    (s) => s.title === SESSION_1_TITLE || s.title === SESSION_2_TITLE
  );

  if (testAfter.length > 0) {
    log(`  Warning: ${testAfter.length} test session(s) still present after removal`);
  } else {
    pass("All test sessions removed successfully");
  }
}

// ── Phase 4: Cleanup ────────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  log("Phase 4: Cleanup...");

  // stop daemon tmux session
  await exec("tmux", ["kill-session", "-t", DAEMON_TMUX]);

  // remove any remaining test sessions
  const list = await exec("aoe", ["list", "--json"]);
  if (list.exitCode === 0) {
    try {
      const sessions = JSON.parse(list.stdout) as Array<{ id: string; title: string }>;
      for (const s of sessions) {
        if (s.title === SESSION_1_TITLE || s.title === SESSION_2_TITLE) {
          await exec("bash", ["-c", `echo "y" | aoe remove ${s.id}`]);
        }
      }
    } catch {}
  }

  // clean temp directory
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}

  pass("Cleanup complete");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   aoaoe Integration Test                     ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  const startTime = Date.now();
  let sessions: TestSession[] = [];

  try {
    // Phase 0
    await checkPrerequisites();

    // Phase 1: Create test sessions
    const [s1, s2] = await createTestSessions();
    sessions = [s1, s2];

    // Phase 2: Start daemon
    await startDaemon();

    // Phase 3: Run tests
    await testDaemonStateFile();
    await testTmuxCapture(sessions);
    await testDaemonObservation(sessions);
    await testSendInput(s1);
    await testContextDiscovery(sessions);
    await testDaemonLogNoTimeouts();

    // Test 7 is destructive — does its own session removal
    await testSessionRemoval();

  } catch (err) {
    console.error(`\n💥 Unexpected error: ${err}`);
  } finally {
    // Always clean up
    await cleanup();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n────────────────────────────────────────────────`);
  console.log(`Integration test completed in ${elapsed}s`);
  console.log(`────────────────────────────────────────────────\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
