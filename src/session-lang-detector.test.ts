import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { detectLanguage, primaryLanguage, detectFleetLanguages, formatLangDetection } from "./session-lang-detector.js";

describe("detectLanguage", () => {
  it("detects TypeScript", () => {
    const d = detectLanguage("src/index.ts: error TS2345\ntsc --build");
    assert.ok(d.some((l) => l.language === "TypeScript"));
  });
  it("detects Python", () => {
    const d = detectLanguage("python3 main.py\npytest tests/");
    assert.ok(d.some((l) => l.language === "Python"));
  });
  it("detects Rust", () => {
    const d = detectLanguage("cargo build\nsrc/lib.rs:42: error");
    assert.ok(d.some((l) => l.language === "Rust"));
  });
  it("detects Go", () => {
    const d = detectLanguage("go test ./...\nmain.go:10");
    assert.ok(d.some((l) => l.language === "Go"));
  });
  it("returns empty for unrecognized output", () => {
    assert.equal(detectLanguage("hello world").length, 0);
  });
  it("sorts by confidence descending", () => {
    const d = detectLanguage("tsc --build\nnpm run test\nnode:test passed\nsrc/index.ts error");
    if (d.length >= 2) assert.ok(d[0].confidence >= d[1].confidence);
  });
  it("detects Shell", () => {
    const d = detectLanguage("#!/bin/bash\necho hello");
    assert.ok(d.some((l) => l.language === "Shell"));
  });
});

describe("primaryLanguage", () => {
  it("returns highest confidence language", () => {
    assert.equal(primaryLanguage("cargo test\nsrc/main.rs"), "Rust");
  });
  it("returns null for unrecognized", () => {
    assert.equal(primaryLanguage("random noise"), null);
  });
});

describe("detectFleetLanguages", () => {
  it("detects for multiple sessions", () => {
    const results = detectFleetLanguages([
      { title: "alpha", output: "cargo build" },
      { title: "beta", output: "npm test" },
    ]);
    assert.equal(results.length, 2);
  });
});

describe("formatLangDetection", () => {
  it("shows no-sessions message", () => {
    const lines = formatLangDetection([]);
    assert.ok(lines[0].includes("no sessions"));
  });
  it("shows detected languages", () => {
    const results = detectFleetLanguages([{ title: "alpha", output: "cargo test\nsrc/main.rs" }]);
    const lines = formatLangDetection(results);
    assert.ok(lines.some((l) => l.includes("Rust")));
  });
});
