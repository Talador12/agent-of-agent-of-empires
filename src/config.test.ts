import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseCliArgs, deepMerge, validateConfig, findConfigFile, configFileExists, defaultConfigPath, warnUnknownKeys, computeConfigDiff } from "./config.js";
import { filterLogLines } from "./console.js";
import type { AoaoeConfig, Action } from "./types.js";
import { actionSession, actionDetail, toSessionStatus, toTaskState, toDaemonState, toAoeSessionList, toReasonerBackend, toActionLogEntry } from "./types.js";

describe("config file resolution", () => {
  it("defaultConfigPath points to ~/.aoaoe/aoaoe.config.json", () => {
    const expected = join(homedir(), ".aoaoe", "aoaoe.config.json");
    assert.equal(defaultConfigPath(), expected);
  });

  it("findConfigFile returns a string or null", () => {
    const result = findConfigFile();
    assert.ok(result === null || typeof result === "string");
  });

  it("configFileExists returns a boolean", () => {
    assert.ok(typeof configFileExists() === "boolean");
  });

  it("findConfigFile prefers ~/.aoaoe/ over cwd", () => {
    // if a config exists at ~/.aoaoe/, findConfigFile should return that path
    const found = findConfigFile();
    if (found && found.includes(".aoaoe")) {
      assert.ok(found.startsWith(homedir()), "config should be under home dir");
    }
  });
});

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

  it("parses register subcommand", () => {
    const result = parseCliArgs(argv("register"));
    assert.equal(result.register, true);
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

  it("throws on non-numeric --poll-interval", () => {
    assert.throws(
      () => parseCliArgs(argv("--poll-interval", "abc")),
      { message: /--poll-interval value 'abc' is not a valid number/ },
    );
  });

  it("throws on non-numeric --port", () => {
    assert.throws(
      () => parseCliArgs(argv("--port", "xyz")),
      { message: /--port value 'xyz' is not a valid number/ },
    );
  });

  it("throws on empty-string --poll-interval", () => {
    assert.throws(
      () => parseCliArgs(argv("--poll-interval", "")),
      { message: /--poll-interval value '' is not a valid number/ },
    );
  });

  it("parseInt truncates floats for --port (no throw)", () => {
    // parseInt("3.14", 10) => 3 — valid number, no NaN
    const result = parseCliArgs(argv("--port", "3.14"));
    assert.equal(result.overrides.opencode?.port, 3);
  });

  it("parses --health-port", () => {
    const result = parseCliArgs(argv("--health-port", "4098"));
    assert.equal(result.overrides.healthPort, 4098);
  });

  it("throws on non-numeric --health-port", () => {
    assert.throws(
      () => parseCliArgs(argv("--health-port", "abc")),
      { message: /--health-port value 'abc' is not a valid number/ },
    );
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

  it("parses test-context subcommand", () => {
    const result = parseCliArgs(argv("test-context"));
    assert.equal(result.testContext, true);
    assert.equal(result.register, false);
  });

  it("returns defaults for no args", () => {
    const result = parseCliArgs(argv());
    assert.equal(result.help, false);
    assert.equal(result.version, false);
    assert.equal(result.register, false);
    assert.equal(result.testContext, false);
    assert.equal(result.runInit, false);
    assert.equal(result.initForce, false);
    assert.equal(result.showStatus, false);
    assert.equal(result.showConfig, false);
    assert.deepEqual(result.overrides, {});
  });

  it("warns on unknown flags", () => {
    // capture stderr to check for warning
    const originalStderr = console.error;
    const warnings: string[] = [];
    console.error = (msg: string) => warnings.push(msg);
    try {
      const result = parseCliArgs(argv("--unknown-flag"));
      assert.ok(warnings.some(w => w.includes("unknown flag") && w.includes("--unknown-flag")));
      // should still return valid defaults (flag is ignored)
      assert.equal(result.help, false);
      assert.equal(result.version, false);
    } finally {
      console.error = originalStderr;
    }
  });

  it("does not warn on known flags", () => {
    const originalStderr = console.error;
    const warnings: string[] = [];
    console.error = (msg: string) => warnings.push(msg);
    try {
      parseCliArgs(argv("--verbose", "--dry-run"));
      assert.ok(!warnings.some(w => w.includes("unknown flag")));
    } finally {
      console.error = originalStderr;
    }
  });

  it("parses --confirm flag", () => {
    const result = parseCliArgs(argv("--confirm"));
    assert.equal(result.overrides.confirm, true);
  });

  it("parses --observe flag", () => {
    const result = parseCliArgs(argv("--observe"));
    assert.equal(result.overrides.observe, true);
  });

  it("parses init subcommand", () => {
    const result = parseCliArgs(argv("init"));
    assert.equal(result.runInit, true);
    assert.equal(result.initForce, false);
    assert.equal(result.register, false);
  });

  it("parses init --force", () => {
    const result = parseCliArgs(argv("init", "--force"));
    assert.equal(result.runInit, true);
    assert.equal(result.initForce, true);
  });

  it("parses init -f", () => {
    const result = parseCliArgs(argv("init", "-f"));
    assert.equal(result.runInit, true);
    assert.equal(result.initForce, true);
  });

  it("parses status subcommand", () => {
    const result = parseCliArgs(argv("status"));
    assert.equal(result.showStatus, true);
    assert.equal(result.showConfig, false);
    assert.equal(result.register, false);
  });

  it("parses tasks --json", () => {
    const result = parseCliArgs(argv("tasks", "--json"));
    assert.equal(result.showTasks, true);
    assert.equal(result.showTasksJson, true);
  });

  it("parses progress subcommand", () => {
    const result = parseCliArgs(argv("progress"));
    assert.equal(result.runProgress, true);
    assert.equal(result.progressSince, undefined);
    assert.equal(result.progressJson, false);
  });

  it("parses progress flags", () => {
    const result = parseCliArgs(argv("progress", "--since", "8h", "--json"));
    assert.equal(result.runProgress, true);
    assert.equal(result.progressSince, "8h");
    assert.equal(result.progressJson, true);
  });

  it("parses runbook subcommand", () => {
    const result = parseCliArgs(argv("runbook"));
    assert.equal(result.runRunbook, true);
    assert.equal(result.runbookJson, false);
    assert.equal(result.runbookSection, undefined);
    assert.equal(result.showStatus, false);
    assert.equal(result.runSupervisor, false);
    assert.equal(result.showConfig, false);
  });

  it("parses runbook --json", () => {
    const result = parseCliArgs(argv("runbook", "--json"));
    assert.equal(result.runRunbook, true);
    assert.equal(result.runbookJson, true);
    assert.equal(result.runbookSection, undefined);
    assert.equal(result.runSupervisor, false);
    assert.equal(result.showStatus, false);
  });

  it("parses runbook --section", () => {
    const result = parseCliArgs(argv("runbook", "--section", "response-flow"));
    assert.equal(result.runRunbook, true);
    assert.equal(result.runbookJson, false);
    assert.equal(result.runbookSection, "response-flow");
  });

  it("parses runbook incident alias section", () => {
    const result = parseCliArgs(argv("runbook", "incident"));
    assert.equal(result.runRunbook, true);
    assert.equal(result.runbookSection, "incident");
  });

  it("parses incident subcommand", () => {
    const result = parseCliArgs(argv("incident"));
    assert.equal(result.runIncident, true);
    assert.equal(result.incidentSince, undefined);
    assert.equal(result.incidentLimit, undefined);
    assert.equal(result.incidentJson, false);
    assert.equal(result.incidentNdjson, false);
    assert.equal(result.incidentWatch, false);
    assert.equal(result.incidentChangesOnly, false);
    assert.equal(result.incidentHeartbeatSec, undefined);
    assert.equal(result.incidentIntervalMs, undefined);
    assert.equal(result.runSupervisor, false);
  });

  it("parses incident flags", () => {
    const result = parseCliArgs(argv("incident", "--since", "2h", "--limit", "7", "--json", "--ndjson", "--watch", "--changes-only", "--heartbeat", "30", "--interval", "1200"));
    assert.equal(result.runIncident, true);
    assert.equal(result.incidentSince, "2h");
    assert.equal(result.incidentLimit, 7);
    assert.equal(result.incidentJson, true);
    assert.equal(result.incidentNdjson, true);
    assert.equal(result.incidentWatch, true);
    assert.equal(result.incidentChangesOnly, true);
    assert.equal(result.incidentHeartbeatSec, 30);
    assert.equal(result.incidentIntervalMs, 1200);
  });

  it("incident --follow implies watch + changes-only", () => {
    const result = parseCliArgs(argv("incident", "--follow"));
    assert.equal(result.runIncident, true);
    assert.equal(result.incidentWatch, true);
    assert.equal(result.incidentChangesOnly, true);
    assert.equal(result.incidentHeartbeatSec, 30);
  });

  it("parses supervisor subcommand", () => {
    const result = parseCliArgs(argv("supervisor"));
    assert.equal(result.runSupervisor, true);
    assert.equal(result.supervisorAll, false);
    assert.equal(result.supervisorJson, false);
    assert.equal(result.supervisorNdjson, false);
    assert.equal(result.supervisorWatch, false);
    assert.equal(result.supervisorChangesOnly, false);
    assert.equal(result.supervisorHeartbeatSec, undefined);
    assert.equal(result.supervisorIntervalMs, undefined);
    assert.equal(result.supervisorSince, undefined);
    assert.equal(result.supervisorLimit, undefined);
  });

  it("parses supervisor flags", () => {
    const result = parseCliArgs(argv("supervisor", "--all", "--since", "2h", "--limit", "12", "--json", "--ndjson", "--watch", "--changes-only", "--heartbeat", "45", "--interval", "1500"));
    assert.equal(result.runSupervisor, true);
    assert.equal(result.supervisorAll, true);
    assert.equal(result.supervisorSince, "2h");
    assert.equal(result.supervisorLimit, 12);
    assert.equal(result.supervisorJson, true);
    assert.equal(result.supervisorNdjson, true);
    assert.equal(result.supervisorWatch, true);
    assert.equal(result.supervisorChangesOnly, true);
    assert.equal(result.supervisorHeartbeatSec, 45);
    assert.equal(result.supervisorIntervalMs, 1500);
  });

  it("parses config subcommand", () => {
    const result = parseCliArgs(argv("config"));
    assert.equal(result.showConfig, true);
    assert.equal(result.showStatus, false);
    assert.equal(result.register, false);
  });

  it("parses notify-test subcommand", () => {
    const result = parseCliArgs(argv("notify-test"));
    assert.equal(result.notifyTest, true);
    assert.equal(result.showConfig, false);
    assert.equal(result.showStatus, false);
    assert.equal(result.register, false);
  });

  it("parses config --validate", () => {
    const result = parseCliArgs(argv("config", "--validate"));
    assert.equal(result.showConfig, true);
    assert.equal(result.configValidate, true);
    assert.equal(result.register, false);
  });

  it("parses config -V", () => {
    const result = parseCliArgs(argv("config", "-V"));
    assert.equal(result.showConfig, true);
    assert.equal(result.configValidate, true);
  });

  it("config without --validate has configValidate false", () => {
    const result = parseCliArgs(argv("config"));
    assert.equal(result.showConfig, true);
    assert.equal(result.configValidate, false);
  });

  it("parses config --diff", () => {
    const result = parseCliArgs(argv("config", "--diff"));
    assert.equal(result.showConfig, true);
    assert.equal(result.configDiff, true);
    assert.equal(result.configValidate, false);
  });

  it("config without --diff has configDiff false", () => {
    const result = parseCliArgs(argv("config"));
    assert.equal(result.configDiff, false);
  });

  it("parses doctor subcommand", () => {
    const result = parseCliArgs(argv("doctor"));
    assert.equal(result.runDoctor, true);
    assert.equal(result.showConfig, false);
    assert.equal(result.showStatus, false);
    assert.equal(result.register, false);
  });

  it("parses logs subcommand", () => {
    const result = parseCliArgs(argv("logs"));
    assert.equal(result.runLogs, true);
    assert.equal(result.logsActions, false);
    assert.equal(result.logsGrep, undefined);
    assert.equal(result.logsCount, undefined);
    assert.equal(result.showHistory, false);
    assert.equal(result.register, false);
  });

  it("parses logs --actions", () => {
    const result = parseCliArgs(argv("logs", "--actions"));
    assert.equal(result.runLogs, true);
    assert.equal(result.logsActions, true);
  });

  it("parses logs -a", () => {
    const result = parseCliArgs(argv("logs", "-a"));
    assert.equal(result.runLogs, true);
    assert.equal(result.logsActions, true);
  });

  it("parses logs --grep", () => {
    const result = parseCliArgs(argv("logs", "--grep", "error"));
    assert.equal(result.runLogs, true);
    assert.equal(result.logsGrep, "error");
  });

  it("parses logs -g", () => {
    const result = parseCliArgs(argv("logs", "-g", "timeout"));
    assert.equal(result.runLogs, true);
    assert.equal(result.logsGrep, "timeout");
  });

  it("parses logs -n", () => {
    const result = parseCliArgs(argv("logs", "-n", "100"));
    assert.equal(result.runLogs, true);
    assert.equal(result.logsCount, 100);
  });

  it("parses logs --count", () => {
    const result = parseCliArgs(argv("logs", "--count", "25"));
    assert.equal(result.runLogs, true);
    assert.equal(result.logsCount, 25);
  });

  it("parses logs with all flags", () => {
    const result = parseCliArgs(argv("logs", "--actions", "--grep", "send_input", "-n", "10"));
    assert.equal(result.runLogs, true);
    assert.equal(result.logsActions, true);
    assert.equal(result.logsGrep, "send_input");
    assert.equal(result.logsCount, 10);
  });

  it("logs -n ignores invalid count", () => {
    const result = parseCliArgs(argv("logs", "-n", "abc"));
    assert.equal(result.runLogs, true);
    assert.equal(result.logsCount, undefined);
  });

  it("logs -n ignores zero count", () => {
    const result = parseCliArgs(argv("logs", "-n", "0"));
    assert.equal(result.runLogs, true);
    assert.equal(result.logsCount, undefined);
  });

  it("subcommands are mutually exclusive", () => {
    const registerResult = parseCliArgs(argv("register"));
    assert.equal(registerResult.register, true);
    assert.equal(registerResult.testContext, false);
    assert.equal(registerResult.runInit, false);
    assert.equal(registerResult.showStatus, false);
    assert.equal(registerResult.showConfig, false);

    const testCtxResult = parseCliArgs(argv("test-context"));
    assert.equal(testCtxResult.register, false);
    assert.equal(testCtxResult.testContext, true);
    assert.equal(testCtxResult.runInit, false);
    assert.equal(testCtxResult.showStatus, false);

    const initResult = parseCliArgs(argv("init"));
    assert.equal(initResult.register, false);
    assert.equal(initResult.testContext, false);
    assert.equal(initResult.runInit, true);
    assert.equal(initResult.showStatus, false);

    const statusResult = parseCliArgs(argv("status"));
    assert.equal(statusResult.showStatus, true);
    assert.equal(statusResult.register, false);
    assert.equal(statusResult.runInit, false);
    assert.equal(statusResult.showConfig, false);

    const runbookResult = parseCliArgs(argv("runbook"));
    assert.equal(runbookResult.runRunbook, true);
    assert.equal(runbookResult.runbookJson, false);
    assert.equal(runbookResult.runbookSection, undefined);
    assert.equal(runbookResult.showStatus, false);
    assert.equal(runbookResult.runSupervisor, false);
    assert.equal(runbookResult.showConfig, false);

    const incidentResult = parseCliArgs(argv("incident"));
    assert.equal(incidentResult.runIncident, true);
    assert.equal(incidentResult.runSupervisor, false);
    assert.equal(incidentResult.runRunbook, false);
    assert.equal(incidentResult.showStatus, false);
    assert.equal(incidentResult.showConfig, false);

    const configResult = parseCliArgs(argv("config"));
    assert.equal(configResult.showConfig, true);
    assert.equal(configResult.register, false);
    assert.equal(configResult.showStatus, false);

    const notifyTestResult = parseCliArgs(argv("notify-test"));
    assert.equal(notifyTestResult.notifyTest, true);
    assert.equal(notifyTestResult.register, false);
    assert.equal(notifyTestResult.showConfig, false);
    assert.equal(notifyTestResult.showStatus, false);

    const doctorResult = parseCliArgs(argv("doctor"));
    assert.equal(doctorResult.runDoctor, true);
    assert.equal(doctorResult.register, false);
    assert.equal(doctorResult.showConfig, false);
    assert.equal(doctorResult.showStatus, false);
    assert.equal(doctorResult.notifyTest, false);

    const logsResult = parseCliArgs(argv("logs"));
    assert.equal(logsResult.runLogs, true);
    assert.equal(logsResult.register, false);
    assert.equal(logsResult.showConfig, false);
    assert.equal(logsResult.showStatus, false);
    assert.equal(logsResult.runDoctor, false);
    assert.equal(logsResult.showHistory, false);

    const exportResult = parseCliArgs(argv("export"));
    assert.equal(exportResult.runExport, true);
    assert.equal(exportResult.register, false);
    assert.equal(exportResult.showConfig, false);
    assert.equal(exportResult.showStatus, false);
    assert.equal(exportResult.runDoctor, false);
    assert.equal(exportResult.runLogs, false);

    const replayResult = parseCliArgs(argv("replay"));
    assert.equal(replayResult.runReplay, true);
    assert.equal(replayResult.register, false);
    assert.equal(replayResult.showConfig, false);
    assert.equal(replayResult.showStatus, false);
    assert.equal(replayResult.runStats, false);
    assert.equal(replayResult.runTail, false);
    assert.equal(replayResult.runExport, false);

    const supervisorResult = parseCliArgs(argv("supervisor"));
    assert.equal(supervisorResult.runSupervisor, true);
    assert.equal(supervisorResult.runReplay, false);
    assert.equal(supervisorResult.showStatus, false);
    assert.equal(supervisorResult.showConfig, false);
  });

  it("parses export subcommand", () => {
    const result = parseCliArgs(argv("export"));
    assert.equal(result.runExport, true);
    assert.equal(result.exportFormat, undefined);
    assert.equal(result.exportOutput, undefined);
    assert.equal(result.exportLast, undefined);
  });

  it("parses export --format", () => {
    const result = parseCliArgs(argv("export", "--format", "markdown"));
    assert.equal(result.runExport, true);
    assert.equal(result.exportFormat, "markdown");
  });

  it("parses export -f shorthand", () => {
    const result = parseCliArgs(argv("export", "-f", "json"));
    assert.equal(result.runExport, true);
    assert.equal(result.exportFormat, "json");
  });

  it("parses export --output", () => {
    const result = parseCliArgs(argv("export", "--output", "/tmp/report.json"));
    assert.equal(result.runExport, true);
    assert.equal(result.exportOutput, "/tmp/report.json");
  });

  it("parses export --last", () => {
    const result = parseCliArgs(argv("export", "--last", "7d"));
    assert.equal(result.runExport, true);
    assert.equal(result.exportLast, "7d");
  });

  it("parses export with all flags", () => {
    const result = parseCliArgs(argv("export", "--format", "markdown", "--output", "report.md", "--last", "24h"));
    assert.equal(result.runExport, true);
    assert.equal(result.exportFormat, "markdown");
    assert.equal(result.exportOutput, "report.md");
    assert.equal(result.exportLast, "24h");
  });
});

describe("validateConfig", () => {
  // helper: build a valid config, then override specific fields
  function makeConfig(overrides: Record<string, unknown> = {}): AoaoeConfig {
    const base: AoaoeConfig = {
      reasoner: "opencode",
      pollIntervalMs: 10_000,
    reasonIntervalMs: 60_000,
      opencode: { port: 4097 },
      claudeCode: { yolo: true, resume: true },
      aoe: { profile: "default" },
      policies: { maxIdleBeforeNudgeMs: 120_000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
      contextFiles: [],
      sessionDirs: {},
      captureLinesCount: 100,
      verbose: false,
      dryRun: false,
      observe: false,
      confirm: false,
      protectedSessions: [],
    };
    return { ...base, ...overrides } as AoaoeConfig;
  }

  it("accepts a valid config", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig()));
  });

  it("rejects invalid reasoner", () => {
    assert.throws(() => validateConfig(makeConfig({ reasoner: "gpt4" })), /reasoner must be/);
  });

  it("rejects pollIntervalMs below 1000", () => {
    assert.throws(() => validateConfig(makeConfig({ pollIntervalMs: 500 })), /pollIntervalMs/);
  });


  it("rejects captureLinesCount zero", () => {
    assert.throws(() => validateConfig(makeConfig({ captureLinesCount: 0 })), /captureLinesCount/);
  });

  it("rejects opencode.port out of range", () => {
    assert.throws(() => validateConfig(makeConfig({ opencode: { port: 0 } })), /opencode\.port/);
    assert.throws(() => validateConfig(makeConfig({ opencode: { port: 70000 } })), /opencode\.port/);
  });

  it("rejects opencode.port NaN", () => {
    assert.throws(() => validateConfig(makeConfig({ opencode: { port: NaN } })), /opencode\.port/);
  });

  it("accepts valid healthPort", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ healthPort: 4098 })));
  });

  it("accepts undefined healthPort", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig()));
  });

  it("rejects healthPort out of range", () => {
    assert.throws(() => validateConfig(makeConfig({ healthPort: 0 })), /healthPort/);
    assert.throws(() => validateConfig(makeConfig({ healthPort: 70000 })), /healthPort/);
  });

  it("rejects healthPort NaN", () => {
    assert.throws(() => validateConfig(makeConfig({ healthPort: NaN })), /healthPort/);
  });

  it("rejects healthPort non-number", () => {
    assert.throws(() => validateConfig(makeConfig({ healthPort: "4098" as unknown as number })), /healthPort/);
  });

  it("accepts valid tuiHistoryRetentionDays", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ tuiHistoryRetentionDays: 7 })));
    assert.doesNotThrow(() => validateConfig(makeConfig({ tuiHistoryRetentionDays: 1 })));
    assert.doesNotThrow(() => validateConfig(makeConfig({ tuiHistoryRetentionDays: 365 })));
  });

  it("accepts undefined tuiHistoryRetentionDays", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig()));
  });

  it("rejects tuiHistoryRetentionDays out of range", () => {
    assert.throws(() => validateConfig(makeConfig({ tuiHistoryRetentionDays: 0 })), /tuiHistoryRetentionDays/);
    assert.throws(() => validateConfig(makeConfig({ tuiHistoryRetentionDays: 366 })), /tuiHistoryRetentionDays/);
    assert.throws(() => validateConfig(makeConfig({ tuiHistoryRetentionDays: -1 })), /tuiHistoryRetentionDays/);
  });

  it("rejects non-integer tuiHistoryRetentionDays", () => {
    assert.throws(() => validateConfig(makeConfig({ tuiHistoryRetentionDays: 3.5 })), /tuiHistoryRetentionDays/);
  });

  it("rejects non-number tuiHistoryRetentionDays", () => {
    assert.throws(() => validateConfig(makeConfig({ tuiHistoryRetentionDays: "7" as unknown as number })), /tuiHistoryRetentionDays/);
  });

  it("rejects maxErrorsBeforeRestart below 1", () => {
    const config = makeConfig();
    config.policies.maxErrorsBeforeRestart = 0;
    assert.throws(() => validateConfig(config), /maxErrorsBeforeRestart/);
  });

  it("collects multiple errors", () => {
    const config = makeConfig({ reasoner: "bad", pollIntervalMs: 100 });
    assert.throws(() => validateConfig(config), /reasoner.*\n.*pollIntervalMs/s);
  });

  it("rejects maxIdleBeforeNudgeMs of 0", () => {
    const config = makeConfig();
    config.policies.maxIdleBeforeNudgeMs = 0;
    assert.throws(() => validateConfig(config), /maxIdleBeforeNudgeMs/);
  });

  it("rejects maxIdleBeforeNudgeMs below pollIntervalMs", () => {
    const config = makeConfig({ pollIntervalMs: 10_000 });
    config.policies.maxIdleBeforeNudgeMs = 5_000; // less than 10_000
    assert.throws(() => validateConfig(config), /maxIdleBeforeNudgeMs/);
  });

  it("accepts config without actionCooldownMs (optional)", () => {
    const config = makeConfig();
    delete config.policies.actionCooldownMs;
    assert.doesNotThrow(() => validateConfig(config));
  });

  it("rejects actionCooldownMs of 0", () => {
    const config = makeConfig();
    config.policies.actionCooldownMs = 0;
    assert.throws(() => validateConfig(config), /actionCooldownMs/);
  });

  it("rejects actionCooldownMs below 1000", () => {
    const config = makeConfig();
    config.policies.actionCooldownMs = 500;
    assert.throws(() => validateConfig(config), /actionCooldownMs/);
  });

  it("rejects protectedSessions as a string", () => {
    assert.throws(
      () => validateConfig(makeConfig({ protectedSessions: "adventure" })),
      /protectedSessions must be an array/,
    );
  });

  it("accepts protectedSessions as an array", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ protectedSessions: ["adventure"] })));
  });

  it("rejects sessionDirs as an array", () => {
    assert.throws(
      () => validateConfig(makeConfig({ sessionDirs: ["foo"] })),
      /sessionDirs must be an object/,
    );
  });

  it("rejects sessionDirs as null", () => {
    assert.throws(
      () => validateConfig(makeConfig({ sessionDirs: null })),
      /sessionDirs must be an object/,
    );
  });

  it("accepts sessionDirs as an object", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ sessionDirs: { adventure: "/tmp" } })));
  });

  it("rejects contextFiles as a string", () => {
    assert.throws(
      () => validateConfig(makeConfig({ contextFiles: "AGENTS.md" })),
      /contextFiles must be an array/,
    );
  });

  it("accepts contextFiles as an array", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ contextFiles: ["AGENTS.md"] })));
  });

  it("rejects claudeCode.yolo as a string", () => {
    assert.throws(
      () => validateConfig(makeConfig({ claudeCode: { yolo: "true", resume: true } })),
      /claudeCode\.yolo must be a boolean/,
    );
  });

  it("rejects claudeCode.resume as a number", () => {
    assert.throws(
      () => validateConfig(makeConfig({ claudeCode: { yolo: true, resume: 1 } })),
      /claudeCode\.resume must be a boolean/,
    );
  });

  it("accepts claudeCode.yolo and resume as booleans", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ claudeCode: { yolo: false, resume: false } })));
  });

  it("rejects aoe.profile as empty string", () => {
    assert.throws(
      () => validateConfig(makeConfig({ aoe: { profile: "" } })),
      /aoe\.profile must be a non-empty string/,
    );
  });

  it("rejects aoe.profile as a number", () => {
    assert.throws(
      () => validateConfig(makeConfig({ aoe: { profile: 42 } })),
      /aoe\.profile must be a non-empty string/,
    );
  });

  it("accepts aoe.profile as a valid string", () => {
    assert.doesNotThrow(() => validateConfig(makeConfig({ aoe: { profile: "work" } })));
  });

  it("rejects policies.autoAnswerPermissions as a string", () => {
    const config = makeConfig();
    (config.policies as Record<string, unknown>).autoAnswerPermissions = "true";
    assert.throws(() => validateConfig(config), /autoAnswerPermissions must be a boolean/);
  });

  it("rejects policies.userActivityThresholdMs as a string", () => {
    const config = makeConfig();
    (config.policies as Record<string, unknown>).userActivityThresholdMs = "30000";
    assert.throws(() => validateConfig(config), /userActivityThresholdMs must be a number/);
  });

  it("rejects policies.userActivityThresholdMs as negative", () => {
    const config = makeConfig();
    config.policies.userActivityThresholdMs = -1;
    assert.throws(() => validateConfig(config), /userActivityThresholdMs must be a number >= 0/);
  });

  it("accepts policies.userActivityThresholdMs as 0", () => {
    const config = makeConfig();
    config.policies.userActivityThresholdMs = 0;
    assert.doesNotThrow(() => validateConfig(config));
  });

  it("rejects policies.allowDestructive as a string", () => {
    const config = makeConfig();
    (config.policies as Record<string, unknown>).allowDestructive = "false";
    assert.throws(() => validateConfig(config), /allowDestructive must be a boolean/);
  });

  it("accepts policies.allowDestructive as true", () => {
    const config = makeConfig();
    config.policies.allowDestructive = true;
    assert.doesNotThrow(() => validateConfig(config));
  });

  // notifications validation
  it("accepts valid notifications config", () => {
    const config = makeConfig();
    config.notifications = { webhookUrl: "https://example.com/hook", slackWebhookUrl: "https://hooks.slack.com/x", events: ["session_error", "daemon_started"] };
    assert.doesNotThrow(() => validateConfig(config));
  });

  it("accepts notifications with no events filter", () => {
    const config = makeConfig();
    config.notifications = { webhookUrl: "https://example.com/hook" };
    assert.doesNotThrow(() => validateConfig(config));
  });

  it("rejects notifications.webhookUrl that is not a URL", () => {
    const config = makeConfig();
    config.notifications = { webhookUrl: "not-a-url" };
    assert.throws(() => validateConfig(config), /webhookUrl must be a URL/);
  });

  it("rejects notifications.webhookUrl that is not a string", () => {
    const config = makeConfig();
    (config as unknown as Record<string, unknown>).notifications = { webhookUrl: 12345 };
    assert.throws(() => validateConfig(config), /webhookUrl must be a URL/);
  });

  it("rejects notifications.slackWebhookUrl that is not a URL", () => {
    const config = makeConfig();
    config.notifications = { slackWebhookUrl: "ftp://nope" };
    assert.throws(() => validateConfig(config), /slackWebhookUrl must be a URL/);
  });

  it("rejects notifications.events with invalid event name", () => {
    const config = makeConfig();
    (config as unknown as Record<string, unknown>).notifications = { events: ["session_error", "bogus_event"] };
    assert.throws(() => validateConfig(config), /invalid event "bogus_event"/);
  });

  it("rejects notifications.events when not an array", () => {
    const config = makeConfig();
    (config as unknown as Record<string, unknown>).notifications = { events: "session_error" };
    assert.throws(() => validateConfig(config), /events must be an array/);
  });

  it("accepts empty notifications object", () => {
    const config = makeConfig();
    config.notifications = {};
    assert.doesNotThrow(() => validateConfig(config));
  });

  it("accepts notifications.maxRetries as valid integer", () => {
    const config = makeConfig();
    config.notifications = { maxRetries: 3 };
    assert.doesNotThrow(() => validateConfig(config));
  });

  it("accepts notifications.maxRetries = 0 (no retry)", () => {
    const config = makeConfig();
    config.notifications = { maxRetries: 0 };
    assert.doesNotThrow(() => validateConfig(config));
  });

  it("rejects negative notifications.maxRetries", () => {
    const config = makeConfig();
    config.notifications = { maxRetries: -1 };
    assert.throws(() => validateConfig(config), /maxRetries/);
  });

  it("rejects non-integer notifications.maxRetries", () => {
    const config = makeConfig();
    config.notifications = { maxRetries: 2.5 };
    assert.throws(() => validateConfig(config), /maxRetries/);
  });

  it("rejects non-number notifications.maxRetries", () => {
    const config = makeConfig();
    (config as unknown as Record<string, unknown>).notifications = { maxRetries: "3" };
    assert.throws(() => validateConfig(config), /maxRetries/);
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

  it("clears nested object when override is empty {}", () => {
    const base = { sessionDirs: { foo: "/bar", baz: "/qux" } } as unknown as Record<string, unknown>;
    const override = { sessionDirs: {} } as unknown as Record<string, unknown>;
    const result = deepMerge(base, override);
    assert.deepEqual(result.sessionDirs, {});
  });

  it("replaces nested object when override is empty {}", () => {
    const base = { policies: { maxIdleBeforeNudgeMs: 120000, maxErrorsBeforeRestart: 3 } } as unknown as Record<string, unknown>;
    const override = { policies: {} } as unknown as Record<string, unknown>;
    const result = deepMerge(base, override);
    assert.deepEqual(result.policies, {});
  });

  it("still deep merges non-empty objects", () => {
    const base = { opencode: { port: 4097, model: "old" } } as unknown as Record<string, unknown>;
    const override = { opencode: { model: "new" } } as unknown as Record<string, unknown>;
    const result = deepMerge(base, override);
    assert.equal(result.opencode.port, 4097);
    assert.equal(result.opencode.model, "new");
  });
});

