// session-lang-detector.ts — detect programming language from output
// patterns. matches file extensions, compiler/tool names, framework
// mentions, and syntax patterns to classify what a session is working on.

export interface LangDetection {
  language: string;
  confidence: number; // 0-100
  signals: string[];
}

const LANG_PATTERNS: Array<{ lang: string; patterns: RegExp[]; label: string }> = [
  { lang: "TypeScript", patterns: [/\.tsx?[\s:]/i, /tsc\b/i, /typescript/i, /node:test/i], label: "TS files/compiler" },
  { lang: "JavaScript", patterns: [/\.jsx?[\s:]/i, /node\b.*\.js/i, /npm\s+(?:run|test|install)/i], label: "JS files/npm" },
  { lang: "Python", patterns: [/\.py[\s:]/i, /python3?\b/i, /pip\s+install/i, /pytest/i, /import\s+\w+/i], label: "Python files/tools" },
  { lang: "Rust", patterns: [/\.rs[\s:]/i, /cargo\s+(?:build|test|run)/i, /rustc/i, /fn\s+main/i], label: "Rust files/cargo" },
  { lang: "Go", patterns: [/\.go[\s:]/i, /go\s+(?:build|test|run|mod)/i, /func\s+(?:main|Test)/i], label: "Go files/tools" },
  { lang: "Java", patterns: [/\.java[\s:]/i, /javac\b/i, /gradle\b/i, /maven\b/i, /mvn\b/i], label: "Java files/build" },
  { lang: "C/C++", patterns: [/\.[ch]pp?[\s:]/i, /gcc\b|g\+\+\b|clang\b/i, /cmake\b|make\b/i], label: "C/C++ files/compiler" },
  { lang: "Ruby", patterns: [/\.rb[\s:]/i, /ruby\b/i, /bundle\b/i, /rails\b/i, /rspec/i], label: "Ruby files/tools" },
  { lang: "Shell", patterns: [/\.sh[\s:]/i, /bash\b|zsh\b/i, /#!/i], label: "Shell scripts" },
  { lang: "SQL", patterns: [/\.sql[\s:]/i, /SELECT\s+\w+\s+FROM/i, /CREATE\s+TABLE/i, /INSERT\s+INTO/i], label: "SQL statements" },
];

/**
 * Detect programming language from session output.
 */
export function detectLanguage(output: string): LangDetection[] {
  const lines = output.split("\n").slice(-50);
  const text = lines.join("\n");
  const detections: LangDetection[] = [];

  for (const lp of LANG_PATTERNS) {
    let matchCount = 0;
    const signals: string[] = [];
    for (const pattern of lp.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        matchCount++;
        signals.push(lp.label);
      }
    }
    if (matchCount > 0) {
      const confidence = Math.min(95, 30 + matchCount * 20);
      detections.push({ language: lp.lang, confidence, signals: [...new Set(signals)] });
    }
  }

  return detections.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get the primary detected language (highest confidence).
 */
export function primaryLanguage(output: string): string | null {
  const detections = detectLanguage(output);
  return detections.length > 0 ? detections[0].language : null;
}

/**
 * Detect languages for multiple sessions.
 */
export function detectFleetLanguages(sessions: Array<{ title: string; output: string }>): Array<{ title: string; languages: LangDetection[] }> {
  return sessions.map((s) => ({ title: s.title, languages: detectLanguage(s.output) }));
}

/**
 * Format language detection for TUI display.
 */
export function formatLangDetection(sessions: Array<{ title: string; languages: LangDetection[] }>): string[] {
  if (sessions.length === 0) return ["  Language detection: no sessions to analyze"];
  const lines: string[] = [];
  lines.push(`  Language Detection (${sessions.length} sessions):`);
  for (const s of sessions) {
    if (s.languages.length === 0) {
      lines.push(`    ${s.title}: unknown`);
    } else {
      const primary = s.languages[0];
      const others = s.languages.slice(1, 3).map((l) => l.language).join(", ");
      lines.push(`    ${s.title}: ${primary.language} (${primary.confidence}%)${others ? ` + ${others}` : ""}`);
    }
  }
  return lines;
}
