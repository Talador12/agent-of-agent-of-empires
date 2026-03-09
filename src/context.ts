// context.ts -- reads AGENTS.md / claude.md files for reasoner context
// global context: from cwd (or configured dir), applies to all sessions
// per-session context: from each session's path, scoped to that session
//
// directory structure this supports:
//   repos/                        <- session path (aoe launches here)
//   ├── AGENTS.md                 <- global context
//   ├── github/                   <- group folder (OSS)
//   │   ├── claude.md             <- group context + roadmap
//   │   ├── adventure/            <- repo (matched by session title)
//   │   └── agent-of-agent-of-empires/
//   ├── cc/                       <- group folder (internal)
//   │   ├── claude.md             <- group context
//   │   └── cloudchamber/         <- repo
//   └── ...
//
// resolveProjectDir searches basePath subdirs for a directory matching
// the session title, then loads context from repo dir + group dir.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

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

// resolve a session's actual project directory by searching subdirectories
// of basePath for a directory whose name matches the session title.
// searches two levels deep: basePath/*/title and basePath/title
// returns the resolved path, or null if not found.
export function resolveProjectDir(basePath: string, sessionTitle: string): string | null {
  if (!basePath || !sessionTitle) return null;

  // normalize title for matching: lowercase, spaces/underscores → hyphens
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "-");
  const needle = normalize(sessionTitle);

  try {
    // first check direct children: basePath/<title>
    const topEntries = safeReaddir(basePath);
    for (const entry of topEntries) {
      if (normalize(entry) === needle) {
        const candidate = join(basePath, entry);
        if (isDir(candidate)) return candidate;
      }
    }

    // then check one level deeper: basePath/<group>/<title>
    // this handles repos/github/adventure, repos/cc/cloudchamber, etc.
    for (const groupEntry of topEntries) {
      const groupDir = join(basePath, groupEntry);
      if (!isDir(groupDir)) continue;
      // skip hidden dirs and node_modules
      if (groupEntry.startsWith(".") || groupEntry === "node_modules") continue;

      const groupChildren = safeReaddir(groupDir);
      for (const child of groupChildren) {
        if (normalize(child) === needle) {
          const candidate = join(groupDir, child);
          if (isDir(candidate)) return candidate;
        }
      }
    }
  } catch {
    // filesystem errors -- fall through
  }

  return null;
}

// load per-session context by resolving the project directory from the title
// falls back to loading from sessionPath directly if resolution fails
export function loadSessionContext(sessionPath: string, sessionTitle?: string): string {
  if (!sessionPath) return "";

  // try to resolve the actual project directory from the title
  let projectDir: string | null = null;
  if (sessionTitle) {
    projectDir = resolveProjectDir(sessionPath, sessionTitle);
  }

  if (projectDir) {
    // found the repo dir -- load context from it (includes parent/group-level)
    const context = loadContextFromDir(projectDir);
    if (context) return context;
  }

  // fallback: load from the session path directly
  const context = loadContextFromDir(sessionPath);
  if (!context) return "";
  return context;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// clear the cache (for testing)
export function clearContextCache(): void {
  cache.clear();
}
