// output-archival.ts — compress and archive old session outputs to disk.
// keeps the daemon's memory footprint manageable over long runs by
// offloading old output to gzipped files.

import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gzipSync } from "node:zlib";

const ARCHIVE_DIR = join(homedir(), ".aoaoe", "output-archive");
const MAX_ARCHIVES = 200;

export interface ArchiveResult {
  sessionTitle: string;
  filepath: string;
  originalLines: number;
  compressedBytes: number;
  archivedAt: number;
}

/**
 * Archive session output to a gzipped file on disk.
 */
export function archiveSessionOutput(sessionTitle: string, output: string[], now = Date.now()): ArchiveResult {
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const safe = sessionTitle.replace(/[^a-zA-Z0-9_-]/g, "_");
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${safe}_${timestamp}.txt.gz`;
  const filepath = join(ARCHIVE_DIR, filename);

  const content = output.join("\n");
  const compressed = gzipSync(Buffer.from(content, "utf-8"));
  writeFileSync(filepath, compressed);

  pruneOldArchives();

  return {
    sessionTitle,
    filepath,
    originalLines: output.length,
    compressedBytes: compressed.length,
    archivedAt: now,
  };
}

/**
 * List available archives.
 */
export function listArchives(): Array<{ filename: string; sessionTitle: string }> {
  if (!existsSync(ARCHIVE_DIR)) return [];
  return readdirSync(ARCHIVE_DIR)
    .filter((f) => f.endsWith(".txt.gz"))
    .sort()
    .reverse()
    .map((f) => ({
      filename: f,
      sessionTitle: f.split("_").slice(0, -2).join("_") || f,
    }));
}

/**
 * Format archive list for TUI display.
 */
export function formatArchiveList(): string[] {
  const archives = listArchives();
  if (archives.length === 0) return ["  (no archived outputs)"];
  const lines: string[] = [];
  lines.push(`  Output archives: ${archives.length} files`);
  for (const a of archives.slice(0, 10)) {
    lines.push(`    ${a.filename}`);
  }
  if (archives.length > 10) lines.push(`    ... and ${archives.length - 10} more`);
  return lines;
}

function pruneOldArchives(): void {
  try {
    const files = readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith(".txt.gz")).sort();
    while (files.length > MAX_ARCHIVES) {
      const oldest = files.shift()!;
      unlinkSync(join(ARCHIVE_DIR, oldest));
    }
  } catch { /* best-effort */ }
}
