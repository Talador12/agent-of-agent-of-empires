// task-parser.ts -- extract OpenCode/Claude TODO patterns from tmux pane output
// OpenCode renders todos in the right sidebar like:
//   [✓] completed task text
//   [•] in progress task text
//   [ ] pending task text
//   [✗] failed/cancelled task
// Also handles plain markdown-style checkboxes:
//   - [x] done
//   - [ ] not done

export interface ParsedTask {
  text: string;
  status: "done" | "in_progress" | "pending" | "failed";
}

// parse TODO items from tmux captured output
export function parseTasks(output: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // OpenCode-style: [✓] text, [•] text, [ ] text, [✗] text
    const ocMatch = trimmed.match(/^\[([✓✗•\s])\]\s+(.+)$/);
    if (ocMatch) {
      const [, icon, text] = ocMatch;
      let status: ParsedTask["status"];
      if (icon === "✓") status = "done";
      else if (icon === "•") status = "in_progress";
      else if (icon === "✗") status = "failed";
      else status = "pending";
      tasks.push({ text: text.trim(), status });
      continue;
    }

    // markdown checkbox: - [x] text, - [ ] text, - [~] text
    const mdMatch = trimmed.match(/^[-*]\s+\[([xX~\s])\]\s+(.+)$/);
    if (mdMatch) {
      const [, icon, text] = mdMatch;
      let status: ParsedTask["status"];
      if (icon === "x" || icon === "X") status = "done";
      else if (icon === "~") status = "in_progress";
      else status = "pending";
      tasks.push({ text: text.trim(), status });
      continue;
    }
  }

  return tasks;
}

// extract model name from OpenCode pane output
export function parseModel(output: string): string | undefined {
  // matches lines like: "  Build  Claude Opus 4.6 Anthropic: Cloudflare AI Gateway · max"
  const match = output.match(/(?:Build|Plan)\s+(Claude\s+\S+\s+[\d.]+|GPT-[\w.-]+|Gemini\s+[\w.-]+)/i);
  return match?.[1];
}

// extract context info from OpenCode pane output
export function parseContext(output: string): string | undefined {
  // matches "137,918 / 200,000 tokens" or plain "137,918 tokens"
  const full = output.match(/([\d,]+)\s*\/\s*([\d,]+)\s+tokens/);
  if (full?.[1] && full[2]) return `${full[1]} / ${full[2]} tokens`;
  const simple = output.match(/([\d,]+)\s+tokens/);
  return simple?.[1] ? `${simple[1]} tokens` : undefined;
}

// extract cost from OpenCode pane output
export function parseCost(output: string): string | undefined {
  // matches "$3.42 spent"
  const match = output.match(/\$([\d.]+)\s+spent/);
  return match ? `$${match[1]}` : undefined;
}

// get last meaningful line (non-empty, not just UI chrome)
export function parseLastLine(output: string): string {
  const lines = output.split("\n");
  // skip from bottom: empty lines, tmux chrome, opencode status bar
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    // skip opencode UI chrome lines
    if (trimmed.startsWith("⬝") || trimmed.startsWith("╹") || trimmed.startsWith("▀")) continue;
    if (trimmed.includes("esc interrupt") || trimmed.includes("ctrl+p commands")) continue;
    if (trimmed.includes("OpenCode ")) continue;
    if (trimmed.match(/^\s*[┃┃╹╻│]\s*$/)) continue;
    // skip blank-looking lines with only box-drawing chars
    if (trimmed.match(/^[┃│╹╻▀▄█\s]+$/)) continue;
    return trimmed.length > 100 ? trimmed.slice(0, 97) + "..." : trimmed;
  }
  return "(no output)";
}

// format a task list for display
export function formatTaskList(tasks: ParsedTask[]): string {
  if (tasks.length === 0) return "  (no tasks detected)";
  return tasks.map((t) => {
    const icon = t.status === "done" ? "✓"
      : t.status === "in_progress" ? "•"
      : t.status === "failed" ? "✗"
      : "○";
    return `  [${icon}] ${t.text}`;
  }).join("\n");
}
