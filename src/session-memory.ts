// session-memory.ts — persist per-session learnings across daemon restarts.
// stores key observations, errors encountered, successful patterns, and
// context hints that survive session teardown and daemon restart.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MEMORY_DIR = join(homedir(), ".aoaoe", "session-memory");

export interface MemoryEntry {
  timestamp: number;
  category: "error_pattern" | "success_pattern" | "context_hint" | "preference" | "warning";
  text: string;
}

export interface SessionMemory {
  sessionTitle: string;
  repo: string;
  entries: MemoryEntry[];
  lastUpdatedAt: number;
}

/**
 * Load session memory from disk. Returns empty memory if not found.
 */
export function loadSessionMemory(sessionTitle: string): SessionMemory {
  const filepath = memoryPath(sessionTitle);
  if (!existsSync(filepath)) {
    return { sessionTitle, repo: "", entries: [], lastUpdatedAt: 0 };
  }
  try {
    const data = JSON.parse(readFileSync(filepath, "utf-8"));
    return { sessionTitle: data.sessionTitle ?? sessionTitle, repo: data.repo ?? "", entries: data.entries ?? [], lastUpdatedAt: data.lastUpdatedAt ?? 0 };
  } catch {
    return { sessionTitle, repo: "", entries: [], lastUpdatedAt: 0 };
  }
}

/**
 * Save session memory to disk.
 */
export function saveSessionMemory(memory: SessionMemory): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  memory.lastUpdatedAt = Date.now();
  writeFileSync(memoryPath(memory.sessionTitle), JSON.stringify(memory, null, 2) + "\n");
}

/**
 * Add a memory entry and save.
 */
export function rememberForSession(
  sessionTitle: string,
  repo: string,
  category: MemoryEntry["category"],
  text: string,
  maxEntries = 50,
): void {
  const memory = loadSessionMemory(sessionTitle);
  memory.repo = repo;
  memory.entries.push({ timestamp: Date.now(), category, text });
  // trim to max entries, keeping newest
  if (memory.entries.length > maxEntries) {
    memory.entries = memory.entries.slice(-maxEntries);
  }
  saveSessionMemory(memory);
}

/**
 * Extract memory context for inclusion in reasoner prompts.
 * Returns a compact text summary of learnings for a session.
 */
export function getMemoryContext(sessionTitle: string, maxLines = 10): string {
  const memory = loadSessionMemory(sessionTitle);
  if (memory.entries.length === 0) return "";

  const lines: string[] = [];
  lines.push(`[Session memory for "${sessionTitle}":]`);

  // prioritize: errors first, then warnings, then success patterns, then context
  const grouped = new Map<string, MemoryEntry[]>();
  for (const e of memory.entries) {
    if (!grouped.has(e.category)) grouped.set(e.category, []);
    grouped.get(e.category)!.push(e);
  }

  const order: MemoryEntry["category"][] = ["error_pattern", "warning", "success_pattern", "context_hint", "preference"];
  let remaining = maxLines - 1;
  for (const cat of order) {
    const entries = grouped.get(cat);
    if (!entries || remaining <= 0) continue;
    const take = entries.slice(-Math.min(3, remaining));
    for (const e of take) {
      lines.push(`- [${e.category}] ${e.text}`);
      remaining--;
    }
  }

  return lines.join("\n");
}

/**
 * List all sessions with stored memory.
 */
export function listSessionMemories(): string[] {
  if (!existsSync(MEMORY_DIR)) return [];
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(MEMORY_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""));
}

/**
 * Format session memory for TUI display.
 */
export function formatSessionMemory(memory: SessionMemory): string[] {
  if (memory.entries.length === 0) return [`  "${memory.sessionTitle}": no memories stored`];
  const lines: string[] = [];
  lines.push(`  "${memory.sessionTitle}" (${memory.entries.length} memories, repo: ${memory.repo || "unknown"}):`);
  for (const e of memory.entries.slice(-10)) {
    const age = Math.round((Date.now() - e.timestamp) / 60_000);
    lines.push(`    [${e.category}] ${e.text} (${age}m ago)`);
  }
  return lines;
}

function memoryPath(sessionTitle: string): string {
  const safe = sessionTitle.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(MEMORY_DIR, `${safe}.json`);
}