describe("parseCliArgs missing flag values", () => {
  const argv = (...args: string[]) => ["node", "aoaoe", ...args];

  it("throws when --reasoner has no value", () => {
    assert.throws(() => parseCliArgs(argv("--reasoner")), /--reasoner requires a value/);
  });

  it("throws when --poll-interval has no value", () => {
    assert.throws(() => parseCliArgs(argv("--poll-interval")), /--poll-interval requires a value/);
  });

  it("throws when --port has no value", () => {
    assert.throws(() => parseCliArgs(argv("--port")), /--port requires a value/);
  });

  it("throws when --model has no value", () => {
    assert.throws(() => parseCliArgs(argv("--model")), /--model requires a value/);
  });

  it("throws when --profile has no value", () => {
    assert.throws(() => parseCliArgs(argv("--profile")), /--profile requires a value/);
  });

  it("throws when --reasoner is the last arg", () => {
    assert.throws(() => parseCliArgs(argv("--verbose", "--reasoner")), /--reasoner requires a value/);
  });

  it("throws when --reasoner has invalid value", () => {
    assert.throws(() => parseCliArgs(argv("--reasoner", "gpt-4")), /must be "opencode" or "claude-code"/);
  });
});

// ── actionSession / actionDetail helpers ────────────────────────────────────

