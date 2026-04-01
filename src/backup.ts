// backup.ts — backup and restore aoaoe state + config for portability.
// backs up ~/.aoaoe/ contents to a timestamped tarball or directory.

import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { exec } from "./shell.js";
import { BOLD, DIM, GREEN, YELLOW, RED, RESET } from "./colors.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");

// files to include in backup (relative to ~/.aoaoe/)
const BACKUP_FILES = [
  "aoaoe.config.json",
  "task-state.json",
  "supervisor-history.jsonl",
  "pin-presets.json",
  "templates.json",
  "prompt-templates.json",
  "tui-prefs.json",
];

export async function createBackup(outputPath?: string): Promise<string> {
  if (!existsSync(AOAOE_DIR)) {
    throw new Error("~/.aoaoe/ does not exist — nothing to back up");
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const defaultPath = join(process.cwd(), `aoaoe-backup-${timestamp}`);
  const target = outputPath || defaultPath;

  // also include aoaoe.tasks.json from cwd if it exists
  const cwdTasksFile = join(process.cwd(), "aoaoe.tasks.json");

  // try tar first (most portable)
  const tarTarget = target.endsWith(".tar.gz") ? target : `${target}.tar.gz`;
  const filesToBackup: string[] = [];

  for (const f of BACKUP_FILES) {
    const full = join(AOAOE_DIR, f);
    if (existsSync(full)) filesToBackup.push(full);
  }
  if (existsSync(cwdTasksFile)) filesToBackup.push(cwdTasksFile);

  if (filesToBackup.length === 0) {
    throw new Error("no files to back up");
  }

  const result = await exec("tar", [
    "czf", tarTarget,
    ...filesToBackup.map((f) => f),
  ]);

  if (result.exitCode === 0) {
    const size = statSync(tarTarget).size;
    const sizeStr = size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}KB`;
    return `${tarTarget} (${filesToBackup.length} files, ${sizeStr})`;
  }

  // tar failed — fall back to directory copy
  mkdirSync(target, { recursive: true });
  let count = 0;
  for (const full of filesToBackup) {
    const name = basename(full);
    copyFileSync(full, join(target, name));
    count++;
  }
  return `${target}/ (${count} files copied)`;
}

export async function restoreBackup(inputPath: string): Promise<{ restored: string[]; skipped: string[] }> {
  const restored: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(inputPath)) {
    throw new Error(`backup not found: ${inputPath}`);
  }

  if (!existsSync(AOAOE_DIR)) {
    mkdirSync(AOAOE_DIR, { recursive: true });
  }

  // try tar extraction
  if (inputPath.endsWith(".tar.gz") || inputPath.endsWith(".tgz")) {
    const result = await exec("tar", ["xzf", inputPath, "-C", "/"]);
    if (result.exitCode === 0) {
      // check what was restored
      for (const f of BACKUP_FILES) {
        if (existsSync(join(AOAOE_DIR, f))) restored.push(f);
      }
      return { restored, skipped };
    }
    throw new Error(`tar extraction failed: ${result.stderr}`);
  }

  // directory restore
  if (!statSync(inputPath).isDirectory()) {
    throw new Error(`${inputPath} is not a directory or tar.gz archive`);
  }

  const files = readdirSync(inputPath);
  for (const f of files) {
    const src = join(inputPath, f);
    if (f === "aoaoe.tasks.json") {
      // restore to cwd
      copyFileSync(src, join(process.cwd(), f));
      restored.push(f);
    } else if (BACKUP_FILES.includes(f)) {
      copyFileSync(src, join(AOAOE_DIR, f));
      restored.push(f);
    } else {
      skipped.push(f);
    }
  }

  return { restored, skipped };
}

export function formatBackupResult(path: string): string {
  return `  ${GREEN}✓${RESET} backup created: ${path}`;
}

export function formatRestoreResult(result: { restored: string[]; skipped: string[] }): string {
  const lines: string[] = [];
  if (result.restored.length > 0) {
    lines.push(`  ${GREEN}✓${RESET} restored ${result.restored.length} file(s):`);
    for (const f of result.restored) lines.push(`    ${DIM}${f}${RESET}`);
  }
  if (result.skipped.length > 0) {
    lines.push(`  ${YELLOW}!${RESET} skipped ${result.skipped.length} file(s):`);
    for (const f of result.skipped) lines.push(`    ${DIM}${f}${RESET}`);
  }
  return lines.join("\n");
}
