// alert-rule-dsl.ts — user-defined alert rules via config file.
// parses a simple DSL for defining custom alert conditions:
//   { "name": "my-rule", "severity": "warning", "condition": "fleetHealth < 40", "cooldownMin": 10 }

import type { AlertContext, AlertRule, AlertSeverity } from "./alert-rules.js";

export interface AlertRuleConfig {
  name: string;
  severity: AlertSeverity;
  condition: string;     // DSL expression: "fleetHealth < 40", "errorSessions > 2", etc.
  cooldownMin: number;   // cooldown in minutes
  description?: string;
}

// supported operators and fields
const VALID_FIELDS = new Set(["fleetHealth", "activeSessions", "errorSessions", "totalCostUsd", "hourlyCostRate", "stuckSessions"]);
const VALID_OPS = new Set(["<", ">", "<=", ">=", "==", "!="]);

/**
 * Parse a DSL condition string into a function.
 * Format: "<field> <op> <value>" — e.g., "fleetHealth < 40"
 */
export function parseCondition(expr: string): ((ctx: AlertContext) => boolean) | null {
  const match = expr.trim().match(/^(\w+)\s*(<=?|>=?|[!=]=)\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const [, field, op, valueStr] = match;
  if (!VALID_FIELDS.has(field)) return null;
  if (!VALID_OPS.has(op)) return null;
  const value = parseFloat(valueStr);
  if (!isFinite(value)) return null;

  return (ctx: AlertContext) => {
    const actual = (ctx as unknown as Record<string, unknown>)[field] as number;
    if (typeof actual !== "number") return false;
    switch (op) {
      case "<": return actual < value;
      case ">": return actual > value;
      case "<=": return actual <= value;
      case ">=": return actual >= value;
      case "==": return actual === value;
      case "!=": return actual !== value;
      default: return false;
    }
  };
}

/**
 * Convert user-defined rule configs into AlertRule objects.
 */
export function parseAlertRuleConfigs(configs: AlertRuleConfig[]): { rules: AlertRule[]; errors: string[] } {
  const rules: AlertRule[] = [];
  const errors: string[] = [];

  for (const cfg of configs) {
    const condition = parseCondition(cfg.condition);
    if (!condition) {
      errors.push(`invalid condition in rule "${cfg.name}": "${cfg.condition}"`);
      continue;
    }
    rules.push({
      name: cfg.name,
      description: cfg.description ?? cfg.condition,
      severity: cfg.severity,
      condition,
      cooldownMs: cfg.cooldownMin * 60_000,
      lastFiredAt: 0,
    });
  }

  return { rules, errors };
}

/**
 * Validate a DSL condition string without executing it.
 */
export function validateCondition(expr: string): { valid: boolean; error?: string } {
  const match = expr.trim().match(/^(\w+)\s*(<=?|>=?|[!=]=)\s*(\d+(?:\.\d+)?)$/);
  if (!match) return { valid: false, error: `invalid format: expected "<field> <op> <value>", got "${expr}"` };
  const [, field, op] = match;
  if (!VALID_FIELDS.has(field)) return { valid: false, error: `unknown field "${field}". valid: ${[...VALID_FIELDS].join(", ")}` };
  if (!VALID_OPS.has(op)) return { valid: false, error: `unknown operator "${op}". valid: ${[...VALID_OPS].join(", ")}` };
  return { valid: true };
}

/**
 * Format available DSL fields for help display.
 */
export function formatDslHelp(): string[] {
  return [
    "  Alert rule DSL:",
    "  Format: <field> <op> <value>",
    `  Fields: ${[...VALID_FIELDS].join(", ")}`,
    `  Operators: ${[...VALID_OPS].join(", ")}`,
    '  Example: { "name": "low-health", "severity": "warning", "condition": "fleetHealth < 50", "cooldownMin": 10 }',
  ];
}