describe("actionSession", () => {
  it("returns session for send_input", () => {
    const a: Action = { action: "send_input", session: "abc", text: "hello" };
    assert.equal(actionSession(a), "abc");
  });

  it("returns session for start_session", () => {
    const a: Action = { action: "start_session", session: "xyz" };
    assert.equal(actionSession(a), "xyz");
  });

  it("returns title for create_agent", () => {
    const a: Action = { action: "create_agent", path: "/tmp", title: "test", tool: "opencode" };
    assert.equal(actionSession(a), "test");
  });

  it("returns undefined for wait", () => {
    const a: Action = { action: "wait", reason: "idle" };
    assert.equal(actionSession(a), undefined);
  });
});

describe("actionDetail", () => {
  it("returns text for send_input", () => {
    const a: Action = { action: "send_input", session: "abc", text: "do stuff" };
    assert.equal(actionDetail(a), "do stuff");
  });

  it("returns summary for report_progress", () => {
    const a: Action = { action: "report_progress", session: "abc", summary: "fixed bug" };
    assert.equal(actionDetail(a), "fixed bug");
  });

  it("returns summary for complete_task", () => {
    const a: Action = { action: "complete_task", session: "abc", summary: "done" };
    assert.equal(actionDetail(a), "done");
  });

  it("returns reason for wait", () => {
    const a: Action = { action: "wait", reason: "all good" };
    assert.equal(actionDetail(a), "all good");
  });

  it("returns undefined for start_session (no detail field)", () => {
    const a: Action = { action: "start_session", session: "abc" };
    assert.equal(actionDetail(a), undefined);
  });

  it("returns undefined for wait without reason", () => {
    const a: Action = { action: "wait" };
    assert.equal(actionDetail(a), undefined);
  });
});

