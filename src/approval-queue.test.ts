import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { ApprovalQueue } from "./approval-queue.js";

describe("ApprovalQueue", () => {
  it("starts empty", () => {
    const q = new ApprovalQueue();
    assert.equal(q.getPending().length, 0);
  });

  it("enqueues items", () => {
    const q = new ApprovalQueue();
    const id = q.enqueue("test", "send_input", "nudge the session");
    assert.ok(id.startsWith("approval-"));
    assert.equal(q.getPending().length, 1);
  });

  it("approves by ID", () => {
    const q = new ApprovalQueue();
    const id = q.enqueue("test", "restart", "restart session");
    assert.equal(q.approve(id), true);
    assert.equal(q.getPending().length, 0);
  });

  it("rejects by ID", () => {
    const q = new ApprovalQueue();
    const id = q.enqueue("test", "stop", "stop session");
    assert.equal(q.reject(id), true);
    assert.equal(q.getPending().length, 0);
  });

  it("returns false for invalid ID", () => {
    const q = new ApprovalQueue();
    assert.equal(q.approve("nonexistent"), false);
    assert.equal(q.reject("nonexistent"), false);
  });

  it("approves all pending", () => {
    const q = new ApprovalQueue();
    q.enqueue("a", "send_input", "msg a");
    q.enqueue("b", "send_input", "msg b");
    q.enqueue("c", "restart", "restart c");
    const count = q.approveAll();
    assert.equal(count, 3);
    assert.equal(q.getPending().length, 0);
  });

  it("rejects all pending", () => {
    const q = new ApprovalQueue();
    q.enqueue("a", "send_input", "msg");
    q.enqueue("b", "send_input", "msg");
    assert.equal(q.rejectAll(), 2);
  });

  it("consumes approved items", () => {
    const q = new ApprovalQueue();
    const id = q.enqueue("test", "send_input", "nudge");
    q.approve(id);
    const approved = q.consumeApproved();
    assert.equal(approved.length, 1);
    assert.equal(approved[0].sessionTitle, "test");
    // consumed items are removed
    assert.equal(q.consumeApproved().length, 0);
  });

  it("expires old pending items", () => {
    const q = new ApprovalQueue({ expiryMs: 1000 });
    const now = Date.now();
    q.enqueue("old", "send_input", "old msg", "medium", now - 2000);
    q.enqueue("new", "send_input", "new msg", "medium", now);
    const pending = q.getPending(now);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].sessionTitle, "new");
  });

  it("enforces max pending", () => {
    const q = new ApprovalQueue({ maxPending: 2 });
    q.enqueue("a", "x", "1");
    q.enqueue("b", "x", "2");
    q.enqueue("c", "x", "3"); // should expire oldest
    assert.equal(q.getPending().length, 2);
  });

  it("tracks stats", () => {
    const q = new ApprovalQueue();
    const id1 = q.enqueue("a", "x", "1");
    q.enqueue("b", "x", "2");
    q.approve(id1);
    const stats = q.getStats();
    assert.equal(stats.pending, 1);
    assert.equal(stats.approved, 1);
    assert.equal(stats.total, 2);
  });

  it("formatQueue shows pending items", () => {
    const q = new ApprovalQueue();
    q.enqueue("adventure", "send_input", "check progress");
    const lines = q.formatQueue();
    assert.ok(lines.some((l) => l.includes("adventure")));
    assert.ok(lines.some((l) => l.includes("approve")));
  });

  it("formatQueue handles empty queue", () => {
    const q = new ApprovalQueue();
    const lines = q.formatQueue();
    assert.ok(lines[0].includes("no pending"));
  });
});
