import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analysePaneOutput, classifyVibe, formatVibe } from "./vibe.js";
import type { VibeLabel } from "./vibe.js";

// ── analysePaneOutput ────────────────────────────────────────────────────────

describe("analysePaneOutput", () => {
  it("counts error lines", () => {
    const output = "Building...\nError: cannot find module 'foo'\nFailed to compile\n";
    const r = analysePaneOutput(output);
    assert.ok(r.errorCount >= 2, `expected >=2 errors, got ${r.errorCount}`);
  });

  it("counts progress lines", () => {
    const output = "git commit -m 'fix'\ngit push origin main\n✓ tests passed\n";
    const r = analysePaneOutput(output);
    assert.ok(r.progressCount >= 2, `expected >=2 progress, got ${r.progressCount}`);
  });

  it("counts waiting lines", () => {
    const output = "Should I proceed with the refactor?\nWaiting for confirmation...\n";
    const r = analysePaneOutput(output);
    assert.ok(r.waitingCount >= 1, `expected >=1 waiting, got ${r.waitingCount}`);
  });

  it("detects repeated lines (loop)", () => {
    const line = "Error: ECONNREFUSED connection refused";
    const repeated = Array(8).fill(line).join("\n");
    const r = analysePaneOutput(repeated);
    assert.ok(r.repeatedLineRatio > 0.4, `expected loop signal, got ${r.repeatedLineRatio}`);
  });

  it("no loop signal for varied output", () => {
    const output = [
      "Installing dependencies...",
      "Building TypeScript...",
      "Running tests...",
      "✓ 100 tests passed",
      "git push origin main",
    ].join("\n");
    const r = analysePaneOutput(output);
    assert.ok(r.repeatedLineRatio < 0.3, `expected low loop ratio, got ${r.repeatedLineRatio}`);
  });

  it("strips ANSI before analysis", () => {
    const output = "\x1b[31mError:\x1b[0m something went wrong\n";
    const r = analysePaneOutput(output);
    assert.ok(r.errorCount >= 1);
  });

  it("strips chrome lines", () => {
    const output = "ctrl+p for commands\n─────────────────\nActual work here\n";
    const r = analysePaneOutput(output);
    // chrome lines should not inflate counts
    assert.equal(r.progressCount, 0);
    assert.equal(r.errorCount, 0);
  });
});

// ── classifyVibe ──────────────────────────────────────────────────────────────

function vibe(
  outputLines: string[],
  status = "working",
  opts: { userActive?: boolean; idleSinceMs?: number; consecutiveErrors?: number } = {}
): VibeLabel {
  const output = outputLines.join("\n");
  const analysis = analysePaneOutput(output);
  const result = classifyVibe(analysis, {
    userActive: opts.userActive ?? false,
    status,
    idleSinceMs: opts.idleSinceMs,
    consecutiveErrors: opts.consecutiveErrors ?? 0,
  });
  return result.label;
}

describe("classifyVibe", () => {
  it("returns 'you' when user is active", () => {
    assert.equal(vibe([], "working", { userActive: true }), "you");
  });

  it("returns 'lost' on repeated error loop", () => {
    const loopLine = "Error: ECONNREFUSED connection refused to localhost";
    const lines = Array(10).fill(loopLine);
    assert.equal(vibe(lines, "error"), "lost");
  });

  it("returns 'lost' for many consecutive errors with no progress", () => {
    const lines = ["Error: type mismatch", "Error: type mismatch", "Error: type mismatch"];
    assert.equal(vibe(lines, "error", { consecutiveErrors: 5 }), "lost");
  });

  it("returns 'needs↑' when agent asks questions", () => {
    const lines = ["I've reviewed the code.", "Should I proceed with the refactor?", "What approach would you prefer?"];
    assert.equal(vibe(lines, "waiting"), "needs↑");
  });

  it("returns 'focused' when fixing errors with some progress", () => {
    const lines = [
      "TypeError: cannot read property 'x' of undefined",
      "Trying to fix the null check...",
      "Fixed the null check, running tests",
      "✓ tests passed",
    ];
    assert.equal(vibe(lines, "working"), "focused");
  });

  it("returns 'flowing' on clear progress signals", () => {
    const lines = [
      "git commit -m 'add feature'",
      "✓ 50 tests passed",
      "git push origin main",
      "npm run build",
      "compiled successfully",
    ];
    assert.equal(vibe(lines, "working"), "flowing");
  });

  it("returns 'idle' when session is done", () => {
    assert.equal(vibe([], "done"), "idle");
  });

  it("returns 'idle' when stale with no recent output", () => {
    assert.equal(vibe([], "working", { idleSinceMs: 300_000 }), "idle");
  });

  it("returns 'flowing' for active working session with recent output", () => {
    const lines = Array(10).fill("Processing file...").map((l, i) => `${l} ${i}`);
    // varied lines, active status — should be flowing
    assert.equal(vibe(lines, "working"), "flowing");
  });
});

// ── formatVibe ────────────────────────────────────────────────────────────────

describe("formatVibe", () => {
  const labels: VibeLabel[] = ["lost", "needs↑", "focused", "flowing", "idle", "you"];

  for (const label of labels) {
    it(`formats '${label}' without throwing`, () => {
      const result = formatVibe({ label });
      assert.ok(typeof result === "string");
      assert.ok(result.length > 0);
      // should contain the label text (modulo ANSI)
      const plain = result.replace(/\x1b\[[0-9;]*m/g, "");
      assert.ok(plain.includes(label.replace("↑", "↑")), `expected '${label}' in '${plain}'`);
    });
  }

  it("produces a non-empty string for every label", () => {
    for (const label of labels) {
      const plain = formatVibe({ label }).replace(/\x1b\[[0-9;]*m/g, "");
      assert.ok(plain.trim().length > 0, `expected non-empty output for '${label}'`);
    }
  });
});
