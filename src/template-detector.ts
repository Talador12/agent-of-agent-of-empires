// template-detector.ts — infer session template from repo file patterns.
// scans known file markers to detect project type (frontend, backend, infra, etc.)

import { findTemplate } from "./session-templates.js";
import type { SessionTemplate } from "./session-templates.js";

export interface DetectionResult {
  detectedTemplate: string | null;
  confidence: number;   // 0.0-1.0
  signals: string[];    // which files/patterns were found
}

// file patterns that signal a project type
const DETECTION_RULES: Array<{ template: string; patterns: string[]; weight: number }> = [
  // frontend
  { template: "frontend", patterns: ["package.json", "tsconfig.json", "vite.config", "next.config", "webpack.config", "tailwind.config", ".jsx", ".tsx", "src/components", "src/pages", "src/app"], weight: 1 },
  // backend
  { template: "backend", patterns: ["go.mod", "Cargo.toml", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle", "src/main", "cmd/", "internal/", "api/", "src/routes", "src/controllers"], weight: 1 },
  // infra
  { template: "infra", patterns: ["terraform", ".tf", "Dockerfile", "docker-compose", "k8s/", "helm/", ".github/workflows", ".gitlab-ci.yml", "Makefile", "Jenkinsfile", "ansible", "pulumi"], weight: 1 },
  // data
  { template: "data", patterns: ["notebook", ".ipynb", "dbt_project.yml", "airflow", "spark", "pandas", "tensorflow", "pytorch", "model/", "data/", "pipeline/"], weight: 1 },
  // docs
  { template: "docs", patterns: ["docs/", "wiki/", "mkdocs.yml", "docusaurus.config", "README.md", "CONTRIBUTING.md", ".mdx"], weight: 1 },
  // security
  { template: "security", patterns: ["security/", ".snyk", "trivy", "bandit", "semgrep", "audit", "cve", "vulnerability"], weight: 1 },
];

/**
 * Detect the most likely session template from a list of file/dir names.
 * Pass the output of `ls` or `readdir` of the project root.
 */
export function detectTemplate(fileNames: string[]): DetectionResult {
  const lowerFiles = fileNames.map((f) => f.toLowerCase());
  const scores = new Map<string, { score: number; signals: string[] }>();

  for (const rule of DETECTION_RULES) {
    let matchCount = 0;
    const signals: string[] = [];
    for (const pattern of rule.patterns) {
      const lp = pattern.toLowerCase();
      if (lowerFiles.some((f) => f.includes(lp))) {
        matchCount++;
        signals.push(pattern);
      }
    }
    if (matchCount > 0) {
      const score = (matchCount / rule.patterns.length) * rule.weight;
      const existing = scores.get(rule.template);
      if (!existing || score > existing.score) {
        scores.set(rule.template, { score, signals });
      }
    }
  }

  if (scores.size === 0) {
    return { detectedTemplate: null, confidence: 0, signals: [] };
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const best = sorted[0];
  return {
    detectedTemplate: best[0],
    confidence: Math.min(1, best[1].score),
    signals: best[1].signals,
  };
}

/**
 * Detect template and return the full SessionTemplate if found.
 */
export function detectAndResolveTemplate(fileNames: string[]): { template: SessionTemplate | null; detection: DetectionResult } {
  const detection = detectTemplate(fileNames);
  const template = detection.detectedTemplate ? findTemplate(detection.detectedTemplate) ?? null : null;
  return { template, detection };
}

/**
 * Format detection result for TUI display.
 */
export function formatDetectionResult(sessionTitle: string, result: DetectionResult): string[] {
  if (!result.detectedTemplate) {
    return [`  ${sessionTitle}: no template detected (${result.signals.length} signals)`];
  }
  return [
    `  ${sessionTitle}: detected "${result.detectedTemplate}" (${Math.round(result.confidence * 100)}% confidence)`,
    `    signals: ${result.signals.join(", ")}`,
  ];
}
