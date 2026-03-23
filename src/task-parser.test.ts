import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseTasks,
  parseModel,
  parseContext,
  parseCost,
  parseLastLine,
  formatTaskList,
} from "./task-parser.js";

describe("parseTasks", () => {
  it("parses OpenCode-style checkmarks", () => {
    const output = [
      "[✓] Build the config loader",
      "[•] Write unit tests",
      "[ ] Deploy to production",
      "[✗] Fix the flaky test",
    ].join("\n");
    const tasks = parseTasks(output);
    assert.equal(tasks.length, 4);
    assert.deepEqual(tasks[0], { text: "Build the config loader", status: "done" });
    assert.deepEqual(tasks[1], { text: "Write unit tests", status: "in_progress" });
    assert.deepEqual(tasks[2], { text: "Deploy to production", status: "pending" });
    assert.deepEqual(tasks[3], { text: "Fix the flaky test", status: "failed" });
  });

  it("parses markdown-style checkboxes", () => {
    const output = [
      "- [x] completed task",
      "- [X] also completed",
      "- [ ] pending task",
      "- [~] in-progress task",
      "* [x] star bullet done",
    ].join("\n");
    const tasks = parseTasks(output);
    assert.equal(tasks.length, 5);
    assert.equal(tasks[0].status, "done");
    assert.equal(tasks[1].status, "done");
    assert.equal(tasks[2].status, "pending");
    assert.equal(tasks[3].status, "in_progress");
    assert.equal(tasks[4].status, "done");
  });

  it("returns empty array for output with no tasks", () => {
    const output = "just some regular terminal output\nnothing to see here";
    assert.deepEqual(parseTasks(output), []);
  });

  it("handles mixed task styles and regular output", () => {
    const output = [
      "Building project...",
      "[✓] Compile TypeScript",
      "warning: unused variable",
      "- [ ] Run linter",
      "Done.",
    ].join("\n");
    const tasks = parseTasks(output);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].text, "Compile TypeScript");
    assert.equal(tasks[1].text, "Run linter");
  });

  it("trims task text", () => {
    const tasks = parseTasks("[✓]   extra spaces around text   ");
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].text, "extra spaces around text");
  });
});

describe("parseModel", () => {
  it("extracts Claude model name", () => {
    const output = "  Build  Claude Opus 4.6 Anthropic: Cloudflare AI Gateway · max";
    assert.equal(parseModel(output), "Claude Opus 4.6");
  });

  it("extracts GPT model name", () => {
    const output = "  Plan  GPT-4o-2025-01-01 OpenAI";
    assert.equal(parseModel(output), "GPT-4o-2025-01-01");
  });

  it("extracts Gemini model name", () => {
    const output = "  Build  Gemini 2.5-pro Google";
    assert.equal(parseModel(output), "Gemini 2.5-pro");
  });

  it("returns undefined when no model found", () => {
    assert.equal(parseModel("regular output with no model info"), undefined);
  });
});

describe("parseContext", () => {
  it("extracts token count", () => {
    assert.equal(parseContext("137,918 tokens used"), "137,918 tokens");
  });

  it("extracts simple token count", () => {
    assert.equal(parseContext("500 tokens"), "500 tokens");
  });

  it("extracts X / Y tokens format (with ceiling)", () => {
    assert.equal(parseContext("137,918 / 200,000 tokens"), "137,918 / 200,000 tokens");
  });

  it("prefers ceiling format over plain when both patterns present", () => {
    const result = parseContext("137,918 / 200,000 tokens");
    assert.ok(result?.includes("/"));
  });

  it("returns undefined when no tokens found", () => {
    assert.equal(parseContext("no token info here"), undefined);
  });
});

describe("parseCost", () => {
  it("extracts dollar cost", () => {
    assert.equal(parseCost("$3.42 spent"), "$3.42");
  });

  it("extracts zero cost", () => {
    assert.equal(parseCost("$0.00 spent"), "$0.00");
  });

  it("returns undefined when no cost found", () => {
    assert.equal(parseCost("no cost info"), undefined);
  });
});

describe("parseLastLine", () => {
  it("returns last non-empty line", () => {
    const output = "line one\nline two\nlast line\n\n";
    assert.equal(parseLastLine(output), "last line");
  });

  it("skips OpenCode UI chrome", () => {
    const output = "actual output\n⬝ something\nesc interrupt\n";
    assert.equal(parseLastLine(output), "actual output");
  });

  it("skips box-drawing chars", () => {
    const output = "real content\n┃│╹\n";
    assert.equal(parseLastLine(output), "real content");
  });

  it("truncates long lines", () => {
    const longLine = "x".repeat(150);
    assert.equal(parseLastLine(longLine), "x".repeat(97) + "...");
  });

  it("returns (no output) for empty input", () => {
    assert.equal(parseLastLine(""), "(no output)");
    assert.equal(parseLastLine("\n\n"), "(no output)");
  });
});

describe("formatTaskList", () => {
  it("formats tasks with correct icons", () => {
    const tasks = [
      { text: "done task", status: "done" as const },
      { text: "active task", status: "in_progress" as const },
      { text: "pending task", status: "pending" as const },
      { text: "failed task", status: "failed" as const },
    ];
    const result = formatTaskList(tasks);
    assert.ok(result.includes("[✓] done task"));
    assert.ok(result.includes("[•] active task"));
    assert.ok(result.includes("[○] pending task"));
    assert.ok(result.includes("[✗] failed task"));
  });

  it("returns placeholder for empty list", () => {
    assert.equal(formatTaskList([]), "  (no tasks detected)");
  });
});
