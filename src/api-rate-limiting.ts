// api-rate-limiting.ts — per-client request throttling for the REST API.
// tracks request counts per client IP in sliding windows, returns 429 when
// limits exceeded. supports burst allowance and configurable windows.
// zero dependencies.

/** rate limit configuration */
export interface RateLimitConfig {
  windowMs: number;          // sliding window duration (default: 60_000 = 1 minute)
  maxRequests: number;       // max requests per window (default: 120)
  burstAllowance: number;    // extra requests allowed in first 10% of window (default: 20)
}

/** per-client tracking bucket */
interface ClientBucket {
  requests: number[];        // timestamps of recent requests
  blocked: number;           // count of blocked requests
}

/** rate limit check result */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;         // requests remaining in window
  resetMs: number;           // ms until window resets
  retryAfterMs: number;      // ms to wait before retrying (0 if allowed)
}

/** rate limiter state */
export interface RateLimiterState {
  config: RateLimitConfig;
  clients: Map<string, ClientBucket>;
  totalAllowed: number;
  totalBlocked: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 120,
  burstAllowance: 20,
};

/** create a new rate limiter */
export function createRateLimiter(config: Partial<RateLimitConfig> = {}): RateLimiterState {
  return {
    config: { ...DEFAULT_CONFIG, ...config },
    clients: new Map(),
    totalAllowed: 0,
    totalBlocked: 0,
  };
}

/** check if a request from clientId is allowed */
export function checkRateLimit(
  state: RateLimiterState,
  clientId: string,
  now = Date.now(),
): RateLimitResult {
  const { windowMs, maxRequests, burstAllowance } = state.config;
  const cutoff = now - windowMs;

  let bucket = state.clients.get(clientId);
  if (!bucket) {
    bucket = { requests: [], blocked: 0 };
    state.clients.set(clientId, bucket);
  }

  // prune expired requests
  bucket.requests = bucket.requests.filter((t) => t > cutoff);

  // compute effective limit (burst applies in first 10% of window)
  const windowStart = bucket.requests.length > 0 ? bucket.requests[0] : now;
  const elapsed = now - windowStart;
  const inBurstWindow = elapsed < windowMs * 0.1;
  const effectiveLimit = inBurstWindow ? maxRequests + burstAllowance : maxRequests;

  if (bucket.requests.length >= effectiveLimit) {
    // blocked
    bucket.blocked++;
    state.totalBlocked++;
    const oldest = bucket.requests[0];
    const resetMs = oldest + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, resetMs),
      retryAfterMs: Math.max(0, resetMs),
    };
  }

  // allowed
  bucket.requests.push(now);
  state.totalAllowed++;
  const remaining = effectiveLimit - bucket.requests.length;
  const oldest = bucket.requests[0];
  const resetMs = oldest + windowMs - now;

  return {
    allowed: true,
    remaining,
    resetMs: Math.max(0, resetMs),
    retryAfterMs: 0,
  };
}

/** get stats for a specific client */
export function getClientStats(
  state: RateLimiterState,
  clientId: string,
  now = Date.now(),
): { requests: number; blocked: number; remaining: number } | null {
  const bucket = state.clients.get(clientId);
  if (!bucket) return null;
  const cutoff = now - state.config.windowMs;
  const active = bucket.requests.filter((t) => t > cutoff).length;
  return {
    requests: active,
    blocked: bucket.blocked,
    remaining: Math.max(0, state.config.maxRequests - active),
  };
}

/** cleanup expired client entries */
export function cleanupExpired(state: RateLimiterState, now = Date.now()): number {
  const cutoff = now - state.config.windowMs * 2; // keep 2x window for hysteresis
  let removed = 0;
  for (const [id, bucket] of state.clients) {
    const latest = bucket.requests[bucket.requests.length - 1] ?? 0;
    if (latest < cutoff) {
      state.clients.delete(id);
      removed++;
    }
  }
  return removed;
}

/** format rate limiter status for TUI display */
export function formatRateLimiter(state: RateLimiterState): string[] {
  const lines: string[] = [];
  const { windowMs, maxRequests, burstAllowance } = state.config;
  lines.push(`api rate limiter: ${maxRequests} req/${Math.round(windowMs / 1000)}s (burst: +${burstAllowance})`);
  lines.push(`  total: ${state.totalAllowed} allowed, ${state.totalBlocked} blocked`);
  lines.push(`  tracked clients: ${state.clients.size}`);

  // top clients by request count
  const now = Date.now();
  const cutoff = now - windowMs;
  const clientStats = [...state.clients.entries()]
    .map(([id, b]) => ({ id, active: b.requests.filter((t) => t > cutoff).length, blocked: b.blocked }))
    .filter((c) => c.active > 0 || c.blocked > 0)
    .sort((a, b) => b.active - a.active)
    .slice(0, 5);

  if (clientStats.length > 0) {
    lines.push("  active clients:");
    for (const c of clientStats) {
      const blockStr = c.blocked > 0 ? ` (${c.blocked} blocked)` : "";
      lines.push(`    ${c.id}: ${c.active} req${blockStr}`);
    }
  }

  return lines;
}
