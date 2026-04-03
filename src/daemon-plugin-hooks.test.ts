import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { DaemonPluginHooks, formatPluginHooks } from "./daemon-plugin-hooks.js";

describe("DaemonPluginHooks", () => {
  it("starts with no hooks", () => {
    const h = new DaemonPluginHooks();
    assert.equal(h.hookCount(), 0);
  });

  it("registers a hook and returns ID", () => {
    const h = new DaemonPluginHooks();
    const id = h.register("pre-tick", "logger", () => {});
    assert.equal(id, 1);
    assert.equal(h.hookCount(), 1);
  });

  it("invokes hooks for matching phase", () => {
    const h = new DaemonPluginHooks();
    let called = false;
    h.register("pre-tick", "test", () => { called = true; });
    h.invoke("pre-tick", { tickNum: 1 });
    assert.ok(called);
  });

  it("does not invoke hooks for non-matching phase", () => {
    const h = new DaemonPluginHooks();
    let called = false;
    h.register("post-tick", "test", () => { called = true; });
    h.invoke("pre-tick", { tickNum: 1 });
    assert.ok(!called);
  });

  it("invokes hooks in priority order", () => {
    const h = new DaemonPluginHooks();
    const order: number[] = [];
    h.register("pre-tick", "low", () => { order.push(3); }, 300);
    h.register("pre-tick", "high", () => { order.push(1); }, 100);
    h.register("pre-tick", "mid", () => { order.push(2); }, 200);
    h.invoke("pre-tick", { tickNum: 1 });
    assert.deepEqual(order, [1, 2, 3]);
  });

  it("unregisters a hook", () => {
    const h = new DaemonPluginHooks();
    const id = h.register("pre-tick", "test", () => {});
    assert.ok(h.unregister(id));
    assert.equal(h.hookCount(), 0);
  });

  it("unregister returns false for unknown ID", () => {
    const h = new DaemonPluginHooks();
    assert.equal(h.unregister(999), false);
  });

  it("disables a hook", () => {
    const h = new DaemonPluginHooks();
    let called = false;
    const id = h.register("pre-tick", "test", () => { called = true; });
    h.setEnabled(id, false);
    h.invoke("pre-tick", { tickNum: 1 });
    assert.ok(!called);
  });

  it("re-enables a hook", () => {
    const h = new DaemonPluginHooks();
    let called = false;
    const id = h.register("pre-tick", "test", () => { called = true; });
    h.setEnabled(id, false);
    h.setEnabled(id, true);
    h.invoke("pre-tick", { tickNum: 1 });
    assert.ok(called);
  });

  it("catches hook errors without crashing", () => {
    const h = new DaemonPluginHooks();
    h.register("pre-tick", "bad", () => { throw new Error("boom"); });
    let secondRan = false;
    h.register("pre-tick", "good", () => { secondRan = true; });
    h.invoke("pre-tick", { tickNum: 1 });
    assert.ok(secondRan);
    assert.equal(h.stats().errors, 1);
  });

  it("tracks invocation stats", () => {
    const h = new DaemonPluginHooks();
    h.register("pre-tick", "a", () => {});
    h.register("pre-tick", "b", () => {});
    h.invoke("pre-tick", { tickNum: 1 });
    assert.equal(h.stats().invocations, 2);
  });

  it("lists hooks", () => {
    const h = new DaemonPluginHooks();
    h.register("pre-tick", "a", () => {});
    h.register("post-reason", "b", () => {});
    const list = h.listHooks();
    assert.equal(list.length, 2);
  });

  it("filters hooks by phase", () => {
    const h = new DaemonPluginHooks();
    h.register("pre-tick", "a", () => {});
    h.register("post-reason", "b", () => {});
    h.register("pre-tick", "c", () => {});
    assert.equal(h.hooksForPhase("pre-tick").length, 2);
    assert.equal(h.hooksForPhase("post-reason").length, 1);
  });
});

describe("formatPluginHooks", () => {
  it("shows no-hooks message when empty", () => {
    const h = new DaemonPluginHooks();
    const lines = formatPluginHooks(h);
    assert.ok(lines.some((l) => l.includes("No hooks")));
  });

  it("shows hooks grouped by phase", () => {
    const h = new DaemonPluginHooks();
    h.register("pre-tick", "logger", () => {});
    h.register("post-reason", "tracker", () => {});
    const lines = formatPluginHooks(h);
    assert.ok(lines.some((l) => l.includes("pre-tick")));
    assert.ok(lines.some((l) => l.includes("post-reason")));
    assert.ok(lines.some((l) => l.includes("logger")));
  });
});