describe("toSessionStatus", () => {
  it("returns valid status unchanged", () => {
    assert.equal(toSessionStatus("working"), "working");
    assert.equal(toSessionStatus("idle"), "idle");
    assert.equal(toSessionStatus("error"), "error");
    assert.equal(toSessionStatus("stopped"), "stopped");
  });

  it("returns 'unknown' for invalid string", () => {
    assert.equal(toSessionStatus("banana"), "unknown");
    assert.equal(toSessionStatus("WORKING"), "unknown"); // case-sensitive
  });

  it("returns 'unknown' for null/undefined", () => {
    assert.equal(toSessionStatus(null), "unknown");
    assert.equal(toSessionStatus(undefined), "unknown");
  });

  it("returns 'unknown' for non-string input", () => {
    assert.equal(toSessionStatus(42), "unknown");
    assert.equal(toSessionStatus(true), "unknown");
  });
});

// ── toTaskState ─────────────────────────────────────────────────────────────

describe("toTaskState", () => {
  const valid = {
    repo: "github/adventure",
    sessionTitle: "adventure",
    sessionMode: "auto",
    tool: "opencode",
    goal: "build it",
    status: "active",
    progress: [],
  };

  it("accepts a valid task state object", () => {
    const result = toTaskState(valid);
    assert.ok(result);
    assert.equal(result.repo, "github/adventure");
    assert.equal(result.status, "active");
    assert.deepEqual(result.progress, []);
  });

  it("accepts all valid statuses", () => {
    for (const s of ["pending", "active", "completed", "paused", "failed"]) {
      assert.ok(toTaskState({ ...valid, status: s }));
    }
  });

  it("rejects null/undefined/primitives", () => {
    assert.equal(toTaskState(null), null);
    assert.equal(toTaskState(undefined), null);
    assert.equal(toTaskState("string"), null);
    assert.equal(toTaskState(42), null);
  });

  it("rejects missing required fields", () => {
    assert.equal(toTaskState({ ...valid, repo: undefined }), null);
    assert.equal(toTaskState({ ...valid, sessionTitle: 42 }), null);
    assert.equal(toTaskState({ ...valid, tool: undefined }), null);
    assert.equal(toTaskState({ ...valid, goal: undefined }), null);
    assert.equal(toTaskState({ ...valid, progress: "not-array" }), null);
  });

  it("rejects invalid status values", () => {
    assert.equal(toTaskState({ ...valid, status: "banana" }), null);
    assert.equal(toTaskState({ ...valid, status: 42 }), null);
  });

  it("preserves optional fields when present", () => {
    const result = toTaskState({ ...valid, sessionMode: "existing", sessionId: "abc-123", createdAt: 1000, lastProgressAt: 2000, completedAt: 3000 });
    assert.ok(result);
    assert.equal(result.sessionMode, "existing");
    assert.equal(result.sessionId, "abc-123");
    assert.equal(result.createdAt, 1000);
    assert.equal(result.lastProgressAt, 2000);
    assert.equal(result.completedAt, 3000);
  });

  it("drops optional fields with wrong types", () => {
    const result = toTaskState({ ...valid, sessionMode: "banana", sessionId: 42, createdAt: "not-a-number" });
    assert.ok(result);
    assert.equal(result.sessionMode, "auto");
    assert.equal(result.sessionId, undefined);
    assert.equal(result.createdAt, undefined);
  });

  it("filters invalid progress entries", () => {
    const result = toTaskState({ ...valid, progress: [
      { at: 1000, summary: "did stuff" },
      { at: "bad", summary: "nope" },
      null,
      { at: 2000, summary: "more stuff" },
    ]});
    assert.ok(result);
    assert.equal(result.progress.length, 2);
  });
});

