// goal-velocity-normalization.ts — normalize velocity across different goal complexities.
// raw velocity (%/hr) is misleading when comparing a trivial fix vs an epic refactor.
// this module normalizes velocity by complexity so comparisons are fair.
// zero dependencies.

/** complexity tier with expected velocity range */
export interface ComplexityTier {
  name: string;                  // trivial, simple, moderate, complex, epic
  minExpectedVelocityPctHr: number;  // expected min %/hr for this complexity
  maxExpectedVelocityPctHr: number;  // expected max %/hr for this complexity
  weight: number;                // difficulty multiplier (trivial=1, epic=5)
}

/** default complexity tiers */
export const DEFAULT_TIERS: ComplexityTier[] = [
  { name: "trivial", minExpectedVelocityPctHr: 50, maxExpectedVelocityPctHr: 200, weight: 1 },
  { name: "simple", minExpectedVelocityPctHr: 20, maxExpectedVelocityPctHr: 80, weight: 2 },
  { name: "moderate", minExpectedVelocityPctHr: 8, maxExpectedVelocityPctHr: 30, weight: 3 },
  { name: "complex", minExpectedVelocityPctHr: 3, maxExpectedVelocityPctHr: 12, weight: 4 },
  { name: "epic", minExpectedVelocityPctHr: 1, maxExpectedVelocityPctHr: 5, weight: 5 },
];

/** input for normalization */
export interface VelocityInput {
  sessionTitle: string;
  rawVelocityPctHr: number;    // raw progress %/hr
  complexity: string;           // tier name
  elapsedHours: number;
  progressPct: number;          // current progress 0-100
}

/** normalized velocity result */
export interface NormalizedVelocity {
  sessionTitle: string;
  rawVelocityPctHr: number;
  normalizedScore: number;      // 0-100: how well this session performs relative to expectations
  complexityWeight: number;
  weightedVelocity: number;     // rawVelocity * complexityWeight — "effective work units/hr"
  rating: "excellent" | "good" | "normal" | "slow" | "stalled";
  percentileInTier: number;     // 0-100: where this session falls within its tier's expected range
}

/** fleet-wide normalized summary */
export interface NormalizationResult {
  velocities: NormalizedVelocity[];
  fleetAvgNormalized: number;
  fleetAvgWeighted: number;
  topPerformer: string | null;
  bottomPerformer: string | null;
}

/** find the tier for a complexity name */
export function findTier(name: string, tiers: ComplexityTier[] = DEFAULT_TIERS): ComplexityTier | null {
  return tiers.find((t) => t.name === name.toLowerCase()) ?? null;
}

/** compute normalized score (0-100) for a velocity within its tier */
export function normalizeVelocity(rawVelocity: number, tier: ComplexityTier): number {
  if (rawVelocity <= 0) return 0;
  const midpoint = (tier.minExpectedVelocityPctHr + tier.maxExpectedVelocityPctHr) / 2;
  // score = velocity / midpoint * 50, capped at 100
  const score = (rawVelocity / midpoint) * 50;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** compute percentile within tier's expected range */
export function computePercentile(rawVelocity: number, tier: ComplexityTier): number {
  const range = tier.maxExpectedVelocityPctHr - tier.minExpectedVelocityPctHr;
  if (range <= 0) return 50;
  const pct = ((rawVelocity - tier.minExpectedVelocityPctHr) / range) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/** rate performance */
function ratePerformance(normalizedScore: number): NormalizedVelocity["rating"] {
  if (normalizedScore >= 80) return "excellent";
  if (normalizedScore >= 60) return "good";
  if (normalizedScore >= 30) return "normal";
  if (normalizedScore >= 10) return "slow";
  return "stalled";
}

/** normalize a single session's velocity */
export function normalizeOne(
  input: VelocityInput,
  tiers: ComplexityTier[] = DEFAULT_TIERS,
): NormalizedVelocity {
  const tier = findTier(input.complexity, tiers) ?? DEFAULT_TIERS[2]; // fallback: moderate
  const normalizedScore = normalizeVelocity(input.rawVelocityPctHr, tier);
  const percentileInTier = computePercentile(input.rawVelocityPctHr, tier);
  const weightedVelocity = input.rawVelocityPctHr * tier.weight;

  return {
    sessionTitle: input.sessionTitle,
    rawVelocityPctHr: input.rawVelocityPctHr,
    normalizedScore,
    complexityWeight: tier.weight,
    weightedVelocity: Math.round(weightedVelocity * 100) / 100,
    rating: ratePerformance(normalizedScore),
    percentileInTier,
  };
}

/** normalize velocities across the fleet */
export function normalizeFleet(
  inputs: VelocityInput[],
  tiers: ComplexityTier[] = DEFAULT_TIERS,
): NormalizationResult {
  const velocities = inputs.map((input) => normalizeOne(input, tiers));

  const fleetAvgNormalized = velocities.length > 0
    ? Math.round(velocities.reduce((s, v) => s + v.normalizedScore, 0) / velocities.length)
    : 0;

  const fleetAvgWeighted = velocities.length > 0
    ? Math.round(velocities.reduce((s, v) => s + v.weightedVelocity, 0) / velocities.length * 100) / 100
    : 0;

  // sort by normalized score desc
  velocities.sort((a, b) => b.normalizedScore - a.normalizedScore);

  const topPerformer = velocities.length > 0 ? velocities[0].sessionTitle : null;
  const bottomPerformer = velocities.length > 0 ? velocities[velocities.length - 1].sessionTitle : null;

  return { velocities, fleetAvgNormalized, fleetAvgWeighted, topPerformer, bottomPerformer };
}

/** format normalized velocities for TUI display */
export function formatNormalizedVelocity(result: NormalizationResult): string[] {
  const lines: string[] = [];
  lines.push(`velocity normalization: ${result.velocities.length} sessions, fleet avg=${result.fleetAvgNormalized}/100`);

  if (result.topPerformer) {
    lines.push(`  top: ${result.topPerformer} | bottom: ${result.bottomPerformer}`);
  }

  for (const v of result.velocities) {
    const bar = "█".repeat(Math.round(v.normalizedScore / 10)) + "░".repeat(10 - Math.round(v.normalizedScore / 10));
    lines.push(`  ${v.sessionTitle}: ${bar} ${v.normalizedScore}/100 [${v.rating}]`);
    lines.push(`    raw=${v.rawVelocityPctHr.toFixed(1)}%/hr × weight=${v.complexityWeight} = ${v.weightedVelocity} effective/hr`);
  }

  return lines;
}
