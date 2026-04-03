// session-peer-review.ts — have one session review another's output before
// marking complete. creates review requests, tracks review status, and
// gates task completion on peer approval.

export type ReviewStatus = "pending" | "approved" | "rejected" | "expired";

export interface PeerReview {
  id: number;
  reviewerSession: string;
  targetSession: string;
  targetGoal: string;
  outputSummary: string; // last N lines of output for context
  status: ReviewStatus;
  createdAt: number;
  resolvedAt?: number;
  feedback?: string;
}

export interface PeerReviewState {
  reviews: PeerReview[];
  nextId: number;
  expiryMs: number;
}

/**
 * Create a fresh peer review state.
 */
export function createPeerReviewState(expiryMs = 600_000): PeerReviewState {
  return { reviews: [], nextId: 1, expiryMs };
}

/**
 * Request a peer review from one session for another's output.
 */
export function requestReview(
  state: PeerReviewState,
  reviewerSession: string,
  targetSession: string,
  targetGoal: string,
  outputSummary: string,
  now = Date.now(),
): PeerReview {
  const review: PeerReview = {
    id: state.nextId++,
    reviewerSession,
    targetSession,
    targetGoal,
    outputSummary: outputSummary.slice(-500), // last 500 chars
    status: "pending",
    createdAt: now,
  };
  state.reviews.push(review);
  return review;
}

/**
 * Resolve a review (approve or reject).
 */
export function resolveReview(
  state: PeerReviewState,
  reviewId: number,
  status: "approved" | "rejected",
  feedback?: string,
  now = Date.now(),
): PeerReview | null {
  const review = state.reviews.find((r) => r.id === reviewId);
  if (!review || review.status !== "pending") return null;
  review.status = status;
  review.resolvedAt = now;
  review.feedback = feedback;
  return review;
}

/**
 * Get pending reviews for a reviewer session.
 */
export function pendingReviewsFor(state: PeerReviewState, reviewerSession: string): PeerReview[] {
  return state.reviews.filter(
    (r) => r.reviewerSession === reviewerSession && r.status === "pending",
  );
}

/**
 * Get review status for a target session (is it approved for completion?).
 */
export function isApprovedForCompletion(state: PeerReviewState, targetSession: string): boolean {
  const reviews = state.reviews.filter((r) => r.targetSession === targetSession);
  if (reviews.length === 0) return true; // no review required
  return reviews.some((r) => r.status === "approved");
}

/**
 * Expire old pending reviews.
 */
export function expireStaleReviews(state: PeerReviewState, now = Date.now()): number {
  let expired = 0;
  for (const r of state.reviews) {
    if (r.status === "pending" && now - r.createdAt > state.expiryMs) {
      r.status = "expired";
      r.resolvedAt = now;
      expired++;
    }
  }
  return expired;
}

/**
 * Get summary stats for reviews.
 */
export function reviewStats(state: PeerReviewState): { total: number; pending: number; approved: number; rejected: number; expired: number } {
  return {
    total: state.reviews.length,
    pending: state.reviews.filter((r) => r.status === "pending").length,
    approved: state.reviews.filter((r) => r.status === "approved").length,
    rejected: state.reviews.filter((r) => r.status === "rejected").length,
    expired: state.reviews.filter((r) => r.status === "expired").length,
  };
}

/**
 * Format peer reviews for TUI display.
 */
export function formatPeerReviews(state: PeerReviewState): string[] {
  const stats = reviewStats(state);
  const lines: string[] = [];
  lines.push(`  Peer Reviews (${stats.total} total: ${stats.pending} pending, ${stats.approved} approved, ${stats.rejected} rejected, ${stats.expired} expired):`);
  const pending = state.reviews.filter((r) => r.status === "pending");
  if (pending.length === 0) {
    lines.push("    No pending reviews");
  } else {
    for (const r of pending) {
      const age = Math.round((Date.now() - r.createdAt) / 60_000);
      lines.push(`    #${r.id} ${r.targetSession} → ${r.reviewerSession} (${age}m ago)`);
      lines.push(`      goal: ${r.targetGoal.slice(0, 60)}`);
    }
  }
  return lines;
}
