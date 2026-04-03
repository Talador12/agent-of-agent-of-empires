// session-output-redaction.ts — auto-strip secrets/PII from captured pane
// output before logging or storing. matches common secret patterns
// (API keys, tokens, passwords, emails, IPs) and replaces with [REDACTED].

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export interface RedactionResult {
  original: string;
  redacted: string;
  matchCount: number;
  rulesMatched: string[];
}

export interface RedactionStats {
  totalCalls: number;
  totalRedactions: number;
  ruleHits: Map<string, number>;
}

const DEFAULT_RULES: RedactionRule[] = [
  { name: "bearer-token", pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, replacement: "Bearer [REDACTED]" },
  { name: "api-key-header", pattern: /(?:api[_-]?key|apikey|api[_-]?token|access[_-]?token|auth[_-]?token|secret[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9\-._~+/]{16,}['"]?/gi, replacement: "[API_KEY_REDACTED]" },
  { name: "aws-key", pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g, replacement: "[AWS_KEY_REDACTED]" },
  { name: "aws-secret", pattern: /(?:aws_secret_access_key|secret_access_key)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi, replacement: "[AWS_SECRET_REDACTED]" },
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, replacement: "[JWT_REDACTED]" },
  { name: "private-key", pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g, replacement: "[PRIVATE_KEY_REDACTED]" },
  { name: "password-assign", pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi, replacement: "[PASSWORD_REDACTED]" },
  { name: "connection-string", pattern: /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s'"]+/gi, replacement: "[CONNECTION_STRING_REDACTED]" },
  { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL_REDACTED]" },
  { name: "ipv4-address", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, replacement: "[IP_REDACTED]" },
  { name: "hex-secret", pattern: /(?:secret|token|key)\s*[:=]\s*['"]?[0-9a-f]{32,}['"]?/gi, replacement: "[HEX_SECRET_REDACTED]" },
];

/**
 * Redaction engine with configurable rules and stats tracking.
 */
export class OutputRedactor {
  private rules: RedactionRule[];
  private stats: RedactionStats;

  constructor(customRules?: RedactionRule[]) {
    this.rules = customRules ?? [...DEFAULT_RULES];
    this.stats = { totalCalls: 0, totalRedactions: 0, ruleHits: new Map() };
  }

  /** Add a custom redaction rule. */
  addRule(rule: RedactionRule): void {
    this.rules.push(rule);
  }

  /** Redact secrets from text. */
  redact(text: string): RedactionResult {
    this.stats.totalCalls++;
    let redacted = text;
    let matchCount = 0;
    const rulesMatched: string[] = [];

    for (const rule of this.rules) {
      // reset regex lastIndex for global patterns
      rule.pattern.lastIndex = 0;
      const matches = redacted.match(rule.pattern);
      if (matches && matches.length > 0) {
        matchCount += matches.length;
        rulesMatched.push(rule.name);
        this.stats.ruleHits.set(rule.name, (this.stats.ruleHits.get(rule.name) ?? 0) + matches.length);
        redacted = redacted.replace(rule.pattern, rule.replacement);
      }
    }

    this.stats.totalRedactions += matchCount;
    return { original: text, redacted, matchCount, rulesMatched };
  }

  /** Get redaction stats. */
  getStats(): RedactionStats {
    return { ...this.stats, ruleHits: new Map(this.stats.ruleHits) };
  }

  /** Get rule count. */
  getRuleCount(): number {
    return this.rules.length;
  }
}

/**
 * Format redaction stats for TUI display.
 */
export function formatRedactionStats(redactor: OutputRedactor): string[] {
  const stats = redactor.getStats();
  const lines: string[] = [];
  lines.push(`  Output Redaction (${redactor.getRuleCount()} rules, ${stats.totalCalls} calls, ${stats.totalRedactions} redactions):`);
  if (stats.ruleHits.size === 0) {
    lines.push("    No secrets detected yet");
  } else {
    const sorted = Array.from(stats.ruleHits.entries()).sort((a, b) => b[1] - a[1]);
    for (const [rule, count] of sorted) {
      lines.push(`    ${rule}: ${count} match${count !== 1 ? "es" : ""}`);
    }
  }
  return lines;
}
