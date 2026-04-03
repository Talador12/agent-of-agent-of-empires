import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateBashCompletion, generateZshCompletion, generateFishCompletion, generateCompletion, formatCommandList, CLI_COMMANDS, TUI_COMMANDS } from "./cli-completions.js";

describe("CLI_COMMANDS", () => {
  it("has expected commands", () => {
    assert.ok(CLI_COMMANDS.includes("init"));
    assert.ok(CLI_COMMANDS.includes("tasks"));
    assert.ok(CLI_COMMANDS.includes("health"));
    assert.ok(CLI_COMMANDS.includes("doctor"));
  });
});

describe("TUI_COMMANDS", () => {
  it("has 55+ commands", () => {
    assert.ok(TUI_COMMANDS.length >= 55);
  });
  it("all start with /", () => {
    for (const cmd of TUI_COMMANDS) assert.ok(cmd.startsWith("/"), `${cmd} should start with /`);
  });
});

describe("generateBashCompletion", () => {
  it("generates valid bash completion", () => {
    const script = generateBashCompletion();
    assert.ok(script.includes("_aoaoe"));
    assert.ok(script.includes("complete -F"));
    assert.ok(script.includes("COMPREPLY"));
    assert.ok(script.includes("init"));
  });
});

describe("generateZshCompletion", () => {
  it("generates valid zsh completion", () => {
    const script = generateZshCompletion();
    assert.ok(script.includes("_aoaoe"));
    assert.ok(script.includes("compdef"));
    assert.ok(script.includes("commands"));
  });
});

describe("generateFishCompletion", () => {
  it("generates valid fish completion", () => {
    const script = generateFishCompletion();
    assert.ok(script.includes("complete -c aoaoe"));
    assert.ok(script.includes("init"));
  });
});

describe("generateCompletion", () => {
  it("dispatches to correct shell", () => {
    assert.ok(generateCompletion("bash").includes("_aoaoe"));
    assert.ok(generateCompletion("zsh").includes("compdef"));
    assert.ok(generateCompletion("fish").includes("complete -c"));
  });
});

describe("formatCommandList", () => {
  it("lists both CLI and TUI commands", () => {
    const lines = formatCommandList();
    assert.ok(lines.some((l) => l.includes("CLI commands")));
    assert.ok(lines.some((l) => l.includes("TUI slash commands")));
  });
});
