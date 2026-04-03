import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createHotSwapState, registerModule, swapModule,
  setModuleEnabled, listModules, swapStats, formatHotSwap,
} from "./daemon-hot-swap.js";

describe("createHotSwapState", () => {
  it("starts empty", () => {
    const s = createHotSwapState();
    assert.equal(s.modules.size, 0);
  });
});

describe("registerModule", () => {
  it("registers a module", () => {
    const s = createHotSwapState();
    const m = registerModule(s, "session-summarizer");
    assert.equal(m.name, "session-summarizer");
    assert.equal(m.version, 1);
    assert.equal(m.status, "active");
    assert.equal(s.modules.size, 1);
  });
});

describe("swapModule", () => {
  it("swaps to new version on success", () => {
    const s = createHotSwapState();
    registerModule(s, "test-mod", 1);
    const r = swapModule(s, "test-mod", 2);
    assert.ok(r.success);
    assert.equal(r.oldVersion, 1);
    assert.equal(r.newVersion, 2);
    assert.equal(s.modules.get("test-mod")!.version, 2);
  });

  it("rolls back on validation failure", () => {
    const s = createHotSwapState();
    registerModule(s, "test-mod", 1);
    const r = swapModule(s, "test-mod", 2, () => false);
    assert.ok(!r.success);
    assert.equal(s.modules.get("test-mod")!.version, 1); // still v1
    assert.equal(s.modules.get("test-mod")!.status, "active");
  });

  it("fails for unregistered module", () => {
    const s = createHotSwapState();
    const r = swapModule(s, "nonexistent", 2);
    assert.ok(!r.success);
    assert.ok(r.message.includes("not registered"));
  });

  it("records swap in history", () => {
    const s = createHotSwapState();
    registerModule(s, "test-mod", 1);
    swapModule(s, "test-mod", 2);
    assert.equal(s.swapHistory.length, 1);
  });

  it("handles validation exception", () => {
    const s = createHotSwapState();
    registerModule(s, "test-mod", 1);
    const r = swapModule(s, "test-mod", 2, () => { throw new Error("boom"); });
    assert.ok(!r.success);
    assert.equal(s.modules.get("test-mod")!.status, "failed");
  });

  it("enforces max history", () => {
    const s = createHotSwapState(3);
    registerModule(s, "mod", 1);
    for (let i = 2; i <= 10; i++) swapModule(s, "mod", i);
    assert.ok(s.swapHistory.length <= 3);
  });
});

describe("setModuleEnabled", () => {
  it("disables a module", () => {
    const s = createHotSwapState();
    registerModule(s, "mod", 1);
    assert.ok(setModuleEnabled(s, "mod", false));
    assert.equal(s.modules.get("mod")!.status, "disabled");
  });

  it("re-enables a module", () => {
    const s = createHotSwapState();
    registerModule(s, "mod", 1);
    setModuleEnabled(s, "mod", false);
    setModuleEnabled(s, "mod", true);
    assert.equal(s.modules.get("mod")!.status, "active");
  });

  it("returns false for unknown module", () => {
    const s = createHotSwapState();
    assert.ok(!setModuleEnabled(s, "nope", true));
  });
});

describe("listModules", () => {
  it("lists all registered modules", () => {
    const s = createHotSwapState();
    registerModule(s, "a"); registerModule(s, "b");
    assert.equal(listModules(s).length, 2);
  });
});

describe("swapStats", () => {
  it("computes stats", () => {
    const s = createHotSwapState();
    registerModule(s, "mod", 1);
    swapModule(s, "mod", 2);
    swapModule(s, "mod", 3, () => false);
    const stats = swapStats(s);
    assert.equal(stats.total, 2);
    assert.equal(stats.succeeded, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.modules, 1);
  });
});

describe("formatHotSwap", () => {
  it("shows module list", () => {
    const s = createHotSwapState();
    registerModule(s, "summarizer", 3);
    const lines = formatHotSwap(s);
    assert.ok(lines[0].includes("Hot Swap"));
    assert.ok(lines.some((l) => l.includes("summarizer")));
  });

  it("shows no-modules message when empty", () => {
    const s = createHotSwapState();
    const lines = formatHotSwap(s);
    assert.ok(lines.some((l) => l.includes("No modules")));
  });
});
