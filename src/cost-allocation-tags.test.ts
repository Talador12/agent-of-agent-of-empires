import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { groupByTag, formatTagReport, parseTags } from "./cost-allocation-tags.js";

describe("parseTags", () => {
  it("parses key=value pairs", () => {
    const tags = parseTags("team=platform,project=aoaoe");
    assert.equal(tags.length, 2);
    assert.equal(tags[0].key, "team");
    assert.equal(tags[0].value, "platform");
  });
  it("handles empty string", () => {
    assert.deepEqual(parseTags(""), []);
  });
  it("handles values with =", () => {
    const tags = parseTags("note=a=b");
    assert.equal(tags[0].value, "a=b");
  });
});

describe("groupByTag", () => {
  it("groups sessions by tag", () => {
    const sessions = [
      { sessionTitle: "a", tags: [{ key: "team", value: "platform" }], costUsd: 5 },
      { sessionTitle: "b", tags: [{ key: "team", value: "platform" }], costUsd: 3 },
      { sessionTitle: "c", tags: [{ key: "team", value: "frontend" }], costUsd: 7 },
    ];
    const report = groupByTag(sessions, "team");
    assert.equal(report.groups.length, 2);
    assert.equal(report.groups[0].value, "platform"); // highest cost first ($5+$3=$8)
    assert.equal(report.groups[0].totalCostUsd, 8);
    assert.equal(report.groups[1].value, "frontend");
    assert.equal(report.groups[1].totalCostUsd, 7);
  });

  it("puts untagged sessions in (untagged) group", () => {
    const sessions = [{ sessionTitle: "a", tags: [], costUsd: 5 }];
    const report = groupByTag(sessions, "team");
    assert.equal(report.groups[0].value, "(untagged)");
  });
});

describe("formatTagReport", () => {
  it("handles empty", () => {
    const lines = formatTagReport({ tagKey: "team", groups: [] });
    assert.ok(lines[0].includes("no sessions"));
  });
  it("shows groups", () => {
    const report = groupByTag([
      { sessionTitle: "a", tags: [{ key: "team", value: "platform" }], costUsd: 10 },
    ], "team");
    const lines = formatTagReport(report);
    assert.ok(lines.some((l) => l.includes("platform")));
  });
});
