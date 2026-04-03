// session-checkpoint.ts — save + resume session state across daemon restarts.
// serializes all transient module state (graduation, escalation, velocity,
// nudge tracker, etc.) to disk so the daemon can pick up where it left off.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CHECKPOINT_DIR = join(homedir(), ".aoaoe", "checkpoints");
const CHECKPOINT_FILE = join(CHECKPOINT_DIR, "daemon-state.json");

export interface DaemonCheckpoint {
  version: number;
  savedAt: number;
  graduation: Record<string, { mode: string; successes: number; failures: number; rate: number }>;
  escalation: Record<string, { level: string; notifyCount: number }>;
  velocitySamples: Record<string, Array<{ timestamp: number; percent: number }>>;
  nudgeRecords: Array<{ session: string; sentAt: number; effective: boolean }>;
  budgetSamples: Record<string, Array<{ timestamp: number; costUsd: number }>>;
  cacheStats: { hits: number; misses: number };
  slaHistory: number[];
  pollInterval: number;
}

/**
 * Save daemon state to a checkpoint file.
 */
export function saveCheckpoint(checkpoint: DaemonCheckpoint): string {
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  checkpoint.savedAt = Date.now();
  checkpoint.version = 1;
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2) + "\n");
  return CHECKPOINT_FILE;
}

/**
 * Load the most recent checkpoint. Returns null if none exists.
 */
export function loadCheckpoint(): DaemonCheckpoint | null {
  if (!existsSync(CHECKPOINT_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
    if (data.version !== 1) return null; // incompatible version
    return data as DaemonCheckpoint;
  } catch {
    return null;
  }
}

/**
 * Build a checkpoint from current module states.
 * This is a generic serialization — callers extract state from each module.
 */
export function buildCheckpoint(state: Omit<DaemonCheckpoint, "version" | "savedAt">): DaemonCheckpoint {
  return { version: 1, savedAt: Date.now(), ...state };
}

/**
 * Format checkpoint info for TUI display.
 */
export function formatCheckpointInfo(): string[] {
  const cp = loadCheckpoint();
  if (!cp) return ["  (no checkpoint found)"];
  const age = Math.round((Date.now() - cp.savedAt) / 60_000);
  const lines: string[] = [];
  lines.push(`  Checkpoint: saved ${age}min ago`);
  lines.push(`  Graduation: ${Object.keys(cp.graduation).length} sessions`);
  lines.push(`  Escalation: ${Object.keys(cp.escalation).length} active`);
  lines.push(`  Velocity: ${Object.keys(cp.velocitySamples).length} tracked`);
  lines.push(`  Nudges: ${cp.nudgeRecords.length} records`);
  lines.push(`  Cache: ${cp.cacheStats.hits} hits / ${cp.cacheStats.misses} misses`);
  lines.push(`  SLA history: ${cp.slaHistory.length} ticks`);
  return lines;
}

/**
 * Check if a checkpoint exists and is recent enough to restore.
 */
export function shouldRestoreCheckpoint(maxAgeMs = 30 * 60_000): boolean {
  const cp = loadCheckpoint();
  if (!cp) return false;
  return (Date.now() - cp.savedAt) <= maxAgeMs;
}
