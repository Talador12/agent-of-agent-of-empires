// context.ts -- reads AGENTS.md / claude.md files for reasoner context
// global context: from cwd (or configured dir), applies to all sessions
// per-session context: from each session's path, scoped to that session
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const CONTEXT_FILES = ["AGENTS.md", "claude.md"];
const MAX_FILE_SIZE = 8_000; // truncate individual files to keep token budget sane
const CACHE_TTL_MS = 60_000; // re-read files at most every 60s

interface CachedContext {
  content: string;
  readAt: number;
  mtime: number;
}

const cache = new Map<string, CachedContext>();

// read a single context file, return its content or empty string
export function readContextFile(filePath: string): string {
  try {
    if (!existsSync(filePath)) return "";
    const stat = statSync(filePath);
    if (!stat.isFile()) return "";

    // check cache
    const cached = cache.get(filePath);
    if (cached && Date.now() - cached.readAt < CACHE_TTL_MS && cached.mtime === stat.mtimeMs) {
      return cached.content;
    }

    let content = readFileSync(filePath, "utf-8").trim();
    if (content.length > MAX_FILE_SIZE) {
      content = content.slice(0, MAX_FILE_SIZE) + "\n\n[... truncated at 8KB ...]";
    }

    cache.set(filePath, { content, readAt: Date.now(), mtime: stat.mtimeMs });
    return content;
  } catch {
    return "";
  }
}

// load all context files from a directory, return combined string
export function loadContextFromDir(dir: string): string {
  if (!dir) return "";
  const parts: string[] = [];

  for (const name of CONTEXT_FILES) {
    const content = readContextFile(join(dir, name));
    if (content) {
      parts.push(`--- ${name} ---`);
      parts.push(content);
      parts.push("");
    }
  }

  // also check parent directory for context files (e.g. group-level claude.md)
  // this matches the AGENTS.md pattern: "Put claude.md in the group folder"
  const parentDir = join(dir, "..");
  for (const name of CONTEXT_FILES) {
    const parentPath = join(parentDir, name);
    // skip if same file we already read (dir is the parent)
    if (parentPath === join(dir, name)) continue;
    const content = readContextFile(parentPath);
    if (content) {
      parts.push(`--- ../${name} (parent directory) ---`);
      parts.push(content);
      parts.push("");
    }
  }

  return parts.join("\n");
}

// load global context (from the directory aoaoe was launched in)
export function loadGlobalContext(cwd?: string): string {
  const dir = cwd ?? process.cwd();
  const context = loadContextFromDir(dir);
  if (!context) return "";
  return `\n\n--- GLOBAL PROJECT CONTEXT (from supervisor working directory) ---\n${context}`;
}

// load per-session context (from the session's project path)
export function loadSessionContext(sessionPath: string): string {
  if (!sessionPath) return "";
  const context = loadContextFromDir(sessionPath);
  if (!context) return "";
  return context;
}

// clear the cache (for testing)
export function clearContextCache(): void {
  cache.clear();
}
