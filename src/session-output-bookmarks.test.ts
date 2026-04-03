import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createBookmarkState, addBookmark, removeBookmark,
  getBookmarks, searchBookmarks, bookmarkCountBySession, formatBookmarks,
} from "./session-output-bookmarks.js";

describe("createBookmarkState", () => {
  it("starts empty", () => {
    const state = createBookmarkState();
    assert.equal(state.bookmarks.length, 0);
  });
});

describe("addBookmark", () => {
  it("adds a bookmark with incremental ID", () => {
    const state = createBookmarkState();
    const bm = addBookmark(state, "alpha", "test output line", "interesting");
    assert.equal(bm.id, 1);
    assert.equal(bm.sessionTitle, "alpha");
    assert.equal(bm.label, "interesting");
    assert.equal(state.bookmarks.length, 1);
  });

  it("truncates long text and labels", () => {
    const state = createBookmarkState();
    const bm = addBookmark(state, "a", "x".repeat(500), "y".repeat(100));
    assert.equal(bm.lineText.length, 300);
    assert.equal(bm.label.length, 50);
  });

  it("enforces max bookmarks", () => {
    const state = createBookmarkState(3);
    for (let i = 0; i < 5; i++) addBookmark(state, "a", `line ${i}`, `bm${i}`);
    assert.equal(state.bookmarks.length, 3);
  });
});

describe("removeBookmark", () => {
  it("removes by ID", () => {
    const state = createBookmarkState();
    addBookmark(state, "a", "line", "label");
    assert.ok(removeBookmark(state, 1));
    assert.equal(state.bookmarks.length, 0);
  });

  it("returns false for invalid ID", () => {
    const state = createBookmarkState();
    assert.ok(!removeBookmark(state, 999));
  });
});

describe("getBookmarks", () => {
  it("returns all bookmarks when no filter", () => {
    const state = createBookmarkState();
    addBookmark(state, "a", "line1", "l1");
    addBookmark(state, "b", "line2", "l2");
    assert.equal(getBookmarks(state).length, 2);
  });

  it("filters by session title (case-insensitive)", () => {
    const state = createBookmarkState();
    addBookmark(state, "Alpha", "line1", "l1");
    addBookmark(state, "beta", "line2", "l2");
    assert.equal(getBookmarks(state, "alpha").length, 1);
  });
});

describe("searchBookmarks", () => {
  it("searches by label", () => {
    const state = createBookmarkState();
    addBookmark(state, "a", "some output", "error-log");
    addBookmark(state, "b", "other output", "success");
    assert.equal(searchBookmarks(state, "error").length, 1);
  });

  it("searches by line text", () => {
    const state = createBookmarkState();
    addBookmark(state, "a", "FAILED: test_auth", "test");
    addBookmark(state, "b", "all tests passed", "test");
    assert.equal(searchBookmarks(state, "FAILED").length, 1);
  });
});

describe("bookmarkCountBySession", () => {
  it("counts per session", () => {
    const state = createBookmarkState();
    addBookmark(state, "a", "l1", "x");
    addBookmark(state, "a", "l2", "y");
    addBookmark(state, "b", "l3", "z");
    const counts = bookmarkCountBySession(state);
    assert.equal(counts.get("a"), 2);
    assert.equal(counts.get("b"), 1);
  });
});

describe("formatBookmarks", () => {
  it("shows no-bookmarks message when empty", () => {
    const lines = formatBookmarks([]);
    assert.ok(lines[0].includes("none"));
  });

  it("shows bookmark details", () => {
    const state = createBookmarkState();
    addBookmark(state, "alpha", "test output here", "important");
    const lines = formatBookmarks(getBookmarks(state));
    assert.ok(lines[0].includes("Bookmarks"));
    assert.ok(lines.some((l) => l.includes("important")));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
