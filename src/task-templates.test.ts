import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAllTemplates, resolveTemplate, formatTemplateList } from "./task-templates.js";

describe("getAllTemplates", () => {
  it("returns at least 5 built-in templates", () => {
    const templates = getAllTemplates();
    assert.ok(templates.length >= 5, `expected >=5, got ${templates.length}`);
  });

  it("includes roadmap template", () => {
    const templates = getAllTemplates();
    assert.ok(templates.some((t) => t.name === "roadmap"));
  });

  it("includes pr-review template", () => {
    const templates = getAllTemplates();
    assert.ok(templates.some((t) => t.name === "pr-review"));
  });

  it("every template has name, description, and goal", () => {
    for (const t of getAllTemplates()) {
      assert.ok(t.name.length > 0, "name should be non-empty");
      assert.ok(t.description.length > 0, "description should be non-empty");
      assert.ok(t.goal.length > 0, "goal should be non-empty");
    }
  });
});

describe("resolveTemplate", () => {
  it("resolves exact name", () => {
    const t = resolveTemplate("roadmap");
    assert.ok(t);
    assert.equal(t.name, "roadmap");
  });

  it("resolves case-insensitively", () => {
    const t = resolveTemplate("ROADMAP");
    assert.ok(t);
    assert.equal(t.name, "roadmap");
  });

  it("resolves prefix match", () => {
    const t = resolveTemplate("road");
    assert.ok(t);
    assert.equal(t.name, "roadmap");
  });

  it("returns undefined for unknown name", () => {
    const t = resolveTemplate("nonexistent-template-xyz");
    assert.equal(t, undefined);
  });

  it("resolves bugfix template", () => {
    const t = resolveTemplate("bugfix");
    assert.ok(t);
    assert.ok(t.goal.includes("bug"));
  });

  it("resolves ci-fix template", () => {
    const t = resolveTemplate("ci-fix");
    assert.ok(t);
    assert.ok(t.goal.includes("CI"));
  });
});

describe("formatTemplateList", () => {
  it("returns non-empty string", () => {
    const result = formatTemplateList();
    assert.ok(result.length > 0);
  });

  it("includes all template names", () => {
    const result = formatTemplateList();
    for (const t of getAllTemplates()) {
      assert.ok(result.includes(t.name), `should include ${t.name}`);
    }
  });

  it("mentions custom templates file path", () => {
    const result = formatTemplateList();
    assert.ok(result.includes("templates.json"));
  });
});
