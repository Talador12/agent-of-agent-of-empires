// api-pagination.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeCursor,
  decodeCursor,
  paginate,
  parsePaginationParams,
  paginationHeaders,
  formatPagination,
} from "./api-pagination.js";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips cursor data", () => {
    const cursor = encodeCursor(42, "forward");
    const decoded = decodeCursor(cursor);
    assert.ok(decoded);
    assert.equal(decoded.offset, 42);
    assert.equal(decoded.direction, "forward");
  });

  it("handles backward direction", () => {
    const cursor = encodeCursor(10, "backward");
    const decoded = decodeCursor(cursor);
    assert.ok(decoded);
    assert.equal(decoded.direction, "backward");
  });

  it("returns null for invalid cursor", () => {
    assert.equal(decodeCursor("not-valid-base64!!!"), null);
    assert.equal(decodeCursor(""), null);
  });

  it("returns null for negative offset", () => {
    const fake = Buffer.from(JSON.stringify({ offset: -1, direction: "forward" })).toString("base64url");
    assert.equal(decodeCursor(fake), null);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));

  it("returns first page by default", () => {
    const result = paginate(items, { limit: 10 });
    assert.equal(result.items.length, 10);
    assert.equal(result.items[0].id, 1);
    assert.equal(result.items[9].id, 10);
    assert.equal(result.pagination.hasMore, true);
    assert.equal(result.pagination.prevCursor, null);
    assert.equal(result.pagination.pageIndex, 0);
    assert.equal(result.pagination.totalItems, 50);
  });

  it("follows cursor to next page", () => {
    const page1 = paginate(items, { limit: 10 });
    assert.ok(page1.pagination.cursor);
    const page2 = paginate(items, { cursor: page1.pagination.cursor!, limit: 10 });
    assert.equal(page2.items[0].id, 11);
    assert.equal(page2.items.length, 10);
    assert.equal(page2.pagination.pageIndex, 1);
    assert.ok(page2.pagination.prevCursor); // can go back
  });

  it("last page has no next cursor", () => {
    const result = paginate(items, { cursor: encodeCursor(40), limit: 10 });
    assert.equal(result.items.length, 10);
    assert.equal(result.pagination.hasMore, false);
    assert.equal(result.pagination.cursor, null);
  });

  it("handles backward navigation", () => {
    const page2Cursor = encodeCursor(20);
    const result = paginate(items, { cursor: page2Cursor, limit: 10, direction: "backward" });
    assert.equal(result.items[0].id, 11); // went back from offset 20 to 10
    assert.equal(result.pagination.pageIndex, 1);
  });

  it("clamps to first page on backward past start", () => {
    const result = paginate(items, { cursor: encodeCursor(5), limit: 10, direction: "backward" });
    assert.equal(result.items[0].id, 1);
    assert.equal(result.pagination.prevCursor, null);
  });

  it("defaults to 20 items per page", () => {
    const result = paginate(items);
    assert.equal(result.items.length, 20);
  });

  it("caps at 100 items per page", () => {
    const bigItems = Array.from({ length: 200 }, (_, i) => i);
    const result = paginate(bigItems, { limit: 500 });
    assert.equal(result.items.length, 100);
  });

  it("handles empty array", () => {
    const result = paginate([], { limit: 10 });
    assert.equal(result.items.length, 0);
    assert.equal(result.pagination.hasMore, false);
    assert.equal(result.pagination.totalItems, 0);
  });

  it("handles array smaller than page size", () => {
    const small = [1, 2, 3];
    const result = paginate(small, { limit: 10 });
    assert.equal(result.items.length, 3);
    assert.equal(result.pagination.hasMore, false);
  });
});

describe("parsePaginationParams", () => {
  it("parses cursor and limit from URL", () => {
    const url = new URL("http://localhost/api?cursor=abc&limit=5");
    const params = parsePaginationParams(url);
    assert.equal(params.cursor, "abc");
    assert.equal(params.limit, 5);
  });

  it("parses direction=backward", () => {
    const url = new URL("http://localhost/api?direction=backward");
    const params = parsePaginationParams(url);
    assert.equal(params.direction, "backward");
  });

  it("defaults to forward direction", () => {
    const url = new URL("http://localhost/api");
    const params = parsePaginationParams(url);
    assert.equal(params.direction, "forward");
  });
});

describe("paginationHeaders", () => {
  it("builds response headers", () => {
    const headers = paginationHeaders({
      cursor: "abc",
      prevCursor: null,
      hasMore: true,
      totalItems: 100,
      pageSize: 20,
      pageIndex: 0,
    });
    assert.equal(headers["X-Total-Count"], "100");
    assert.equal(headers["X-Has-More"], "true");
    assert.equal(headers["X-Next-Cursor"], "abc");
    assert.ok(!headers["X-Prev-Cursor"]);
  });
});

describe("formatPagination", () => {
  it("formats pagination info for TUI", () => {
    const lines = formatPagination({
      cursor: "abc",
      prevCursor: null,
      hasMore: true,
      totalItems: 100,
      pageSize: 20,
      pageIndex: 0,
    });
    assert.ok(lines[0].includes("page 1"));
    assert.ok(lines[0].includes("100 total"));
    assert.ok(lines.some((l) => l.includes("has more: true")));
  });
});