// ── toDaemonState ───────────────────────────────────────────────────────────

describe("toDaemonState", () => {
  const valid = {
    tickStartedAt: 1000,
    nextTickAt: 2000,
    pollIntervalMs: 10000,
    phase: "sleeping",
    phaseStartedAt: 1000,
    pollCount: 5,
    paused: false,
    sessionCount: 2,
    changeCount: 1,
    sessions: [],
  };

  it("accepts a valid daemon state", () => {
    const result = toDaemonState(valid);
    assert.ok(result);
    assert.equal(result.phase, "sleeping");
  });

  it("rejects null/undefined/primitives", () => {
    assert.equal(toDaemonState(null), null);
    assert.equal(toDaemonState(undefined), null);
    assert.equal(toDaemonState("string"), null);
  });

  it("rejects missing required fields", () => {
    assert.equal(toDaemonState({ ...valid, tickStartedAt: undefined }), null);
    assert.equal(toDaemonState({ ...valid, phase: 42 }), null);
    assert.equal(toDaemonState({ ...valid, paused: "yes" }), null);
    assert.equal(toDaemonState({ ...valid, sessions: "not-array" }), null);
  });
});

// ── toAoeSessionList ────────────────────────────────────────────────────────

describe("toAoeSessionList", () => {
  it("filters valid sessions from array", () => {
    const result = toAoeSessionList([
      { id: "abc", title: "Adventure" },
      { id: "def", title: "CHV" },
    ]);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, "Adventure");
  });

  it("returns empty for non-array", () => {
    assert.deepEqual(toAoeSessionList(null), []);
    assert.deepEqual(toAoeSessionList("string"), []);
    assert.deepEqual(toAoeSessionList(42), []);
  });

  it("filters out entries missing id or title", () => {
    const result = toAoeSessionList([
      { id: "abc", title: "good" },
      { id: "def" }, // missing title
      { title: "no-id" }, // missing id
      null,
      42,
      { id: "ghi", title: "also-good" },
    ]);
    assert.equal(result.length, 2);
  });
});

