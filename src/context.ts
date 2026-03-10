// context.ts -- reads AI instruction files for reasoner context
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
//
// supports AI instruction files from many tools:
//   AGENTS.md, claude.md/CLAUDE.md (opencode/claude-code)
//   .cursorrules (cursor), .windsurfrules (windsurf)
//   .github/copilot-instructions.md (github copilot)
//   .clinerules (cline), .aider.conf.yml (aider)
//   + user-configured custom paths via config.contextFiles
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, basename, dirname, relative, sep } from "node:path";

// primary files — always loaded first in this order
const PRIMARY_FILES = ["AGENTS.md", "claude.md", "CLAUDE.md"];

// patterns to auto-discover AI instruction files from root readdir
// catches .cursorrules, .windsurfrules, .clinerules, future *rules tools, etc.
const AUTO_DISCOVER_PATTERNS = [
  /rules$/i, // .cursorrules, .windsurfrules, .clinerules, etc.
  /instructions/i, // copilot-instructions.md, etc.
  /\.aider/i, // .aider.conf.yml, .aiderignore
  /^codex\.md$/i, // CODEX.md
  /^contributing\.md$/i, // CONTRIBUTING.md
];

// known nested paths to check (not discoverable via root readdir)
const NESTED_CONTEXT_PATHS = [
  ".github/copilot-instructions.md",
  ".cursor/rules",
];

const MAX_FILE_SIZE = 8_000; // truncate individual files to keep token budget sane
const MAX_DIR_BUDGET = 24_000; // total budget per directory load (global or per-session)
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

// discover AI instruction files in a directory via readdir + pattern matching.
// returns de-duped list: primary files first, then auto-discovered, then nested.
// de-dupes by device+inode to handle case-insensitive filesystems (macOS APFS)
// where claude.md and CLAUDE.md resolve to the same file.
export function discoverContextFiles(dir: string): string[] {
  if (!dir) return [];
  const found: string[] = [];
  const seenPaths = new Set<string>();
  const seenInodes = new Set<string>();

  const add = (filePath: string) => {
    const resolved = resolve(filePath);
    if (seenPaths.has(resolved)) return;
    // de-dupe by inode for case-insensitive filesystems (macOS APFS, Windows NTFS).
    // on case-sensitive systems (Linux ext4) different-case files have different inodes
    // so both are kept — which is correct.
    // guard: ino=0 on some network mounts / edge cases, fall back to path-only de-dupe.
    try {
      const stat = statSync(resolved);
      if (stat.ino > 0) {
        const inodeKey = `${stat.dev}:${stat.ino}`;
        if (seenInodes.has(inodeKey)) return;
        seenInodes.add(inodeKey);
      }
    } catch {
      // stat failed — still add by path to avoid silently dropping
    }
    seenPaths.add(resolved);
    found.push(filePath);
  };

  // 1. primary files — always checked first
  for (const name of PRIMARY_FILES) {
    const p = join(dir, name);
    if (existsSync(p) && isFile(p)) add(p);
  }

  // 2. auto-discover from root readdir
  const entries = safeReaddir(dir);
  for (const entry of entries) {
    if (AUTO_DISCOVER_PATTERNS.some((pat) => pat.test(entry))) {
      const p = join(dir, entry);
      if (isFile(p)) add(p);
    }
  }

  // 3. known nested paths
  for (const nested of NESTED_CONTEXT_PATHS) {
    const p = join(dir, nested);
    if (existsSync(p) && isFile(p)) add(p);
  }

  return found;
}

