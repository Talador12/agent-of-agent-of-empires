// shared ANSI color constants — single source of truth for all CLI output
// basic 16-color
export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const ITALIC = "\x1b[3m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";
export const WHITE = "\x1b[37m";

// 256-color palette — tasteful accents for the TUI
// use sparingly: these are highlights, not defaults
export const INDIGO = "\x1b[38;5;105m";    // muted purple-blue for branding
export const TEAL = "\x1b[38;5;73m";       // cool blue-green for info
export const AMBER = "\x1b[38;5;214m";     // warm orange for warnings/active
export const SLATE = "\x1b[38;5;245m";     // neutral gray for secondary text
export const ROSE = "\x1b[38;5;204m";      // soft red for errors
export const LIME = "\x1b[38;5;114m";      // fresh green for success/working
export const SKY = "\x1b[38;5;117m";       // light blue for reasoning

// background variants (256-color)
export const BG_DARK = "\x1b[48;5;236m";      // dark gray for header bar
export const BG_DARKER = "\x1b[48;5;234m";    // near-black for contrast panels
export const BG_PANEL = "\x1b[48;5;237m";     // subtle panel background
export const BG_HIGHLIGHT = "\x1b[48;5;238m"; // highlight row

// box-drawing characters — Unicode block elements
export const BOX = {
  tl: "┌", tr: "┐", bl: "└", br: "┘",
  h: "─", v: "│",
  ltee: "├", rtee: "┤", ttee: "┬", btee: "┴", cross: "┼",
  // rounded corners (softer look)
  rtl: "╭", rtr: "╮", rbl: "╰", rbr: "╯",
} as const;

// braille spinner frames for phase animation
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

// status dots — filled circle variants
export const DOT = { filled: "●", hollow: "○", half: "◐" } as const;