// ── toReasonerBackend ───────────────────────────────────────────────────────

describe("toReasonerBackend", () => {
  it("accepts valid backends", () => {
    assert.equal(toReasonerBackend("opencode"), "opencode");
    assert.equal(toReasonerBackend("claude-code"), "claude-code");
  });

  it("throws for invalid backend", () => {
    assert.throws(() => toReasonerBackend("gpt-4"), /must be "opencode" or "claude-code"/);
    assert.throws(() => toReasonerBackend(""), /must be "opencode" or "claude-code"/);
  });
});

// ── warnUnknownKeys ─────────────────────────────────────────────────────────

describe("warnUnknownKeys", () => {
  // capture stderr warnings emitted by warnUnknownKeys
  function captureWarnings(fn: () => void): string[] {
    const original = console.error;
    const warnings: string[] = [];
    console.error = (msg: string) => warnings.push(msg);
    try { fn(); } finally { console.error = original; }
    return warnings;
  }

  it("produces no warnings for valid top-level keys", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ reasoner: "opencode", pollIntervalMs: 10000, verbose: true }, "test.json"),
    );
    assert.equal(warnings.length, 0);
  });

  it("warns on unknown top-level key", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ reasoner: "opencode", typo_key: true }, "test.json"),
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("typo_key"));
    assert.ok(warnings[0].includes("test.json"));
  });

  it("warns on multiple unknown top-level keys", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ foo: 1, bar: 2, reasoner: "opencode" }, "test.json"),
    );
    assert.equal(warnings.length, 2);
  });

  it("produces no warnings for valid nested keys", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ opencode: { port: 4097, model: "gpt-4o" }, policies: { maxErrorsBeforeRestart: 3 } }, "test.json"),
    );
    assert.equal(warnings.length, 0);
  });

  it("warns on unknown nested key", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ opencode: { port: 4097, bogus: true } }, "test.json"),
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("opencode.bogus"));
    assert.ok(warnings[0].includes("test.json"));
  });

  it("warns on unknown nested key in policies", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ policies: { maxErrorsBeforeRestart: 3, fakePolicy: true } }, "test.json"),
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("policies.fakePolicy"));
  });

  it("is a no-op for non-object input", () => {
    const warnings = captureWarnings(() => {
      warnUnknownKeys(null, "test.json");
      warnUnknownKeys(undefined, "test.json");
      warnUnknownKeys("string", "test.json");
      warnUnknownKeys(42, "test.json");
      warnUnknownKeys([], "test.json");
    });
    assert.equal(warnings.length, 0);
  });

  it("skips nested check when nested value is not an object", () => {
    // opencode expects a Set of valid sub-keys, but if the value is a string, skip
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ opencode: "not-an-object" }, "test.json"),
    );
    assert.equal(warnings.length, 0);
  });

  it("includes source path in warning messages", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ unknownField: true }, "/home/user/.aoaoe/aoaoe.config.json"),
    );
    assert.ok(warnings[0].includes("/home/user/.aoaoe/aoaoe.config.json"));
  });

  it("produces no warnings for valid notifications nested keys", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ notifications: { webhookUrl: "https://x.com", slackWebhookUrl: "https://y.com", events: [] } }, "test.json"),
    );
    assert.equal(warnings.length, 0);
  });

  it("warns on unknown nested key in notifications", () => {
    const warnings = captureWarnings(() =>
      warnUnknownKeys({ notifications: { webhookUrl: "https://x.com", bogusField: true } }, "test.json"),
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("notifications.bogusField"));
  });
});

