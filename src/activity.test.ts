import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSessionActivity, getActivityForSessions } from "./activity.js";

// these tests call real tmux — in CI without tmux, exec returns exitCode 1
// and the function returns the noClients fallback (graceful degradation).

describe("getSessionActivity", () => {
  it("returns noClients for nonexistent session", async () => {
    const info = await getSessionActivity("nonexistent_session_xyz_999");
    assert.equal(info.userActive, false);
    assert.equal(info.clientCount, 0);
    assert.equal(info.lastActivityMs, Infinity);
    assert.equal(info.tmuxName, "nonexistent_session_xyz_999");
  });

  it("returns noClients for empty tmux name", async () => {
    const info = await getSessionActivity("");
    assert.equal(info.userActive, false);
    assert.equal(info.clientCount, 0);
  });

  it("respects threshold parameter", async () => {
    const info = await getSessionActivity("nonexistent_session_xyz_999", 0);
    assert.equal(info.userActive, false);
  });

  it("returns correct shape", async () => {
    const info = await getSessionActivity("any_session");
    assert.equal(typeof info.userActive, "boolean");
    assert.equal(typeof info.clientCount, "number");
    assert.equal(typeof info.lastActivityMs, "number");
    assert.equal(typeof info.tmuxName, "string");
  });
});

describe("getActivityForSessions", () => {
  it("returns a map for all requested sessions", async () => {
    const result = await getActivityForSessions(["session_a", "session_b"]);
    assert.equal(result.size, 2);
    assert.ok(result.has("session_a"));
    assert.ok(result.has("session_b"));
  });

  it("each entry has correct shape", async () => {
    const result = await getActivityForSessions(["fake_session"]);
    const info = result.get("fake_session")!;
    assert.equal(typeof info.userActive, "boolean");
    assert.equal(typeof info.clientCount, "number");
    assert.equal(typeof info.lastActivityMs, "number");
    assert.equal(info.tmuxName, "fake_session");
  });

  it("handles empty array", async () => {
    const result = await getActivityForSessions([]);
    assert.equal(result.size, 0);
  });

  it("handles single session", async () => {
    const result = await getActivityForSessions(["one_session"]);
    assert.equal(result.size, 1);
    const info = result.get("one_session")!;
    assert.equal(info.userActive, false);
  });
});
