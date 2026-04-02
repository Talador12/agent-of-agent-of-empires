// conflict-detector.ts — detect when two sessions are editing the same files.
// parses tmux pane output for file paths that appear in edit/write operations
// and flags overlaps between sessions.

export interface FileEdit {
  sessionTitle: string;
  sessionId: string;
  filePath: string;
  detectedAt: number;
}

export interface Conflict {
  filePath: string;
  sessions: Array<{ title: string; id: string }>;
  detectedAt: number;
}

// patterns that indicate a file is being edited
const EDIT_PATTERNS = [
  // opencode / claude-code tool output
  /(?:Edit|Write|Create|Update|Modify)\s+(?:file:?\s*)?[`"']?([^\s`"']+\.[a-zA-Z0-9]+)/i,
  // git diff header
  /^(?:diff --git\s+a\/|---\s+a\/|\+\+\+\s+b\/)(.+)/,
  // sed/awk in-place
  /(?:sed|awk)\s+.*-i\s+.*?([^\s]+\.[a-zA-Z0-9]+)/,
  // generic file creation/modification
  /(?:writing|wrote|saved|created|modified|editing)\s+[`"']?([^\s`"']+\.[a-zA-Z0-9]+)/i,
  // tool use output: "Edit src/foo.ts"
  /^(?:Read|Edit|Write|Glob|Grep)\s+([^\s]+\.[a-zA-Z0-9]+)/,
];

// file extensions that are likely code files (not build artifacts, logs, etc.)
const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "rb", "php",
  "c", "cpp", "h", "hpp", "cs", "swift", "kt", "scala",
  "css", "scss", "less", "html", "vue", "svelte",
  "json", "yaml", "yml", "toml", "md", "txt",
  "sh", "bash", "zsh", "fish",
  "sql", "graphql", "proto",
  "dockerfile", "makefile",
]);

/**
 * Extract file paths being edited from tmux pane output lines.
 * Returns unique file paths found in the output.
 */
export function extractEditedFiles(lines: readonly string[]): string[] {
  const files = new Set<string>();

  for (const raw of lines) {
    const line = raw.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").trim();
    if (!line) continue;

    for (const pattern of EDIT_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const filePath = match[1].replace(/[`"',;:]+$/, ""); // strip trailing punctuation
        // filter: must have a code-like extension
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        if (CODE_EXTENSIONS.has(ext)) {
          // normalize: strip leading ./ or a/ b/ (from git diff)
          const normalized = filePath.replace(/^(?:\.\/)/, "");
          files.add(normalized);
        }
      }
    }
  }

  return [...files];
}

/**
 * Track file edits across sessions and detect conflicts.
 * Maintains a sliding window of recent edits to avoid stale detections.
 */
export class ConflictDetector {
  private edits: FileEdit[] = [];
  private windowMs: number;

  constructor(windowMs = 10 * 60 * 1000) { // 10-minute window
    this.windowMs = windowMs;
  }

  /** Record file edits for a session from its new output lines. */
  recordEdits(sessionTitle: string, sessionId: string, newLines: readonly string[], now = Date.now()): void {
    const files = extractEditedFiles(newLines);
    for (const filePath of files) {
      this.edits.push({ sessionTitle, sessionId, filePath, detectedAt: now });
    }
    this.prune(now);
  }

  /** Find files being edited by multiple sessions within the time window. */
  detectConflicts(now = Date.now()): Conflict[] {
    this.prune(now);

    // group edits by file path
    const byFile = new Map<string, Map<string, { title: string; id: string }>>();
    for (const edit of this.edits) {
      if (!byFile.has(edit.filePath)) byFile.set(edit.filePath, new Map());
      byFile.get(edit.filePath)!.set(edit.sessionId, { title: edit.sessionTitle, id: edit.sessionId });
    }

    // find files with edits from multiple sessions
    const conflicts: Conflict[] = [];
    for (const [filePath, sessions] of byFile) {
      if (sessions.size >= 2) {
        conflicts.push({
          filePath,
          sessions: [...sessions.values()],
          detectedAt: now,
        });
      }
    }

    return conflicts;
  }

  /** Format conflicts for display. */
  formatConflicts(conflicts: Conflict[]): string[] {
    if (conflicts.length === 0) return [];
    const lines: string[] = [];
    lines.push(`⚠ FILE CONFLICTS (${conflicts.length}):`);
    for (const c of conflicts) {
      const sessionNames = c.sessions.map((s) => `"${s.title}"`).join(", ");
      lines.push(`  ${c.filePath} — edited by ${sessionNames}`);
    }
    return lines;
  }

  /** Get the current edit count (for testing). */
  get editCount(): number {
    return this.edits.length;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.edits = this.edits.filter((e) => e.detectedAt >= cutoff);
  }
}