// ── toActionLogEntry ────────────────────────────────────────────────────────

describe("toActionLogEntry", () => {
  it("accepts a valid action log entry", () => {
    const entry = toActionLogEntry({
      timestamp: 1700000000000,
      action: { action: "send_input", session: "abc123", text: "hello" },
      success: true,
      detail: "sent input",
    });
    assert.ok(entry !== null);
    assert.equal(entry!.timestamp, 1700000000000);
    assert.equal(entry!.action.action, "send_input");
    assert.equal(entry!.action.session, "abc123");
    assert.equal(entry!.action.text, "hello");
    assert.equal(entry!.success, true);
    assert.equal(entry!.detail, "sent input");
  });

  it("accepts entry with title instead of session", () => {
    const entry = toActionLogEntry({
      timestamp: 1700000000000,
      action: { action: "create_agent", title: "my-agent" },
      success: true,
      detail: "created agent",
    });
    assert.ok(entry !== null);
    assert.equal(entry!.action.title, "my-agent");
    assert.equal(entry!.action.session, undefined);
  });

  it("returns null for null/undefined/primitives", () => {
    assert.equal(toActionLogEntry(null), null);
    assert.equal(toActionLogEntry(undefined), null);
    assert.equal(toActionLogEntry(42), null);
    assert.equal(toActionLogEntry("string"), null);
  });

  it("returns null when timestamp is missing", () => {
    assert.equal(toActionLogEntry({
      action: { action: "wait" },
      success: true,
      detail: "",
    }), null);
  });

  it("returns null when action is missing", () => {
    assert.equal(toActionLogEntry({
      timestamp: 1700000000000,
      success: true,
      detail: "",
    }), null);
  });

  it("returns null when action.action is not a string", () => {
    assert.equal(toActionLogEntry({
      timestamp: 1700000000000,
      action: { action: 42 },
      success: true,
      detail: "",
    }), null);
  });

  it("returns null when success is not a boolean", () => {
    assert.equal(toActionLogEntry({
      timestamp: 1700000000000,
      action: { action: "wait" },
      success: "true",
      detail: "",
    }), null);
  });

  it("coerces missing detail to empty string", () => {
    const entry = toActionLogEntry({
      timestamp: 1700000000000,
      action: { action: "wait" },
      success: true,
    });
    assert.ok(entry !== null);
    assert.equal(entry!.detail, "");
  });

  it("drops non-string optional fields", () => {
    const entry = toActionLogEntry({
      timestamp: 1700000000000,
      action: { action: "send_input", session: 42, text: true, title: null },
      success: false,
      detail: "failed",
    });
    assert.ok(entry !== null);
    assert.equal(entry!.action.session, undefined);
    assert.equal(entry!.action.text, undefined);
    assert.equal(entry!.action.title, undefined);
  });
});

