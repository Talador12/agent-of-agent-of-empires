import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, deepMerge } from "./config.js";
import type { AoaoeConfig } from "./types.js";

describe("parseCliArgs", () => {
  // helper: simulate argv with "node" and "script" prefix
  const argv = (...args: string[]) => ["node", "aoaoe", ...args];

  it("parses --help", () => {
    const result = parseCliArgs(argv("--help"));
    assert.equal(result.help, true);
  });

  it("parses -h", () => {
    const result = parseCliArgs(argv("-h"));
    assert.equal(result.help, true);
  });

  it("parses --version", () => {
    const result = parseCliArgs(argv("--version"));
    assert.equal(result.version, true);
  });

  it("parses attach subcommand", () => {
    const result = parseCliArgs(argv("attach"));
    assert.equal(result.attach, true);
    assert.equal(result.register, false);
  });

  it("parses register subcommand", () => {
    const result = parseCliArgs(argv("register"));
    assert.equal(result.register, true);
    assert.equal(result.attach, false);
  });

  it("parses register --title", () => {
    const result = parseCliArgs(argv("register", "--title", "my-supervisor"));
    assert.equal(result.register, true);
    assert.equal(result.registerTitle, "my-supervisor");
  });

  it("parses register -t", () => {
    const result = parseCliArgs(argv("register", "-t", "my-supervisor"));
    assert.equal(result.register, true);
    assert.equal(result.registerTitle, "my-supervisor");
  });

  it("parses --reasoner", () => {
    const result = parseCliArgs(argv("--reasoner", "claude-code"));
    assert.equal(result.overrides.reasoner, "claude-code");
  });

  it("parses --poll-interval", () => {
    const result = parseCliArgs(argv("--poll-interval", "5000"));
    assert.equal(result.overrides.pollIntervalMs, 5000);
  });

  it("parses --port", () => {
    const result = parseCliArgs(argv("--port", "9999"));
    assert.equal(result.overrides.opencode?.port, 9999);
  });

  it("parses --model (sets both backends)", () => {
    const result = parseCliArgs(argv("--model", "gpt-4o"));
    assert.equal(result.overrides.opencode?.model, "gpt-4o");
    assert.equal(result.overrides.claudeCode?.model, "gpt-4o");
  });

  it("parses --verbose", () => {
    const result = parseCliArgs(argv("--verbose"));
    assert.equal(result.overrides.verbose, true);
  });

  it("parses -v", () => {
    const result = parseCliArgs(argv("-v"));
    assert.equal(result.overrides.verbose, true);
  });

  it("parses --dry-run", () => {
    const result = parseCliArgs(argv("--dry-run"));
    assert.equal(result.overrides.dryRun, true);
  });

  it("parses --profile", () => {
    const result = parseCliArgs(argv("--profile", "staging"));
    assert.equal(result.overrides.aoe?.profile, "staging");
  });

  it("parses multiple flags", () => {
    const result = parseCliArgs(argv("--reasoner", "claude-code", "--verbose", "--dry-run", "--poll-interval", "2000"));
    assert.equal(result.overrides.reasoner, "claude-code");
    assert.equal(result.overrides.verbose, true);
    assert.equal(result.overrides.dryRun, true);
    assert.equal(result.overrides.pollIntervalMs, 2000);
  });

  it("returns defaults for no args", () => {
    const result = parseCliArgs(argv());
    assert.equal(result.help, false);
    assert.equal(result.version, false);
    assert.equal(result.attach, false);
    assert.equal(result.register, false);
    assert.deepEqual(result.overrides, {});
  });
});

describe("deepMerge", () => {
  it("merges flat objects", () => {
    const result = deepMerge(
      { verbose: false, dryRun: false } as unknown as Record<string, unknown>,
      { verbose: true } as unknown as Record<string, unknown>,
    );
    assert.equal(result.verbose, true);
  });

  it("deep merges nested objects", () => {
    const base = {
      opencode: { port: 4097 },
      policies: { maxIdleBeforeNudgeMs: 120000 },
    };
    const override = {
      opencode: { port: 9999, model: "gpt-4o" },
    };
    const result = deepMerge(
      base as unknown as Record<string, unknown>,
      override as unknown as Record<string, unknown>,
    );
    assert.equal(result.opencode.port, 9999);
    assert.equal(result.opencode.model, "gpt-4o");
    // policies should be preserved from base
    assert.equal(result.policies.maxIdleBeforeNudgeMs, 120000);
  });

  it("does not overwrite with null or undefined", () => {
    const result = deepMerge(
      { verbose: true } as unknown as Record<string, unknown>,
      { verbose: undefined } as unknown as Record<string, unknown>,
    );
    assert.equal(result.verbose, true);
  });

  it("merges three objects in order", () => {
    const result = deepMerge(
      { pollIntervalMs: 10000 } as unknown as Record<string, unknown>,
      { pollIntervalMs: 5000 } as unknown as Record<string, unknown>,
      { pollIntervalMs: 2000 } as unknown as Record<string, unknown>,
    );
    assert.equal(result.pollIntervalMs, 2000);
  });
});
