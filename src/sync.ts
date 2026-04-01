// sync.ts — git-based task state sharing across machines.
// uses a bare git repo at ~/.aoaoe/sync/ to push/pull state files.
// workflow: aoaoe sync init <remote-url> → aoaoe sync push → aoaoe sync pull

import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { exec } from "./shell.js";
import { GREEN, YELLOW, RED, DIM, BOLD, RESET } from "./colors.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const SYNC_DIR = join(AOAOE_DIR, "sync");

// files to sync between machines
const SYNC_FILES = [
  "task-state.json",
  "aoaoe.config.json",
  "pin-presets.json",
  "templates.json",
  "prompt-templates.json",
];

export async function syncInit(remoteUrl: string): Promise<string> {
  if (!remoteUrl) throw new Error("usage: aoaoe sync init <git-remote-url>");

  if (existsSync(join(SYNC_DIR, ".git"))) {
    // already initialized — update remote
    await exec("git", ["remote", "set-url", "origin", remoteUrl], 30_000, undefined, SYNC_DIR);
    return `sync repo updated: remote set to ${remoteUrl}`;
  }

  mkdirSync(SYNC_DIR, { recursive: true });
  const initResult = await exec("git", ["init"], 30_000, undefined, SYNC_DIR);
  if (initResult.exitCode !== 0) throw new Error(`git init failed: ${initResult.stderr}`);

  const remoteResult = await exec("git", ["remote", "add", "origin", remoteUrl], 30_000, undefined, SYNC_DIR);
  if (remoteResult.exitCode !== 0) throw new Error(`git remote add failed: ${remoteResult.stderr}`);

  // try to pull existing state
  const fetchResult = await exec("git", ["fetch", "origin"], 30_000, undefined, SYNC_DIR);
  if (fetchResult.exitCode === 0) {
    const checkoutResult = await exec("git", ["checkout", "-b", "main", "origin/main"], 30_000, undefined, SYNC_DIR);
    if (checkoutResult.exitCode !== 0) {
      // no remote main yet — create initial commit
      await exec("git", ["checkout", "-b", "main"], 30_000, undefined, SYNC_DIR);
    }
  } else {
    await exec("git", ["checkout", "-b", "main"], 30_000, undefined, SYNC_DIR);
  }

  return `sync repo initialized at ${SYNC_DIR} → ${remoteUrl}`;
}

export async function syncPush(): Promise<string> {
  if (!existsSync(join(SYNC_DIR, ".git"))) {
    throw new Error("sync not initialized — run: aoaoe sync init <git-remote-url>");
  }

  // copy state files into sync repo
  let copied = 0;
  for (const f of SYNC_FILES) {
    const src = join(AOAOE_DIR, f);
    if (existsSync(src)) {
      copyFileSync(src, join(SYNC_DIR, f));
      copied++;
    }
  }

  // also copy aoaoe.tasks.json from cwd if present
  const cwdTasks = join(process.cwd(), "aoaoe.tasks.json");
  if (existsSync(cwdTasks)) {
    copyFileSync(cwdTasks, join(SYNC_DIR, "aoaoe.tasks.json"));
    copied++;
  }

  if (copied === 0) return "nothing to sync (no state files found)";

  // git add + commit + push
  await exec("git", ["add", "-A"], 30_000, undefined, SYNC_DIR);

  const hostname = (await exec("hostname", ["-s"])).stdout.trim() || "unknown";
  const timestamp = new Date().toISOString().slice(0, 19);
  const msg = `sync push from ${hostname} at ${timestamp}`;

  const commitResult = await exec("git", ["commit", "-m", msg, "--allow-empty"], 30_000, undefined, SYNC_DIR);
  if (commitResult.exitCode !== 0 && !commitResult.stderr.includes("nothing to commit")) {
    throw new Error(`git commit failed: ${commitResult.stderr}`);
  }

  const pushResult = await exec("git", ["push", "origin", "main"], 30_000, undefined, SYNC_DIR);
  if (pushResult.exitCode !== 0) {
    throw new Error(`git push failed: ${pushResult.stderr}`);
  }

  return `pushed ${copied} file(s) to sync remote`;
}

export async function syncPull(): Promise<string> {
  if (!existsSync(join(SYNC_DIR, ".git"))) {
    throw new Error("sync not initialized — run: aoaoe sync init <git-remote-url>");
  }

  const pullResult = await exec("git", ["pull", "origin", "main", "--rebase"], 30_000, undefined, SYNC_DIR);
  if (pullResult.exitCode !== 0) {
    throw new Error(`git pull failed: ${pullResult.stderr}`);
  }

  // copy files back from sync repo to ~/.aoaoe/
  let restored = 0;
  const syncFiles = existsSync(SYNC_DIR) ? readdirSync(SYNC_DIR).filter((f) => !f.startsWith(".")) : [];
  for (const f of syncFiles) {
    if (f === "aoaoe.tasks.json") {
      copyFileSync(join(SYNC_DIR, f), join(process.cwd(), f));
      restored++;
    } else if (SYNC_FILES.includes(f)) {
      copyFileSync(join(SYNC_DIR, f), join(AOAOE_DIR, f));
      restored++;
    }
  }

  return `pulled and restored ${restored} file(s) from sync remote`;
}

export async function syncDiff(): Promise<string> {
  if (!existsSync(join(SYNC_DIR, ".git"))) {
    throw new Error("sync not initialized — run: aoaoe sync init <git-remote-url>");
  }

  // copy current state files to sync dir for diffing (without committing)
  for (const f of SYNC_FILES) {
    const src = join(AOAOE_DIR, f);
    if (existsSync(src)) copyFileSync(src, join(SYNC_DIR, f));
  }

  const diffResult = await exec("git", ["diff", "--stat"], 30_000, undefined, SYNC_DIR);
  if (!diffResult.stdout.trim()) return "no changes since last sync push";
  return `changes since last sync push:\n${diffResult.stdout}`;
}

export async function syncStatus(): Promise<string> {
  if (!existsSync(join(SYNC_DIR, ".git"))) {
    return `${YELLOW}sync not initialized${RESET} — run: aoaoe sync init <git-remote-url>`;
  }

  const remoteResult = await exec("git", ["remote", "-v"], 30_000, undefined, SYNC_DIR);
  const remote = remoteResult.stdout.split("\n")[0]?.replace(/\t/, " ") || "(no remote)";

  const logResult = await exec("git", ["log", "--oneline", "-1"], 30_000, undefined, SYNC_DIR);
  const lastCommit = logResult.stdout.trim() || "(no commits)";

  const syncFiles = readdirSync(SYNC_DIR).filter((f) => !f.startsWith(".") && SYNC_FILES.includes(f));

  return [
    `${BOLD}sync status${RESET}`,
    `  remote: ${DIM}${remote}${RESET}`,
    `  last:   ${DIM}${lastCommit}${RESET}`,
    `  files:  ${syncFiles.length} state file(s) tracked`,
  ].join("\n");
}
