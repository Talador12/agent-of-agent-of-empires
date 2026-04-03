import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { BUILTIN_WORKFLOW_TEMPLATES, findWorkflowTemplate, instantiateWorkflow, formatWorkflowTemplateList } from "./workflow-templates.js";

describe("BUILTIN_WORKFLOW_TEMPLATES", () => {
  it("has at least 4 templates", () => { assert.ok(BUILTIN_WORKFLOW_TEMPLATES.length >= 4); });
  it("all templates have stages", () => {
    for (const t of BUILTIN_WORKFLOW_TEMPLATES) {
      assert.ok(t.stages.length >= 2, `${t.name} has fewer than 2 stages`);
      assert.ok(t.name); assert.ok(t.description); assert.ok(t.tags.length > 0);
    }
  });
});

describe("findWorkflowTemplate", () => {
  it("finds by exact name", () => { assert.equal(findWorkflowTemplate("ci-cd")?.name, "ci-cd"); });
  it("finds case-insensitive", () => { assert.equal(findWorkflowTemplate("FEATURE-DEV")?.name, "feature-dev"); });
  it("returns undefined for unknown", () => { assert.equal(findWorkflowTemplate("nonexistent"), undefined); });
});

describe("instantiateWorkflow", () => {
  it("creates workflow with unique session titles", () => {
    const template = findWorkflowTemplate("ci-cd")!;
    const wf = instantiateWorkflow(template, "myproject");
    assert.ok(wf.name.includes("myproject"));
    assert.equal(wf.stages.length, 3);
    const titles = wf.stages.flatMap((s) => s.tasks.map((t) => t.sessionTitle));
    assert.equal(titles.length, new Set(titles).size); // all unique
  });

  it("preserves stage structure", () => {
    const template = findWorkflowTemplate("feature-dev")!;
    const wf = instantiateWorkflow(template, "feat");
    assert.equal(wf.stages[0].name, "implement");
    assert.equal(wf.stages[3].name, "merge");
  });
});

describe("formatWorkflowTemplateList", () => {
  it("lists all templates with stages", () => {
    const lines = formatWorkflowTemplateList();
    assert.ok(lines[0].includes("Workflow templates"));
    assert.ok(lines.some((l) => l.includes("ci-cd")));
    assert.ok(lines.some((l) => l.includes("→"))); // stage arrows
  });
});
