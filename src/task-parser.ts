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

// ── Background progress digestion ───────────────────────────────────────────
// Parse significant milestones from tmux pane output so task progress
// updates automatically without the reasoner needing to emit report_progress.

export type MilestoneType = "commit" | "test" | "build" | "version" | "push";

export interface PaneMilestone {
  type: MilestoneType;
  summary: string;
}

/**
 * Scan pane output lines for milestone events.
 * Designed to run on the *new* lines since last poll (diff),
 * not the full capture buffer — keeps it fast and avoids duplicates.
 * Returns milestones in the order they appear.
 */
export function parsePaneMilestones(lines: readonly string[]): PaneMilestone[] {
  const milestones: PaneMilestone[] = [];

  for (const raw of lines) {
    // strip ANSI escape codes for matching
    const line = raw.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").trim();
    if (!line) continue;

    // ── git commit ──────────────────────────────────────────────────────
    // "[main abc1234] some commit message" or "[branchname hash] message"
    const commitMatch = line.match(/^\[(\S+)\s+([a-f0-9]{7,})\]\s+(.+)$/);
    if (commitMatch) {
      const msg = commitMatch[3].slice(0, 80);
      milestones.push({ type: "commit", summary: `${commitMatch[1]} ${commitMatch[2].slice(0, 7)}: ${msg}` });
      continue;
    }

    // ── git push ────────────────────────────────────────────────────────
    // "   abc1234..def5678  main -> main" (git push output)
    const pushMatch = line.match(/^\s*[a-f0-9]+\.\.[a-f0-9]+\s+(\S+)\s*->\s*(\S+)/);
    if (pushMatch) {
      milestones.push({ type: "push", summary: `pushed ${pushMatch[1]} → ${pushMatch[2]}` });
      continue;
    }

    // ── test results (node:test style) ──────────────────────────────────
    // "ℹ tests 2287"  "ℹ pass 2287"  "ℹ fail 0"
    const nodeTestMatch = line.match(/^ℹ\s+tests\s+(\d+)/);
    if (nodeTestMatch) {
      milestones.push({ type: "test", summary: `${nodeTestMatch[1]} tests ran` });
      continue;
    }
    // "Tests:  104 passed, 104 total" (jest style)
    const jestMatch = line.match(/Tests:\s*(\d+)\s+passed,?\s*(\d+)\s+total/i);
    if (jestMatch) {
      milestones.push({ type: "test", summary: `${jestMatch[1]}/${jestMatch[2]} tests passed` });
      continue;
    }
    // "✔ N tests passed" or "N passing"
    const passMatch = line.match(/(\d+)\s+(?:tests?\s+)?pass(?:ed|ing)/i);
    if (passMatch && !line.match(/^ℹ/)) {
      milestones.push({ type: "test", summary: `${passMatch[1]} tests passed` });
      continue;
    }

    // ── version bump ────────────────────────────────────────────────────
    // "v0.168.0" as standalone or "npm version" output
    const versionMatch = line.match(/^v(\d+\.\d+\.\d+)$/);
    if (versionMatch) {
      milestones.push({ type: "version", summary: `version ${versionMatch[0]}` });
      continue;
    }

    // ── build success ───────────────────────────────────────────────────
    // tsc with no errors outputs nothing; npm run build echoes the command then blank
    // Look for "Build completed" or webpack/vite done
    if (/build\s+(?:completed|succeeded|done)/i.test(line)) {
      milestones.push({ type: "build", summary: "build completed" });
      continue;
    }
    // vite: "✓ built in Ns"
    if (/^✓\s+built\s+in/i.test(line)) {
      milestones.push({ type: "build", summary: line.slice(0, 60) });
      continue;
    }
  }

  return milestones;
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
