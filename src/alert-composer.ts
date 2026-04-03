// alert-composer.ts — AND/OR composition of alert conditions.
// extends alert-rule-dsl.ts with logical operators for complex rules.

import { parseCondition } from "./alert-rule-dsl.js";
import type { AlertContext } from "./alert-rules.js";

export type ComposedCondition = (ctx: AlertContext) => boolean;

/**
 * Compose multiple condition strings with AND logic.
 * All conditions must be true for the composed condition to fire.
 */
export function composeAnd(expressions: string[]): ComposedCondition | null {
  const fns = expressions.map(parseCondition);
  if (fns.some((f) => f === null)) return null;
  return (ctx) => fns.every((f) => f!(ctx));
}

/**
 * Compose multiple condition strings with OR logic.
 * Any condition being true fires the composed condition.
 */
export function composeOr(expressions: string[]): ComposedCondition | null {
  const fns = expressions.map(parseCondition);
  if (fns.some((f) => f === null)) return null;
  return (ctx) => fns.some((f) => f!(ctx));
}

/**
 * Parse a composed condition from config.
 * Format: { "and": ["fleetHealth < 40", "errorSessions > 2"] }
 *      or { "or": ["fleetHealth < 20", "stuckSessions >= 3"] }
 *      or plain string "fleetHealth < 50"
 */
export function parseComposedCondition(
  spec: string | { and: string[] } | { or: string[] },
): ComposedCondition | null {
  if (typeof spec === "string") return parseCondition(spec);
  if ("and" in spec) return composeAnd(spec.and);
  if ("or" in spec) return composeOr(spec.or);
  return null;
}

/**
 * Format a composed condition for display.
 */
export function formatComposedCondition(spec: string | { and: string[] } | { or: string[] }): string {
  if (typeof spec === "string") return spec;
  if ("and" in spec) return spec.and.join(" AND ");
  if ("or" in spec) return spec.or.join(" OR ");
  return "unknown";
}
