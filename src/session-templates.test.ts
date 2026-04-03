import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { BUILTIN_TEMPLATES, findTemplate, listTemplateNames, applyTemplate, formatTemplateList, formatTemplateDetail } from "./session-templates.js";

describe("BUILTIN_TEMPLATES", () => {
  it("has at least 5 templates", () => { assert.ok(BUILTIN_TEMPLATES.length >= 5); });
  it("all templates have required fields", () => {
    for (const t of BUILTIN_TEMPLATES) {
      assert.ok(t.name); assert.ok(t.description); assert.ok(t.promptHints.length > 0);
      assert.ok(t.suggestedTool); assert.ok(t.tags.length > 0);
    }
  });
});

describe("findTemplate", () => {
  it("finds by exact name", () => { assert.equal(findTemplate("frontend")?.name, "frontend"); });
  it("finds case-insensitive", () => { assert.equal(findTemplate("BACKEND")?.name, "backend"); });
  it("returns undefined for unknown", () => { assert.equal(findTemplate("nonexistent"), undefined); });
});

describe("listTemplateNames", () => {
  it("returns all template names", () => {
    const names = listTemplateNames();
    assert.ok(names.includes("frontend"));
    assert.ok(names.includes("backend"));
    assert.ok(names.includes("infra"));
  });
});

describe("applyTemplate", () => {
  it("appends prompt hints to string goal", () => {
    const template = findTemplate("frontend")!;
    const task = { repo: "test", goal: "build the UI" };
    const result = applyTemplate(template, task);
    assert.ok(typeof result.goal === "string");
    assert.ok((result.goal as string).includes("build the UI"));
    assert.ok((result.goal as string).includes("Session template hints:"));
  });

  it("appends prompt hints to array goal", () => {
    const template = findTemplate("backend")!;
    const task = { repo: "test", goal: ["implement auth", "add tests"] };
    const result = applyTemplate(template, task);
    assert.ok(Array.isArray(result.goal));
    assert.ok((result.goal as string[]).some((l) => l.includes("Session template hints:")));
  });

  it("uses template tool when task has none", () => {
    const template = findTemplate("infra")!;
    const task = { repo: "test", goal: "deploy" };
    const result = applyTemplate(template, task);
    assert.equal(result.tool, "opencode");
  });

  it("preserves task tool when specified", () => {
    const template = findTemplate("frontend")!;
    const task = { repo: "test", goal: "build", tool: "claude-code" };
    const result = applyTemplate(template, task);
    assert.equal(result.tool, "claude-code");
  });
});

describe("formatTemplateList", () => {
  it("lists all templates", () => {
    const lines = formatTemplateList();
    assert.ok(lines.length >= BUILTIN_TEMPLATES.length);
    assert.ok(lines.some((l) => l.includes("frontend")));
  });
});

describe("formatTemplateDetail", () => {
  it("shows template details", () => {
    const template = findTemplate("security")!;
    const lines = formatTemplateDetail(template);
    assert.ok(lines.some((l) => l.includes("security")));
    assert.ok(lines.some((l) => l.includes("Prompt hints")));
    assert.ok(lines.some((l) => l.includes("Policy overrides")));
  });
});
