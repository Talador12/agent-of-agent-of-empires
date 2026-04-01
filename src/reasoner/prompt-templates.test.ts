import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAllPromptTemplates, resolvePromptTemplate, applyPromptTemplate, formatPromptTemplateList } from "./prompt-templates.js";

describe("getAllPromptTemplates", () => {
  it("returns at least 5 built-in templates", () => {
    const templates = getAllPromptTemplates();
    assert.ok(templates.length >= 5, `expected >=5, got ${templates.length}`);
  });

  it("includes default template", () => {
    assert.ok(getAllPromptTemplates().some((t) => t.name === "default"));
  });

  it("includes hands-off template", () => {
    assert.ok(getAllPromptTemplates().some((t) => t.name === "hands-off"));
  });

  it("includes aggressive template", () => {
    assert.ok(getAllPromptTemplates().some((t) => t.name === "aggressive"));
  });

  it("every template has name, description, and preamble", () => {
    for (const t of getAllPromptTemplates()) {
      assert.ok(t.name.length > 0);
      assert.ok(t.description.length > 0);
      assert.ok(typeof t.preamble === "string");
    }
  });
});

describe("resolvePromptTemplate", () => {
  it("resolves exact name", () => {
    const t = resolvePromptTemplate("hands-off");
    assert.ok(t);
    assert.equal(t.name, "hands-off");
  });

  it("resolves case-insensitively", () => {
    const t = resolvePromptTemplate("AGGRESSIVE");
    assert.ok(t);
    assert.equal(t.name, "aggressive");
  });

  it("resolves prefix match", () => {
    const t = resolvePromptTemplate("hand");
    assert.ok(t);
    assert.equal(t.name, "hands-off");
  });

  it("returns undefined for unknown", () => {
    assert.equal(resolvePromptTemplate("nonexistent-xyz"), undefined);
  });
});

describe("applyPromptTemplate", () => {
  const base = "You are a supervisor.";

  it("returns base prompt unchanged for default template", () => {
    assert.equal(applyPromptTemplate(base, "default"), base);
  });

  it("prepends preamble for non-default template", () => {
    const result = applyPromptTemplate(base, "hands-off");
    assert.ok(result.startsWith("IMPORTANT OVERRIDE"));
    assert.ok(result.includes(base));
  });

  it("returns base prompt for unknown template name", () => {
    assert.equal(applyPromptTemplate(base, "nonexistent"), base);
  });

  it("returns base prompt for empty template name", () => {
    assert.equal(applyPromptTemplate(base, ""), base);
  });
});

describe("formatPromptTemplateList", () => {
  it("returns non-empty string", () => {
    assert.ok(formatPromptTemplateList().length > 0);
  });

  it("includes all template names", () => {
    const result = formatPromptTemplateList();
    for (const t of getAllPromptTemplates()) {
      assert.ok(result.includes(t.name), `should include ${t.name}`);
    }
  });

  it("mentions custom templates file path", () => {
    assert.ok(formatPromptTemplateList().includes("prompt-templates.json"));
  });
});
