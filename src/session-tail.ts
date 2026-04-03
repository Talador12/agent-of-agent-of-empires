// session-tail.ts — live tail of any session's output from the TUI.
// provides a filtered view of a specific session's recent output lines
// with optional pattern highlighting.

export interface TailOptions {
  sessionTitle: string;
  lineCount: number;    // how many recent lines to show (default: 30)
  highlightPattern?: string; // optional regex to highlight matches
  stripAnsi: boolean;
}

const DEFAULT_OPTIONS: Partial<TailOptions> = {
  lineCount: 30,
  stripAnsi: true,
};

/**
 * Extract the last N lines from session output, optionally highlighting matches.
 */
export function tailSession(
  output: string[],
  options: Partial<TailOptions> & { sessionTitle: string },
): string[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lines = output.slice(-opts.lineCount!);

  if (opts.stripAnsi) {
    lines = lines.map((l) => l.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, ""));
  }

  if (opts.highlightPattern) {
    try {
      const regex = new RegExp(opts.highlightPattern, "gi");
      lines = lines.map((l) => l.replace(regex, (match) => `>>>${match}<<<`));
    } catch { /* invalid regex, skip highlighting */ }
  }

  return lines;
}

/**
 * Format tail output for TUI display.
 */
export function formatTail(sessionTitle: string, lines: string[], total: number): string[] {
  const header = `  tail: "${sessionTitle}" (last ${lines.length} of ${total} lines)`;
  const sep = "  " + "─".repeat(70);
  return [header, sep, ...lines.map((l) => `  ${l}`), sep];
}

/**
 * Parse tail command arguments.
 * Format: /tail <session> [count] [pattern]
 */
export function parseTailArgs(args: string): Partial<TailOptions> & { sessionTitle: string } {
  const parts = args.split(/\s+/);
  const sessionTitle = parts[0];
  let lineCount = 30;
  let highlightPattern: string | undefined;

  for (let i = 1; i < parts.length; i++) {
    const num = parseInt(parts[i], 10);
    if (!isNaN(num) && num > 0) lineCount = num;
    else highlightPattern = parts[i];
  }

  return { sessionTitle, lineCount, highlightPattern };
}
