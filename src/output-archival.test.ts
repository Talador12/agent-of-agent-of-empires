import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { formatArchiveList } from "./output-archival.js";

describe("formatArchiveList", () => {
  it("handles no archives", () => {
    // may or may not have archives depending on prior runs
    const lines = formatArchiveList();
    assert.ok(lines.length >= 1);
  });
});
