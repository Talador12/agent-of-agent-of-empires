// observation-cache.ts — deduplicate identical observations to save LLM calls.
// hashes observation content and returns cached reasoning results when the
// same observation is seen again within a TTL window.

import { createHash } from "node:crypto";
import type { ReasonerResult } from "./types.js";

export interface CacheEntry {
  hash: string;
  result: ReasonerResult;
  createdAt: number;
  hitCount: number;
}

export interface CacheStats {
  entries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number; // 0.0-1.0
  savedCalls: number;
}

/**
 * Cache LLM reasoning results keyed by observation content hash.
 */
export class ObservationCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxEntries: number;
  private totalHits = 0;
  private totalMisses = 0;

  constructor(ttlMs = 5 * 60_000, maxEntries = 100) { // 5min TTL, 100 entries
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /**
   * Hash an observation for cache lookup.
   * Uses a SHA-256 of the observation JSON excluding timestamps.
   */
  static hashObservation(observationJson: string): string {
    // strip timestamps and volatile fields before hashing
    const stripped = observationJson
      .replace(/"capturedAt":\d+/g, '"capturedAt":0')
      .replace(/"timestamp":\d+/g, '"timestamp":0');
    return createHash("sha256").update(stripped).digest("hex").slice(0, 16);
  }

  /** Look up a cached result. Returns null on miss. */
  get(observationJson: string, now = Date.now()): ReasonerResult | null {
    this.prune(now);
    const hash = ObservationCache.hashObservation(observationJson);
    const entry = this.cache.get(hash);
    if (!entry) {
      this.totalMisses++;
      return null;
    }
    entry.hitCount++;
    this.totalHits++;
    return entry.result;
  }

  /** Store a result in the cache. */
  set(observationJson: string, result: ReasonerResult, now = Date.now()): void {
    const hash = ObservationCache.hashObservation(observationJson);
    this.cache.set(hash, { hash, result, createdAt: now, hitCount: 0 });
    // evict oldest if over max
    if (this.cache.size > this.maxEntries) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
      this.cache.delete(oldest[0][0]);
    }
  }

  /** Get cache statistics. */
  getStats(): CacheStats {
    const total = this.totalHits + this.totalMisses;
    return {
      entries: this.cache.size,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate: total > 0 ? this.totalHits / total : 0,
      savedCalls: this.totalHits,
    };
  }

  /** Format stats for TUI display. */
  formatStats(): string[] {
    const s = this.getStats();
    if (s.totalHits + s.totalMisses === 0) return ["  (no cache activity yet)"];
    return [
      `  Observation cache: ${s.entries} entries, ${Math.round(s.hitRate * 100)}% hit rate`,
      `  Hits: ${s.totalHits}  Misses: ${s.totalMisses}  Saved calls: ${s.savedCalls}`,
    ];
  }

  /** Clear all entries. */
  clear(): void {
    this.cache.clear();
  }

  private prune(now: number): void {
    const cutoff = now - this.ttlMs;
    for (const [hash, entry] of this.cache) {
      if (entry.createdAt < cutoff) this.cache.delete(hash);
    }
  }
}
