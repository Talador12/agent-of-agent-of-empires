import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createAnnotationState, annotate, removeAnnotation,
  getSessionAnnotations, getAnnotationsBySeverity, getAnnotationsByLabel,
  annotationCounts, formatAnnotations,
} from "./session-output-annotations.js";

describe("createAnnotationState", () => {
  it("starts empty", () => {
    const s = createAnnotationState();
    assert.equal(s.annotations.length, 0);
  });
});

describe("annotate", () => {
  it("adds an annotation", () => {
    const s = createAnnotationState();
    const a = annotate(s, "alpha", 42, "FAIL: tests", "test-fail", "error", "verifier");
    assert.equal(a.id, 1);
    assert.equal(a.sessionTitle, "alpha");
    assert.equal(a.severity, "error");
    assert.equal(s.annotations.length, 1);
  });

  it("truncates long text", () => {
    const s = createAnnotationState();
    const a = annotate(s, "a", 0, "x".repeat(500), "y".repeat(100), "info", "mod");
    assert.equal(a.lineText.length, 200);
    assert.equal(a.label.length, 30);
  });

  it("enforces max annotations", () => {
    const s = createAnnotationState(3);
    for (let i = 0; i < 5; i++) annotate(s, "a", i, `line ${i}`, "lbl", "info", "mod");
    assert.equal(s.annotations.length, 3);
  });

  it("increments IDs", () => {
    const s = createAnnotationState();
    const a1 = annotate(s, "a", 0, "l1", "lbl", "info", "m");
    const a2 = annotate(s, "a", 1, "l2", "lbl", "info", "m");
    assert.equal(a1.id, 1);
    assert.equal(a2.id, 2);
  });
});

describe("removeAnnotation", () => {
  it("removes by ID", () => {
    const s = createAnnotationState();
    annotate(s, "a", 0, "line", "lbl", "info", "m");
    assert.ok(removeAnnotation(s, 1));
    assert.equal(s.annotations.length, 0);
  });

  it("returns false for invalid ID", () => {
    const s = createAnnotationState();
    assert.ok(!removeAnnotation(s, 999));
  });
});

describe("getSessionAnnotations", () => {
  it("filters by session (case-insensitive)", () => {
    const s = createAnnotationState();
    annotate(s, "Alpha", 0, "l1", "lbl", "info", "m");
    annotate(s, "beta", 0, "l2", "lbl", "info", "m");
    assert.equal(getSessionAnnotations(s, "alpha").length, 1);
  });
});

describe("getAnnotationsBySeverity", () => {
  it("filters by severity", () => {
    const s = createAnnotationState();
    annotate(s, "a", 0, "l1", "lbl", "info", "m");
    annotate(s, "a", 1, "l2", "lbl", "error", "m");
    assert.equal(getAnnotationsBySeverity(s, "error").length, 1);
  });
});

describe("getAnnotationsByLabel", () => {
  it("filters by label (case-insensitive)", () => {
    const s = createAnnotationState();
    annotate(s, "a", 0, "l1", "milestone", "info", "m");
    annotate(s, "a", 1, "l2", "error", "error", "m");
    assert.equal(getAnnotationsByLabel(s, "Milestone").length, 1);
  });
});

describe("annotationCounts", () => {
  it("counts by severity", () => {
    const s = createAnnotationState();
    annotate(s, "a", 0, "l", "x", "info", "m");
    annotate(s, "a", 1, "l", "x", "error", "m");
    annotate(s, "a", 2, "l", "x", "error", "m");
    const c = annotationCounts(s);
    assert.equal(c.info, 1);
    assert.equal(c.error, 2);
  });
});

describe("formatAnnotations", () => {
  it("shows none message when empty", () => {
    const lines = formatAnnotations([]);
    assert.ok(lines[0].includes("none"));
  });

  it("shows annotation details", () => {
    const s = createAnnotationState();
    annotate(s, "alpha", 42, "FAIL: test_auth", "test-fail", "error", "verifier", "regression");
    const lines = formatAnnotations(s.annotations);
    assert.ok(lines[0].includes("Annotations"));
    assert.ok(lines.some((l) => l.includes("alpha")));
    assert.ok(lines.some((l) => l.includes("test-fail")));
  });
});
