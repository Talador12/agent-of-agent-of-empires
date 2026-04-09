// session-error-pattern-library.ts — curated regex patterns for common error types
// across 10+ languages and tools. classifies errors by severity, category, and
// language. provides actionable suggestions for each pattern match.
// zero dependencies.

/** error severity */
export type ErrorSeverity = "critical" | "error" | "warning" | "info";

/** error category */
export type ErrorCategory =
  | "syntax"
  | "runtime"
  | "type"
  | "import"
  | "permission"
  | "network"
  | "memory"
  | "build"
  | "test"
  | "config"
  | "dependency"
  | "timeout"
  | "assertion";

/** a pattern definition in the library */
export interface ErrorPattern {
  id: string;
  language: string;           // "typescript", "python", "rust", etc. or "general"
  category: ErrorCategory;
  severity: ErrorSeverity;
  regex: RegExp;
  description: string;
  suggestion: string;
}

/** a match found in session output */
export interface ErrorMatch {
  patternId: string;
  language: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  description: string;
  suggestion: string;
  matchedText: string;
  lineIndex: number;
}

/** scan result */
export interface ScanResult {
  matches: ErrorMatch[];
  bySeverity: Record<ErrorSeverity, number>;
  byCategory: Record<string, number>;
  byLanguage: Record<string, number>;
  linesScanned: number;
}

/** built-in error pattern library */
export const BUILTIN_PATTERNS: ErrorPattern[] = [
  // TypeScript / JavaScript
  { id: "ts-type-error", language: "typescript", category: "type", severity: "error", regex: /TS\d{4,5}:\s*error/i, description: "TypeScript type error", suggestion: "check type annotations and imports" },
  { id: "ts-cannot-find", language: "typescript", category: "import", severity: "error", regex: /Cannot find module ['"]([^'"]+)['"]/i, description: "Module not found", suggestion: "verify import path or install missing dependency" },
  { id: "js-reference-error", language: "javascript", category: "runtime", severity: "error", regex: /ReferenceError:\s*(\w+)\s+is not defined/i, description: "Undefined variable reference", suggestion: "check variable declaration scope" },
  { id: "js-syntax-error", language: "javascript", category: "syntax", severity: "error", regex: /SyntaxError:\s*(.+)/i, description: "JavaScript syntax error", suggestion: "check for missing brackets, semicolons, or invalid tokens" },
  { id: "js-type-error", language: "javascript", category: "type", severity: "error", regex: /TypeError:\s*(.+)/i, description: "Type error at runtime", suggestion: "check for null/undefined access or wrong argument types" },
  { id: "node-unhandled", language: "javascript", category: "runtime", severity: "critical", regex: /UnhandledPromiseRejection|unhandled rejection/i, description: "Unhandled promise rejection", suggestion: "add .catch() or try/catch around async calls" },

  // Python
  { id: "py-import-error", language: "python", category: "import", severity: "error", regex: /ImportError:\s*(.+)|ModuleNotFoundError:\s*(.+)/i, description: "Python import error", suggestion: "install missing package or check import path" },
  { id: "py-syntax-error", language: "python", category: "syntax", severity: "error", regex: /SyntaxError:\s*(.+)/i, description: "Python syntax error", suggestion: "check indentation, colons, and parentheses" },
  { id: "py-type-error", language: "python", category: "type", severity: "error", regex: /TypeError:\s*(.+)/i, description: "Python type error", suggestion: "verify argument types and counts" },
  { id: "py-name-error", language: "python", category: "runtime", severity: "error", regex: /NameError:\s*name '(\w+)' is not defined/i, description: "Undefined name", suggestion: "check variable/function spelling and scope" },

  // Rust
  { id: "rust-compile-error", language: "rust", category: "build", severity: "error", regex: /error\[E\d{4}\]:/i, description: "Rust compiler error", suggestion: "follow the compiler suggestion in the error message" },
  { id: "rust-borrow", language: "rust", category: "type", severity: "error", regex: /cannot borrow .+ as (mutable|immutable)/i, description: "Rust borrow checker error", suggestion: "restructure ownership or use clone/Rc/RefCell" },
  { id: "rust-lifetime", language: "rust", category: "type", severity: "error", regex: /lifetime .+ required|borrowed value does not live long enough/i, description: "Rust lifetime error", suggestion: "add explicit lifetime annotations or restructure references" },

  // Go
  { id: "go-compile-error", language: "go", category: "build", severity: "error", regex: /\.go:\d+:\d+:\s*(.+)/i, description: "Go compile error", suggestion: "fix the error at the specified file:line:col" },
  { id: "go-unused", language: "go", category: "build", severity: "warning", regex: /\w+ declared and not used/i, description: "Go unused variable", suggestion: "remove unused variable or use _ blank identifier" },

  // General / multi-language
  { id: "gen-oom", language: "general", category: "memory", severity: "critical", regex: /out of memory|OOMKilled|heap out of memory|JavaScript heap/i, description: "Out of memory", suggestion: "increase memory limit or investigate memory leak" },
  { id: "gen-segfault", language: "general", category: "memory", severity: "critical", regex: /segmentation fault|SIGSEGV|signal 11/i, description: "Segmentation fault", suggestion: "debug with address sanitizer or valgrind" },
  { id: "gen-permission", language: "general", category: "permission", severity: "error", regex: /permission denied|EACCES|EPERM/i, description: "Permission denied", suggestion: "check file permissions or run with appropriate privileges" },
  { id: "gen-network", language: "general", category: "network", severity: "error", regex: /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|connection refused/i, description: "Network connection error", suggestion: "verify the target service is running and reachable" },
  { id: "gen-timeout", language: "general", category: "timeout", severity: "warning", regex: /timeout|timed out|deadline exceeded/i, description: "Operation timeout", suggestion: "increase timeout or investigate slow dependency" },
  { id: "gen-test-fail", language: "general", category: "test", severity: "error", regex: /FAIL|test failed|tests? failing|\d+ failing/i, description: "Test failure", suggestion: "review test output for assertion details" },
  { id: "gen-assertion", language: "general", category: "assertion", severity: "error", regex: /AssertionError|assertion failed|expected .+ (to equal|to be|but got)/i, description: "Assertion failure", suggestion: "check expected vs actual values in the test" },
  { id: "gen-dep-conflict", language: "general", category: "dependency", severity: "warning", regex: /peer dep|conflicting peer|dependency conflict|version mismatch/i, description: "Dependency version conflict", suggestion: "update dependencies or use overrides/resolutions" },
  { id: "gen-config-error", language: "general", category: "config", severity: "error", regex: /invalid config|configuration error|missing required/i, description: "Configuration error", suggestion: "review config file against documentation" },

  // Build tools
  { id: "npm-err", language: "javascript", category: "dependency", severity: "error", regex: /npm ERR!|npm error/i, description: "npm error", suggestion: "check npm error output and try npm install" },
  { id: "cargo-err", language: "rust", category: "build", severity: "error", regex: /error: could not compile/i, description: "Cargo build failure", suggestion: "fix compiler errors above this line" },
  { id: "pip-err", language: "python", category: "dependency", severity: "error", regex: /pip.*error|Could not find a version/i, description: "pip install error", suggestion: "check package name and Python version compatibility" },
];

