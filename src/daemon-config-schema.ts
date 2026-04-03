// daemon-config-schema.ts — JSON Schema-style validation for config
// with helpful error messages. validates types, ranges, required fields,
// and known field names. no external deps — hand-rolled schema checker.

export interface SchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  min?: number;
  max?: number;
  enum?: unknown[];
  description: string;
  children?: SchemaField[]; // for nested objects
}

export interface ValidationError {
  field: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

const AOAOE_SCHEMA: SchemaField[] = [
  { name: "reasoner", type: "string", required: true, enum: ["opencode", "claude-code"], description: "Reasoning backend" },
  { name: "pollIntervalMs", type: "number", min: 1000, max: 300_000, description: "Poll interval in milliseconds" },
  { name: "reasonIntervalMs", type: "number", min: 5000, max: 600_000, description: "Reason interval in milliseconds" },
  { name: "verbose", type: "boolean", description: "Enable verbose logging" },
  { name: "dryRun", type: "boolean", description: "Observe only, don't execute actions" },
  { name: "confirm", type: "boolean", description: "Require confirmation for actions" },
  { name: "healthPort", type: "number", min: 1, max: 65535, description: "HTTP health check port" },
  { name: "sessionDirs", type: "object", description: "Session title -> directory mapping" },
  {
    name: "policies", type: "object", description: "Daemon policies",
    children: [
      { name: "maxIdleBeforeNudgeMs", type: "number", min: 0, description: "Max idle before nudge (ms)" },
      { name: "maxErrorsBeforeRestart", type: "number", min: 0, max: 100, description: "Max errors before restart" },
      { name: "autoAnswerPermissions", type: "boolean", description: "Auto-answer permission prompts" },
      { name: "actionCooldownMs", type: "number", min: 0, description: "Cooldown between actions (ms)" },
      { name: "allowDestructive", type: "boolean", description: "Allow destructive actions" },
    ],
  },
  {
    name: "costBudgets", type: "object", description: "Cost budget settings",
    children: [
      { name: "globalBudgetUsd", type: "number", min: 0, description: "Global budget in USD" },
    ],
  },
];

/**
 * Validate a config object against the schema.
 */
export function validateConfigSchema(config: Record<string, unknown>, schema?: SchemaField[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const fields = schema ?? AOAOE_SCHEMA;

  // check required fields
  for (const field of fields) {
    if (field.required && !(field.name in config)) {
      errors.push({ field: field.name, message: `Required field "${field.name}" is missing`, suggestion: field.description });
    }
  }

  // check each config value
  const knownNames = new Set(fields.map((f) => f.name));
  for (const [key, value] of Object.entries(config)) {
    if (!knownNames.has(key)) {
      warnings.push({ field: key, message: `Unknown config field "${key}"`, suggestion: "Check for typos" });
      continue;
    }

    const field = fields.find((f) => f.name === key)!;

    // type check
    if (field.type === "array") {
      if (!Array.isArray(value)) errors.push({ field: key, message: `"${key}" should be an array, got ${typeof value}` });
    } else if (typeof value !== field.type) {
      errors.push({ field: key, message: `"${key}" should be ${field.type}, got ${typeof value}`, suggestion: field.description });
      continue;
    }

    // range check
    if (field.type === "number" && typeof value === "number") {
      if (field.min !== undefined && value < field.min) {
        errors.push({ field: key, message: `"${key}" is ${value}, minimum is ${field.min}` });
      }
      if (field.max !== undefined && value > field.max) {
        errors.push({ field: key, message: `"${key}" is ${value}, maximum is ${field.max}` });
      }
    }

    // enum check
    if (field.enum && !field.enum.includes(value)) {
      errors.push({ field: key, message: `"${key}" is "${value}", must be one of: ${field.enum.join(", ")}` });
    }

    // nested object validation
    if (field.type === "object" && field.children && typeof value === "object" && value !== null) {
      const nested = validateConfigSchema(value as Record<string, unknown>, field.children);
      for (const e of nested.errors) errors.push({ ...e, field: `${key}.${e.field}` });
      for (const w of nested.warnings) warnings.push({ ...w, field: `${key}.${w.field}` });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Get the schema for documentation.
 */
export function getSchema(): SchemaField[] {
  return [...AOAOE_SCHEMA];
}

/**
 * Format validation result for TUI display.
 */
export function formatValidation(result: ValidationResult): string[] {
  const lines: string[] = [];
  const status = result.valid ? "VALID" : "INVALID";
  const icon = result.valid ? "✓" : "✗";
  lines.push(`  Config Validation: ${icon} ${status} (${result.errors.length} errors, ${result.warnings.length} warnings)`);
  for (const e of result.errors) {
    lines.push(`    ✗ ${e.field}: ${e.message}`);
    if (e.suggestion) lines.push(`      → ${e.suggestion}`);
  }
  for (const w of result.warnings) {
    lines.push(`    ⚠ ${w.field}: ${w.message}`);
    if (w.suggestion) lines.push(`      → ${w.suggestion}`);
  }
  if (result.valid && result.warnings.length === 0) {
    lines.push("    All fields pass validation");
  }
  return lines;
}
