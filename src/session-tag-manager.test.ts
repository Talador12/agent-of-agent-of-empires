import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createTagStore, setTag, getTag, getTags, removeTag, findByTag, formatTagStore } from "./session-tag-manager.js";

describe("SessionTagStore", () => {
  it("sets and gets tags", () => {
    const store = createTagStore();
    setTag(store, "adventure", "team", "platform");
    assert.equal(getTag(store, "adventure", "team"), "platform");
  });
  it("returns undefined for missing tags", () => {
    const store = createTagStore();
    assert.equal(getTag(store, "nope", "team"), undefined);
  });
  it("gets all tags for a session", () => {
    const store = createTagStore();
    setTag(store, "a", "team", "platform");
    setTag(store, "a", "project", "aoaoe");
    const tags = getTags(store, "a");
    assert.equal(tags.size, 2);
  });
  it("removes tags", () => {
    const store = createTagStore();
    setTag(store, "a", "team", "x");
    assert.equal(removeTag(store, "a", "team"), true);
    assert.equal(getTag(store, "a", "team"), undefined);
  });
  it("finds sessions by tag", () => {
    const store = createTagStore();
    setTag(store, "a", "team", "platform");
    setTag(store, "b", "team", "frontend");
    setTag(store, "c", "team", "platform");
    assert.deepEqual(findByTag(store, "team", "platform").sort(), ["a", "c"]);
    assert.equal(findByTag(store, "team").length, 3);
  });
  it("formats empty store", () => {
    const lines = formatTagStore(createTagStore());
    assert.ok(lines[0].includes("no session tags"));
  });
  it("formats populated store", () => {
    const store = createTagStore();
    setTag(store, "adventure", "team", "platform");
    const lines = formatTagStore(store);
    assert.ok(lines.some((l) => l.includes("adventure") && l.includes("team=platform")));
  });
});
