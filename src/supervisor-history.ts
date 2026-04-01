import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const SUPERVISOR_HISTORY_FILE = join(AOAOE_DIR, "supervisor-history.jsonl");
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export interface SupervisorEvent {
  at: number;
  detail: string;
}

export function appendSupervisorEvent(
  event: SupervisorEvent,
  filePath: string = SUPERVISOR_HISTORY_FILE,
  maxSize: number = MAX_FILE_SIZE,
): void {
  try {
    const dir = join(filePath, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotateSupervisorHistory(filePath, maxSize);
    appendFileSync(filePath, JSON.stringify(event) + "\n", "utf-8");
  } catch {
    // fire-and-forget persistence
  }
}

export function loadSupervisorEvents(
  maxEntries = 50,
  filePath: string = SUPERVISOR_HISTORY_FILE,
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): SupervisorEvent[] {
  try {
    if (!existsSync(filePath)) return [];
    const cutoff = Date.now() - maxAgeMs;
    const lines = readFileSync(filePath, "utf-8").split("\n").filter((l) => l.trim());
    const events: SupervisorEvent[] = [];
    for (const line of lines.slice(-maxEntries * 3)) {
      try {
        const parsed = JSON.parse(line);
        if (isSupervisorEvent(parsed) && parsed.at >= cutoff) events.push(parsed);
      } catch {
        // skip malformed entries
      }
    }
    return events.slice(-maxEntries);
  } catch {
    return [];
  }
}

export function rotateSupervisorHistory(
  filePath: string = SUPERVISOR_HISTORY_FILE,
  maxSize: number = MAX_FILE_SIZE,
): boolean {
  try {
    if (!existsSync(filePath)) return false;
    if (statSync(filePath).size < maxSize) return false;
    renameSync(filePath, `${filePath}.old`);
    return true;
  } catch {
    return false;
  }
}

function isSupervisorEvent(val: unknown): val is SupervisorEvent {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return typeof obj.at === "number" && typeof obj.detail === "string";
}

export const SUPERVISOR_HISTORY_PATH = SUPERVISOR_HISTORY_FILE;
