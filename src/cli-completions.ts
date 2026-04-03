// cli-completions.ts — shell autocomplete for all aoaoe commands and TUI slash commands.
// generates completion scripts for bash, zsh, and fish.

export const CLI_COMMANDS = [
  "init", "tasks", "progress", "health", "summary", "supervisor",
  "incident", "runbook", "adopt", "doctor", "stats", "replay",
  "export", "tail", "web", "sync", "test-context",
  "task", "config",
] as const;

export const CLI_FLAGS = [
  "--config", "--verbose", "--dry-run", "--observe", "--confirm",
  "--json", "--ndjson", "--watch", "--changes-only", "--heartbeat", "--follow",
  "--help", "--version",
] as const;

export const TUI_COMMANDS = [
  "/supervisor", "/incident", "/runbook", "/progress", "/health",
  "/prompt-template", "/pin-save", "/pin-load", "/pin-presets",
  "/activity", "/conflicts", "/heatmap", "/audit", "/audit-stats",
  "/audit-search", "/fleet-snap", "/budget-predict", "/retries",
  "/fleet-forecast", "/priority", "/escalations", "/poll-status",
  "/drift", "/goal-progress", "/pool", "/reasoner-cost",
  "/anomaly", "/sla", "/velocity", "/schedule", "/cost-summary",
  "/session-report", "/cache", "/rate-limit", "/recovery",
  "/lifecycle", "/cost-report", "/decompose", "/memory",
  "/dep-graph", "/approvals", "/approve", "/reject", "/fleet-diff",
  "/template", "/difficulty", "/smart-nudge", "/utilization",
  "/detect-template", "/fleet-search", "/nudge-stats", "/allocation",
  "/graduation", "/refine", "/export", "/clear",
] as const;

/**
 * Generate bash completion script.
 */
export function generateBashCompletion(): string {
  const cmds = CLI_COMMANDS.join(" ");
  const flags = CLI_FLAGS.join(" ");
  return `# aoaoe bash completion
# Add to ~/.bashrc: eval "$(aoaoe completions bash)"
_aoaoe() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  
  if [[ "\${cur}" == --* ]]; then
    COMPREPLY=($(compgen -W "${flags}" -- "\${cur}"))
  elif [[ "\${COMP_CWORD}" -eq 1 ]]; then
    COMPREPLY=($(compgen -W "${cmds}" -- "\${cur}"))
  fi
}
complete -F _aoaoe aoaoe
`;
}

/**
 * Generate zsh completion script.
 */
export function generateZshCompletion(): string {
  const cmdList = CLI_COMMANDS.map((c) => `'${c}'`).join(" ");
  const flagList = CLI_FLAGS.map((f) => `'${f}'`).join(" ");
  return `# aoaoe zsh completion
# Add to ~/.zshrc: eval "$(aoaoe completions zsh)"
_aoaoe() {
  local -a commands flags
  commands=(${cmdList})
  flags=(${flagList})
  
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  elif [[ "\${words[CURRENT]}" == --* ]]; then
    _describe 'flag' flags
  fi
}
compdef _aoaoe aoaoe
`;
}

/**
 * Generate fish completion script.
 */
export function generateFishCompletion(): string {
  const lines = [
    "# aoaoe fish completion",
    "# Add to ~/.config/fish/completions/aoaoe.fish",
  ];
  for (const cmd of CLI_COMMANDS) {
    lines.push(`complete -c aoaoe -n '__fish_use_subcommand' -a '${cmd}'`);
  }
  for (const flag of CLI_FLAGS) {
    lines.push(`complete -c aoaoe -l '${flag.replace(/^--/, "")}'`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Generate completion script for the specified shell.
 */
export function generateCompletion(shell: "bash" | "zsh" | "fish"): string {
  switch (shell) {
    case "bash": return generateBashCompletion();
    case "zsh": return generateZshCompletion();
    case "fish": return generateFishCompletion();
  }
}

/**
 * List all available commands for help display.
 */
export function formatCommandList(): string[] {
  const lines: string[] = [];
  lines.push(`  CLI commands (${CLI_COMMANDS.length}):`);
  lines.push(`    ${CLI_COMMANDS.join(", ")}`);
  lines.push("");
  lines.push(`  TUI slash commands (${TUI_COMMANDS.length}):`);
  // group in rows of 6
  for (let i = 0; i < TUI_COMMANDS.length; i += 6) {
    lines.push(`    ${TUI_COMMANDS.slice(i, i + 6).join("  ")}`);
  }
  return lines;
}