/** scan output lines for error patterns */
export function scanForErrors(
  lines: string[],
  patterns: ErrorPattern[] = BUILTIN_PATTERNS,
): ScanResult {
  const matches: ErrorMatch[] = [];
  const bySeverity: Record<ErrorSeverity, number> = { critical: 0, error: 0, warning: 0, info: 0 };
  const byCategory: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      const m = pattern.regex.exec(line);
      if (m) {
        matches.push({
          patternId: pattern.id,
          language: pattern.language,
          category: pattern.category,
          severity: pattern.severity,
          description: pattern.description,
          suggestion: pattern.suggestion,
          matchedText: m[0],
          lineIndex: i,
        });
        bySeverity[pattern.severity]++;
        byCategory[pattern.category] = (byCategory[pattern.category] ?? 0) + 1;
        byLanguage[pattern.language] = (byLanguage[pattern.language] ?? 0) + 1;
        break; // one match per line (most specific wins since patterns are ordered)
      }
    }
  }

  return { matches, bySeverity, byCategory, byLanguage, linesScanned: lines.length };
}

/** get patterns for a specific language */
export function patternsForLanguage(language: string, patterns: ErrorPattern[] = BUILTIN_PATTERNS): ErrorPattern[] {
  return patterns.filter((p) => p.language === language || p.language === "general");
}

/** list all supported languages */
export function supportedLanguages(patterns: ErrorPattern[] = BUILTIN_PATTERNS): string[] {
  return [...new Set(patterns.map((p) => p.language))].filter((l) => l !== "general").sort();
}

/** format scan result for TUI display */
export function formatErrorScan(result: ScanResult): string[] {
  const lines: string[] = [];
  const total = result.matches.length;
  lines.push(`error scan: ${total} matches across ${result.linesScanned} lines`);

  if (total === 0) {
    lines.push("  no known error patterns detected");
    return lines;
  }

  // severity summary
  const sev = result.bySeverity;
  lines.push(`  severity: ${sev.critical} critical, ${sev.error} error, ${sev.warning} warning, ${sev.info} info`);

  // category breakdown
  const cats = Object.entries(result.byCategory).sort((a, b) => b[1] - a[1]);
  lines.push(`  categories: ${cats.map(([c, n]) => `${c}(${n})`).join(", ")}`);

  // language breakdown
  const langs = Object.entries(result.byLanguage).sort((a, b) => b[1] - a[1]);
  lines.push(`  languages: ${langs.map(([l, n]) => `${l}(${n})`).join(", ")}`);

  // top matches with suggestions
  const top = result.matches.slice(0, 5);
  lines.push("  top matches:");
  for (const m of top) {
    lines.push(`    line ${m.lineIndex + 1}: [${m.severity}] ${m.description}`);
    lines.push(`      → ${m.suggestion}`);
  }

  return lines;
}
