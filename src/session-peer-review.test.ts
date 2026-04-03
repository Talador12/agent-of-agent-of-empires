import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createPeerReviewState, requestReview, resolveReview,
  pendingReviewsFor, isApprovedForCompletion, expireStaleReviews,
  reviewStats, formatPeerReviews,
} from "./session-peer-review.js";

describe("createPeerReviewState", () => {
  it("starts empty", () => {
    const state = createPeerReviewState();
    assert.equal(state.reviews.length, 0);
  });
});

describe("requestReview", () => {
  it("creates a pending review", () => {
    const state = createPeerReviewState();
    const review = requestReview(state, "reviewer", "target", "build auth", "output text");
    assert.equal(review.status, "pending");
    assert.equal(review.reviewerSession, "reviewer");
    assert.equal(review.targetSession, "target");
    assert.equal(state.reviews.length, 1);
  });

  it("truncates output summary to 500 chars", () => {
    const state = createPeerReviewState();
    const longOutput = "x".repeat(1000);
    const review = requestReview(state, "a", "b", "goal", longOutput);
    assert.equal(review.outputSummary.length, 500);
  });

  it("assigns incremental IDs", () => {
    const state = createPeerReviewState();
    const r1 = requestReview(state, "a", "b", "g1", "out");
    const r2 = requestReview(state, "c", "d", "g2", "out");
    assert.equal(r1.id, 1);
    assert.equal(r2.id, 2);
  });
});

describe("resolveReview", () => {
  it("approves a pending review", () => {
    const state = createPeerReviewState();
    requestReview(state, "a", "b", "goal", "out");
    const resolved = resolveReview(state, 1, "approved", "looks good");
    assert.ok(resolved);
    assert.equal(resolved!.status, "approved");
    assert.equal(resolved!.feedback, "looks good");
  });

  it("rejects a pending review", () => {
    const state = createPeerReviewState();
    requestReview(state, "a", "b", "goal", "out");
    const resolved = resolveReview(state, 1, "rejected", "tests failing");
    assert.ok(resolved);
    assert.equal(resolved!.status, "rejected");
  });

  it("returns null for already-resolved review", () => {
    const state = createPeerReviewState();
    requestReview(state, "a", "b", "goal", "out");
    resolveReview(state, 1, "approved");
    assert.equal(resolveReview(state, 1, "rejected"), null);
  });

  it("returns null for invalid ID", () => {
    const state = createPeerReviewState();
    assert.equal(resolveReview(state, 999, "approved"), null);
  });
});

describe("pendingReviewsFor", () => {
  it("returns reviews for a specific reviewer", () => {
    const state = createPeerReviewState();
    requestReview(state, "reviewer-a", "target-1", "g1", "out");
    requestReview(state, "reviewer-b", "target-2", "g2", "out");
    requestReview(state, "reviewer-a", "target-3", "g3", "out");
    const pending = pendingReviewsFor(state, "reviewer-a");
    assert.equal(pending.length, 2);
  });
});

describe("isApprovedForCompletion", () => {
  it("returns true with no reviews", () => {
    const state = createPeerReviewState();
    assert.ok(isApprovedForCompletion(state, "target"));
  });

  it("returns false when only pending", () => {
    const state = createPeerReviewState();
    requestReview(state, "a", "target", "g", "out");
    assert.ok(!isApprovedForCompletion(state, "target"));
  });

  it("returns true when approved", () => {
    const state = createPeerReviewState();
    requestReview(state, "a", "target", "g", "out");
    resolveReview(state, 1, "approved");
    assert.ok(isApprovedForCompletion(state, "target"));
  });
});

describe("expireStaleReviews", () => {
  it("expires old reviews", () => {
    const state = createPeerReviewState(5000);
    requestReview(state, "a", "b", "g", "out", 1000);
    const expired = expireStaleReviews(state, 10_000);
    assert.equal(expired, 1);
    assert.equal(state.reviews[0].status, "expired");
  });

  it("does not expire fresh reviews", () => {
    const state = createPeerReviewState(5000);
    requestReview(state, "a", "b", "g", "out", 8000);
    assert.equal(expireStaleReviews(state, 10_000), 0);
  });
});

describe("reviewStats", () => {
  it("computes correct counts", () => {
    const state = createPeerReviewState();
    requestReview(state, "a", "b", "g1", "out");
    requestReview(state, "c", "d", "g2", "out");
    resolveReview(state, 1, "approved");
    const stats = reviewStats(state);
    assert.equal(stats.total, 2);
    assert.equal(stats.approved, 1);
    assert.equal(stats.pending, 1);
  });
});

describe("formatPeerReviews", () => {
  it("shows review summary", () => {
    const state = createPeerReviewState();
    requestReview(state, "a", "b", "build auth", "out");
    const lines = formatPeerReviews(state);
    assert.ok(lines[0].includes("Peer Reviews"));
    assert.ok(lines.some((l) => l.includes("#1")));
  });

  it("shows no-pending message", () => {
    const state = createPeerReviewState();
    const lines = formatPeerReviews(state);
    assert.ok(lines.some((l) => l.includes("No pending")));
  });
});
