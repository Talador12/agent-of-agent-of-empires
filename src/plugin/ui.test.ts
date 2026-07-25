import { test } from "node:test";
import assert from "node:assert/strict";
import { queueCardPayload, statusBarPayload, attentionColumnPayload, attentionSortPayload, sessionPanePayload, spawnReportBlocks } from "./ui.js";
import type { QueueRow } from "./attention.js";
import type { SpawnReport } from "./spawn.js";

function row(overrides: Partial<QueueRow>): QueueRow {
  return {
    sessionId: "s1",
    title: "session one",
    tool: "claude",
    projectPath: "/p",
    status: "Waiting",
    attentionScore: 65,
    inStatusForMs: 5 * 60_000,
    pluginOwned: false,
    reasons: ["status Waiting"],
    ...overrides,
  };
}

const summary = { paused: false, dryRun: true, reasoner: "rules" };

test("queue card shows top rows, dry-run note, and action buttons", () => {
  const rows = Array.from({ length: 7 }, (_, i) => row({ sessionId: `s${i}`, title: `sess ${i}` }));
  const card = queueCardPayload(rows, summary);
  assert.match(JSON.stringify(card.blocks[0]), /Dry run/);
  const rowBlocks = card.blocks.filter((b) => b.kind === "row");
  assert.equal(rowBlocks.length, 5); // top 5 only
  assert.match(JSON.stringify(card.blocks), /\+2 more/);
  const actions = card.blocks.filter((b) => b.kind === "action");
  assert.deepEqual(actions.map((a) => a.method), ["aoaoe.tick", "aoaoe.pause"]);
});

test("paused card offers resume instead of pause", () => {
  const card = queueCardPayload([], { ...summary, paused: true });
  const actions = card.blocks.filter((b) => b.kind === "action");
  assert.deepEqual(actions.map((a) => a.method), ["aoaoe.tick", "aoaoe.resume"]);
});

test("status bar flags urgent counts and pause state", () => {
  assert.equal(statusBarPayload([row({ attentionScore: 80 })], summary).text, "orch 1!");
  assert.equal(statusBarPayload([row({ attentionScore: 10 })], summary).text, "orch 1");
  assert.equal(statusBarPayload([], { ...summary, paused: true }).text, "orch ⏸");
});

test("row column carries a numeric sort_value matching the sort-key contract", () => {
  const col = attentionColumnPayload(row({ attentionScore: 72.4 }));
  assert.equal(typeof col.sort_value, "number");
  const sort = attentionSortPayload();
  assert.equal(sort.column, "attention_score"); // must match the [[ui]] row-column id
  assert.equal(sort.direction, "desc");
});

test("session pane includes signals and a recommendation when given", () => {
  const pane = sessionPanePayload(row({}), "check on this");
  assert.equal(pane.title, "Orchestrator");
  assert.match(JSON.stringify(pane.blocks), /check on this/);
});

test("spawn report renders errors, dry runs, and creations distinctly", () => {
  const base: SpawnReport = { repo: "o/r", live: false, outcomes: [] };
  assert.match(JSON.stringify(spawnReportBlocks({ ...base, error: "boom" })), /boom/);
  assert.match(JSON.stringify(spawnReportBlocks(base)), /No open issues/);
  const mixed: SpawnReport = {
    repo: "o/r",
    live: true,
    outcomes: [
      { issue: { number: 1, title: "one", body: "", url: "" }, planned: false, created: true, sessionId: "s1" },
      { issue: { number: 2, title: "two", body: "", url: "" }, planned: false, created: false, skippedReason: "pool full" },
    ],
  };
  const text = JSON.stringify(spawnReportBlocks(mixed));
  assert.match(text, /spawned s1/);
  assert.match(text, /pool full/);
});
