import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { detectTemplate, detectAndResolveTemplate, formatDetectionResult } from "./template-detector.js";

describe("detectTemplate", () => {
  it("detects frontend from React files", () => {
    const r = detectTemplate(["package.json", "tsconfig.json", "src/components", "vite.config.ts", "tailwind.config.js"]);
    assert.equal(r.detectedTemplate, "frontend");
    assert.ok(r.confidence > 0);
    assert.ok(r.signals.length > 0);
  });

  it("detects backend from Go files", () => {
    const r = detectTemplate(["go.mod", "cmd/", "internal/", "main.go"]);
    assert.equal(r.detectedTemplate, "backend");
  });

  it("detects infra from Terraform files", () => {
    const r = detectTemplate(["main.tf", "variables.tf", "terraform", "Dockerfile"]);
    assert.equal(r.detectedTemplate, "infra");
  });

  it("detects data from notebook files", () => {
    const r = detectTemplate(["model.ipynb", "data/", "pipeline/", "notebook"]);
    assert.equal(r.detectedTemplate, "data");
  });

  it("detects docs from documentation structure", () => {
    const r = detectTemplate(["docs/", "mkdocs.yml", "README.md"]);
    assert.equal(r.detectedTemplate, "docs");
  });

  it("detects security from audit patterns", () => {
    const r = detectTemplate(["security/", ".snyk", "trivy", "audit"]);
    assert.equal(r.detectedTemplate, "security");
  });

  it("returns null for unrecognized files", () => {
    const r = detectTemplate(["random.xyz", "unknown_file"]);
    assert.equal(r.detectedTemplate, null);
    assert.equal(r.confidence, 0);
  });

  it("chooses highest-scoring template when multiple match", () => {
    // has both frontend and backend signals, but more frontend
    const r = detectTemplate(["package.json", "tsconfig.json", "vite.config.ts", "tailwind.config.js", "src/components", "src/pages", "go.mod"]);
    assert.equal(r.detectedTemplate, "frontend");
  });
});

describe("detectAndResolveTemplate", () => {
  it("resolves to full SessionTemplate", () => {
    const { template, detection } = detectAndResolveTemplate(["package.json", "tsconfig.json", "src/components"]);
    assert.ok(template);
    assert.equal(template!.name, "frontend");
    assert.ok(detection.confidence > 0);
  });

  it("returns null template for unrecognized", () => {
    const { template } = detectAndResolveTemplate(["random.xyz"]);
    assert.equal(template, null);
  });
});

describe("formatDetectionResult", () => {
  it("shows detected template", () => {
    const result = detectTemplate(["go.mod", "cmd/"]);
    const lines = formatDetectionResult("adventure", result);
    assert.ok(lines[0].includes("backend"));
    assert.ok(lines[0].includes("adventure"));
  });

  it("shows no detection message", () => {
    const result = detectTemplate(["random"]);
    const lines = formatDetectionResult("test", result);
    assert.ok(lines[0].includes("no template detected"));
  });
});
