// session-clipboard.ts — copy output snippets to system clipboard.
// provides a cross-platform clipboard write function and a TUI command
// that captures the last N lines from a session for pasting elsewhere.

export interface ClipboardResult {
  success: boolean;
  lineCount: number;
  charCount: number;
  content: string;
  method: "pbcopy" | "xclip" | "xsel" | "wl-copy" | "powershell" | "fallback";
}

/**
 * Detect the appropriate clipboard command for the current platform.
 */
export function detectClipboardMethod(): ClipboardResult["method"] {
  const platform = typeof process !== "undefined" ? process.platform : "linux";
  if (platform === "darwin") return "pbcopy";
  if (platform === "win32") return "powershell";
  // Linux: prefer wl-copy (Wayland) > xclip > xsel
  if (process.env.WAYLAND_DISPLAY) return "wl-copy";
  return "xclip";
}

/**
 * Build the clipboard command for a given method.
 */
export function buildClipboardCommand(method: ClipboardResult["method"]): string {
  switch (method) {
    case "pbcopy": return "pbcopy";
    case "xclip": return "xclip -selection clipboard";
    case "xsel": return "xsel --clipboard --input";
    case "wl-copy": return "wl-copy";
    case "powershell": return "powershell.exe -command Set-Clipboard -Value $input";
    default: return "cat > /dev/null"; // fallback — discard
  }
}

/**
 * Prepare output lines for clipboard (strip ANSI, trim).
 */
export function prepareForClipboard(lines: string[], maxLines = 50): string {
  return lines
    .slice(-maxLines)
    .map((l) => l.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, ""))
    .join("\n");
}

/**
 * Build a clipboard result (does not actually write — caller does I/O).
 */
export function buildClipboardResult(lines: string[], maxLines = 50): ClipboardResult {
  const content = prepareForClipboard(lines, maxLines);
  return {
    success: true,
    lineCount: Math.min(lines.length, maxLines),
    charCount: content.length,
    content,
    method: detectClipboardMethod(),
  };
}

/**
 * Format clipboard result for TUI display.
 */
export function formatClipboardResult(result: ClipboardResult): string[] {
  const lines: string[] = [];
  if (result.success) {
    lines.push(`  Clipboard: ${result.lineCount} lines (${result.charCount} chars) via ${result.method}`);
    // show preview
    const preview = result.content.split("\n").slice(0, 3);
    for (const l of preview) lines.push(`    ${l.slice(0, 60)}`);
    if (result.lineCount > 3) lines.push(`    ... ${result.lineCount - 3} more lines`);
  } else {
    lines.push("  Clipboard: failed to copy");
  }
  return lines;
}
