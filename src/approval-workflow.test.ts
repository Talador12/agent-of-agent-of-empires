import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { shouldAutoApprove, filterThroughApproval, formatApprovalWorkflowStatus } from "./approval-workflow.js";
import { ApprovalQueue } from "./approval-queue.js";
import type { Action, ReasonerResult } from "./types.js";

describe("shouldAutoApprove", () => {
  it("auto-approves wait actions", () => {
    const action: Action = { action: "wait", reason: "no action needed" };
    assert.equal(shouldAutoApprove(action, "high"), true);
  });

  it("requires approval for remove_agent", () => {
    const action: Action = { action: "remove_agent", session: "x" };
    assert.equal(shouldAutoApprove(action, "high"), false);
  });

  it("requires approval for stop_session", () => {
    const action: Action = { action: "stop_session", session: "x" };
    assert.equal(shouldAutoApprove(action, "high"), false);
  });

  it("auto-approves high-confidence send_input", () => {
    const action: Action = { action: "send_input", session: "x", text: "check status" };
    assert.equal(shouldAutoApprove(action, "high"), true);
  });

  it("auto-approves medium-confidence send_input (threshold=low)", () => {
    const action: Action = { action: "send_input", session: "x", text: "nudge" };
    assert.equal(shouldAutoApprove(action, "medium"), true);
  });

  it("queues low-confidence send_input (threshold=low)", () => {
    const action: Action = { action: "send_input", session: "x", text: "risky" };
    assert.equal(shouldAutoApprove(action, "low"), false); // low < low threshold
  });
});

describe("filterThroughApproval", () => {
  it("passes all high-confidence actions through", () => {
    const queue = new ApprovalQueue();
    const result: ReasonerResult = {
      actions: [
        { action: "send_input", session: "x", text: "hi" },
        { action: "wait", reason: "ok" },
      ],
      confidence: "high",
    };
    const { immediate, queued } = filterThroughApproval(result, queue);
    assert.equal(immediate.length, 2);
    assert.equal(queued.length, 0);
  });

  it("queues destructive actions regardless of confidence", () => {
    const queue = new ApprovalQueue();
    const result: ReasonerResult = {
      actions: [{ action: "remove_agent", session: "x" }],
      confidence: "high",
    };
    const { immediate, queued } = filterThroughApproval(result, queue);
    assert.equal(immediate.length, 0);
    assert.equal(queued.length, 1);
  });

  it("queues low-confidence non-trivial actions", () => {
    const queue = new ApprovalQueue();
    const result: ReasonerResult = {
      actions: [
        { action: "send_input", session: "x", text: "restart everything" },
        { action: "wait", reason: "thinking" },
      ],
      confidence: "low",
    };
    const { immediate, queued } = filterThroughApproval(result, queue);
    assert.equal(immediate.length, 1); // wait is always approved
    assert.equal(queued.length, 1); // send_input queued
  });
});

describe("formatApprovalWorkflowStatus", () => {
  it("shows all approved", () => {
    assert.ok(formatApprovalWorkflowStatus(0, 3).includes("auto-approved"));
  });

  it("shows mixed", () => {
    const s = formatApprovalWorkflowStatus(2, 1);
    assert.ok(s.includes("1 auto-approved"));
    assert.ok(s.includes("2 queued"));
  });
});