// ── computeConfigDiff ───────────────────────────────────────────────────────

describe("computeConfigDiff", () => {
  it("returns empty array when objects are identical", () => {
    const obj = { a: 1, b: "hello" };
    assert.deepEqual(computeConfigDiff(obj, { ...obj }), []);
  });

  it("detects changed primitive values", () => {
    const current = { a: 1, b: "changed" };
    const defaults = { a: 1, b: "original" };
    const diffs = computeConfigDiff(current, defaults);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].path, "b");
    assert.equal(diffs[0].current, "changed");
    assert.equal(diffs[0].default, "original");
  });

  it("detects new fields not in defaults", () => {
    const current = { a: 1, extra: "new" };
    const defaults = { a: 1 };
    const diffs = computeConfigDiff(current, defaults);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].path, "extra");
    assert.equal(diffs[0].current, "new");
    assert.equal(diffs[0].default, undefined);
  });

  it("detects fields removed from defaults", () => {
    const current = { a: 1 };
    const defaults = { a: 1, removed: true };
    const diffs = computeConfigDiff(current, defaults);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].path, "removed");
    assert.equal(diffs[0].current, undefined);
    assert.equal(diffs[0].default, true);
  });

  it("recurses into nested objects with dot-notation paths", () => {
    const current = { nested: { x: 10, y: 20 } };
    const defaults = { nested: { x: 10, y: 99 } };
    const diffs = computeConfigDiff(current, defaults);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].path, "nested.y");
    assert.equal(diffs[0].current, 20);
    assert.equal(diffs[0].default, 99);
  });

  it("compares arrays by JSON.stringify", () => {
    const current = { arr: [1, 2, 3] };
    const defaults = { arr: [1, 2] };
    const diffs = computeConfigDiff(current, defaults);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].path, "arr");
  });

  it("returns empty for deeply identical nested objects", () => {
    const obj = { a: { b: { c: 42 } } };
    assert.deepEqual(computeConfigDiff(obj, JSON.parse(JSON.stringify(obj))), []);
  });

  it("handles mixed changed and unchanged fields", () => {
    const current = { a: 1, b: 2, c: 3 };
    const defaults = { a: 1, b: 99, c: 3 };
    const diffs = computeConfigDiff(current, defaults);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].path, "b");
  });
});

// ── filterLogLines ──────────────────────────────────────────────────────────

describe("filterLogLines", () => {
  const lines = [
    "10:00:00 [observation] 3 sessions, 1 changed",
    "10:00:01 [reasoner] decided to send_input",
    "10:00:02 [+ action] send_input → adventure: fix the bug",
    "10:00:03 [system] paused via console",
    "10:00:04 [! action] stop_session failed",
    "10:00:05 [explain] All agents are making progress",
  ];

  it("filters by plain substring (case-insensitive)", () => {
    const result = filterLogLines(lines, "action");
    assert.equal(result.length, 2);
    assert.ok(result[0].includes("[+ action]"));
    assert.ok(result[1].includes("[! action]"));
  });

  it("filters by regex pattern", () => {
    const result = filterLogLines(lines, "\\d+:\\d+:\\d+.*reasoner");
    assert.equal(result.length, 1);
    assert.ok(result[0].includes("[reasoner]"));
  });

  it("returns all lines when pattern matches everything", () => {
    const result = filterLogLines(lines, "10:00");
    assert.equal(result.length, 6);
  });

  it("returns empty array when nothing matches", () => {
    const result = filterLogLines(lines, "nonexistent-pattern-xyz");
    assert.equal(result.length, 0);
  });

  it("falls back to substring when regex is invalid", () => {
    // "[+" is an invalid regex (unclosed bracket)
    const result = filterLogLines(lines, "[+");
    // should fall back to substring matching
    assert.ok(result.length > 0);
    assert.ok(result.every(l => l.includes("[+")));
  });

  it("handles empty lines array", () => {
    assert.deepEqual(filterLogLines([], "anything"), []);
  });

  it("case-insensitive substring matching", () => {
    const result = filterLogLines(lines, "SYSTEM");
    assert.equal(result.length, 1);
    assert.ok(result[0].includes("[system]"));
  });
});
