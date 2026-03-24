// shared ANSI color constants — single source of truth for all CLI output
// basic 16-color
export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";
export const WHITE = "\x1b[37m";

// 256-color palette — tasteful accents for the TUI
export const INDIGO  = "\x1b[38;5;105m";   // muted purple-blue for branding
export const TEAL    = "\x1b[38;5;73m";    // cool blue-green for info
export const AMBER   = "\x1b[38;5;214m";   // warm orange for warnings/active
export const SLATE   = "\x1b[38;5;245m";   // neutral gray for secondary text
export const ROSE    = "\x1b[38;5;204m";   // soft red for errors
export const LIME    = "\x1b[38;5;114m";   // fresh green for success/working
export const SKY     = "\x1b[38;5;117m";   // light blue for reasoning
export const PURPLE  = "\x1b[38;5;141m";   // violet for special highlights
export const ORANGE  = "\x1b[38;5;208m";   // bright orange for warnings
export const PINK    = "\x1b[38;5;213m";   // hot pink for high-signal events
export const GOLD    = "\x1b[38;5;220m";   // gold for completed/done
export const SILVER  = "\x1b[38;5;250m";   // light gray for borders/structural
export const STEEL   = "\x1b[38;5;240m";   // dark gray for dim structural elements

// background variants (256-color)
export const BG_DARK    = "\x1b[48;5;235m";   // header bar (very dark)
export const BG_HEADER2 = "\x1b[48;5;237m";   // secondary header sections
export const BG_HOVER   = "\x1b[48;5;238m";   // hover highlight
export const BG_INPUT   = "\x1b[48;5;234m";   // input box background
export const BG_SECTION = "\x1b[48;5;236m";   // section panel background

// bright foreground on dark background (for section labels in colored boxes)
export const BG_INDIGO  = "\x1b[48;5;62m";    // indigo bg for brand pill
export const BG_SKY     = "\x1b[48;5;67m";    // sky bg for reasoning pill
export const BG_LIME    = "\x1b[48;5;71m";    // lime bg for working pill
export const BG_ROSE    = "\x1b[48;5;160m";   // rose bg for error pill
export const BG_AMBER   = "\x1b[48;5;172m";   // amber bg for warning pill
export const BG_TEAL    = "\x1b[48;5;30m";    // teal bg for info pill

// box-drawing characters — Unicode block elements
export const BOX = {
  tl: "┌", tr: "┐", bl: "└", br: "┘",
  h: "─", v: "│",
  ltee: "├", rtee: "┤", ttee: "┬", btee: "┴", cross: "┼",
  // rounded corners (softer look)
  rtl: "╭", rtr: "╮", rbl: "╰", rbr: "╯",
  // double-line (for section headers)
  dh: "═", dv: "║",
  dtl: "╔", dtr: "╗", dbl: "╚", dbr: "╝",
  // mixed (double-horizontal, single-vertical tees)
  dltee: "╠", drtee: "╣",
} as const;

// braille spinner frames for phase animation
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

// bouncing progress bar frames (blue tip sweeping over grey blocks)
export const PROGRESS_BLOCKS = 12; // width of the progress bar in chars
export const PROGRESS_IDLE = "\x1b[38;5;240m"; // grey for idle blocks ░
export const PROGRESS_TIP  = "\x1b[38;5;75m";  // bright blue for active tip ▓

// status dots — filled circle variants
export const DOT = { filled: "●", hollow: "○", half: "◐" } as const;

// section label glyphs
export const GLYPH = {
  agent:    "◈",  // agents panel
  activity: "◉",  // activity log
  input:    "▸",  // input prompt
  thinking: "⟳",  // reasoning in progress
  clock:    "◷",  // countdown
  check:    "✓",  // done/ok
  cross:    "✗",  // error
  arrow:    "→",  // action
  bullet:   "•",  // generic
  pipe:     "┃",  // vertical gutter bar (colored per tag)
} as const;