// load all context files from a directory, return combined string.
// auto-discovers AI instruction files, respects total budget.
export function loadContextFromDir(dir: string, extraFiles?: string[]): string {
  if (!dir) return "";
  const parts: string[] = [];
  let totalSize = 0;

  const files = discoverContextFiles(dir);

  // append user-configured extra files
  if (extraFiles) {
    for (const f of extraFiles) {
      const p = resolve(dir, f);
      if (existsSync(p) && isFile(p) && !files.includes(p)) {
        files.push(p);
      }
    }
  }

  for (const filePath of files) {
    if (totalSize >= MAX_DIR_BUDGET) break;
    const content = readContextFile(filePath);
    if (content) {
      // label with path relative to dir for readability (cross-platform)
      const rel = relative(dir, filePath);
      const label = rel && !rel.startsWith("..") ? rel.split(sep).join("/") : basename(filePath);
      parts.push(`--- ${label} ---`);
      parts.push(content);
      parts.push("");
      totalSize += content.length;
    }
  }

  // also check parent directory for primary context files (group-level)
  // this matches the AGENTS.md pattern: "Put claude.md in the group folder"
  const parentDir = resolve(dir, "..");
  if (parentDir !== resolve(dir)) {
    // collect inodes of files we already loaded to avoid dupes on case-insensitive FS
    const loadedInodes = new Set<string>();
    for (const f of files) {
      try {
        const s = statSync(resolve(f));
        if (s.ino > 0) loadedInodes.add(`${s.dev}:${s.ino}`);
      } catch { /* ignore */ }
    }

    for (const name of PRIMARY_FILES) {
      if (totalSize >= MAX_DIR_BUDGET) break;
      const parentPath = join(parentDir, name);
      if (!existsSync(parentPath) || !isFile(parentPath)) continue;
      // skip if same resolved path (dir is a root with no real parent)
      if (resolve(parentPath) === resolve(join(dir, name))) continue;
      // skip if same inode as something already loaded (case-insensitive FS)
      try {
        const s = statSync(resolve(parentPath));
        if (s.ino > 0 && loadedInodes.has(`${s.dev}:${s.ino}`)) continue;
        if (s.ino > 0) loadedInodes.add(`${s.dev}:${s.ino}`);
      } catch { /* ignore */ }
      const content = readContextFile(parentPath);
      if (content) {
        parts.push(`--- ../${name} (parent directory) ---`);
        parts.push(content);
        parts.push("");
        totalSize += content.length;
      }
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

// resolve a session's actual project directory.
// priority order:
//   1. explicit sessionDirs mapping (from config)
//   2. direct child: basePath/<title>
//   3. nested child: basePath/<group>/<title>
// returns the resolved path, or null if not found.
export function resolveProjectDir(
  basePath: string,
  sessionTitle: string,
  sessionDirs?: Record<string, string>,
): string | null {
  if (!basePath || !sessionTitle) return null;

  // 1. explicit mapping takes priority — no heuristics needed
  if (sessionDirs) {
    // try exact match first, then case-insensitive
    const explicit = sessionDirs[sessionTitle]
      ?? Object.entries(sessionDirs).find(
        ([k]) => k.toLowerCase() === sessionTitle.toLowerCase()
      )?.[1];
    if (explicit) {
      const resolved = resolve(basePath, explicit);
      if (isDir(resolved)) return resolved;
    }
  }

  // 2. heuristic search: normalize title and scan filesystem
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "-");
  const needle = normalize(sessionTitle);

  try {
    // direct children: basePath/<title>
    const topEntries = safeReaddir(basePath);
    for (const entry of topEntries) {
      if (normalize(entry) === needle) {
        const candidate = join(basePath, entry);
        if (isDir(candidate)) return candidate;
      }
    }

    // one level deeper: basePath/<group>/<title>
    // handles repos/github/adventure, repos/cc/cloudchamber, etc.
    for (const groupEntry of topEntries) {
      const groupDir = join(basePath, groupEntry);
      if (!isDir(groupDir)) continue;
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
//
// loads AGENTS.md + claude.md (primary) plus any other AI instruction files,
// then checks parent dir for group-level context.
//
// sessionDirs: explicit session title -> project directory mapping (from config).
// checked first before heuristic filesystem search.
export function loadSessionContext(
  sessionPath: string,
  sessionTitle?: string,
  extraFiles?: string[],
  sessionDirs?: Record<string, string>,
): string {
  if (!sessionPath) return "";

  // try to resolve the actual project directory from the title
  let projectDir: string | null = null;
  if (sessionTitle) {
    projectDir = resolveProjectDir(sessionPath, sessionTitle, sessionDirs);
  }

  if (projectDir) {
    // found the repo dir -- load context from it (includes parent/group-level)
    const context = loadContextFromDir(projectDir, extraFiles);
    if (context) return context;
  }

  // fallback: load from the session path directly
  const context = loadContextFromDir(sessionPath, extraFiles);
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

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// clear the cache (for testing)
export function clearContextCache(): void {
  cache.clear();
}
