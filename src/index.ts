#!/usr/bin/env node
import { execSync } from "node:child_process";
import { loadConfig, validateEnvironment, parseCliArgs, printHelp, configFileExists, findConfigFile, DEFAULTS, computeConfigDiff } from "./config.js";
import { Poller, computeTmuxName } from "./poller.js";
import { createReasoner } from "./reasoner/index.js";
import { Executor } from "./executor.js";
import { printDashboard } from "./dashboard.js";
import { InputReader } from "./input.js";
import { ReasonerConsole } from "./console.js";
import { writeState, buildSessionStates, checkInterrupt, clearInterrupt, cleanupState, acquireLock, readState, setSessionTask } from "./daemon-state.js";
import { formatSessionSummaries, formatActionDetail, formatPlainEnglishAction, narrateObservation, summarizeRecentActions, friendlyError, colorizeConsoleLine, filterLogLines } from "./console.js";
import { type SessionPolicyState } from "./reasoner/prompt.js";
import { loadGlobalContext, resolveProjectDirWithSource, discoverContextFiles, loadSessionContext } from "./context.js";
import { tick as loopTick } from "./loop.js";
import { exec as shellExec } from "./shell.js";
import { wakeableSleep } from "./wake.js";
import { classifyMessages, formatUserMessages, buildReceipts, shouldSkipSleep, hasPendingFile, isInsistMessage, stripInsistPrefix } from "./message.js";
import { TaskManager, loadTaskDefinitions, loadTaskState, saveTaskState, formatTaskTable, formatProgressDigest, formatAgo, importAoeSessionsToTasks, saveTaskDefinitions, syncTaskDefinitionsFromState, taskStateKey, resolveTaskRepoPath, shouldReconcileTasks } from "./task-manager.js";
import { goalToList } from "./types.js";
import { runTaskCli, handleTaskSlashCommand, quickTaskUpdate } from "./task-cli.js";
import { parsePaneMilestones } from "./task-parser.js";
import { TUI, hitTestSession, nextSortMode, SORT_MODES, formatUptime, formatClipText, CLIP_DEFAULT_COUNT, loadTuiPrefs, saveTuiPrefs, BUILTIN_COMMANDS, validateGroupName, CONTEXT_BURN_THRESHOLD, buildSnapshotData, formatSnapshotJson, formatSnapshotMarkdown, formatBroadcastSummary, WATCHDOG_DEFAULT_MINUTES, rankSessions, TOP_SORT_MODES, formatIdleSince, CONTEXT_CEILING_THRESHOLD, buildSessionStats, formatSessionStatsLines, formatStatsJson, validateSessionTag, validateColorName, SESSION_COLOR_NAMES, TIMELINE_DEFAULT_COUNT, computeErrorTrend, isQuietHour, parseQuietHoursRange, computeCostSummary, formatSessionReport, formatQuietStatus, formatSessionAge, formatHealthTrendChart, isOverBudget, DRAIN_ICON, formatSessionsTable, buildFanOutTemplate, TRUST_LEVELS, TRUST_STABLE_TICKS_TO_ESCALATE, formatTrustLadderStatus, computeContextBudgets, formatContextBudgetTable, CTX_BUDGET_DEFAULT_GLOBAL, resolveProfiles, formatProfileSummary, parseContextCeiling, shouldCompactContext, formatCompactionNudge, formatCompactionAlert, buildSessionDependencyGraph, formatDependencyGraph, formatRelayRules, matchRelayRules, detectOOM, shouldRestartOnOOM, formatOOMAlert, searchSessionOutputs, formatSearchResults, formatThrottleConfig, diffSessionOutput, formatSessionDiff, formatAlertPatterns, matchAlertPatterns, formatLifecycleHooks, matchLifecycleHooks, buildHookEnv } from "./tui.js";
import type { LifecycleEvent } from "./tui.js";
import type { TrustLevel } from "./tui.js";
import type { SessionReportData } from "./tui.js";
import type { TopSortMode } from "./tui.js";
import type { SortMode } from "./tui.js";
import { isDaemonRunningFromState } from "./chat.js";
import { sendNotification, sendTestNotification, formatNotifyFilters, parseNotifyEvents, shouldNotifySession } from "./notify.js";
import { startHealthServer } from "./health.js";
import { loadTuiHistory, searchHistory, TUI_HISTORY_FILE, computeHistoryStats } from "./tui-history.js";
import { appendSupervisorEvent, loadSupervisorEvents } from "./supervisor-history.js";
import { savePreset, deletePreset, getPreset, formatPresetList } from "./pin-presets.js";
import { resolvePromptTemplate, formatPromptTemplateList } from "./reasoner/prompt-templates.js";
import { formatHealthReport, computeAllHealth } from "./health-score.js";
import { SessionSummarizer } from "./session-summarizer.js";
import { ConflictDetector } from "./conflict-detector.js";
import { detectCompletionSignals, shouldAutoComplete } from "./goal-detector.js";
import { computeBudgetStatus, findOverBudgetSessions, formatBudgetAlert } from "./cost-budget.js";
import type { CostBudgetConfig } from "./cost-budget.js";
import { ActivityTracker } from "./activity-heatmap.js";
import { audit, readRecentAuditEntries, auditStats, formatAuditEntries, formatAuditStats } from "./audit-trail.js";
import { captureFleetSnapshot, saveFleetSnapshot, formatFleetSnapshot, shouldTakeSnapshot } from "./fleet-snapshot.js";
import { BudgetPredictor } from "./budget-predictor.js";
import { TaskRetryManager } from "./task-retry.js";
import { searchAuditTrail, parseAuditSearchQuery, formatAuditSearchResults } from "./audit-search.js";
import { AdaptivePollController } from "./adaptive-poll.js";
import { computeFleetForecast, formatFleetForecast } from "./fleet-forecast.js";
import { rankSessionsByPriority, formatPriorityQueue } from "./session-priority.js";
import type { SessionPriorityInput } from "./session-priority.js";
import { EscalationManager } from "./notify-escalation.js";
import { detectDrift, formatDriftSignals } from "./drift-detector.js";
import { estimateProgress, formatProgressEstimates } from "./goal-progress.js";
import { SessionPoolManager } from "./session-pool.js";
import { ReasonerCostTracker } from "./reasoner-cost.js";
import { detectAnomalies, formatAnomalies } from "./anomaly-detector.js";
import type { SessionMetrics } from "./anomaly-detector.js";
import { FleetSlaMonitor } from "./fleet-sla.js";
import { ProgressVelocityTracker } from "./progress-velocity.js";
import { computeSchedulingActions, formatSchedulingActions } from "./dep-scheduler.js";
import { ObservationCache } from "./observation-cache.js";
import { FleetRateLimiter } from "./fleet-rate-limiter.js";
import { RecoveryPlaybookManager } from "./recovery-playbook.js";
import { buildLifecycleRecords, computeLifecycleStats, formatLifecycleStats } from "./lifecycle-analytics.js";
import { buildCostAttributions, computeCostReport, formatCostReport } from "./cost-attribution.js";
import { decomposeGoal, formatDecomposition } from "./goal-decomposer.js";
import { ConfigWatcher, formatConfigChange } from "./config-watcher.js";
import { parseActionLogEntries, parseActivityEntries, mergeTimeline, filterByAge, parseDuration, formatTimelineJson, formatTimelineMarkdown, formatTaskExportJson, formatTaskExportMarkdown } from "./export.js";
import type { AoaoeConfig, Observation, TaskState } from "./types.js";
import { actionSession, actionDetail, toActionLogEntry } from "./types.js";
import { YELLOW, GREEN, DIM, BOLD, RED, RESET } from "./colors.js";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AOAOE_DIR = join(homedir(), ".aoaoe"); // watch dir for wakeable sleep
const INPUT_FILE = join(AOAOE_DIR, "pending-input.txt"); // file IPC from chat.ts
const TASK_RECONCILE_EVERY_POLLS = 6;

async function main() {
   const { overrides, help, version, register, testContext: isTestContext, runTest, showTasks, showTasksJson, runProgress, progressSince, progressJson, runHealth, healthJson, runSummary, runAdopt, adoptTemplate, showHistory, showStatus, runRunbook, runbookJson, runbookSection, runIncident, incidentSince, incidentLimit, incidentJson, incidentNdjson, incidentWatch, incidentChangesOnly, incidentHeartbeatSec, incidentIntervalMs, runSupervisor, supervisorAll, supervisorSince, supervisorLimit, supervisorJson, supervisorNdjson, supervisorWatch, supervisorChangesOnly, supervisorHeartbeatSec, supervisorIntervalMs, showConfig, configValidate, configDiff, notifyTest, runDoctor, runBackup, backupOutput, runRestore, restoreInput, runSync, syncAction, syncRemote, runWeb, webPort, runLogs, logsActions, logsGrep, logsCount, runExport, exportFormat, exportOutput, exportLast, runInit, initForce, runTaskCli: isTaskCli, runTail: isTail, tailFollow, tailCount, runStats: isStats, statsLast, runReplay: isReplay, replaySpeed, replayLast, registerTitle } = parseCliArgs(process.argv);

  if (help) {
    printHelp();
    process.exit(0);
  }

  if (version) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"));
      console.log(`aoaoe ${pkg.version}`);
    } catch {
      console.log("aoaoe (version unknown)");
    }
    process.exit(0);
  }

  // `aoaoe register` -- register aoaoe as an AoE session
  if (register) {
    await registerAsAoeSession(registerTitle);
    return;
  }

  // `aoaoe test-context` -- safe read-only scan of sessions + context discovery
  if (isTestContext) {
    await testContext();
    return;
  }

  // `aoaoe test` -- run the integration test (create sessions, test, clean up)
  if (runTest) {
    await runIntegrationTest();
    return;
  }

  // suppress noisy [tasks] [config] log lines in one-shot CLI commands
  if (showTasks || runProgress || runHealth || runSummary || runAdopt || runBackup || runRestore || runExport || showStatus || runRunbook || runIncident || runSupervisor) {
    process.env.AOAOE_QUIET = "1";
  }

  // `aoaoe tasks` -- show current task state
  if (showTasks) {
    await showTaskStatus(showTasksJson);
    return;
  }

  // `aoaoe progress` -- per-session accomplishment digest
  if (runProgress) {
    await showProgressDigest(progressSince, progressJson);
    return;
  }

  // `aoaoe health` -- per-session health scores
  if (runHealth) {
    showHealthStatus(healthJson);
    return;
  }

  // `aoaoe summary` -- one-liner fleet status
  if (runSummary) {
    showFleetSummary();
    return;
  }

  // `aoaoe adopt` -- import untracked sessions as tasks
  if (runAdopt) {
    await adoptUntrackedSessions(adoptTemplate);
    return;
  }

  // `aoaoe history` -- review recent actions
  if (showHistory) {
    await showActionHistory();
    return;
  }

  // `aoaoe status` -- quick one-shot daemon health check
  if (showStatus) {
    showDaemonStatus();
    return;
  }

  // `aoaoe runbook` -- operator quickstart and incident flow
  if (runRunbook) {
    showRunbook(runbookJson, runbookSection);
    return;
  }

  // `aoaoe incident` -- one-shot incident quick view
  if (runIncident) {
    await showIncidentStatus({ since: incidentSince, limit: incidentLimit, json: incidentJson, ndjson: incidentNdjson, watch: incidentWatch, changesOnly: incidentChangesOnly, heartbeatSec: incidentHeartbeatSec, intervalMs: incidentIntervalMs });
    return;
  }

  // `aoaoe supervisor` -- one-shot supervisor orchestration report
  if (runSupervisor) {
    await showSupervisorStatus({ all: supervisorAll, since: supervisorSince, limit: supervisorLimit, json: supervisorJson, ndjson: supervisorNdjson, watch: supervisorWatch, changesOnly: supervisorChangesOnly, heartbeatSec: supervisorHeartbeatSec, intervalMs: supervisorIntervalMs });
    return;
  }

  // `aoaoe config` -- show effective resolved config (with optional --validate or --diff)
  if (showConfig) {
    if (configValidate) {
      await runConfigValidation();
    } else if (configDiff) {
      showConfigDiff();
    } else {
      showEffectiveConfig();
    }
    return;
  }

  // `aoaoe notify-test` -- send a test notification to configured webhooks
  if (notifyTest) {
    await runNotifyTest();
    return;
  }

  // `aoaoe doctor` -- comprehensive health check
  if (runWeb) {
    setWebResolveProfiles(resolveProfiles);
    const port = webPort ?? 4099;
    startWebServer(port);
    // keep process alive until Ctrl+C
    process.on("SIGINT", () => process.exit(0));
    return;
  }

  if (runSync) {
    process.env.AOAOE_QUIET = "1";
    try {
      switch (syncAction) {
        case "init":
          console.log(await syncInit(syncRemote ?? ""));
          break;
        case "push":
          console.log(await syncPush());
          break;
        case "pull":
          console.log(await syncPull());
          break;
        case "status":
          console.log(await syncStatus());
          break;
        case "diff":
          console.log(await syncDiff());
          break;
        default:
          console.error("usage: aoaoe sync [init <url>|push|pull|diff|status]");
          process.exitCode = 1;
      }
    } catch (err) {
      console.error(`sync failed: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
    return;
  }

  if (runDoctor) {
    await runDoctorCheck();
    return;
  }

  if (runBackup) {
    try {
      const result = await createBackup(backupOutput);
      console.log(formatBackupResult(result));
    } catch (err) {
      console.error(`backup failed: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
    return;
  }

  if (runRestore) {
    if (!restoreInput) {
      console.error("usage: aoaoe restore <backup-path>");
      process.exitCode = 1;
      return;
    }
    try {
      const result = await restoreBackup(restoreInput);
      console.log(formatRestoreResult(result));
    } catch (err) {
      console.error(`restore failed: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
    return;
  }

  // `aoaoe logs` -- show conversation or action log entries
  if (runLogs) {
    await showLogs(logsActions, logsGrep, logsCount);
    return;
  }

  // `aoaoe export` -- export session timeline as JSON or Markdown
  if (runExport) {
    const { exportTasks } = parseCliArgs(process.argv);
    if (exportTasks) {
      await runTaskExport(exportFormat, exportOutput);
    } else {
      await runTimelineExport(exportFormat, exportOutput, exportLast);
    }
    return;
  }

async function runTaskExport(format?: string, output?: string): Promise<void> {
  const fmt = format ?? "json";
  if (fmt !== "json" && fmt !== "markdown" && fmt !== "md") {
    console.error(`error: --format must be "json" or "markdown", got "${fmt}"`);
    process.exit(1);
  }

  const basePath = process.cwd();
  const defs = loadTaskDefinitions(basePath);
  const taskProfiles = resolveProfiles(loadConfig());
  const tm = defs.length > 0 ? new TaskManager(basePath, defs, taskProfiles) : undefined;
  const tasks = tm?.tasks ?? [...loadTaskState().values()];

  if (tasks.length === 0) {
    console.error("no tasks to export");
    return;
  }

  const isMarkdown = fmt === "markdown" || fmt === "md";
  const content = isMarkdown ? formatTaskExportMarkdown(tasks) : formatTaskExportJson(tasks);

  if (output) {
    writeFileSync(output, content);
    console.log(`exported ${tasks.length} task(s) to ${output}`);
  } else {
    process.stdout.write(content);
    if (!content.endsWith("\n")) process.stdout.write("\n");
  }
}

// `aoaoe stats` -- show aggregate daemon statistics
  if (isStats) {
    await runStatsCommand(statsLast);
    return;
  }

  // `aoaoe replay` -- play back tui-history.jsonl like a movie
  if (isReplay) {
    const { runReplay: doReplay } = await import("./replay.js");
    await doReplay({ speed: replaySpeed ?? 5, last: replayLast });
    return;
  }

  // `aoaoe task` -- task management CLI
  if (isTaskCli) {
    await runTaskCli(process.argv);
    return;
  }

  // `aoaoe init` -- auto-discover environment and generate config
  if (runInit) {
    const { runInit: doInit } = await import("./init.js");
    await doInit(initForce);
    return;
  }

  // `aoaoe tail` -- live-stream daemon activity to a separate terminal
  if (isTail) {
    const { runTail: doTail } = await import("./tail.js");
    await doTail({ count: tailCount ?? 50, follow: tailFollow });
    return;
  }

  // auto-init: if no config file exists, run init automatically
  if (!configFileExists()) {
    console.error("");
    console.error("  no config found (~/.aoaoe/ or cwd) — running auto-init...");
    console.error("");
    const { runInit } = await import("./init.js");
    await runInit(false);
    // if init still didn't create a config (e.g. no aoe sessions), warn but continue with defaults
    if (!configFileExists()) {
      console.error("");
      console.error("  init completed but no config was written (no sessions found?)");
      console.error("  continuing with defaults...");
      console.error("");
    }
  }

  const configResult = loadConfig(overrides);
  const configPath = configResult._configPath;
  let config: AoaoeConfig = configResult; // strip _configPath from type for downstream (let: hot-reloaded)

  // acquire daemon lock — prevent two daemons from running simultaneously
  const lock = acquireLock();
  if (!lock.acquired) {
    console.error("");
    console.error(`  another aoaoe daemon is already running (pid ${lock.existingPid ?? "unknown"})`);
    console.error("  only one daemon can manage sessions at a time.");
    console.error("");
    console.error("  if this is stale, remove ~/.aoaoe/daemon.lock and retry.");
    process.exit(1);
  }

  // startup banner + TUI setup
  const pkg = readPkgVersion();
  const useTui = process.stdin.isTTY === true;
  const tui = useTui ? new TUI() : null;

  // restore sticky prefs from previous run
  if (tui) {
    const prefs = loadTuiPrefs();
    if (prefs.sortMode && (SORT_MODES as readonly string[]).includes(prefs.sortMode)) tui.setSortMode(prefs.sortMode as SortMode);
    if (prefs.compact) tui.setCompact(true);
    if (prefs.focus) tui.setFocus(true);
    if (prefs.bell) tui.setBell(true);
    if (prefs.autoPin) tui.setAutoPin(true);
    if (prefs.tagFilter) tui.setTagFilter(prefs.tagFilter);
    if (prefs.sessionGroups) tui.restoreGroups(prefs.sessionGroups);
    if (prefs.sessionAliases) tui.restoreSessionAliases(prefs.sessionAliases);
    if (prefs.sessionTags) tui.restoreSessionTags(prefs.sessionTags);
    if (prefs.sessionColors) tui.restoreSessionColors(prefs.sessionColors);
    if (prefs.quietHours && prefs.quietHours.length > 0) {
      const ranges = prefs.quietHours.map(parseQuietHoursRange).filter(Boolean) as Array<[number, number]>;
      if (ranges.length > 0) tui.setQuietHours(ranges);
    }
  }
  const persistPrefs = () => {
    if (!tui) return;
    // persist session groups, aliases, and multi-tags
    const groupsObj: Record<string, string> = {};
    for (const [id, g] of tui.getAllGroups()) groupsObj[id] = g;
    const aliasesObj: Record<string, string> = {};
    for (const [id, name] of tui.getAllSessionAliases()) aliasesObj[id] = name;
    const sTagsObj: Record<string, string[]> = {};
    for (const [id, tset] of tui.getAllSessionTags()) sTagsObj[id] = [...tset];
    const sColorsObj: Record<string, string> = {};
    for (const [id, c] of tui.getAllSessionColors()) sColorsObj[id] = c;
    saveTuiPrefs({
      sortMode: tui.getSortMode(),
      compact: tui.isCompact(),
      focus: tui.isFocused(),
      bell: tui.isBellEnabled(),
      autoPin: tui.isAutoPinEnabled(),
      tagFilter: tui.getTagFilter(),
      aliases: input.getAliases(),
      sessionGroups: groupsObj,
      sessionAliases: aliasesObj,
      sessionTags: sTagsObj,
      sessionColors: sColorsObj,
      quietHours: tui.getQuietHours().map(([s, e]) => `${s}-${e}`),
    });
  };

  if (!useTui) {
    // fallback: plain scrolling output (non-TTY / piped)
    console.error("");
    console.error("  aoaoe" + (pkg ? ` v${pkg}` : "") + "  —  autonomous supervisor");
    console.error(`  reasoner: ${config.reasoner}  |  poll: ${config.pollIntervalMs / 1000}s`);
    console.error(`  config: ${configPath ?? "defaults (no config file found)"}`);
    if (config.observe) console.error("  OBSERVE MODE — watching only, no AI, no actions");
    else if (config.confirm) console.error("  CONFIRM MODE — the AI will ask before every action");
    else if (config.dryRun) console.error("  DRY RUN — the AI thinks but doesn't act");
    console.error("");
  }

  // validate tools are installed (in observe mode, only need aoe+tmux, not the reasoner)
  if (config.observe) {
    // lightweight validation — only poller deps (aoe + tmux), skip reasoner tool check
    const obsConfig = { ...config, reasoner: "opencode" as const };
    try {
      await validateEnvironment(obsConfig);
    } catch (err) {
      // re-throw only if aoe/tmux are missing (strip reasoner-specific errors)
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("aoe") || msg.includes("tmux")) throw err;
      // opencode/claude missing is fine in observe mode — no reasoner needed
    }
  } else {
    await validateEnvironment(config);
  }

  // auto-start opencode serve if not running (opencode backend only, skip in observe mode)
  if (!config.observe && config.reasoner === "opencode") {
    const { ensureOpencodeServe } = await import("./init.js");
    const serverReady = await ensureOpencodeServe(config.opencode.port);
    if (!serverReady) {
      console.error("  opencode serve failed to start — cannot reason without it");
      console.error(`  start manually: opencode serve --port ${config.opencode.port}`);
      process.exit(1);
    }
  }

  // load global context (AGENTS.md / claude.md from cwd or parent)
  const globalContext = config.observe ? null : loadGlobalContext();
  if (globalContext) {
    log("loaded global context (AGENTS.md / claude.md)");
  }

  // load tasks from aoaoe.tasks.json or config
  const basePath = process.cwd();
  const taskProfiles = resolveProfiles(config);
  const supervisorEvents: Array<{ at: number; detail: string }> = [];
  const MAX_SUPERVISOR_EVENTS = 20;

  const pushSupervisorEvent = (detail: string, opts?: { at?: number; persist?: boolean }): void => {
    const at = opts?.at ?? Date.now();
    supervisorEvents.push({ at, detail });
    if (supervisorEvents.length > MAX_SUPERVISOR_EVENTS) supervisorEvents.shift();
    if (opts?.persist !== false) appendSupervisorEvent({ at, detail });
  };

  for (const evt of loadSupervisorEvents(MAX_SUPERVISOR_EVENTS)) {
    pushSupervisorEvent(evt.detail, { at: evt.at, persist: false });
  }

  const importedTasks = await importAoeSessionsToTasks(basePath, taskProfiles);
  if (importedTasks.imported.length > 0) {
    console.error(`  tasks: imported ${importedTasks.imported.length} AoE session(s) into task list`);
    pushSupervisorEvent(`imported ${importedTasks.imported.length} session(s) from aoe`);
  }

  const taskDefs = loadTaskDefinitions(basePath);
  let taskManager: TaskManager | undefined;

  if (taskDefs.length > 0) {
    taskManager = new TaskManager(basePath, taskDefs, taskProfiles);
    const active = taskManager.tasks.filter((t) => t.status === "active").length;
    const pending = taskManager.tasks.filter((t) => t.status === "pending").length;
    const paused = taskManager.tasks.filter((t) => t.status === "paused").length;
    console.error(`  tasks: ${taskManager.tasks.length} (${active} active, ${pending} pending, ${paused} paused)`);
    for (const t of taskManager.tasks) {
      const icon = t.status === "active" ? "●" : t.status === "completed" ? "✓" : t.status === "paused" ? "◎" : "○";
      const goalPreview = t.goal.length > 60 ? t.goal.slice(0, 57) + "..." : t.goal;
      const depsTag = t.dependsOn?.length ? ` [waits on: ${t.dependsOn.join(", ")}]` : "";
      console.error(`    ${icon} ${t.sessionTitle}: ${goalPreview}${depsTag}`);
    }
    console.error("");

    // reconcile: create missing AoE sessions, start them
    log("reconciling task sessions...");
    const { created, linked, goalsInjected } = await taskManager.reconcileSessions();
    if (created.length > 0) log(`created sessions: ${created.join(", ")}`);
    if (linked.length > 0) log(`linked existing sessions: ${linked.join(", ")}`);
    if (goalsInjected.length > 0) log(`injected goals: ${goalsInjected.join(", ")}`);
    pushSupervisorEvent(`startup reconcile: +${created.length} created, +${linked.length} linked, +${goalsInjected.length} goals`);

    // seed dashboard session-task display from task manager state
    for (const t of taskManager.tasks) {
      if (t.sessionId && t.goal) {
        const goalPreview = t.goal.length > 60 ? t.goal.slice(0, 57) + "..." : t.goal;
        setSessionTask(t.sessionId, `[${t.sessionTitle}] ${goalPreview}`);
      }
    }
  }

  const poller = new Poller(config);
  const reasoner = config.observe ? null : createReasoner(config, globalContext || undefined);
  const executor = config.observe ? null : new Executor(config);
  if (taskManager && executor) executor.setTaskManager(taskManager);

  // v0.197+ intelligence modules — instantiated once, fed per-tick
  const sessionSummarizer = new SessionSummarizer();
  const conflictDetector = new ConflictDetector();
  const activityTracker = new ActivityTracker();
  const budgetPredictor = new BudgetPredictor();
  const taskRetryManager = new TaskRetryManager({
    maxRetries: config.policies.maxStuckNudgesBeforePause ?? 3,
  });
  const adaptivePollController = new AdaptivePollController({
    baseIntervalMs: config.pollIntervalMs,
  });
  const escalationManager = new EscalationManager();
  const sessionPoolManager = new SessionPoolManager();
  const reasonerCostTracker = new ReasonerCostTracker();
  const fleetSlaMonitor = new FleetSlaMonitor();
  const progressVelocityTracker = new ProgressVelocityTracker();
  const observationCache = new ObservationCache();
  const fleetRateLimiter = new FleetRateLimiter();
  const recoveryPlaybookManager = new RecoveryPlaybookManager();

  // audit: log daemon start
  audit("daemon_start", `daemon started (v${pkg ?? "dev"}, reasoner=${config.reasoner})`);

  const refreshTaskSupervisorState = (reason?: string): void => {
    if (!taskManager) {
      if (tui) tui.updateState({ supervisorStatus: "" });
      return;
    }
    const defs = loadTaskDefinitions(basePath);
    taskManager = new TaskManager(basePath, defs, taskProfiles);
    if (executor) executor.setTaskManager(taskManager);
    if (tui) tui.updateState({ supervisorStatus: buildTaskSupervisorStatus(taskManager) });
    if (reason) pushSupervisorEvent(reason);
  };

  const input = new InputReader();
  const reasonerConsole = new ReasonerConsole();

  // init reasoner (starts opencode serve, verifies claude, etc) — skip in observe mode
  if (reasoner) {
    log("initializing reasoner...");
    await reasoner.init();
    log("reasoner ready");
  }

  // restore aliases from sticky prefs
  if (tui) {
    const prefs = loadTuiPrefs();
    if (prefs.aliases) input.setAliases(prefs.aliases);
  }

  // start interactive input listener and conversation log
  input.start();
  await reasonerConsole.start();

  // wire scroll keys to TUI (PgUp/PgDn/Home/End)
  if (tui) {
    input.onScroll((dir) => {
      if (tui!.getViewMode() === "drilldown") {
        // PgUp/PgDn/Home/End scroll the session output in drill-down mode
        switch (dir) {
          case "up": tui!.scrollDrilldownUp(); break;
          case "down": tui!.scrollDrilldownDown(); break;
          case "bottom": tui!.scrollDrilldownToBottom(); break;
          // "top" not wired for drilldown — could add scrollDrilldownToTop() later
        }
      } else {
        switch (dir) {
          case "up": tui!.scrollUp(); break;
          case "down": tui!.scrollDown(); break;
          case "top": tui!.scrollToTop(); break;
          case "bottom": tui!.scrollToBottom(); break;
        }
      }
    });
    // wire queue count changes to TUI prompt display
    input.onQueueChange((count) => {
      tui!.updateState({ pendingCount: count });
    });
    // plain text in drill-down defaults to task goal capture
    input.onGoalCaptureMode(() => tui!.getViewMode() === "drilldown");
    // wire /view and /back commands to TUI drill-down
    input.onView((target) => {
      if (target === null) {
        tui!.exitDrilldown();
        tui!.log("system", "returned to overview");
      } else {
        // try number first, then name/id
        const num = parseInt(target, 10);
        const ok = !isNaN(num) ? tui!.enterDrilldown(num) : tui!.enterDrilldown(target);
        if (ok) {
          tui!.log("system", `viewing session: ${target}`);
        } else {
          tui!.log("system", `session not found: ${target}`);
        }
      }
    });
    // wire mouse clicks on session cards to drill-down
    input.onMouseClick((row, _col) => {
      if (tui!.getViewMode() === "drilldown") {
        // click anywhere in drilldown = back to overview
        tui!.exitDrilldown();
        tui!.log("system", "returned to overview");
        return;
      }
      // compact mode: no per-session click targeting (use quick-switch or /view)
      if (tui!.isCompact()) return;
      const sessionIdx = hitTestSession(row, 1, tui!.getSessionCount());
      if (sessionIdx !== null) {
        const ok = tui!.enterDrilldown(sessionIdx);
        if (ok) tui!.log("system", `viewing session #${sessionIdx}`);
      }
    });
    // wire quick-switch: bare digit 1-9 jumps to session (or switches in drilldown)
    input.onQuickSwitch((num) => {
      if (tui!.getViewMode() === "drilldown") {
        // in drilldown, switch to a different session
        const ok = tui!.enterDrilldown(num);
        if (ok) tui!.log("system", `switched to session #${num}`);
        else tui!.log("system", `session #${num} not found`);
      } else {
        // in overview, drill into session
        const ok = tui!.enterDrilldown(num);
        if (ok) tui!.log("system", `viewing session #${num}`);
        else tui!.log("system", `session #${num} not found`);
      }
    });
    // wire /search command to TUI activity filter
    input.onSearch((pattern) => {
      tui!.setSearch(pattern);
      if (pattern) {
        tui!.log("system", `search: "${pattern}"`);
      } else {
        tui!.log("system", "search cleared");
      }
    });
    // wire /sort command to TUI session sort
    input.onSort((mode) => {
      if (mode && (SORT_MODES as readonly string[]).includes(mode)) {
        tui!.setSortMode(mode as SortMode);
        tui!.log("system", `sort: ${mode}`);
        persistPrefs();
      } else if (!mode) {
        const next = nextSortMode(tui!.getSortMode());
        tui!.setSortMode(next);
        tui!.log("system", `sort: ${next}`);
        persistPrefs();
      } else {
        tui!.log("system", `unknown sort mode: ${mode} (try: status, name, activity, default)`);
      }
    });
    // wire /compact toggle
    input.onCompact(() => {
      const enabled = !tui!.isCompact();
      tui!.setCompact(enabled);
      tui!.log("system", `compact mode: ${enabled ? "on" : "off"}`);
      persistPrefs();
    });
    // wire /mark bookmark
    input.onMark(() => {
      const num = tui!.addBookmark();
      if (num > 0) {
        tui!.log("system", `bookmark #${num} saved`);
      } else {
        tui!.log("system", "nothing to bookmark (activity buffer empty)");
      }
    });
    // wire /jump to bookmark
    input.onJump((num) => {
      const ok = tui!.jumpToBookmark(num);
      if (ok) {
        tui!.log("system", `jumped to bookmark #${num}`);
      } else {
        tui!.log("system", `bookmark #${num} not found`);
      }
    });
    // wire /marks listing
    input.onMarks(() => {
      const bms = tui!.getBookmarks();
      if (bms.length === 0) {
        tui!.log("system", "no bookmarks — use /mark to save one");
      } else {
        for (let i = 0; i < bms.length; i++) {
          tui!.log("system", `  #${i + 1}: ${bms[i].label}`);
        }
      }
    });
    // wire /diff N to show activity since a bookmark
    input.onDiff((num) => {
      const bms = tui!.getBookmarks();
      const bm = bms[num - 1];
      if (!bm) {
        tui!.log("system", `bookmark #${num} not found`);
        return;
      }
      const buffer = tui!.getActivityBuffer();
      const entries = buffer.slice(bm.index);
      if (entries.length === 0) {
        tui!.log("system", `no activity since bookmark #${num}`);
      } else {
        tui!.log("system", `${entries.length} entries since bookmark #${num} (${bm.label}):`);
        for (const e of entries.slice(-30)) { // cap at last 30 to avoid spam
          tui!.log("system", `  [${e.time}] ${e.tag}: ${e.text}`);
        }
        if (entries.length > 30) {
          tui!.log("system", `  ... (${entries.length - 30} more — use /clip to export all)`);
        }
      }
    });
    // wire /focus toggle
    input.onFocus(() => {
      const enabled = !tui!.isFocused();
      tui!.setFocus(enabled);
      tui!.log("system", `focus mode: ${enabled ? "on (pinned only)" : "off (all sessions)"}`);
      persistPrefs();
    });
    // wire /bell toggle
    input.onBell(() => {
      const enabled = !tui!.isBellEnabled();
      tui!.setBell(enabled);
      tui!.log("system", `bell notifications: ${enabled ? "on" : "off"}`);
      persistPrefs();
    });
    // wire /pin toggle
    input.onPin((target) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const ok = tui!.togglePin(num ?? target);
      if (ok) {
        tui!.log("system", `pin toggled: ${target}`);
      } else {
        tui!.log("system", `session not found: ${target}`);
      }
    });
    // wire /mute toggle
    input.onMute((target) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const ok = tui!.toggleMute(num ?? target);
      if (ok) {
        tui!.log("system", `mute toggled: ${target}`);
      } else {
        tui!.log("system", `session not found: ${target}`);
      }
    });
    // wire /unmute-all
    input.onUnmuteAll(() => {
      const count = tui!.unmuteAll();
      if (count > 0) {
        tui!.log("system", `unmuted ${count} session${count === 1 ? "" : "s"}`);
      } else {
        tui!.log("system", "no sessions are muted");
      }
    });
    // wire /filter tag
    input.onTagFilter((tag) => {
      tui!.setTagFilter(tag);
      if (tag) {
        tui!.log("system", `filter: ${tag}`);
      } else {
        tui!.log("system", "filter cleared");
      }
      persistPrefs();
    });
    // wire /who fleet status
    input.onWho(() => {
      const sessions = tui!.getSessions();
      if (sessions.length === 0) {
        tui!.log("system", "no sessions");
        return;
      }
      const now = Date.now();
      const firstSeen = tui!.getAllFirstSeen();
      const lastChangeAt = tui!.getAllLastChangeAt();
      const errors = tui!.getSessionErrorCounts();
      const notes = tui!.getAllNotes();
      const groups = tui!.getAllGroups();
      // sort: errors first, then status priority, then alphabetical
      const statusPriority: Record<string, number> = { error: 0, waiting: 1, working: 2, running: 2, idle: 3, stopped: 4, done: 5 };
      const sorted = [...sessions].sort((a, b) => {
        const ea = errors.get(a.id) ?? 0, eb = errors.get(b.id) ?? 0;
        if (ea !== eb) return eb - ea; // most errors first
        const pa = statusPriority[a.status] ?? 3, pb = statusPriority[b.status] ?? 3;
        if (pa !== pb) return pa - pb;
        return a.title.localeCompare(b.title);
      });
      for (const s of sorted) {
        const up = firstSeen.has(s.id) ? formatUptime(now - firstSeen.get(s.id)!) : "?";
        const errCount = errors.get(s.id) ?? 0;
        const errTs = tui!.getSessionErrorTimestamps(s.id);
        const errTrend = errTs.length > 0 ? (computeErrorTrend(errTs, now) === "rising" ? "↑" : computeErrorTrend(errTs, now) === "falling" ? "↓" : "") : "";
        const errStr = errCount > 0 ? ` ${errCount}err${errTrend}` : "";
        const ctxStr = s.contextTokens ? ` ${s.contextTokens}` : "";
        const costStr = tui!.getSessionCost(s.id) ? ` ${tui!.getSessionCost(s.id)}` : "";
        const note = notes.get(s.id);
        const noteStr = note ? ` "${note}"` : "";
        const group = groups.get(s.id);
        const groupStr = group ? ` [${group}]` : "";
        // idle-since: show for non-active sessions with stale activity
        const lastChange = lastChangeAt.get(s.id);
        const idleStr = (lastChange && (s.status === "idle" || s.status === "stopped" || s.status === "done"))
          ? ` idle ${formatUptime(now - lastChange)}` : "";
        // session age from AoE created_at
        const ageStr = s.createdAt ? ` age:${formatSessionAge(s.createdAt, now)}` : "";
        tui!.log("system", `  ${s.title}${groupStr} — ${s.status} ${up}${ctxStr}${costStr}${errStr}${idleStr}${ageStr}${noteStr}`);
      }
    });
    // wire /uptime listing
    input.onUptime(() => {
      const firstSeen = tui!.getAllFirstSeen();
      const sessions = tui!.getSessions();
      if (sessions.length === 0) {
        tui!.log("system", "no sessions — uptime not available");
      } else {
        const now = Date.now();
        for (const s of sessions) {
          const start = firstSeen.get(s.id);
          const up = start !== undefined ? formatUptime(now - start) : "unknown";
          tui!.log("system", `  ${s.title}: ${up}`);
        }
      }
    });
    // wire /auto-pin toggle
    input.onAutoPin(() => {
      const enabled = !tui!.isAutoPinEnabled();
      tui!.setAutoPin(enabled);
      tui!.log("system", `auto-pin on error: ${enabled ? "on" : "off"}`);
      persistPrefs();
    });
    // wire /note set/clear
    input.onNote((target, text) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const ok = tui!.setNote(num ?? target, text);
      if (ok) {
        if (text) {
          tui!.log("system", `note set for ${target}: "${text}"`);
        } else {
          tui!.log("system", `note cleared for ${target}`);
        }
      } else {
        tui!.log("system", `session not found: ${target}`);
      }
    });
    // wire /notes listing
    input.onNotes(() => {
      const notes = tui!.getAllNotes();
      if (notes.size === 0) {
        tui!.log("system", "no notes — use /note <N|name> <text> to add one");
      } else {
        const sessions = tui!.getSessions();
        for (const [id, text] of notes) {
          const session = sessions.find((s) => s.id === id);
          const label = session ? session.title : id.slice(0, 8);
          tui!.log("system", `  ${label}: "${text}"`);
        }
      }
    });
    // wire /clip to export activity entries to clipboard or file
    input.onClip((count) => {
      const buffer = tui!.getActivityBuffer();
      if (buffer.length === 0) {
        tui!.log("system", "no activity to clip");
        return;
      }
      const text = formatClipText(buffer, count);
      const entryCount = Math.min(count, buffer.length);
      try {
        execSync("pbcopy", { input: text, timeout: 5000 });
        tui!.log("system", `copied ${entryCount} entries to clipboard`);
      } catch {
        try {
          const clipPath = join(homedir(), ".aoaoe", "clip.txt");
          writeFileSync(clipPath, text, "utf-8");
          tui!.log("system", `saved ${entryCount} entries to ~/.aoaoe/clip.txt`);
        } catch (writeErr) {
          tui!.log("error", `clip failed: ${writeErr}`);
        }
      }
    });
    // wire alias changes to persist prefs
    input.onAliasChange(() => {
      persistPrefs();
    });
    // wire /group assignment
    input.onGroup((target, tag) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      if (!tag) {
        // clear group
        const ok = tui!.setGroup(num ?? target, null);
        if (ok) {
          tui!.log("system", `group cleared for ${target}`);
          persistPrefs();
        } else {
          tui!.log("system", `session not found: ${target}`);
        }
        return;
      }
      const err = validateGroupName(tag);  // validates alphanumeric, max length
      if (err) {
        tui!.log("system", `invalid group name: ${err}`);
        return;
      }
      const ok = tui!.setGroup(num ?? target, tag);
      if (ok) {
        tui!.log("system", `group set for ${target}: ${tag}`);
        persistPrefs();
      } else {
        tui!.log("system", `session not found: ${target}`);
      }
    });
    // wire /groups listing
    input.onGroups(() => {
      const groups = tui!.getAllGroups();
      if (groups.size === 0) {
        tui!.log("system", "no groups — use /group <N|name> <tag> to assign one");
        return;
      }
      const sessions = tui!.getSessions();
      // group sessions by group tag
      const byGroup = new Map<string, string[]>();
      for (const [id, g] of groups) {
        const session = sessions.find((s) => s.id === id);
        const label = session ? session.title : id.slice(0, 8);
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(label);
      }
      for (const [g, members] of [...byGroup].sort()) {
        tui!.log("system", `  ${g}: ${members.join(", ")}`);
      }
    });
    // wire /group-filter
    input.onGroupFilter((group) => {
      tui!.setGroupFilter(group);
      if (group) {
        tui!.log("system", `group filter: ${group}`);
      } else {
        tui!.log("system", "group filter cleared");
      }
    });
    // wire /burn-rate to show context token burn rates
    input.onBurnRate(() => {
      const sessions = tui!.getSessions();
      if (sessions.length === 0) {
        tui!.log("system", "no sessions — burn rate not available");
        return;
      }
      const rates = tui!.getAllBurnRates();
      let any = false;
      for (const s of sessions) {
        const rate = rates.get(s.id);
        if (rate === null || rate === undefined) {
          tui!.log("system", `  ${s.title}: no context data yet`);
        } else if (rate <= 0) {
          tui!.log("system", `  ${s.title}: stable (${s.contextTokens ?? "no token data"})`);
        } else {
          const rounded = Math.round(rate / 100) * 100;
          const alert = rate > CONTEXT_BURN_THRESHOLD ? " ⚠ high" : "";
          tui!.log("system", `  ${s.title}: ~${rounded.toLocaleString()} tokens/min${alert}`);
          any = true;
        }
      }
      if (!any) tui!.log("system", `  threshold: ${CONTEXT_BURN_THRESHOLD.toLocaleString()} tokens/min`);
    });
    // wire /mute-errors toggle
    input.onMuteErrors(() => {
      const muted = tui!.toggleMuteErrors();
      tui!.log("system", `mute-errors: ${muted ? "on — error entries hidden from activity log" : "off — all entries visible"}`);
    });
    // wire /prev-goal
    input.onPrevGoal((target, nBack) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const sessions = tui!.getSessions();
      const session = num !== undefined
        ? sessions[num - 1]
        : sessions.find((s) => s.title.toLowerCase() === target.toLowerCase() || s.id.startsWith(target));
      if (!session) {
        tui!.log("system", `session not found: ${target}`);
        return;
      }
      const goal = tui!.getPreviousGoal(session.id, nBack);
      if (!goal) {
        tui!.log("system", `no goal history for ${session.title} (${nBack} back)`);
        return;
      }
      // queue as a task update for that session
      input.inject(`__CMD_QUICKTASK__${goal}`);
      tui!.log("system", `prev-goal restored for ${session.title}: "${goal}"`);
    });
    // wire /tag set session tags
    input.onTag((target, tags) => {
      for (const t of tags) {
        const err = validateSessionTag(t);
        if (err) { tui!.log("system", `invalid tag "${t}": ${err}`); return; }
      }
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const ok = tui!.setSessionTags(num ?? target, tags);
      if (ok) {
        if (tags.length > 0) {
          tui!.log("system", `tags set for ${target}: ${tags.join(", ")}`);
        } else {
          tui!.log("system", `tags cleared for ${target}`);
        }
        persistPrefs();
      } else {
        tui!.log("system", `session not found: ${target}`);
      }
    });
    // wire /tags list
    input.onTagsList(() => {
      const allTags = tui!.getAllSessionTags();
      if (allTags.size === 0) {
        tui!.log("system", "no tags — use /tag <N|name> <tag1,tag2> to assign");
        return;
      }
      const sessions = tui!.getSessions();
      for (const [id, tset] of allTags) {
        const s = sessions.find((s) => s.id === id);
        const label = s?.title ?? id.slice(0, 8);
        tui!.log("system", `  ${label}: ${[...tset].sort().join(", ")}`);
      }
    });
    // wire /tag-filter session panel filter
    input.onTagFilter2((tag) => {
      tui!.setTagFilter2(tag);
      if (tag) {
        tui!.log("system", `tag filter: ${tag} (showing sessions tagged "${tag}")`);
      } else {
        tui!.log("system", "tag filter cleared");
      }
    });
    // wire /find — search session pane outputs
    input.onFind((text) => {
      const sessions = tui!.getSessions();
      if (sessions.length === 0) {
        tui!.log("system", "no sessions to search");
        return;
      }
      const lower = text.toLowerCase();
      let found = 0;
      for (const s of sessions) {
        const lines = tui!.getSessionOutput(s.id);
        if (!lines) continue;
        const matches = lines.filter((l) => l.toLowerCase().includes(lower));
        if (matches.length > 0) {
          tui!.log("system", `  ${s.title}: ${matches.length} line${matches.length !== 1 ? "s" : ""} match`);
          // show up to 3 matching lines
          for (const m of matches.slice(-3)) {
            tui!.log("system", `    ${m.slice(0, 120)}`);
          }
          found++;
        }
      }
      if (found === 0) {
        tui!.log("system", `find: no matches for "${text}" in any session output`);
      } else {
        tui!.log("system", `find: "${text}" found in ${found} session${found !== 1 ? "s" : ""}`);
      }
    });
    // wire /timeline session activity
    input.onTimeline((target, count) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const entries = tui!.getSessionTimeline(num ?? target, count);
      if (entries === null) {
        tui!.log("system", `session not found: ${target}`);
        return;
      }
      const sessions = tui!.getSessions();
      const session = num !== undefined ? sessions[num - 1] : sessions.find((s) => s.title.toLowerCase() === target.toLowerCase());
      const label = session?.title ?? target;
      if (entries.length === 0) {
        tui!.log("system", `timeline: no activity for ${label}`);
        return;
      }
      tui!.log("system", `timeline: ${label} — last ${entries.length} entr${entries.length !== 1 ? "ies" : "y"}:`);
      for (const e of entries) {
        tui!.log("system", `  ${e.time}  ${e.tag}  ${e.text}`);
      }
    });
    // wire /color session accent
    input.onColor((target, colorName) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      if (!colorName) {
        const ok = tui!.setSessionColor(num ?? target, null);
        if (ok) { tui!.log("system", `color cleared for ${target}`); persistPrefs(); }
        else tui!.log("system", `session not found: ${target}`);
        return;
      }
      const err = validateColorName(colorName);
      if (err) { tui!.log("system", err); return; }
      const ok = tui!.setSessionColor(num ?? target, colorName);
      if (ok) { tui!.log("system", `color set for ${target}: ${colorName}`); persistPrefs(); }
      else tui!.log("system", `session not found: ${target}`);
    });
    // wire /reset-health
    input.onResetHealth((target) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const ok = tui!.resetSessionHealth(num ?? target);
      if (ok) {
        tui!.log("system", `health reset for ${target} — error counts + context history cleared`);
      } else {
        tui!.log("system", `session not found: ${target}`);
      }
    });
    // wire /pin-all-errors
    input.onPinAllErrors(() => {
      const count = tui!.pinAllErrors();
      if (count === 0) {
        tui!.log("system", "pin-all-errors: no error sessions to pin");
      } else {
        tui!.log("system", `pin-all-errors: pinned ${count} session${count !== 1 ? "s" : ""}`);
        persistPrefs();
      }
    });
    // wire /export-stats
    input.onExportStats(() => {
      const sessions = tui!.getSessions();
      const now = Date.now();
       const entries = buildSessionStats(
         sessions,
         tui!.getSessionErrorCounts(),
         tui!.getAllBurnRates(now),
         tui!.getAllFirstSeen(),
         tui!.getAllLastChangeAt(),
         tui!.getAllHealthScores(now),
         tui!.getAllSessionAliases(),
         now,
         new Map(sessions.map((s) => [s.id, tui!.getSessionErrorTimestamps(s.id)])),
         tui!.getAllSessionCosts(),
         new Map(sessions.map((s) => [s.id, tui!.getSessionHealthHistory(s.id)])),
       );
       const ts = new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dir = join(homedir(), ".aoaoe");
      const path = join(dir, `stats-${ts}.json`);
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, formatStatsJson(entries, pkg ?? "dev", now), "utf-8");
        tui!.log("system", `stats exported: ~/.aoaoe/stats-${ts}.json (${entries.length} sessions)`);
      } catch (err) {
        tui!.log("error", `export-stats failed: ${err}`);
      }
    });
    // wire /duplicate — clone a session
    input.onDuplicate((target, newTitle) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const args = tui!.getDuplicateArgs(num ?? target, newTitle || undefined);
      if (!args) {
        tui!.log("system", `duplicate failed: session "${target}" not found or has no path/tool`);
        return;
      }
      if (executor) {
        executor.execute([{ action: "create_agent", path: args.path, title: args.title, tool: args.tool }], [])
          .then(() => tui!.log("+ action", `duplicate: spawned "${args.title}" (${args.tool}) at ${args.path}`))
          .catch((err: unknown) => tui!.log("! action", `duplicate failed: ${err}`));
      } else {
        tui!.log("system", `[dry-run] duplicate: would spawn "${args.title}" (${args.tool}) at ${args.path}`);
      }
    });
    // wire /color-all
    input.onColorAll((colorName) => {
      if (!colorName) {
        const count = tui!.setColorAll(null);
        tui!.log("system", `color-all: cleared accent color for ${count} sessions`);
        persistPrefs();
        return;
      }
      const err = validateColorName(colorName);
      if (err) { tui!.log("system", err); return; }
      const count = tui!.setColorAll(colorName);
      tui!.log("system", `color-all: set ${colorName} for ${count} sessions`);
      persistPrefs();
    });
    // wire /quiet-hours
    input.onQuietHours((specs) => {
      if (specs.length === 0) {
        tui!.setQuietHours([]);
        tui!.log("system", "quiet hours: cleared — alerts active at all hours");
        persistPrefs();
        return;
      }
      const ranges: Array<[number, number]> = [];
      for (const spec of specs) {
        const r = parseQuietHoursRange(spec);
        if (!r) { tui!.log("system", `quiet hours: invalid range "${spec}" — use HH-HH (e.g. 22-06)`); return; }
        ranges.push(r);
      }
      tui!.setQuietHours(ranges);
      tui!.log("system", `quiet hours: ${specs.join(", ")} — watchdog+burn alerts suppressed`);
      persistPrefs();
    });
    // wire /note-history
    input.onNoteHistory((target) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const sessions = tui!.getSessions();
      const session = num !== undefined
        ? sessions[num - 1]
        : sessions.find((s) => s.title.toLowerCase() === target.toLowerCase() || s.id.startsWith(target));
      if (!session) { tui!.log("system", `session not found: ${target}`); return; }
      const hist = tui!.getNoteHistory(session.id);
      if (hist.length === 0) {
        tui!.log("system", `note-history: no previous notes for ${session.title}`);
      } else {
        tui!.log("system", `note-history for ${session.title} (${hist.length}):`);
        for (const n of hist) tui!.log("system", `  "${n}"`);
      }
    });
    // wire /label
    input.onLabel((target, label) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const ok = tui!.setLabel(num ?? target, label || null);
      if (ok) {
        tui!.log("system", label ? `label set for ${target}: "${label}"` : `label cleared for ${target}`);
      } else {
        tui!.log("system", `session not found: ${target}`);
      }
    });
    // wire /sessions enhanced table
    input.onSessionsTable(() => {
      const sessions = tui!.getSessions();
      const now = Date.now();
      const lines = formatSessionsTable(sessions, {
        groups: tui!.getAllGroups(),
        tags: tui!.getAllSessionTags(),
        colors: tui!.getAllSessionColors(),
        notes: tui!.getAllNotes(),
        labels: tui!.getAllLabels(),
        aliases: tui!.getAllSessionAliases(),
        drainingIds: tui!.getDrainingIds(),
        healthScores: tui!.getAllHealthScores(now),
        costs: tui!.getAllSessionCosts(),
        firstSeen: tui!.getAllFirstSeen(),
      }, now);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /flap-log
    input.onFlapLog(() => {
      const log = tui!.getFlapLog();
      if (log.length === 0) { tui!.log("system", "flap-log: no flap events recorded"); return; }
      tui!.log("system", `flap-log: ${log.length} event${log.length !== 1 ? "s" : ""}:`);
      for (const e of log.slice(-20)) {
        const time = new Date(e.ts).toLocaleTimeString();
        tui!.log("system", `  ${time}  ${e.title}: ${e.count} changes in window`);
      }
    });
    // wire /drain and /undrain
    input.onDrain((target, drain) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const ok = drain ? tui!.drainSession(num ?? target) : tui!.undrainSession(num ?? target);
      if (ok) {
        tui!.log("system", `${drain ? "drain" : "undrain"}: ${target} ${drain ? `marked draining (${DRAIN_ICON})` : "restored"}`);
      } else {
        tui!.log("system", `session not found: ${target}`);
      }
    });
    // wire /export-all bulk export
    input.onExportAll(() => {
      const sessions = tui!.getSessions();
      if (sessions.length === 0) { tui!.log("system", "export-all: no sessions"); return; }
      const now = Date.now();
      const ts = new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dir = join(homedir(), ".aoaoe");
      try {
        mkdirSync(dir, { recursive: true });
        // snapshot JSON
        const snapData = buildSnapshotData(sessions, tui!.getAllGroups(), tui!.getAllNotes(),
          tui!.getAllFirstSeen(), tui!.getSessionErrorCounts(), tui!.getAllBurnRates(now), pkg ?? "dev", now);
        writeFileSync(join(dir, `snapshot-${ts}.json`), formatSnapshotJson(snapData), "utf-8");
        // stats JSON
        const statEntries = buildSessionStats(sessions, tui!.getSessionErrorCounts(), tui!.getAllBurnRates(now),
          tui!.getAllFirstSeen(), tui!.getAllLastChangeAt(), tui!.getAllHealthScores(now),
          tui!.getAllSessionAliases(), now,
          new Map(sessions.map((s) => [s.id, tui!.getSessionErrorTimestamps(s.id)])),
          tui!.getAllSessionCosts(),
          new Map(sessions.map((s) => [s.id, tui!.getSessionHealthHistory(s.id)])));
        writeFileSync(join(dir, `stats-${ts}.json`), formatStatsJson(statEntries, pkg ?? "dev", now), "utf-8");
        tui!.log("system", `export-all: snapshot + stats saved to ~/.aoaoe/ (${sessions.length} sessions)`);
      } catch (err) {
        tui!.log("error", `export-all failed: ${err}`);
      }
    });
    // wire /labels — list all session labels
    input.onLabels(() => {
      const labels = tui!.getAllLabels();
      if (labels.size === 0) {
        tui!.log("system", "labels: no labels set — use /label <N> <text> to add one");
        return;
      }
      tui!.log("system", `labels: ${labels.size} active`);
      for (const [id, label] of labels) {
        const session = tui!.getSessions().find((s) => s.id === id);
        const name = session?.title ?? id;
        tui!.log("system", `  ${name}: "${label}"`);
      }
    });
    // wire /pin-draining — pin all draining sessions
    input.onPinDraining(() => {
      const count = tui!.pinDraining();
      if (count === 0) {
        tui!.log("system", "pin-draining: no draining sessions to pin (use /drain <N> first)");
      } else {
        tui!.log("system", `pin-draining: pinned ${count} draining session${count !== 1 ? "s" : ""}`);
        persistPrefs();
      }
    });
    // wire /icon <N|name> <emoji>
     input.onIcon((target, emoji) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const ok = tui!.setIcon(num ?? target, emoji);
      if (ok) {
        tui!.log("system", emoji ? `icon set for ${target}: ${emoji}` : `icon cleared for ${target}`);
      } else {
        tui!.log("system", `session not found: ${target}`);
      }
    });
    // wire /diff-sessions A B
    input.onDiffSessions((a, b) => {
      const sessions = tui!.getSessions();
      const resolve = (ref: string) => {
        const num = /^\d+$/.test(ref) ? parseInt(ref, 10) : NaN;
        if (!isNaN(num)) return sessions[num - 1];
        return sessions.find((s) => s.title.toLowerCase() === ref.toLowerCase() || s.id.startsWith(ref));
      };
      const sA = resolve(a);
      const sB = resolve(b);
      if (!sA) { tui!.log("system", `diff-sessions: session not found: ${a}`); return; }
      if (!sB) { tui!.log("system", `diff-sessions: session not found: ${b}`); return; }
      const linesA = (tui!.getSessionOutput(sA.id) ?? []).filter((l: string) => l.trim());
      const linesB = (tui!.getSessionOutput(sB.id) ?? []).filter((l: string) => l.trim());
      const diff = diffSessions(sA.title, linesA, sB.title, linesB);
      tui!.log("system", `diff-sessions: ${sA.title} vs ${sB.title} (last ${Math.max(linesA.length, linesB.length)} lines)`);
      for (const line of diff) tui!.log("system", line);
    });
    // wire /fan-out — generate starter task list for all sessions
    input.onFanOut(() => {
      const sessions = tui!.getSessions();
      if (sessions.length === 0) {
        tui!.log("system", "fan-out: no sessions to generate tasks for");
        return;
      }
      const existing = loadTaskDefinitions(basePath);
      const { defs, added } = buildFanOutTemplate(sessions, existing);
      if (added.length === 0) {
        tui!.log("system", `fan-out: all ${sessions.length} sessions already have task entries`);
        return;
      }
      saveTaskDefinitions(basePath, defs);
      tui!.log("system", `fan-out: added ${added.length} task${added.length !== 1 ? "s" : ""} → aoaoe.tasks.json`);
      for (const title of added) {
        tui!.log("system", `  + ${title}`);
      }
    });
    // wire /trust — trust ladder management
    input.onTrust((arg) => {
      if (!arg) {
        // show current status
        const status = formatTrustLadderStatus(
          tui!.getTrustLevel(), tui!.getTrustStableTicks(), tui!.isTrustAutoEnabled(),
        );
        tui!.log("system", status);
        return;
      }
      if (arg === "auto" || arg === "on") {
        tui!.setTrustAuto(true);
        tui!.log("system", "trust: auto-escalation enabled");
        return;
      }
      if (arg === "off") {
        tui!.setTrustAuto(false);
        tui!.log("system", "trust: auto-escalation disabled (staying at current level)");
        return;
      }
      const validLevels = ["observe", "dry-run", "confirm", "autopilot"];
      if (validLevels.includes(arg)) {
        tui!.setTrustLevel(arg as any);
        // also set the actual daemon mode to match
        if (arg === "observe") { config.observe = true; config.confirm = false; config.dryRun = false; }
        else if (arg === "dry-run") { config.observe = false; config.confirm = false; config.dryRun = true; }
        else if (arg === "confirm") { config.observe = false; config.confirm = true; config.dryRun = false; }
        else { config.observe = false; config.confirm = false; config.dryRun = false; }
        tui!.log("system", `trust: level set to ${arg} (mode synced)`);
        return;
      }
      tui!.log("system", `trust: unknown arg '${arg}' — use observe, dry-run, confirm, autopilot, auto, off`);
    });
    // wire /budget cost alerts
    // wire /ctx-budget — show smart context budget allocations
    // wire /profile — show active profiles summary
    input.onProfile(() => {
      const profiles = resolveProfiles(config);
      const sessions = tui!.getSessions();
      // count sessions per profile — for now all sessions belong to the active profile
      // (multi-profile polling will populate this properly when wired)
      const counts = new Map<string, number>();
      for (const p of profiles) counts.set(p, 0);
      counts.set(config.aoe.profile, sessions.length);
      const lines = formatProfileSummary(counts, config.aoe.profile);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /replay — play back a session's stored output like a movie
    input.onReplay((target, speed) => {
      if (tui!.isReplaying()) {
        tui!.stopReplay();
        tui!.log("system", "replay stopped");
        return;
      }
      const ref = /^\d+$/.test(target) ? parseInt(target, 10) : target;
      const ok = tui!.startReplay(ref, speed ?? undefined);
      if (!ok) tui!.log("system", `replay: session not found or has no output: ${target}`);
    });
    // wire /notify-filter — per-session notification event filters
    // wire /deps — show session dependency graph
    // wire /search-all — ranked full-text search across session outputs
    input.onFullSearch((query) => {
      const sessions = tui!.getSessions();
      const outputs = new Map<string, string[]>();
      const meta = new Map<string, { id: string }>();
      for (const s of sessions) {
        const out = tui!.getSessionOutput(s.id);
        if (out) { outputs.set(s.title, out); meta.set(s.title, { id: s.id }); }
      }
      const results = searchSessionOutputs(outputs, meta, query);
      const lines = formatSearchResults(results, query);
      for (const line of lines) tui!.log("system", line);
    });
    input.onDeps(() => {
      const sessions = tui!.getSessions();
      // gather task goals for cross-reference detection
      const goals = new Map<string, string>();
      if (taskManager) {
        for (const s of sessions) {
          const task = taskManager.getTaskForSession(s.title);
          if (task?.goal) goals.set(s.title, task.goal);
        }
      }
      const graph = buildSessionDependencyGraph(sessions, goals);
      const lines = formatDependencyGraph(graph);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /relay — cross-session message relay
    // wire /throttle — per-session action cooldown override
    // wire /snap — save output snapshot for later diffing
    // wire /alert-pattern — output pattern alerting
    // wire /hook — session lifecycle hooks
    input.onHook((args) => {
      if (!args) {
        const lines = formatLifecycleHooks(tui!.getLifecycleHooks());
        for (const line of lines) tui!.log("system", line);
        return;
      }
      const parts = args.split(/\s+/);
      if (parts[0] === "rm" && parts[1]) {
        const id = parseInt(parts[1], 10);
        if (isNaN(id)) { tui!.log("system", `hook: invalid ID '${parts[1]}'`); return; }
        const ok = tui!.removeLifecycleHook(id);
        tui!.log("system", ok ? `hook: removed #${id}` : `hook: #${id} not found`);
        return;
      }
      // add: <event> <session|*> <command...>
      if (parts.length < 3) {
        tui!.log("system", "usage: /hook <event> <session|*> <command> — events: pre_start, post_start, pre_stop, post_stop, pre_restart, post_restart");
        return;
      }
      const [event, sessionPattern, ...cmdParts] = parts;
      const command = cmdParts.join(" ");
      const hook = tui!.addLifecycleHook(event, sessionPattern, command);
      if (hook) {
        tui!.log("system", `hook: added #${hook.id} ${hook.event} [${hook.sessionPattern}] → ${hook.command}`);
      } else {
        tui!.log("system", `hook: invalid event '${event}' — valid: pre_start, post_start, pre_stop, post_stop, pre_restart, post_restart`);
      }
    });
    input.onAlertPattern((args) => {
      if (!args) {
        const lines = formatAlertPatterns(tui!.getAlertPatterns());
        for (const line of lines) tui!.log("system", line);
        return;
      }
      const parts = args.split(/\s+/);
      if (parts[0] === "rm" && parts[1]) {
        const id = parseInt(parts[1], 10);
        if (isNaN(id)) { tui!.log("system", `alert-pattern: invalid ID '${parts[1]}'`); return; }
        const ok = tui!.removeAlertPattern(id);
        tui!.log("system", ok ? `alert-pattern: removed #${id}` : `alert-pattern: #${id} not found`);
        return;
      }
      // add: first token is regex, rest is optional label
      const pattern = parts[0];
      const label = parts.slice(1).join(" ") || undefined;
      const ap = tui!.addAlertPattern(pattern, label);
      if (ap) {
        tui!.log("system", `alert-pattern: added #${ap.id} /${ap.pattern}/i${ap.label ? ` (${ap.label})` : ""}`);
      } else {
        tui!.log("system", `alert-pattern: invalid regex '${pattern}'`);
      }
    });
    input.onSnap((target) => {
      const ref = /^\d+$/.test(target) ? parseInt(target, 10) : target;
      const sid = tui!.saveOutputSnapshot(ref);
      if (sid) {
        const session = tui!.getSessions().find((s) => s.id === sid);
        tui!.log("system", `snapshot saved for ${session?.title ?? sid}`);
      } else {
        tui!.log("system", `snap: session not found or has no output: ${target}`);
      }
    });
    // wire /snap-diff — diff current output vs last snapshot
    input.onSnapDiff((target) => {
      const ref = /^\d+$/.test(target) ? parseInt(target, 10) : target;
      // resolve session ID
      const sessions = tui!.getSessions();
      let session: typeof sessions[0] | undefined;
      if (typeof ref === "number") {
        session = sessions[ref - 1];
      } else {
        const needle = ref.toLowerCase();
        session = sessions.find((s) => s.id === ref || s.id.startsWith(needle) || s.title.toLowerCase() === needle);
      }
      if (!session) { tui!.log("system", `snap-diff: session not found: ${target}`); return; }
      const snapshot = tui!.getOutputSnapshot(session.id);
      if (!snapshot) { tui!.log("system", `snap-diff: no snapshot saved for ${session.title} — use /snap first`); return; }
      const current = tui!.getSessionOutput(session.id);
      if (!current) { tui!.log("system", `snap-diff: no current output for ${session.title}`); return; }
      const diff = diffSessionOutput(snapshot, current);
      const lines = formatSessionDiff(session.title, diff);
      for (const line of lines) tui!.log("system", line);
    });
    input.onThrottle((args) => {
      if (!args) {
        const globalMs = config.policies.actionCooldownMs ?? 30_000;
        const titles = new Map<string, string>();
        for (const s of tui!.getSessions()) titles.set(s.id, s.title);
        const lines = formatThrottleConfig(tui!.getAllSessionThrottles(), globalMs, titles);
        for (const line of lines) tui!.log("system", line);
        return;
      }
      const parts = args.split(/\s+/);
      const target = parts[0];
      const valueStr = parts[1];
      // resolve session
      const sessions = tui!.getSessions();
      const needle = target.toLowerCase();
      const session = /^\d+$/.test(target)
        ? sessions[parseInt(target, 10) - 1]
        : sessions.find((s) => s.id.startsWith(needle) || s.title.toLowerCase() === needle);
      if (!session) { tui!.log("system", `throttle: session not found: ${target}`); return; }
      if (!valueStr || valueStr === "clear") {
        const ok = tui!.clearSessionThrottle(session.id);
        tui!.log("system", ok ? `throttle: cleared override for ${session.title} (using global)` : `throttle: no override set for ${session.title}`);
        return;
      }
      const ms = parseInt(valueStr, 10);
      if (isNaN(ms) || ms < 0) { tui!.log("system", `throttle: invalid ms value '${valueStr}'`); return; }
      tui!.setSessionThrottle(session.id, ms);
      tui!.log("system", `throttle: ${session.title} → ${(ms / 1000).toFixed(1)}s cooldown`);
    });
    input.onRelay((args) => {
      if (!args) {
        // list rules
        const lines = formatRelayRules(tui!.getRelayRules());
        for (const line of lines) tui!.log("system", line);
        return;
      }
      const parts = args.split(/\s+/);
      if (parts[0] === "rm" && parts[1]) {
        const id = parseInt(parts[1], 10);
        if (isNaN(id)) { tui!.log("system", `relay: invalid ID '${parts[1]}'`); return; }
        const ok = tui!.removeRelayRule(id);
        tui!.log("system", ok ? `relay: removed rule #${id}` : `relay: rule #${id} not found`);
        return;
      }
      // add rule: <source> <target> <pattern...>
      if (parts.length < 3) {
        tui!.log("system", "usage: /relay <source> <target> <pattern> — or /relay rm <id>");
        return;
      }
      const [source, target, ...patternParts] = parts;
      const pattern = patternParts.join(" ");
      const rule = tui!.addRelayRule(source, target, pattern);
      tui!.log("system", `relay: added rule #${rule.id} — ${source} → ${target} when output contains "${pattern}"`);
    });
    input.onNotifyFilter((sessionTitle, events) => {
      if (sessionTitle === null) {
        // list current filters
        const filters = tui!.getAllSessionNotifyFilters();
        const lines = formatNotifyFilters(filters);
        for (const line of lines) tui!.log("system", line);
        return;
      }
      if (sessionTitle === "__CLEAR_ALL__") {
        // clear all filters
        const filters = tui!.getAllSessionNotifyFilters();
        const count = filters.size;
        for (const key of [...filters.keys()]) tui!.clearSessionNotifyFilter(key);
        tui!.log("system", `notify-filter: cleared ${count} filter${count !== 1 ? "s" : ""}`);
        return;
      }
      if (events.length === 1 && events[0] === "__CLEAR__") {
        // clear filter for one session
        const ok = tui!.clearSessionNotifyFilter(sessionTitle);
        tui!.log("system", ok ? `notify-filter: cleared filter for ${sessionTitle}` : `notify-filter: no filter set for ${sessionTitle}`);
        return;
      }
      // set filter
      const parsed = parseNotifyEvents(events);
      tui!.setSessionNotifyFilter(sessionTitle, parsed);
      const eventList = [...parsed].sort().join(", ") || "(none — all blocked)";
      tui!.log("system", `notify-filter: ${sessionTitle} → ${eventList}`);
    });
    // wire /ctx-budget — show smart context budget allocations
    input.onCtxBudget(() => {
      const sessions = tui!.getSessions();
      if (sessions.length === 0) {
        tui!.log("system", "ctx-budget: no sessions");
        return;
      }
      const allocations = computeContextBudgets(sessions);
      const lines = formatContextBudgetTable(allocations, CTX_BUDGET_DEFAULT_GLOBAL);
      for (const line of lines) tui!.log("system", line);
    });
    input.onBudget((target, budgetUSD) => {
      if (budgetUSD === null) {
        // clear global budget
        tui!.setGlobalBudget(null);
        tui!.log("system", "budget: global budget cleared");
        return;
      }
      if (target === null) {
        tui!.setGlobalBudget(budgetUSD);
        tui!.log("system", `budget: global budget set to $${budgetUSD.toFixed(2)}`);
        return;
      }
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const ok = tui!.setSessionBudget(num ?? target, budgetUSD);
      if (ok) tui!.log("system", `budget: $${budgetUSD.toFixed(2)} set for ${target}`);
      else tui!.log("system", `session not found: ${target}`);
    });
    // wire /pause-all and /resume-all
    input.onBulkControl((action) => {
      const sessions = tui!.getSessions();
      if (sessions.length === 0) {
        tui!.log("system", `${action}-all: no sessions`);
        return;
      }
      // ESC for pause, Enter for resume (nudge sessions out of waiting)
      const keys = action === "pause" ? "Escape" : "Enter";
      let count = 0;
      for (const s of sessions) {
        const tmuxName = computeTmuxName(s.title, s.id);
        shellExec("tmux", ["send-keys", "-t", tmuxName, "", keys])
          .then(() => { /* silent */ })
          .catch((_e: unknown) => { /* best effort */ });
        count++;
      }
      tui!.log("system", `${action}-all: sent to ${count} session${count !== 1 ? "s" : ""}`);
    });
    // wire /health-trend
    input.onHealthTrend((target, height) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const sessions = tui!.getSessions();
      const session = num !== undefined
        ? sessions[num - 1]
        : sessions.find((s) => s.title.toLowerCase() === target.toLowerCase() || s.id.startsWith(target));
      if (!session) { tui!.log("system", `session not found: ${target}`); return; }
      const hist = tui!.getSessionHealthHistory(session.id);
      const lines = formatHealthTrendChart(hist, session.title, height);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /alert-mute
    input.onAlertMute((pattern) => {
      if (pattern === null) {
        // null = "clear" keyword
        tui!.clearAlertMutePatterns();
        tui!.log("system", "alert-mute: all patterns cleared");
        return;
      }
      if (!pattern) {
        // empty = list patterns
        const pats = tui!.getAlertMutePatterns();
        if (pats.size === 0) {
          tui!.log("system", "alert-mute: no patterns set — use /alert-mute <text> to suppress");
        } else {
          tui!.log("system", `alert-mute: ${pats.size} pattern${pats.size !== 1 ? "s" : ""}:`);
          for (const p of pats) tui!.log("system", `  "${p}"`);
        }
        return;
      }
      tui!.addAlertMutePattern(pattern);
      tui!.log("system", `alert-mute: added "${pattern}" — matching alerts hidden from /alert-log`);
    });
    // wire /budgets list
    input.onBudgetsList(() => {
      const global = tui!.getGlobalBudget();
      const perSession = tui!.getAllSessionBudgets();
      if (global === null && perSession.size === 0) {
        tui!.log("system", "budgets: none set — use /budget $N (global) or /budget <N> $N (per-session)");
        return;
      }
      if (global !== null) tui!.log("system", `  global: $${global.toFixed(2)}`);
      const sessions = tui!.getSessions();
      for (const [id, budget] of perSession) {
        const s = sessions.find((s) => s.id === id);
        const label = s?.title ?? id.slice(0, 8);
        tui!.log("system", `  ${label}: $${budget.toFixed(2)}`);
      }
    });
    // wire /budget-status
    input.onBudgetStatus(() => {
      const sessions = tui!.getSessions();
      const costs = tui!.getAllSessionCosts();
      const global = tui!.getGlobalBudget();
      const perSession = tui!.getAllSessionBudgets();
      let shown = 0;
      for (const s of sessions) {
        const budget = perSession.get(s.id) ?? global;
        const costStr = costs.get(s.id);
        if (budget === null) continue;
        const over = isOverBudget(costStr, budget);
        const costLabel = costStr ?? "(no data)";
        const status = over ? `OVER ($${budget.toFixed(2)} budget)` : `ok ($${budget.toFixed(2)} budget)`;
        tui!.log("system", `  ${s.title}: ${costLabel} — ${status}`);
        shown++;
      }
      if (shown === 0) tui!.log("system", "budget-status: no sessions with budgets configured");
    });
    // wire /quiet-status
    input.onQuietStatus(() => {
      const { active, message } = formatQuietStatus(tui!.getQuietHours());
      tui!.log("system", `quiet-status: ${message}`);
      if (active) tui!.log("system", "  watchdog, burn-rate, and ceiling alerts are suppressed");
    });
    // wire /alert-log
    input.onAlertLog((count) => {
      const alerts = tui!.getAlertLog();
      const recent = alerts.slice(-count);
      if (recent.length === 0) {
        tui!.log("system", "alert-log: no auto-generated alerts yet");
        return;
      }
      tui!.log("system", `alert-log: last ${recent.length} alert${recent.length !== 1 ? "s" : ""}:`);
      for (const e of recent) {
        tui!.log("system", `  ${e.time}  ${e.text}`);
      }
    });
    // wire /cost-summary
    // wire /activity — plain-English session activity summaries
    input.onActivity(() => {
      const all = sessionSummarizer.getAll();
      if (all.size === 0) {
        tui!.log("system", "activity: no session summaries yet (waiting for first poll)");
        return;
      }
      tui!.log("system", `activity: ${all.size} session${all.size !== 1 ? "s" : ""}:`);
      for (const [title, summary] of all) {
        tui!.log("system", `  ${title}: ${SessionSummarizer.format(summary)}`);
      }
    });
    // wire /conflicts — cross-session file edit conflicts
    input.onConflicts(() => {
      const conflicts = conflictDetector.detectConflicts();
      if (conflicts.length === 0) {
        tui!.log("system", "conflicts: no file edit conflicts detected");
        return;
      }
      const lines = conflictDetector.formatConflicts(conflicts);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /heatmap — per-session activity sparklines
    input.onHeatmap(() => {
      const lines = activityTracker.formatAll();
      for (const line of lines) tui!.log("system", line);
    });
    // wire /audit — show recent audit trail entries
    input.onAudit((count) => {
      const entries = readRecentAuditEntries(count);
      if (entries.length === 0) {
        tui!.log("system", "audit: no entries yet");
        return;
      }
      tui!.log("system", `audit: last ${entries.length} entries:`);
      const lines = formatAuditEntries(entries);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /audit-stats — audit event type counts
    input.onAuditStats(() => {
      const stats = auditStats();
      tui!.log("system", "audit-stats:");
      const lines = formatAuditStats(stats);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /fleet-snap — manual fleet snapshot
    input.onFleetSnap(() => {
      const sessions = tui!.getSessions();
      const tasks = taskManager?.tasks ?? [];
      const summaries = new Map<string, string>();
      for (const [title, s] of sessionSummarizer.getAll()) {
        summaries.set(title, SessionSummarizer.format(s));
      }
      const scores = new Map<string, number>();
      // simple health from session status
      for (const s of sessions) {
        scores.set(s.title, s.status === "working" || s.status === "running" ? 80 : s.status === "error" ? 20 : 50);
      }
      const snapshot = captureFleetSnapshot(sessions, tasks, summaries, scores);
      const filepath = saveFleetSnapshot(snapshot);
      tui!.log("system", `fleet-snap: saved to ${filepath}`);
      const lines = formatFleetSnapshot(snapshot);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /budget-predict — predictive budget exhaustion
    input.onBudgetPredict(() => {
      if (!config.costBudgets) {
        tui!.log("system", "budget-predict: no costBudgets configured");
        return;
      }
      const budgetConfig = { globalBudgetUsd: config.costBudgets.globalBudgetUsd, sessionBudgets: config.costBudgets.sessionBudgets };
      const predictions = budgetPredictor.predictAll(budgetConfig);
      if (predictions.length === 0) {
        tui!.log("system", "budget-predict: insufficient cost data (need 2+ samples per session)");
        return;
      }
      tui!.log("system", `budget-predict: ${predictions.length} session${predictions.length !== 1 ? "s" : ""}:`);
      for (const p of predictions) tui!.log("system", BudgetPredictor.format(p));
    });
    // wire /retries — task retry states
    input.onRetries(() => {
      const lines = taskRetryManager.formatRetries();
      for (const line of lines) tui!.log("system", line);
    });
    // wire /audit-search — structured audit trail search
    input.onAuditSearch((queryStr) => {
      const query = parseAuditSearchQuery(queryStr);
      const results = searchAuditTrail(query);
      const lines = formatAuditSearchResults(results, queryStr);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /fleet-forecast — fleet-wide cost projection
    input.onFleetForecast(() => {
      if (!config.costBudgets) {
        tui!.log("system", "fleet-forecast: no costBudgets configured");
        return;
      }
      const budgetConfig = { globalBudgetUsd: config.costBudgets.globalBudgetUsd, sessionBudgets: config.costBudgets.sessionBudgets };
      const predictions = budgetPredictor.predictAll(budgetConfig);
      if (predictions.length === 0) {
        tui!.log("system", "fleet-forecast: insufficient cost data");
        return;
      }
      const forecast = computeFleetForecast(predictions);
      const lines = formatFleetForecast(forecast);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /priority — session priority queue
    input.onPriorityQueue(() => {
      const sessions = tui!.getSessions();
      const tasks = taskManager?.tasks ?? [];
      const inputs: SessionPriorityInput[] = sessions.map((s) => {
        const task = tasks.find((t) => t.sessionTitle === s.title);
        const lastChange = tui!.getAllLastChangeAt().get(s.id);
        return {
          sessionTitle: s.title,
          healthScore: s.status === "working" || s.status === "running" ? 80 : s.status === "error" ? 20 : 50,
          lastChangeMs: lastChange ? Date.now() - lastChange : 0,
          lastProgressMs: task?.lastProgressAt ? Date.now() - task.lastProgressAt : 0,
          taskStatus: task?.status ?? "unknown",
          isStuck: (task?.stuckNudgeCount ?? 0) > 0,
          hasError: s.status === "error",
          isUserActive: s.userActive ?? false,
        };
      });
      const ranked = rankSessionsByPriority(inputs);
      tui!.log("system", `priority queue (${ranked.length} sessions):`);
      const lines = formatPriorityQueue(ranked);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /escalations — notification escalation states
    input.onEscalations(() => {
      const lines = escalationManager.formatAll();
      for (const line of lines) tui!.log("system", line);
    });
    // wire /poll-status — adaptive poll interval info
    input.onPollStatus(() => {
      tui!.log("system", adaptivePollController.formatStatus());
    });
    // wire /drift — goal drift detection
    input.onDrift(() => {
      const tasks = taskManager?.tasks ?? [];
      const sessions = tui!.getSessions();
      const activeTasks = tasks.filter((t) => t.status === "active");
      if (activeTasks.length === 0) {
        tui!.log("system", "drift: no active tasks to check");
        return;
      }
      const signals = activeTasks.map((t) => {
        const session = sessions.find((s) => s.title === t.sessionTitle);
        const outputLines = session ? (tui!.getSessionOutput(session.id) ?? []) : [];
        return detectDrift(t, outputLines.join("\n"));
      });
      tui!.log("system", `drift: ${signals.length} session${signals.length !== 1 ? "s" : ""} checked:`);
      const lines = formatDriftSignals(signals);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /goal-progress — progress estimation
    input.onGoalProgress(() => {
      const tasks = taskManager?.tasks ?? [];
      const sessions = tui!.getSessions();
      if (tasks.length === 0) {
        tui!.log("system", "goal-progress: no tasks");
        return;
      }
      const estimates = tasks.map((t) => {
        const session = sessions.find((s) => s.title === t.sessionTitle);
        const outputLines = session ? (tui!.getSessionOutput(session.id) ?? []) : [];
        return estimateProgress(t, outputLines.join("\n"));
      });
      tui!.log("system", `goal-progress: ${estimates.length} tasks:`);
      const lines = formatProgressEstimates(estimates);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /pool — session pool status
    input.onPool(() => {
      const tasks = taskManager?.tasks ?? [];
      const lines = sessionPoolManager.formatStatus(tasks);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /reasoner-cost — reasoner call cost tracking
    input.onReasonerCost(() => {
      const lines = reasonerCostTracker.formatSummary();
      for (const line of lines) tui!.log("system", line);
    });
    // wire /anomaly — fleet anomaly detection
    input.onAnomaly(() => {
      const sessions = tui!.getSessions();
      const heatmaps = activityTracker.getAllHeatmaps();
      const heatmapByTitle = new Map(heatmaps.map((h) => [h.sessionTitle, h]));
      const metrics: SessionMetrics[] = sessions.map((s) => ({
        sessionTitle: s.title,
        costRatePerHour: budgetPredictor.predict(s.title, config.costBudgets ?? {})?.burnRateUsdPerHour ?? 0,
        activityEventsPerHour: (heatmapByTitle.get(s.title)?.totalEvents ?? 0) * 2, // 30min window → hourly rate
        errorCount: s.status === "error" ? 1 : 0,
        idleDurationMs: tui!.getAllLastChangeAt().get(s.id) ? Date.now() - tui!.getAllLastChangeAt().get(s.id)! : 0,
      }));
      const anomalies = detectAnomalies(metrics);
      const lines = formatAnomalies(anomalies);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /sla — fleet health SLA
    input.onSla(() => {
      const lines = fleetSlaMonitor.formatStatus();
      for (const line of lines) tui!.log("system", line);
    });
    // wire /velocity — progress velocity + ETA
    input.onVelocity(() => {
      const lines = progressVelocityTracker.formatAll();
      for (const line of lines) tui!.log("system", line);
    });
    // wire /schedule — dependency-aware scheduling
    input.onSchedule(() => {
      const tasks = taskManager?.tasks ?? [];
      const actions = computeSchedulingActions(tasks, sessionPoolManager.getStatus(tasks).maxConcurrent);
      const lines = formatSchedulingActions(actions);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /cache — observation cache stats
    input.onCache(() => {
      const lines = observationCache.formatStats();
      for (const line of lines) tui!.log("system", line);
    });
    // wire /rate-limit — fleet rate limit status
    input.onRateLimit(() => {
      const lines = fleetRateLimiter.formatStatus();
      for (const line of lines) tui!.log("system", line);
    });
    // wire /recovery — recovery playbook states
    input.onRecovery(() => {
      const lines = recoveryPlaybookManager.formatAll();
      for (const line of lines) tui!.log("system", line);
    });
    // wire /lifecycle — task lifecycle analytics
    input.onLifecycle(() => {
      const tasks = taskManager?.tasks ?? [];
      const records = buildLifecycleRecords(tasks);
      const stats = computeLifecycleStats(records);
      const lines = formatLifecycleStats(stats);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /cost-report — cost attribution breakdown
    input.onCostReport(() => {
      const tasks = taskManager?.tasks ?? [];
      const costMap = tui!.getAllSessionCosts();
      const attrs = buildCostAttributions(tasks, costMap);
      const report = computeCostReport(attrs);
      const lines = formatCostReport(report);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /decompose — goal decomposition
    input.onDecompose((target) => {
      const tasks = taskManager?.tasks ?? [];
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const task = num !== undefined ? tasks[num - 1] : tasks.find((t) => t.sessionTitle.toLowerCase() === target.toLowerCase());
      if (!task) { tui!.log("system", `decompose: task not found: ${target}`); return; }
      const result = decomposeGoal(task.goal, task.sessionTitle);
      const lines = formatDecomposition(result);
      for (const line of lines) tui!.log("system", line);
    });
    input.onCostSummary(() => {
      const sessions = tui!.getSessions();
      const summary = computeCostSummary(sessions, tui!.getAllSessionCosts());
      if (summary.sessionCount === 0) {
        tui!.log("system", "cost-summary: no cost data available (costs parsed from $N.NN pane output)");
        return;
      }
      tui!.log("system", `cost-summary: ${summary.totalStr} total across ${summary.sessionCount} session${summary.sessionCount !== 1 ? "s" : ""}:`);
      for (const e of summary.entries) {
        tui!.log("system", `  ${e.title}: ${e.costStr}`);
      }
    });
    // wire /session-report
    input.onSessionReport((target) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const sessions = tui!.getSessions();
      const session = num !== undefined
        ? sessions[num - 1]
        : sessions.find((s) => s.title.toLowerCase() === target.toLowerCase() || s.id.startsWith(target));
      if (!session) { tui!.log("system", `session not found: ${target}`); return; }
      const now = Date.now();
      const id = session.id;
      const firstSeen = tui!.getAllFirstSeen().get(id);
      const lastChange = tui!.getAllLastChangeAt().get(id);
      const burnRates = tui!.getAllBurnRates(now);
      const errTs = tui!.getSessionErrorTimestamps(id);
      const goalHist = tui!.getGoalHistory(id);
      const timeline = tui!.getSessionTimeline(id, 20) ?? [];
      const data: SessionReportData = {
        title: session.title,
        status: session.status,
        tool: session.tool,
        group: tui!.getGroup(id),
        color: tui!.getSessionColor(id),
        tags: [...tui!.getSessionTags(id)],
        note: tui!.getAllNotes().get(id),
        health: tui!.getAllHealthScores(now).get(id) ?? 100,
        errors: tui!.getSessionErrorCounts().get(id) ?? 0,
        errorTrend: errTs.length > 0 ? computeErrorTrend(errTs, now) : undefined,
        costStr: tui!.getSessionCost(id),
        contextTokens: session.contextTokens,
        uptimeMs: firstSeen !== undefined ? now - firstSeen : undefined,
        idleSinceMs: lastChange !== undefined ? now - lastChange : undefined,
        burnRatePerMin: burnRates.get(id) ?? null,
        goalHistory: [...goalHist],
        recentTimeline: timeline,
        exportedAt: new Date(now).toISOString(),
      };
      const md = formatSessionReport(data);
      const safeTitle = session.title.replace(/[^a-z0-9_-]/gi, "-").toLowerCase().slice(0, 30);
      const ts = new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dir = join(homedir(), ".aoaoe");
      const path = join(dir, `report-${safeTitle}-${ts}.md`);
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, md, "utf-8");
        tui!.log("system", `report saved: ~/.aoaoe/report-${safeTitle}-${ts}.md`);
      } catch (err) {
        tui!.log("error", `session-report failed: ${err}`);
      }
    });
    // wire /history-stats
    input.onHistoryStats(() => {
      const all = loadTuiHistory(100_000);
      if (all.length === 0) {
        tui!.log("system", "history-stats: no history entries found");
        return;
      }
      const stats = computeHistoryStats(all);
      const oldest = stats.oldestTs ? new Date(stats.oldestTs).toLocaleDateString() : "?";
      const newest = stats.newestTs ? new Date(stats.newestTs).toLocaleDateString() : "?";
      tui!.log("system", `history-stats: ${stats.totalEntries} entries over ${stats.spanDays} day(s) (${oldest} → ${newest})`);
      const topTags = Object.entries(stats.tagCounts).slice(0, 5);
      for (const [tag, count] of topTags) {
        tui!.log("system", `  ${tag}: ${count}`);
      }
    });
    // wire /clear-history
    input.onClearHistory(() => {
      try {
        writeFileSync(TUI_HISTORY_FILE, "", "utf-8");
        tui!.log("system", "history cleared — tui-history.jsonl truncated");
      } catch (err) {
        tui!.log("error", `clear-history failed: ${err}`);
      }
    });
    // wire /recall — search persisted history
    input.onRecall((keyword, maxResults) => {
      const matches = searchHistory(keyword, maxResults);
      if (matches.length === 0) {
        tui!.log("system", `recall: no matches for "${keyword}" in history`);
        return;
      }
      tui!.log("system", `recall: ${matches.length} match${matches.length !== 1 ? "es" : ""} for "${keyword}":`);
      for (const e of matches) {
        tui!.log("system", `  ${e.time}  ${e.tag}  ${e.text}`);
      }
    });
    // wire /stats per-session summary
    input.onStats(() => {
      const sessions = tui!.getSessions();
      if (sessions.length === 0) {
        tui!.log("system", "no sessions — no stats available");
        return;
      }
      const now = Date.now();
       const entries = buildSessionStats(
         sessions,
         tui!.getSessionErrorCounts(),
         tui!.getAllBurnRates(now),
         tui!.getAllFirstSeen(),
         tui!.getAllLastChangeAt(),
         tui!.getAllHealthScores(now),
         tui!.getAllSessionAliases(),
         now,
         new Map(sessions.map((s) => [s.id, tui!.getSessionErrorTimestamps(s.id)])),
         tui!.getAllSessionCosts(),
         new Map(sessions.map((s) => [s.id, tui!.getSessionHealthHistory(s.id)])),
       );
       tui!.log("system", `/stats — ${entries.length} session${entries.length !== 1 ? "s" : ""}:`);
      for (const line of formatSessionStatsLines(entries)) {
        tui!.log("system", line);
      }
    });
    // wire /stats-live — toggle periodic auto-refresh of per-session stats
    input.onStatsLive(() => {
      if (tui!.isStatsRefreshing()) {
        tui!.stopStatsRefresh();
        tui!.log("system", "stats-live: off");
      } else {
        const refreshFn = () => {
          const sessions = tui!.getSessions();
          if (sessions.length === 0) return;
          const now = Date.now();
          const entries = buildSessionStats(
            sessions,
            tui!.getSessionErrorCounts(),
            tui!.getAllBurnRates(now),
            tui!.getAllFirstSeen(),
            tui!.getAllLastChangeAt(),
            tui!.getAllHealthScores(now),
            tui!.getAllSessionAliases(),
            now,
            new Map(sessions.map((s) => [s.id, tui!.getSessionErrorTimestamps(s.id)])),
            tui!.getAllSessionCosts(),
            new Map(sessions.map((s) => [s.id, tui!.getSessionHealthHistory(s.id)])),
          );
          tui!.log("stats", `/stats — ${entries.length} session${entries.length !== 1 ? "s" : ""}:`);
          for (const line of formatSessionStatsLines(entries)) {
            tui!.log("stats", line);
          }
        };
        tui!.startStatsRefresh(refreshFn);
        tui!.log("system", "stats-live: on (every 5s) — /stats-live again to stop");
      }
    });
    // wire /copy session pane output to clipboard
    input.onCopySession((target) => {
      // resolve target: null = current drill-down session
      let lines: string[] | null = null;
      let label = "current session";
      if (target === null) {
        const ddId = tui!.getDrilldownId();
        if (!ddId) {
          tui!.log("system", "no session in view — use /copy N or drill into a session first");
          return;
        }
        lines = tui!.getSessionOutput(ddId);
        const s = tui!.getSessions().find((s) => s.id === ddId);
        label = s?.title ?? ddId.slice(0, 8);
      } else {
        const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
        lines = tui!.getSessionOutput(num ?? target);
        label = target;
      }
      if (!lines || lines.length === 0) {
        tui!.log("system", `no output stored for ${label} — session may not have been polled yet`);
        return;
      }
      const text = lines.join("\n") + "\n";
      try {
        execSync("pbcopy", { input: text, timeout: 5000 });
        tui!.log("system", `copied ${lines.length} lines from ${label} to clipboard`);
      } catch {
        try {
          const copyPath = join(homedir(), ".aoaoe", "copy.txt");
          writeFileSync(copyPath, text, "utf-8");
          tui!.log("system", `saved ${lines.length} lines from ${label} to ~/.aoaoe/copy.txt`);
        } catch (writeErr) {
          tui!.log("error", `copy failed: ${writeErr}`);
        }
      }
    });
    // wire /rename custom display name
    input.onRename((target, displayName) => {
      const num = /^\d+$/.test(target) ? parseInt(target, 10) : undefined;
      const ok = tui!.renameSession(num ?? target, displayName || null);
      if (ok) {
        if (displayName) {
          tui!.log("system", `renamed ${target} → "${displayName}"`);
        } else {
          tui!.log("system", `rename cleared for ${target}`);
        }
        persistPrefs();
      } else {
        tui!.log("system", `session not found: ${target}`);
      }
    });
    // wire /ceiling context usage view
    input.onCeiling(() => {
      const sessions = tui!.getSessions();
      if (sessions.length === 0) {
        tui!.log("system", "no sessions — context data not available");
        return;
      }
      const ceilings = tui!.getAllContextCeilings();
      let any = false;
      for (const s of sessions) {
        const c = ceilings.get(s.id);
        if (!c) {
          tui!.log("system", `  ${s.title}: no ceiling data (${s.contextTokens ?? "no tokens"})`);
        } else {
          const pct = Math.round((c.current / c.max) * 100);
          const warn = pct >= CONTEXT_CEILING_THRESHOLD * 100 ? " ⚠" : "";
          tui!.log("system", `  ${s.title}: ${pct}% — ${c.current.toLocaleString()} / ${c.max.toLocaleString()} tokens${warn}`);
          any = true;
        }
      }
      if (!any) tui!.log("system", `  tip: context ceiling requires "X / Y tokens" format in session output`);
    });
    // wire /top ranked session view
    input.onTop((modeArg) => {
      const mode: TopSortMode = (TOP_SORT_MODES as readonly string[]).includes(modeArg)
        ? modeArg as TopSortMode : "default";
      const sessions = tui!.getSessions();
      if (sessions.length === 0) {
        tui!.log("system", "no sessions");
        return;
      }
      const now = Date.now();
      const entries = rankSessions(
        sessions,
        tui!.getSessionErrorCounts(),
        tui!.getAllBurnRates(now),
        tui!.getAllLastChangeAt(),
        mode,
        now,
      );
      const modeLabel = mode === "default" ? "composite" : mode;
      tui!.log("system", `/top (${modeLabel}) — ${entries.length} sessions:`);
      for (const e of entries) {
        const errStr = e.errors > 0 ? ` ${e.errors}err` : "";
        const burnStr = e.burnRatePerMin !== null && e.burnRatePerMin > 0
          ? ` ~${Math.round(e.burnRatePerMin / 100) * 100}tok/min` : "";
        const idleStr = e.idleMs !== null ? ` ${formatIdleSince(e.idleMs) || "active"}` : "";
        tui!.log("system", `  #${e.rank} ${e.title} [${e.status}]${errStr}${burnStr}${idleStr}`);
      }
    });
    // wire /watchdog stall detection
    input.onWatchdog((thresholdMinutes) => {
      if (thresholdMinutes === null) {
        tui!.setWatchdog(null);
        tui!.log("system", "watchdog: disabled");
      } else {
        tui!.setWatchdog(thresholdMinutes * 60_000);
        tui!.log("system", `watchdog: alert if session stalls >${thresholdMinutes}m`);
      }
    });
    // wire /snapshot export
    input.onSnapshot((fmt) => {
      const sessions = tui!.getSessions();
      const groups = tui!.getAllGroups();
      const notes = tui!.getAllNotes();
      const firstSeen = tui!.getAllFirstSeen();
      const errorCounts = tui!.getSessionErrorCounts();
      const burnRates = tui!.getAllBurnRates();
      const version = pkg ?? "dev";
      const data = buildSnapshotData(sessions, groups, notes, firstSeen, errorCounts, burnRates, version);
      const ts = new Date(data.exportedAtMs).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dir = join(homedir(), ".aoaoe");
      try {
        mkdirSync(dir, { recursive: true });
        if (fmt === "md") {
          const path = join(dir, `snapshot-${ts}.md`);
          writeFileSync(path, formatSnapshotMarkdown(data), "utf-8");
          tui!.log("system", `snapshot saved: ~/.aoaoe/snapshot-${ts}.md (${sessions.length} sessions)`);
        } else {
          const path = join(dir, `snapshot-${ts}.json`);
          writeFileSync(path, formatSnapshotJson(data), "utf-8");
          tui!.log("system", `snapshot saved: ~/.aoaoe/snapshot-${ts}.json (${sessions.length} sessions)`);
        }
      } catch (err) {
        tui!.log("error", `snapshot failed: ${err}`);
      }
    });
    // wire /broadcast — send a message to all sessions (or group-filtered)
    input.onBroadcast((message, group) => {
      const sessions = tui!.getSessions();
      const groups = tui!.getAllGroups();
      const targets = group
        ? sessions.filter((s) => groups.get(s.id) === group)
        : sessions;
      if (targets.length === 0) {
        tui!.log("system", formatBroadcastSummary(0, group));
        return;
      }
      // fire send_input for each target session via tmux (bypasses executor rate limit)
      tui!.log("system", formatBroadcastSummary(targets.length, group));
      for (const s of targets) {
        // resolve tmux pane name (aoe_<title>_<first8id>)
        const tmuxName = computeTmuxName(s.title, s.id);
        shellExec("tmux", ["send-keys", "-t", tmuxName, message, "Enter"])
          .then(() => tui!.log("+ action", `broadcast → ${s.title}`, s.id))
          .catch((err: unknown) => tui!.log("! action", `broadcast failed → ${s.title}: ${err}`, s.id));
      }
    });
    // wire mouse move to hover highlight on session cards (disabled in compact)
    input.onMouseMove((row, _col) => {
      if (tui!.getViewMode() === "overview" && !tui!.isCompact()) {
        const sessionIdx = hitTestSession(row, 1, tui!.getSessionCount());
        tui!.setHoverSession(sessionIdx);
      }
    });
    // wire mouse wheel to scroll (3 lines per tick for smooth scrolling)
    input.onMouseWheel((direction) => {
      if (tui!.getViewMode() === "drilldown") {
        if (direction === "up") tui!.scrollDrilldownUp(3);
        else tui!.scrollDrilldownDown(3);
      } else {
        if (direction === "up") tui!.scrollUp(3);
        else tui!.scrollDown(3);
      }
    });
  }

  const getReasonerLabel = (): string => (
    config.observe
      ? "observe-only"
      : config.reasoner === "opencode"
        ? `opencode${config.opencode.model ? `:${config.opencode.model}` : ""}`
        : `claude-code${config.claudeCode.model ? `:${config.claudeCode.model}` : ""}`
  );

  const getRunMode = (): string => (
    config.observe
      ? "observe"
      : config.confirm
        ? "confirm"
        : config.dryRun
          ? "dry-run"
          : "autopilot"
  );

  // start TUI (alternate screen buffer) after input is ready
  if (tui) {
    // replay persisted history from previous runs before entering alt screen
    const retentionDays = config.tuiHistoryRetentionDays ?? 7;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const history = loadTuiHistory(200, undefined, retentionMs);
    if (history.length > 0) tui.replayHistory(history);

    tui.start(pkg || "dev");
    tui.updateState({ reasonerName: getReasonerLabel(), supervisorStatus: buildTaskSupervisorStatus(taskManager) });

    // welcome banner — plain-English explanation of what's happening
    tui.log("system", "");
    if (config.observe) {
      tui.log("system", "OBSERVE MODE — watching agents without touching anything.");
      tui.log("system", "No AI calls, no actions, zero cost. Just monitoring.");
    } else if (config.confirm) {
      tui.log("system", "supervisor is active — will ask before every action.");
      tui.log("system", "You'll see a y/n prompt before anything runs.");
    } else if (config.dryRun) {
      tui.log("system", "DRY RUN — AI will think, but nothing will be executed.");
    } else {
      tui.log("system", "supervisor is active — watching agents and acting when needed.");
    }
    tui.log("system", "");

    // show which AoE sessions are being supervised (with tmux window names)
    if (taskManager && taskManager.tasks.length > 0) {
      tui.log("system", "── supervised sessions ─────────────────────────────────");
      for (const t of taskManager.tasks) {
        const tmuxName = `aoe_${t.sessionTitle}_${t.sessionId?.slice(0, 8) ?? "????????"}`;
        const goalLines = goalToList(t.goal);
        const goalPreview = goalLines[0]?.slice(0, 60) ?? "continue roadmap";
        tui.log("system", `  ${t.sessionTitle}  →  tmux: ${tmuxName}`);
        tui.log("system", `  goal: ${goalPreview}${goalLines.length > 1 ? ` (+${goalLines.length - 1} more)` : ""}`);
      }
      tui.log("system", "────────────────────────────────────────────────────────");
    }

    tui.log("system", "");
    tui.log("system", `config: ${configPath ?? "defaults"}`);
    tui.log("system", "/help for commands  •  ESC ESC to interrupt  •  type to message the AI");
    tui.log("system", "");

    // catch-up: show recent activity from actions.log
    try {
      const actionsLogPath = join(homedir(), ".aoaoe", "actions.log");
      if (existsSync(actionsLogPath)) {
        const logContent = readFileSync(actionsLogPath, "utf-8").trim();
        if (logContent) {
          const logLines = logContent.split("\n").filter((l) => l.trim());
          const catchUp = summarizeRecentActions(logLines);
          tui.log("system", catchUp);
        }
      }
    } catch {}
  }

  // ── health check HTTP server (opt-in via config.healthPort) ────────────────
  const daemonStartedAt = Date.now();
  let healthServer: ReturnType<typeof startHealthServer> | null = null;
  if (config.healthPort) {
    healthServer = startHealthServer(config.healthPort, daemonStartedAt);
    const msg = `health server listening on http://127.0.0.1:${config.healthPort}/health`;
    if (tui) tui.log("system", msg); else log(msg);
  }

  // ── session stats (for shutdown summary) ──────────────────────────────────
  let totalDecisions = 0;
  let totalActionsExecuted = 0;
  let totalActionsFailed = 0;
  let totalPolls = 0;
  let lastReasonerAt = 0;
  let lastReasonerDurationMs = 0;
  let lastReasonerSummary = "";
  let lastReasonerActionCount = 0;

  // graceful shutdown — wrap in .catch so unhandled rejections from
  // reasoner.shutdown() or reasonerConsole.stop() don't get swallowed
  let running = true;
  const shutdown = () => {
    if (!running) return;
    running = false;
    // swallow further signals during cleanup — prevents stale lock files
    // when user hits Ctrl+C again while async cleanup is in progress
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.on("SIGINT", () => {}); // swallow
    process.on("SIGTERM", () => {}); // swallow
    if (tui) tui.stop();

    // ── shutdown summary ──────────────────────────────────────────────────
    const elapsed = Date.now() - daemonStartedAt;
    const mins = Math.floor(elapsed / 60_000);
    const secs = Math.floor((elapsed % 60_000) / 1000);
    const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    console.error("");
    console.error("  ── aoaoe session summary ──");
    console.error(`  duration:   ${duration}`);
    console.error(`  polls:      ${totalPolls}`);
    if (!config.observe) {
      console.error(`  decisions:  ${totalDecisions}`);
      console.error(`  actions:    ${totalActionsExecuted} executed, ${totalActionsFailed} failed`);
    }
    if (config.observe) console.error(`  mode:       observe-only (no LLM, no execution)`);
    else if (config.confirm) console.error(`  mode:       confirm (human-approved actions)`);
    else if (config.dryRun) console.error(`  mode:       dry-run (no execution)`);
    console.error("");

    log("shutting down...");
    configWatcher.stop();
    if (healthServer) healthServer.close();
    // notify: daemon stopped (fire-and-forget, don't block shutdown)
    sendNotification(config, { event: "daemon_stopped", timestamp: Date.now(), detail: `polls: ${totalPolls}, actions: ${totalActionsExecuted}` });
    input.stop();
    Promise.resolve()
      .then(() => reasonerConsole.stop())
      .then(() => reasoner?.shutdown())
      .catch((err) => console.error(`[shutdown] error during cleanup: ${err}`))
      .finally(() => {
        cleanupState();
        process.exit(0);
      });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // main loop
  let pollCount = 0;
  let forceDashboard = false;
  let paused = false; // can be set by /pause from stdin or chat.ts
  const policyStates = new Map<string, SessionPolicyState>(); // per-session idle/error tracking
  if (tui) {
    tui.log("system", "entering main loop (Ctrl+C to stop)");
  } else {
    log("entering main loop (Ctrl+C to stop)\n");
  }

  // ── config hot-reload watcher ──────────────────────────────────────────────
  const configWatcher = new ConfigWatcher(config);
  const watchedPath = configWatcher.start((changes, newConfig) => {
    config = newConfig;
    if (executor) (executor as Executor).updateConfig(newConfig);
    const applied = changes.filter((c) => c.applied);
    const needsRestart = changes.filter((c) => !c.applied);
    for (const c of applied) {
      const msg = `${formatConfigChange(c)}`;
      if (tui) tui.log("config", msg); else log(`config: ${msg}`);
    }
    for (const c of needsRestart) {
      const msg = `${c.field} changed — restart required`;
      if (tui) tui.log("config", msg); else log(`config: ${msg}`);
    }
  });
  if (watchedPath) {
    const msg = `watching config: ${watchedPath}`;
    if (tui) tui.log("system", msg); else log(msg);
  }

  // notify: daemon started
  sendNotification(config, { event: "daemon_started", timestamp: Date.now(), detail: `reasoner: ${config.reasoner}` });

  // clear any stale interrupt from a previous run
  clearInterrupt();

  // auto-explain: on the very first tick with sessions, inject an explain prompt
  // so the AI introduces what it sees. Only in normal mode (not observe/confirm/dry-run).
  let autoExplainPending = !config.observe && !config.confirm;

  while (running) {
    pollCount++;

    // drain user input from both stdin and console tmux session
    const stdinMessages = input.drain();
    const consoleMessages = reasonerConsole.drainInput();
    const allMessages = [...stdinMessages, ...consoleMessages];

    // classify into commands vs. real user messages
    const { commands, userMessages } = classifyMessages(allMessages);

    // strip insist prefix from priority messages and log them distinctly
    for (let i = 0; i < userMessages.length; i++) {
      if (isInsistMessage(userMessages[i])) {
        const raw = stripInsistPrefix(userMessages[i]);
        userMessages[i] = raw;
        if (tui) tui.log("you", `! ${raw}`); else log(`[insist] ${raw}`);
      }
    }

    // auto-explain on first tick: inject an explain prompt so the AI introduces itself
    if (autoExplainPending && pollCount === 1) {
      const autoExplainPrompt = "This is your first observation. Please briefly introduce what you see: " +
        "how many agents are running, what each one is working on, and whether anything needs attention. " +
        "Keep it conversational — one or two sentences per agent.";
      userMessages.push(autoExplainPrompt);
      autoExplainPending = false;
      if (tui) tui.log("system", "asking the AI for an introduction..."); else log("auto-explain: asking AI to introduce what it sees");
    }

    // /explain: inject a smart prompt into userMessages before formatting
    if (commands.includes("__CMD_EXPLAIN__")) {
      const explainPrompt = "Please explain what's happening right now in plain English. " +
        "For each agent, say what it's working on, whether it's making progress or stuck, " +
        "and whether you plan to do anything. Write as if explaining to someone who just walked in.";
      userMessages.push(explainPrompt);
      if (tui) tui.log("you", "/explain"); else log("/explain — asking AI for a summary");
      reasonerConsole.writeUserMessage("/explain");
    }

    // acknowledge receipt of user messages in the conversation log
    const receipts = buildReceipts(userMessages);
    for (const receipt of receipts) {
      reasonerConsole.writeStatus(receipt);
    }

    // format user messages for the reasoner prompt
    const userMessage = userMessages.length > 0 ? formatUserMessages(userMessages) : undefined;

    // adaptive poll: reset to fast mode when user sends a message
    if (userMessage) adaptivePollController.reset();

    // handle built-in command markers (from stdin or chat.ts file IPC)
    for (const cmd of commands) {
      if (cmd.startsWith("__CMD_PIN_SAVE__")) {
        const name = cmd.slice("__CMD_PIN_SAVE__".length).trim();
        if (!name) {
          const msg = "usage: /pin-save <preset-name>";
          if (tui) tui.log("error", msg); else log(msg);
          continue;
        }
        if (tui) {
          const titles = tui.getPinnedTitles();
          if (titles.length === 0) {
            const msg = "no sessions pinned — /pin a session first";
            tui.log("status", msg);
          } else {
            savePreset(name, titles);
            const msg = `pin preset saved: ${name} (${titles.join(", ")})`;
            tui.log("system", msg);
            pushSupervisorEvent(`pin-save: ${name} [${titles.length} sessions]`);
          }
        } else {
          log("pin presets require TUI mode");
        }
        continue;
      }
      if (cmd.startsWith("__CMD_PIN_LOAD__")) {
        const name = cmd.slice("__CMD_PIN_LOAD__".length).trim();
        if (!name) {
          const msg = "usage: /pin-load <preset-name>";
          if (tui) tui.log("error", msg); else log(msg);
          continue;
        }
        const titles = getPreset(name);
        if (!titles) {
          const msg = `pin preset not found: ${name}`;
          if (tui) tui.log("error", msg); else log(msg);
          continue;
        }
        if (tui) {
          const count = tui.loadPinPreset(titles);
          const msg = `pin preset loaded: ${name} (${count} sessions pinned)`;
          tui.log("system", msg);
          pushSupervisorEvent(`pin-load: ${name} [${count} pinned]`);
        }
        continue;
      }
      if (cmd.startsWith("__CMD_PIN_DELETE__")) {
        const name = cmd.slice("__CMD_PIN_DELETE__".length).trim();
        if (!name) {
          const msg = "usage: /pin-delete <preset-name>";
          if (tui) tui.log("error", msg); else log(msg);
          continue;
        }
        const ok = deletePreset(name);
        const msg = ok ? `pin preset deleted: ${name}` : `pin preset not found: ${name}`;
        if (tui) tui.log(ok ? "system" : "error", msg); else log(msg);
        continue;
      }
      if (cmd === "__CMD_PIN_PRESETS__") {
        const msg = formatPresetList();
        for (const line of msg.split("\n")) {
          if (tui) tui.log("status", line); else log(line);
        }
        continue;
      }
      if (cmd.startsWith("__CMD_PROMPT_TEMPLATE__")) {
        const name = cmd.slice("__CMD_PROMPT_TEMPLATE__".length).trim();
        if (!name) {
          const current = config.promptTemplate || "default";
          const msg = `current prompt template: ${current}`;
          if (tui) tui.log("status", msg); else log(msg);
          const list = formatPromptTemplateList();
          for (const line of list.split("\n")) {
            if (tui) tui.log("status", line); else log(line);
          }
        } else {
          const tmpl = resolvePromptTemplate(name);
          if (!tmpl) {
            const msg = `unknown prompt template: ${name}`;
            if (tui) tui.log("error", msg); else log(msg);
            const list = formatPromptTemplateList();
            for (const line of list.split("\n")) {
              if (tui) tui.log("status", line); else log(line);
            }
          } else {
            config.promptTemplate = tmpl.name;
            const msg = `prompt template set to: ${tmpl.name} — ${tmpl.description}`;
            if (tui) tui.log("system", msg); else log(msg);
            pushSupervisorEvent(`prompt-template: ${tmpl.name}`);
            reasonerConsole.writeSystem(msg);
            // note: takes effect on next reasoner init (next reasoning cycle)
            if (tui) tui.log("status", `(takes effect on next reasoning cycle)`);
          }
        }
        continue;
      }
      if (cmd === "__CMD_HEALTH__") {
        const tasks = taskManager?.tasks ?? [];
        const report = formatHealthReport(tasks);
        for (const line of report.split("\n")) {
          if (tui) tui.log("status", line); else log(line);
          reasonerConsole.writeSystem(line);
        }
        continue;
      }
      if (cmd === "__CMD_STATUS__") {
        const isPausedNow = paused || input.isPaused();
        const modeMsg = `status: poll #${pollCount}, mode=${getRunMode()}, reasoner=${getReasonerLabel()}, paused=${isPausedNow}`;
        const totalsMsg = `lifetime: polls=${totalPolls}, decisions=${totalDecisions}, actions=${totalActionsExecuted} ok / ${totalActionsFailed} failed`;
        const reasonerMsg = lastReasonerAt > 0
          ? `reasoner: last cycle ${Math.max(0, Math.floor((Date.now() - lastReasonerAt) / 1000))}s ago, took ${lastReasonerDurationMs}ms, actions=${lastReasonerActionCount}${lastReasonerSummary ? ` (${lastReasonerSummary})` : ""}`
          : "reasoner: no completed cycles yet";
        if (tui) {
          tui.log("status", modeMsg);
          tui.log("status", totalsMsg);
          tui.log("status", reasonerMsg);
        } else {
          log(modeMsg);
          log(totalsMsg);
          log(reasonerMsg);
        }
        reasonerConsole.writeSystem(modeMsg);
        reasonerConsole.writeSystem(totalsMsg);
        reasonerConsole.writeSystem(reasonerMsg);
      } else if (cmd.startsWith("__CMD_PROGRESS__")) {
        const args = cmd.slice("__CMD_PROGRESS__".length).trim().split(/\s+/).filter(Boolean);
        let maxAgeMs = 24 * 60 * 60 * 1000;
        let outputJson = false;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--json") {
            outputJson = true;
          } else if (args[i] === "--since" && args[i + 1]) {
            const dur = parseDuration(args[i + 1]);
            if (dur !== null) maxAgeMs = dur;
            i++;
          }
        }
        const tasks = taskManager?.tasks ?? [];
        if (outputJson) {
          const now = Date.now();
          const cutoff = now - maxAgeMs;
          const payload = tasks.map((t) => ({
            session: t.sessionTitle,
            status: t.status,
            dependsOn: t.dependsOn ?? [],
            recentProgress: t.progress.filter((p) => p.at >= cutoff).map((p) => ({
              at: p.at,
              ago: formatAgo(now - p.at),
              summary: p.summary,
            })),
          }));
          const jsonStr = JSON.stringify(payload, null, 2);
          for (const line of jsonStr.split("\n")) {
            if (tui) tui.log("status", line); else log(line);
            reasonerConsole.writeSystem(line);
          }
        } else {
          const digest = formatProgressDigest(tasks, maxAgeMs);
          for (const line of digest.split("\n")) {
            if (tui) tui.log("status", line); else log(line);
            reasonerConsole.writeSystem(line);
          }
        }
      } else if (cmd.startsWith("__CMD_INCIDENT__")) {
        const args = cmd.slice("__CMD_INCIDENT__".length).trim().split(/\s+/).filter(Boolean);
        let maxAgeMs = 30 * 60 * 1000;
        let limit = 5;
        let outputJson = false;
        let outputNdjson = false;
        let watchRequested = false;
        let followRequested = false;
        let changesOnlyRequested = false;
        let heartbeatSec: number | undefined;
        let intervalMs: number | undefined;
        let parseError: string | null = null;
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === "--json") {
            outputJson = true;
          } else if (a === "--ndjson") {
            outputNdjson = true;
          } else if (a === "--follow" || a === "-f") {
            followRequested = true;
          } else if (a === "--watch" || a === "-w") {
            watchRequested = true;
          } else if (a === "--changes-only") {
            changesOnlyRequested = true;
          } else if ((a === "--heartbeat" || a === "-H")) {
            const raw = args[i + 1];
            if (!raw) { parseError = "missing value for --heartbeat"; break; }
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n < 1) { parseError = `invalid --heartbeat '${raw}'`; break; }
            heartbeatSec = n;
            i++;
          } else if ((a === "--interval" || a === "-i")) {
            const raw = args[i + 1];
            if (!raw) { parseError = "missing value for --interval"; break; }
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n < 500) { parseError = `invalid --interval '${raw}'`; break; }
            intervalMs = n;
            i++;
          } else if (a === "--since") {
            const raw = args[i + 1];
            if (!raw) { parseError = "missing value for --since"; break; }
            const dur = parseDuration(raw);
            if (dur === null) { parseError = `invalid --since '${raw}' (examples: 30m, 2h, 1d)`; break; }
            maxAgeMs = dur;
            i++;
          } else if (a === "--limit") {
            const raw = args[i + 1];
            if (!raw) { parseError = "missing value for --limit"; break; }
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n < 1) { parseError = `invalid --limit '${raw}'`; break; }
            limit = n;
            i++;
          } else {
            parseError = `unknown incident option '${a}'`;
            break;
          }
        }

        if (followRequested) {
          watchRequested = true;
          changesOnlyRequested = true;
          if (heartbeatSec === undefined) heartbeatSec = 30;
          if (!outputJson && !outputNdjson) outputNdjson = true;
        }

        if (watchRequested || changesOnlyRequested || heartbeatSec !== undefined || intervalMs !== undefined) {
          const watchArgs: string[] = ["--watch"];
          if (changesOnlyRequested) watchArgs.push("--changes-only");
          if (heartbeatSec !== undefined) watchArgs.push("--heartbeat", String(heartbeatSec));
          if (intervalMs !== undefined) watchArgs.push("--interval", String(intervalMs));
          if (args.includes("--since")) {
            const idx = args.indexOf("--since");
            if (idx !== -1 && args[idx + 1]) watchArgs.push("--since", args[idx + 1]);
          }
          if (args.includes("--limit")) {
            const idx = args.indexOf("--limit");
            if (idx !== -1 && args[idx + 1]) watchArgs.push("--limit", args[idx + 1]);
          }
          if (outputJson) watchArgs.push("--json");
          if (outputNdjson) watchArgs.push("--ndjson");
          const msg = `incident: watch mode is CLI-only; run ${BOLD}aoaoe incident ${watchArgs.join(" ")}${RESET} in another terminal`;
          if (tui) tui.log("status", msg); else log(msg);
          reasonerConsole.writeSystem(msg);
        }

        if (parseError) {
          const msg = `incident: ${parseError}`;
          const usage = "incident usage: /incident [--since <30m|2h|1d>] [--limit N] [--json|--ndjson] [--watch|--follow]";
          if (tui) {
            tui.log("error", msg);
            tui.log("status", usage);
          } else {
            log(msg);
            log(usage);
          }
          reasonerConsole.writeSystem(msg);
          reasonerConsole.writeSystem(usage);
          continue;
        }

        const runbook = buildRunbookPayload("incident");
        const tasks = taskManager?.tasks ?? [];
        const status = buildTaskSupervisorStatus(taskManager) || "supervisor: no task manager active";
        const active = tasks.filter((t) => t.status === "active").length;
        const pending = tasks.filter((t) => t.status === "pending").length;
        const pausedTasks = tasks.filter((t) => t.status === "paused").length;
        const now = Date.now();
        const recent = supervisorEvents.filter((evt) => evt.at >= (now - maxAgeMs)).slice(-limit).reverse();
        const formatAgoShort = (at: number): string => {
          const ms = Math.max(0, Date.now() - at);
          if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
          if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
          return `${Math.floor(ms / 3_600_000)}h ago`;
        };

        const incidentPayload = {
          emitReason: "snapshot",
          incident: {
            supervisor: status,
            summary: { active, pending, paused: pausedTasks },
            options: { sinceMs: maxAgeMs, limit },
            responseFlow: runbook.payload.responseFlow,
            recentEvents: recent.map((evt) => ({ at: evt.at, ago: formatAgoShort(evt.at), detail: evt.detail })),
            stepIn: "/task <session> :: <goal>",
          },
        };

        if (outputJson || outputNdjson) {
          const encoded = outputNdjson ? JSON.stringify(incidentPayload) : JSON.stringify(incidentPayload, null, 2);
          const jsonLines = outputNdjson ? [encoded] : encoded.split("\n");
          for (const line of jsonLines) {
            if (tui) tui.log("status", line); else log(line);
            reasonerConsole.writeSystem(line);
          }
          continue;
        }

        const lines: string[] = [
          "incident quick view:",
          `supervisor: ${status}`,
          `incident focus: ${active} active | ${pending} pending | ${pausedTasks} paused | events(window): ${recent.length}`,
          "runbook response-flow:",
        ];

        for (const step of runbook.payload.responseFlow) {
          lines.push(`- ${step.when} -> ${step.action}${step.command ? ` (${step.command})` : ""}`);
        }

        if (recent.length > 0) {
          lines.push("recent supervisor events:");
          for (const evt of recent) lines.push(`- ${evt.detail} (${formatAgoShort(evt.at)})`);
        } else {
          lines.push("recent supervisor events: none in current window");
        }

        lines.push("step-in now: /task <session> :: <goal>");

        for (const line of lines) {
          if (tui) tui.log("status", line); else log(line);
          reasonerConsole.writeSystem(line);
        }
      } else if (cmd.startsWith("__CMD_RUNBOOK__")) {
        const args = cmd.slice("__CMD_RUNBOOK__".length).trim().split(/\s+/).filter(Boolean);
        let section: string | undefined;
        let outputJson = false;
        let parseError: string | null = null;
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === "--json") {
            outputJson = true;
          } else if (a === "--section" || a === "-s") {
            const raw = args[i + 1];
            if (!raw) { parseError = "missing value for --section"; break; }
            section = raw;
            i++;
          } else if (!a.startsWith("-") && !section) {
            section = a;
          } else {
            parseError = `unknown runbook option '${a}'`;
            break;
          }
        }

        if (parseError) {
          const msg = `runbook: ${parseError}`;
          if (tui) tui.log("error", msg); else log(msg);
          reasonerConsole.writeSystem(msg);
          const usage = "runbook usage: /runbook [quickstart|response-flow|incident|all] [--section <name>] [--json]";
          if (tui) tui.log("status", usage); else log(usage);
          reasonerConsole.writeSystem(usage);
          continue;
        }

        const runbook = buildRunbookPayload(section);
        if (runbook.error) {
          const msg = `runbook: ${runbook.error}`;
          if (tui) tui.log("error", msg); else log(msg);
          reasonerConsole.writeSystem(msg);
          continue;
        }

        if (outputJson) {
          const jsonLines = JSON.stringify(runbook.payload, null, 2).split("\n");
          for (const line of jsonLines) {
            if (tui) tui.log("status", line); else log(line);
            reasonerConsole.writeSystem(line);
          }
          continue;
        }

        const lines: string[] = [];
        if (runbook.includeQuickstart) {
          lines.push("runbook quickstart:");
          lines.push("1) aoaoe supervisor --watch --ndjson --changes-only --heartbeat 30");
          lines.push("2) aoaoe task reconcile");
          lines.push("3) aoaoe-chat  then: /task <session> :: <new goal>");
        }
        if (runbook.includeResponseFlow) {
          if (lines.length > 0) lines.push("");
          lines.push("runbook response-flow:");
          lines.push("- emitReason=change spikes -> aoaoe supervisor --since 30m --limit 20");
          lines.push("- pending/paused too long -> aoaoe task reconcile, then /task nudge");
          lines.push("- noisy but stable -> keep --changes-only + --heartbeat");
        }
        for (const line of lines) {
          if (tui) tui.log("status", line); else log(line);
          reasonerConsole.writeSystem(line);
        }
      } else if (cmd.startsWith("__CMD_SUPERVISOR__")) {
        const rawArgs = cmd.slice("__CMD_SUPERVISOR__".length).trim();
        const args = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];
        let showAll = false;
        let limit = 5;
        let maxAgeMs: number | null = null;
        let outputJson = false;
        let parseError: string | null = null;
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === "--all") {
            showAll = true;
          } else if (a === "--limit") {
            const raw = args[i + 1];
            if (!raw) { parseError = "missing value for --limit"; break; }
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n < 1) { parseError = `invalid --limit '${raw}'`; break; }
            limit = n;
            i++;
          } else if (a === "--since") {
            const raw = args[i + 1];
            if (!raw) { parseError = "missing value for --since"; break; }
            const dur = parseDuration(raw);
            if (dur === null) { parseError = `invalid --since '${raw}' (examples: 30m, 2h, 7d)`; break; }
            maxAgeMs = dur;
            i++;
          } else if (a === "--json") {
            outputJson = true;
          } else {
            parseError = `unknown supervisor option '${a}'`;
            break;
          }
        }

        if (parseError) {
          const usage = `supervisor usage: /supervisor [--all] [--since <30m|2h|7d>] [--limit N] [--json]`;
          if (tui) {
            tui.log("error", `supervisor: ${parseError}`);
            tui.log("status", usage);
          } else {
            log(`supervisor: ${parseError}`);
            log(usage);
          }
          reasonerConsole.writeSystem(`supervisor: ${parseError}`);
          reasonerConsole.writeSystem(usage);
          continue;
        }

        const status = buildTaskSupervisorStatus(taskManager) || "supervisor: no task manager active";
        const tasks = taskManager?.tasks ?? [];
        const active = tasks.filter((t) => t.status === "active");
        const pending = tasks.filter((t) => t.status === "pending");
        const pausedTasks = tasks.filter((t) => t.status === "paused");
        const linked = tasks.filter((t) => !!t.sessionId);
        const topActive = active.slice(0, 4).map((t) => `${t.sessionTitle}${t.profile && t.profile !== "default" ? `@${t.profile}` : ""}`);
        const pendingPreview = pending.slice(0, 3).map((t) => t.sessionTitle);
        const pausedPreview = pausedTasks.slice(0, 3).map((t) => t.sessionTitle);
        const formatAgoShort = (at: number): string => {
          const ms = Math.max(0, Date.now() - at);
          if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
          if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
          return `${Math.floor(ms / 3_600_000)}h ago`;
        };
        const now = Date.now();
        const filteredEvents = maxAgeMs === null
          ? supervisorEvents
          : supervisorEvents.filter((evt) => evt.at >= (now - maxAgeMs));
        const eventLimit = showAll ? filteredEvents.length : limit;
        const recentEvents = filteredEvents.slice(-eventLimit).reverse();

        const lines = [
          `supervisor: ${status}`,
          `supervisor detail: ${active.length} active | ${pending.length} pending | ${pausedTasks.length} paused | ${linked.length} linked sessions`,
          topActive.length > 0 ? `active now: ${topActive.join(", ")}` : "active now: none",
          pendingPreview.length > 0 ? `needs kickoff: ${pendingPreview.join(", ")}${pending.length > pendingPreview.length ? " ..." : ""}` : "needs kickoff: none",
          pausedPreview.length > 0 ? `paused tasks: ${pausedPreview.join(", ")}${pausedTasks.length > pausedPreview.length ? " ..." : ""}` : "paused tasks: none",
          `step-in paths: /task <session> :: <goal>  |  /task new <title> <path> :: <goal>  |  :<goal> in drill-down`,
        ];

        if (recentEvents.length > 0) {
          lines.push(`supervisor recent (${recentEvents.length}/${filteredEvents.length} shown):`);
          for (const evt of recentEvents) {
            lines.push(`- ${evt.detail} (${formatAgoShort(evt.at)})`);
          }
        } else {
          lines.push("supervisor recent: none (use /supervisor --all to inspect full buffer)");
        }

        if (outputJson) {
          const payload = {
            supervisor: status,
            summary: {
              total: tasks.length,
              active: active.length,
              pending: pending.length,
              paused: pausedTasks.length,
              linkedSessions: linked.length,
            },
            activeNow: topActive,
            needsKickoff: pendingPreview,
            pausedTasks: pausedPreview,
            options: {
              showAll,
              limit,
              sinceMs: maxAgeMs,
              eventsShown: recentEvents.length,
              eventsAvailable: filteredEvents.length,
            },
            recentEvents: recentEvents.map((evt) => ({ at: evt.at, ago: formatAgoShort(evt.at), detail: evt.detail })),
            stepIn: [
              "/task <session> :: <goal>",
              "/task new <title> <path> :: <goal>",
              ":<goal> in drill-down",
            ],
          };
          const jsonLines = JSON.stringify(payload, null, 2).split("\n");
          for (const line of jsonLines) {
            if (tui) tui.log("status", line); else log(line);
            reasonerConsole.writeSystem(line);
          }
          continue;
        }

        for (const line of lines) {
          if (tui) tui.log("status", line); else log(line);
          reasonerConsole.writeSystem(line);
        }
      } else if (cmd.startsWith("__CMD_MODE__")) {
        const modeArg = cmd.slice("__CMD_MODE__".length).trim().toLowerCase();
        if (!modeArg) {
          const msg = `mode: ${getRunMode()} (options: observe, dry-run, confirm, autopilot)`;
          if (tui) tui.log("system", msg); else log(msg);
          reasonerConsole.writeSystem(msg);
          continue;
        }
        if (modeArg === "observe") {
          config.observe = true;
          config.confirm = false;
          config.dryRun = false;
        } else if (modeArg === "dry-run" || modeArg === "dryrun") {
          config.observe = false;
          config.confirm = false;
          config.dryRun = true;
        } else if (modeArg === "confirm") {
          config.observe = false;
          config.confirm = true;
          config.dryRun = false;
        } else if (modeArg === "autopilot" || modeArg === "auto") {
          config.observe = false;
          config.confirm = false;
          config.dryRun = false;
        } else {
          const msg = `unknown mode: ${modeArg} (use observe, dry-run, confirm, autopilot)`;
          if (tui) tui.log("error", msg); else log(msg);
          reasonerConsole.writeSystem(msg);
          continue;
        }
        if (tui) tui.updateState({ reasonerName: getReasonerLabel() });
        const msg = `mode set: ${getRunMode()} (reasoner=${getReasonerLabel()})`;
        if (tui) tui.log("system", msg); else log(msg);
        reasonerConsole.writeSystem(msg);
      } else if (cmd === "__CMD_DASHBOARD__") {
        forceDashboard = true;
      } else if (cmd === "__CMD_VERBOSE__") {
        config.verbose = !config.verbose;
        const msg = `verbose: ${config.verbose ? "on" : "off"}`;
        if (tui) tui.log("system", msg); else log(msg);
        reasonerConsole.writeSystem(msg);
      } else if (cmd === "__CMD_PAUSE__") {
        paused = true;
        if (tui) { tui.log("system", "paused via console"); tui.updateState({ paused: true }); } else log("paused via console");
        reasonerConsole.writeSystem("paused -- reasoner will not be called until /resume");
      } else if (cmd === "__CMD_RESUME__") {
        paused = false;
        if (tui) { tui.log("system", "resumed"); tui.updateState({ paused: false }); } else log("resumed via console");
        reasonerConsole.writeSystem("resumed");
      } else if (cmd === "__CMD_INTERRUPT__") {
        // interrupt is handled inside tick() via the flag file; clear it here if no tick is running
        if (tui) tui.log("system", "interrupt requested (will take effect during next reasoning call)"); else log("interrupt requested (will take effect during next reasoning call)");
      } else if (cmd === "__CMD_EXPLAIN__") {
        // handled above (before formatUserMessages) — just skip here
      } else if (cmd.startsWith("__CMD_TASK__")) {
        const taskArgs = cmd.slice("__CMD_TASK__".length);
        try {
          const output = await handleTaskSlashCommand(taskArgs);
          refreshTaskSupervisorState(`task command: ${taskArgs.trim() || "list"}`);
          if (tui) tui.log("system", output); else log(output);
          reasonerConsole.writeSystem(output);
        } catch (err) {
          const msg = `task command error: ${err}`;
          if (tui) tui.log("error", msg); else log(msg);
        }
       } else if (cmd.startsWith("__CMD_QUICKTASK__")) {
         const goal = cmd.slice("__CMD_QUICKTASK__".length).trim();
         if (!goal) continue;
         const sessionId = tui?.getDrilldownSessionId();
         if (!sessionId) {
           const msg = "quick task needs a target session: use /view first, then type :<goal>";
           if (tui) tui.log("system", msg); else log(msg);
           reasonerConsole.writeSystem(msg);
           continue;
         }
          try {
            const output = await quickTaskUpdate(sessionId, goal);
            refreshTaskSupervisorState(`quick step-in: ${sessionId.slice(0, 8)} goal updated`);
            if (tui) tui.log("system", output); else log(output);
            reasonerConsole.writeSystem(output);
         } catch (err) {
           const msg = `quick task error: ${err}`;
           if (tui) tui.log("error", msg); else log(msg);
         }
       } else if (cmd.startsWith("__CMD_NATURALTASK__")) {
         // natural language task intent: "task for adventure: implement login"
         // format: __CMD_NATURALTASK__<session>\t<goal>
         const payload = cmd.slice("__CMD_NATURALTASK__".length);
         const tabIdx = payload.indexOf("\t");
         if (tabIdx < 0) continue;
         const sessionRef = payload.slice(0, tabIdx).trim();
         const goal = payload.slice(tabIdx + 1).trim();
         if (!sessionRef || !goal) continue;
          try {
            const output = await quickTaskUpdate(sessionRef, goal);
            refreshTaskSupervisorState(`natural task intent: ${sessionRef}`);
            if (tui) tui.log("system", `task intent: ${output}`); else log(`task intent: ${output}`);
            reasonerConsole.writeSystem(`task intent: ${output}`);
         } catch (err) {
           const msg = `task intent error: ${err}`;
           if (tui) tui.log("error", msg); else log(msg);
         }
       }
    }

    // check pause from both stdin input and console commands
    const isPaused = paused || input.isPaused();
    if (isPaused) {
      if (pollCount % 6 === 1) {
        if (tui) tui.log("system", "paused (type /resume to continue)"); else log("paused (type /resume to continue)");
      }
      const pausedNextTickAt = Date.now() + config.pollIntervalMs;
      if (tui) tui.updateState({ phase: "sleeping", paused: true, pollCount, nextTickAt: pausedNextTickAt });
      writeState("sleeping", { paused: true, pollCount, pollIntervalMs: config.pollIntervalMs, nextTickAt: pausedNextTickAt });
      await wakeableSleep(config.pollIntervalMs, AOAOE_DIR);
      continue;
    }

    try {
      totalPolls++;
      if (tui) tui.updateState({ phase: "polling", pollCount, paused: false });

      // keep task/session bindings fresh while daemon runs so newly opened AoE
      // sessions get adopted and missing task sessions are recreated automatically.
      if (taskManager && shouldReconcileTasks(pollCount, TASK_RECONCILE_EVERY_POLLS)) {
        const { created, linked, goalsInjected } = await taskManager.reconcileSessions();
        if (tui) tui.updateState({ supervisorStatus: buildTaskSupervisorStatus(taskManager) });
        if (created.length > 0 || linked.length > 0 || goalsInjected.length > 0) {
          pushSupervisorEvent(`reconcile: +${created.length} created, +${linked.length} linked, +${goalsInjected.length} goals`);
          const msg = `tasks reconcile: +${created.length} created, +${linked.length} linked, +${goalsInjected.length} goals injected`;
          if (tui) tui.log("system", msg); else log(msg);
        } else if (config.verbose) {
          if (tui) tui.log("system", "tasks reconcile: no changes"); else log("tasks reconcile: no changes");
        }
        // refresh dashboard session-task display
        for (const t of taskManager.tasks) {
          if (t.sessionId && t.goal) {
            const goalPreview = t.goal.length > 60 ? t.goal.slice(0, 57) + "..." : t.goal;
            setSessionTask(t.sessionId, `[${t.sessionTitle}] ${goalPreview}`);
          }
        }
      }

      // ── observe mode: poll + display, skip reasoning + execution ──────
      if (config.observe) {
        const observation = await poller.poll();
        const sessionStates = buildSessionStates(observation);
        if (tui) tui.updateState({ phase: "polling", pollCount, sessions: sessionStates });
        writeState("polling", { pollCount, sessionCount: observation.sessions.length, changeCount: observation.changes.length, sessions: sessionStates });

        if (observation.sessions.length === 0 && pollCount % 6 === 1) {
          if (tui) tui.log("observation", "no active aoe sessions found"); else log("no active aoe sessions found");
        } else if (observation.changes.length > 0) {
          for (const ch of observation.changes) {
            const preview = ch.newLines.split("\n").filter((l) => l.trim()).slice(-3).join(" | ").slice(0, 80);
            if (tui) tui.log("observation", `${ch.title}: ${preview}`); else log(`[${ch.title}] ${preview}`);
          }
        } else if (config.verbose) {
          if (tui) tui.log("observation", `${observation.sessions.length} sessions, no changes`);
        }

        // user message in observe mode — just acknowledge, don't send to reasoner
        if (userMessage) {
          const msg = "observe mode: message received but no reasoner to forward to";
          if (tui) tui.log("system", msg); else log(msg);
        }
        // skip the rest — no reasoning, no execution
      } else {
      // ── normal mode: poll every pollIntervalMs, reason only on reasonIntervalMs ──

      const activeTaskContext = taskManager ? taskManager.tasks.filter((t) => t.status !== "completed") : undefined;
      if (!reasoner || !executor) throw new Error("reasoner/executor unexpectedly null in normal mode");

      // Decide whether to call the LLM this tick:
      // - Always reason if there's a user message (immediate response)
      // - Always reason if forceDashboard is set
      // - Otherwise gate on reasonIntervalMs elapsed since last reasoning call
      // - Skip if in quiet hours (unless user message forces it)
      const msSinceLastReason = Date.now() - lastReasonerAt;
      const quietSpec = config.policies.quietHours;
      const inQuietHours = quietSpec ? isQuietHour(new Date().getHours(), [parseQuietHoursRange(quietSpec)].filter(Boolean) as Array<[number, number]>) : false;
      const reasonDue = (lastReasonerAt === 0
        || msSinceLastReason >= config.reasonIntervalMs
        || !!userMessage
        || forceDashboard)
        && (!inQuietHours || !!userMessage); // user messages always get through even in quiet hours

      if (inQuietHours && !userMessage && pollCount % 30 === 1) {
        const msg = `quiet hours active (${quietSpec}) — polling only, no reasoning`;
        if (tui) tui.log("status", msg); else log(msg);
      }

      if (!reasonDue) {
        // Observation-only tick: poll sessions, update TUI state, skip LLM
        const observation = await poller.poll();
        const sessionStates = buildSessionStates(observation);
        if (tui) tui.updateState({ phase: "sleeping", pollCount, sessions: sessionStates, supervisorStatus: buildTaskSupervisorStatus(taskManager) });
        writeState("sleeping", { pollCount, pollIntervalMs: config.pollIntervalMs, nextTickAt: Date.now() + config.pollIntervalMs });
        if (config.verbose && observation.changes.length > 0) {
          for (const ch of observation.changes) {
            const preview = ch.newLines.split("\n").filter((l) => l.trim()).slice(-2).join(" | ").slice(0, 80);
            if (tui) tui.log("observation", `${ch.title}: ${preview}`); else log(`[obs] ${ch.title}: ${preview}`);
          }
        }
        const nextReasonMs = Math.max(0, config.reasonIntervalMs - msSinceLastReason);
        if (tui) tui.updateState({ nextReasonAt: Date.now() + nextReasonMs });
      } else {
        // Full reasoning tick
        const {
          interrupted,
          decisionsThisTick,
          actionsOk,
          actionsFail,
          reasonerDurationMs,
          reasonerActionCount,
          reasonerSummary,
        } = await daemonTick(config, poller, reasoner, executor, reasonerConsole, pollCount, policyStates, userMessage, forceDashboard, activeTaskContext, taskManager, tui, {
          sessionSummarizer,
          conflictDetector,
          activityTracker,
          budgetPredictor,
          taskRetryManager,
          pushSupervisorEvent,
          refreshTaskSupervisorState,
        });
        totalDecisions += decisionsThisTick;
        totalActionsExecuted += actionsOk;
        totalActionsFailed += actionsFail;

        // adaptive poll: feed tick results into the controller
        adaptivePollController.recordTick(decisionsThisTick > 0 ? 1 : 0, actionsOk > 0);

        // fleet SLA: record health each tick and alert on breach
        if (tui) {
          const sessions = tui.getSessions();
          const scores = sessions.map((s) => s.status === "working" || s.status === "running" ? 80 : s.status === "error" ? 20 : 50);
          const fleetHealth = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 100;
          const slaStatus = fleetSlaMonitor.recordHealth(fleetHealth);
          if (slaStatus.shouldAlert) {
            tui.log("status", `🔴 Fleet SLA breach: health ${slaStatus.averageHealth}/100 (threshold: ${slaStatus.threshold})`);
            audit("session_error", `fleet SLA breach: avg health ${slaStatus.averageHealth}`, undefined, { averageHealth: slaStatus.averageHealth, threshold: slaStatus.threshold });
          }
        }

        // progress velocity: record current estimates each tick
        if (tui && taskManager) {
          for (const task of taskManager.tasks) {
            if (task.status !== "active") continue;
            const session = tui.getSessions().find((s) => s.title === task.sessionTitle);
            const outputLines = session ? (tui.getSessionOutput(session.id) ?? []) : [];
            const est = estimateProgress(task, outputLines.join("\n"));
            progressVelocityTracker.recordProgress(task.sessionTitle, est.percentComplete);
          }
        }

        // trust ladder: record stable tick or failure, sync mode if escalated
        if (tui && decisionsThisTick > 0) {
          if (actionsFail > 0) {
            tui.recordTrustFailure();
            // sync daemon mode to observe
            config.observe = true; config.confirm = false; config.dryRun = false;
            tui.log("system", `trust: demoted to observe (action failure detected)`);
          } else {
            const { level, escalated } = tui.recordStableTick();
            if (escalated) {
              // sync daemon mode to match new trust level
              if (level === "observe") { config.observe = true; config.confirm = false; config.dryRun = false; }
              else if (level === "dry-run") { config.observe = false; config.confirm = false; config.dryRun = true; }
              else if (level === "confirm") { config.observe = false; config.confirm = true; config.dryRun = false; }
              else { config.observe = false; config.confirm = false; config.dryRun = false; }
              tui.log("system", `trust: escalated to ${level} (${TRUST_STABLE_TICKS_TO_ESCALATE} stable ticks)`);
              tui.updateState({ reasonerName: getReasonerLabel() });
            }
          }
        }

        // periodic fleet snapshots (every ~10min = 60 polls at 10s interval)
        if (tui && shouldTakeSnapshot(pollCount)) {
          const sessions = tui.getSessions();
          const tasks = taskManager?.tasks ?? [];
          const summaries = new Map<string, string>();
          for (const [title, s] of sessionSummarizer.getAll()) {
            summaries.set(title, SessionSummarizer.format(s));
          }
          const scores = new Map<string, number>();
          for (const s of sessions) {
            scores.set(s.title, s.status === "working" || s.status === "running" ? 80 : s.status === "error" ? 20 : 50);
          }
          const snapshot = captureFleetSnapshot(sessions, tasks, summaries, scores);
          saveFleetSnapshot(snapshot);
        }

        if (reasonerDurationMs !== undefined) {
          lastReasonerAt = Date.now();
          lastReasonerDurationMs = reasonerDurationMs;
          lastReasonerActionCount = reasonerActionCount ?? 0;
          lastReasonerSummary = reasonerSummary ?? "";
        }

        if (interrupted) {
          writeState("interrupted", { pollCount, pollIntervalMs: config.pollIntervalMs });
          reasonerConsole.writeSystem("reasoner interrupted -- type a message and it will be picked up immediately");
          if (tui) tui.log("system", "interrupted -- continuing to next tick"); else log("interrupted -- continuing to next tick (wakeable sleep will pick up input)");
          clearInterrupt();
        }

        if (tui) tui.updateState({ supervisorStatus: buildTaskSupervisorStatus(taskManager) });
      }
      forceDashboard = false;

      } // end normal mode else block
    } catch (err) {
      const msg = `tick ${pollCount} failed: ${err}`;
      if (tui) tui.log("error", msg); else console.error(`[error] ${msg}`);
    }

    // re-show input prompt after tick output (no-op when TUI is active since it has its own input line)
    if (!tui) input.prompt();

    if (running) {
      // skip sleep entirely if there are already-queued messages waiting
      const skipSleep = shouldSkipSleep({
        hasPendingStdin: input.hasPending(),
        hasPendingFile: hasPendingFile(INPUT_FILE),
        interrupted: checkInterrupt(),
      });

      if (skipSleep) {
        if (tui) tui.log("system", "skipping sleep — pending input detected"); else log("skipping sleep — pending input detected");
      } else {
        // adaptive poll: use dynamic interval instead of fixed config value
        const effectivePollMs = adaptivePollController.intervalMs;
        const nextTickAt = Date.now() + effectivePollMs;
        const nextReasonAtFull = lastReasonerAt > 0 ? lastReasonerAt + config.reasonIntervalMs : Date.now() + config.reasonIntervalMs;
        if (tui) tui.updateState({ phase: "sleeping", nextTickAt, nextReasonAt: nextReasonAtFull });
        writeState("sleeping", { pollCount, pollIntervalMs: effectivePollMs, nextTickAt, paused: false });

        const wake = await wakeableSleep(effectivePollMs, AOAOE_DIR);
        if (wake.reason === "wake") {
          if (tui) tui.log("system", `woke early after ${wake.elapsed}ms`); else log(`woke early after ${wake.elapsed}ms (file change detected)`);
        }
      }
    }
  }
}

// wraps the core tick logic (loop.ts) with daemon UI: state file, dashboard, status line,
// console output, and interrupt support. the core logic in loop.ts is what the tests exercise.
async function daemonTick(
  config: AoaoeConfig,
  poller: Poller,
  reasoner: ReturnType<typeof createReasoner>,
  executor: Executor,
  reasonerConsole: ReasonerConsole,
  pollCount: number,
  policyStates: Map<string, SessionPolicyState>,
  userMessage?: string,
  forceDashboard?: boolean,
  taskContext?: TaskState[],
  taskManager?: TaskManager,
  tui?: TUI | null,
  intelligence?: {
    sessionSummarizer: SessionSummarizer;
    conflictDetector: ConflictDetector;
    activityTracker: ActivityTracker;
    budgetPredictor: BudgetPredictor;
    taskRetryManager: TaskRetryManager;
    pushSupervisorEvent: (detail: string) => void;
    refreshTaskSupervisorState: (reason?: string) => void;
  },
): Promise<{
  interrupted: boolean;
  decisionsThisTick: number;
  actionsOk: number;
  actionsFail: number;
  reasonerDurationMs?: number;
  reasonerActionCount?: number;
  reasonerSummary?: string;
}> {
  // pre-tick: write IPC state + tick separator in conversation log
  writeState("polling", { pollCount, pollIntervalMs: config.pollIntervalMs, tickStartedAt: Date.now() });
  reasonerConsole.writeTickSeparator(pollCount);

  // user message -> console + TUI
  if (userMessage) {
    if (tui) tui.log("you", userMessage);
    reasonerConsole.writeUserMessage(userMessage);
  }

  let reasonerDurationMs: number | undefined;
  let reasonerActionCount: number | undefined;
  let reasonerSummary: string | undefined;

  // wrap reasoner with timeout + interrupt support (passes AbortSignal to backends)
  const wrappedReasoner: import("./types.js").Reasoner = {
    init: () => reasoner.init(),
    shutdown: () => reasoner.shutdown(),
    decide: async (obs) => {
      writeState("reasoning", { pollCount, pollIntervalMs: config.pollIntervalMs });
      if (tui) tui.updateState({ phase: "reasoning" }); else process.stdout.write(" | reasoning...");

      const startedAt = Date.now();
      const { result: r, interrupted } = await withTimeoutAndInterrupt(
        (signal) => reasoner.decide(obs, signal),
        90_000,
        { actions: [{ action: "wait" as const, reason: "reasoner timeout" }] }
      );
      if (interrupted) {
        if (tui) tui.log("system", "reasoner INTERRUPTED"); else process.stdout.write(" INTERRUPTED\n");
        reasonerConsole.writeSystem("reasoner interrupted by operator");
        throw new InterruptError();
      }
      reasonerDurationMs = Date.now() - startedAt;
      reasonerActionCount = r.actions.length;
      reasonerSummary = r.actions.map((a) => a.action).join(", ");
      return r;
    },
  };

  // confirm mode: build a beforeExecute hook that prompts the user for each action
  let beforeExecute: ((action: import("./types.js").Action) => Promise<boolean>) | undefined;
  if (config.confirm && process.stdin.isTTY) {
    // resolve session titles for confirm prompts
    beforeExecute = async (action) => {
      if (action.action === "wait") return true;
      const plainText = formatPlainEnglishAction(
        action.action,
        actionSession(action),
        actionDetail(action) ?? action.action,
        true,
      );
      const answer = await askConfirm(plainText, tui);
      if (!answer) {
        const msg = `Skipped: ${plainText}`;
        if (tui) tui.log("system", msg); else log(msg);
        reasonerConsole.writeSystem(msg);
      }
      return answer;
    };
  }

  // auto-restart sessions that have been in error state for too many consecutive polls.
  // this runs independently of the reasoner so it works even when the LLM is down.
  if (executor && pollCount > 1) {
    const maxErrors = config.policies.maxErrorsBeforeRestart;
    // build title lookup from task manager
    const titleLookup = new Map<string, string>();
    if (taskManager) {
      for (const t of taskManager.tasks) {
        if (t.sessionId) titleLookup.set(t.sessionId, t.sessionTitle);
      }
    }
    for (const [sid, ps] of policyStates) {
      if (ps.consecutiveErrorPolls >= maxErrors && maxErrors > 0) {
        const title = titleLookup.get(sid) ?? sid.slice(0, 8);
        const msg = `auto-restarting '${title}' after ${ps.consecutiveErrorPolls} consecutive error polls`;
        if (tui) tui.log("system", msg); else log(msg);
        try {
          await shellExec("aoe", ["session", "restart", sid]);
          ps.consecutiveErrorPolls = 0;
          appendSupervisorEvent({ at: Date.now(), detail: `auto-restart: ${title}` });
        } catch (err) {
          const errMsg = `auto-restart failed for ${title}: ${err}`;
          if (tui) tui.log("error", errMsg); else log(errMsg);
        }
      }
    }
  }

  // run core tick logic (same code path the tests exercise)
  let tickResult: import("./loop.js").TickResult;
  try {
     tickResult = await loopTick({
       config, poller, reasoner: wrappedReasoner, executor, policyStates, pollCount, userMessage, taskContext, beforeExecute,
       drainingSessionIds: tui ? [...tui.getDrainingIds()] : undefined,
     });
  } catch (err) {
    if (err instanceof InterruptError) return {
      interrupted: true,
      decisionsThisTick: 0,
      actionsOk: 0,
      actionsFail: 0,
      reasonerDurationMs,
      reasonerActionCount,
      reasonerSummary,
    };
    throw err;
  }

  const { observation, result, executed, skippedReason, dryRunActions } = tickResult;
  const sessionCount = observation.sessions.length;
  const changeCount = observation.changes.length;

  // update IPC state with session info + task progress
  const sessionStates = buildSessionStates(observation);
  const taskStates = taskManager ? taskManager.tasks : undefined;
  writeState("polling", { pollCount, sessionCount, changeCount, sessions: sessionStates, tasks: taskStates });

  // update TUI session panel + drill-down outputs
  if (tui) {
    tui.updateState({ phase: "polling", pollCount, sessions: sessionStates });
    // pass full session outputs for drill-down view
    const outputs = new Map<string, string>();
    for (const snap of observation.sessions) {
      outputs.set(snap.session.id, snap.output);
    }
    tui.setSessionOutputs(outputs);

    // background progress digestion: parse milestones from new pane output
    // and auto-update task progress for matching sessions.
    if (taskManager && observation.changes.length > 0) {
      for (const change of observation.changes) {
        if (!change.newLines) continue;
        const newLines = change.newLines.split("\n");
        const milestones = parsePaneMilestones(newLines);
        if (milestones.length > 0) {
          // deduplicate: only report milestones not already in recent progress
          const recentProgress = (taskManager.getTaskForSession(change.title)?.progress ?? []).slice(-10);
          const recentSummaries = new Set(recentProgress.map((p) => p.summary));
          for (const m of milestones) {
            if (!recentSummaries.has(m.summary)) {
              taskManager.reportProgress(change.title, m.summary);
            }
          }
        }
      }
    }

    // v0.198 intelligence modules — run only when wired
    if (intelligence && observation.changes.length > 0) {
      // session activity summarization + heatmap tracking
      for (const change of observation.changes) {
        if (!change.newLines) continue;
        intelligence.sessionSummarizer.update(change.title, change.newLines.split("\n"));
        intelligence.activityTracker.recordEvent(change.title);
      }

      // cross-session conflict detection: track file edits, alert, and auto-resolve
      for (const change of observation.changes) {
        if (!change.newLines) continue;
        const snap = observation.sessions.find((s) => s.session.title === change.title);
        if (snap) {
          intelligence.conflictDetector.recordEdits(change.title, snap.session.id, change.newLines.split("\n"));
        }
      }
      const conflicts = intelligence.conflictDetector.detectConflicts();
      if (conflicts.length > 0) {
        const lines = intelligence.conflictDetector.formatConflicts(conflicts);
        for (const line of lines) tui.log("status", line);
        for (const c of conflicts) {
          audit("conflict_detected", `${c.filePath} — ${c.sessions.map((s) => s.title).join(", ")}`, undefined, { filePath: c.filePath, sessions: c.sessions.map((s) => s.title) });
        }

        // auto-resolve: pause lower-priority sessions on conflict (if task manager available)
        if (taskManager && !config.observe && !config.dryRun) {
          const resolutions = intelligence.conflictDetector.resolveConflicts(conflicts);
          for (const r of resolutions) {
            const task = taskManager.getTaskForSession(r.pauseSession);
            if (task && task.status === "active") {
              task.status = "paused";
              tui.log("status", `conflict auto-pause: "${r.pauseSession}" — ${r.reason}`);
              audit("conflict_detected", `auto-paused "${r.pauseSession}": ${r.reason}`, r.pauseSession);
              intelligence.pushSupervisorEvent(`conflict auto-pause: ${r.pauseSession}`);
              intelligence.refreshTaskSupervisorState(`conflict pause: ${r.pauseSession}`);
            }
          }
        }
      }

      // goal completion detection: check active tasks for completion signals
      if (taskManager) {
        for (const change of observation.changes) {
          const task = taskManager.getTaskForSession(change.title);
          if (!task || task.status !== "active") continue;
          const signals = detectCompletionSignals(change.newLines.split("\n"), task);
          if (signals.length > 0) {
            const autoResult = shouldAutoComplete(signals, task);
            if (autoResult.complete) {
              tui.log("+ action", `auto-completing "${change.title}": ${autoResult.summary}`);
              intelligence.pushSupervisorEvent(`auto-completed: ${change.title} (${Math.round(autoResult.confidence * 100)}%)`);
              audit("auto_complete", autoResult.summary, change.title, { confidence: autoResult.confidence });
              taskManager.completeTask(change.title, autoResult.summary, false);
              intelligence.refreshTaskSupervisorState(`auto-completed: ${change.title}`);
            }
          }
        }
      }

      // cost budget enforcement: auto-pause tasks that exceed their budget
      if (taskManager && config.costBudgets) {
        const autoPause = config.costBudgets.autoPauseOnExceed !== false;
        if (autoPause) {
          const budgetConfig: CostBudgetConfig = {
            globalBudgetUsd: config.costBudgets.globalBudgetUsd,
            sessionBudgets: config.costBudgets.sessionBudgets,
          };
          const sessionInfos = observation.sessions.map((s) => ({
            title: s.session.title,
            costStr: sessionStates.find((ss) => ss.id === s.session.id)?.costStr,
            status: s.session.status,
          }));
          const violations = findOverBudgetSessions(sessionInfos, budgetConfig);
          for (const v of violations) {
            const task = taskManager.getTaskForSession(v.sessionTitle);
            if (task && task.status === "active") {
              task.status = "paused";
              tui.log("status", formatBudgetAlert(v));
              audit("budget_pause", `$${v.currentCostUsd.toFixed(2)} / $${v.budgetUsd.toFixed(2)}`, v.sessionTitle, { cost: v.currentCostUsd, budget: v.budgetUsd });
              intelligence.pushSupervisorEvent(`budget exceeded: ${v.sessionTitle} ($${v.currentCostUsd.toFixed(2)} / $${v.budgetUsd.toFixed(2)})`);
              intelligence.refreshTaskSupervisorState(`budget pause: ${v.sessionTitle}`);
            }
          }
        }
      }
    }

  }

  // budget prediction + task retry run every tick (not gated on changes)
  if (tui && intelligence) {
    // predictive budget: record cost samples from all sessions each tick
    for (const s of sessionStates) {
      if (s.costStr) intelligence.budgetPredictor.recordCost(s.title, s.costStr);
    }
    // predictive budget alerts: warn when approaching exhaustion
    if (config.costBudgets) {
      const budgetConfig = { globalBudgetUsd: config.costBudgets.globalBudgetUsd, sessionBudgets: config.costBudgets.sessionBudgets };
      const predictions = intelligence.budgetPredictor.predictAll(budgetConfig);
      for (const p of predictions) {
        if (p.warningLevel === "imminent") {
          tui.log("status", `⚠ budget imminent: "${p.sessionTitle}" — ${p.estimatedExhaustionLabel} at $${p.burnRateUsdPerHour.toFixed(2)}/hr`);
        }
      }
    }

    // task retry: check for failed tasks due for retry
    if (taskManager) {
      const dueRetries = intelligence.taskRetryManager.getDueRetries();
      for (const r of dueRetries) {
        const task = taskManager.getTaskForSession(r.sessionTitle);
        if (task && task.status === "failed") {
          task.status = "active";
          intelligence.taskRetryManager.clearRetry(r.sessionTitle);
          tui.log("+ action", `retrying "${r.sessionTitle}" (attempt ${r.retryCount})`);
          audit("session_restart", `auto-retry attempt ${r.retryCount}`, r.sessionTitle);
          intelligence.pushSupervisorEvent(`auto-retry: ${r.sessionTitle} (attempt ${r.retryCount})`);
          intelligence.refreshTaskSupervisorState(`retry: ${r.sessionTitle}`);
        }
      }
      // record failures for tasks that just entered failed state
      for (const task of taskManager.tasks) {
        if (task.status === "failed" && !intelligence.taskRetryManager.getState(task.sessionTitle)) {
          const retryState = intelligence.taskRetryManager.recordFailure(task.sessionTitle);
          if (retryState.exhausted) {
            tui.log("status", `task "${task.sessionTitle}" exhausted retries (${retryState.retryCount})`);
            audit("session_error", `retry exhausted after ${retryState.retryCount} attempts`, task.sessionTitle);
          } else {
            const delay = Math.round((retryState.nextRetryAt - Date.now()) / 1000);
            tui.log("status", `task "${task.sessionTitle}" failed — retry ${retryState.retryCount} in ${delay}s`);
          }
        }
      }
    }
  }

  // output pattern alerting: check new output against configured alert patterns
  if (tui && observation.changes.length > 0) {
    const patterns = tui.getAlertPatterns();
    if (patterns.length > 0) {
      for (const change of observation.changes) {
        if (!change.newLines) continue;
        for (const line of change.newLines.split("\n")) {
          const matches = matchAlertPatterns(line, patterns);
          for (const m of matches) {
            const clean = line.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").trim().slice(0, 100);
            const label = m.label ? ` (${m.label})` : "";
            tui.log("status", `alert #${m.id}${label}: ${change.title} — "${clean}"`);
          }
        }
      }
    }
  }

  // cross-session message relay: check new output against relay rules
  if (tui && observation.changes.length > 0 && !config.observe && !config.dryRun) {
    const rules = tui.getRelayRules();
    if (rules.length > 0) {
      // build tmux name lookup for targets
      const tmuxMap = new Map<string, string>();
      for (const snap of observation.sessions) tmuxMap.set(snap.session.title.toLowerCase(), snap.session.tmux_name);

      for (const change of observation.changes) {
        if (!change.newLines) continue;
        for (const line of change.newLines.split("\n")) {
          const stripped = line.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").trim();
          if (!stripped) continue;
          const matches = matchRelayRules(change.title, stripped, rules);
          for (const rule of matches) {
            const targetTmux = tmuxMap.get(rule.target.toLowerCase());
            if (targetTmux) {
              const relayMsg = `[relay from ${change.title}] ${stripped.slice(0, 200)}`;
              shellExec("tmux", ["send-keys", "-t", targetTmux, relayMsg, "Enter"])
                .then(() => tui.log("system", `relay #${rule.id}: ${change.title} → ${rule.target}`, undefined))
                .catch(() => { /* best-effort */ });
            }
          }
        }
      }
    }
  }

  // automatic OOM restart: detect heap exhaustion in new output and restart the session
  if (tui && observation.changes.length > 0 && !config.observe && !config.dryRun) {
    const now = Date.now();
    for (const change of observation.changes) {
      if (!change.newLines) continue;
      const oomLine = detectOOM(change.newLines.split("\n"));
      if (!oomLine) continue;

      // find session ID from observation snapshots
      const snap = observation.sessions.find((s) => s.session.title === change.title);
      if (!snap) continue;
      const sid = snap.session.id;

      const info = tui.getOOMRestartInfo(sid);
      const canRestart = shouldRestartOnOOM(info?.lastAt, info?.count ?? 0, now);
      tui.log("status", formatOOMAlert(change.title, oomLine, canRestart), sid);

      if (canRestart) {
        tui.recordOOMRestart(sid, now);
        shellExec("aoe", ["session", "restart", sid])
          .then(() => tui.log("+ action", `OOM restart: ${change.title}`, sid))
          .catch((err: unknown) => tui.log("! action", `OOM restart failed: ${change.title}: ${err}`, sid));
      }
    }
  }

  // automatic context compaction: nudge sessions approaching context ceiling
  if (tui && !config.observe && !config.dryRun) {
    const now = Date.now();
    // build tmux name lookup from observation snapshots
    const tmuxLookup = new Map<string, string>();
    for (const snap of observation.sessions) tmuxLookup.set(snap.session.id, snap.session.tmux_name);

    for (const s of sessionStates) {
      const ceiling = parseContextCeiling(s.contextTokens);
      if (!ceiling) continue;
      const fraction = ceiling.current / ceiling.max;
      const lastNudge = tui.getCompactionNudgeAt(s.id);
      if (shouldCompactContext(fraction, lastNudge, now)) {
        const pct = Math.round(fraction * 100);
        const nudgeMsg = formatCompactionNudge(s.title, pct);
        const tmuxName = tmuxLookup.get(s.id);
        if (tmuxName) {
          shellExec("tmux", ["send-keys", "-t", tmuxName, nudgeMsg, "Enter"])
            .then(() => {
              tui.recordCompactionNudge(s.id, now);
              tui.log("status", formatCompactionAlert(s.title, pct), s.id);
            })
            .catch(() => { /* best-effort */ });
        }
      }
    }
  }

  const noStats = {
    interrupted: false,
    decisionsThisTick: 0,
    actionsOk: 0,
    actionsFail: 0,
    reasonerDurationMs,
    reasonerActionCount,
    reasonerSummary,
  };

  // skip cases
  if (skippedReason === "no sessions") {
    if (pollCount % 6 === 1) {
      if (tui) tui.log("observation", "no active aoe sessions found"); else log("no active aoe sessions found");
    }
    return noStats;
  }

  // dashboard (only in non-TUI mode — TUI has its own session panel)
  if (!tui && (forceDashboard || pollCount % 6 === 1)) {
    printDashboard(observation, executor.getRecentLog(), pollCount, config);
  }

  // status line (only in non-TUI mode — TUI header shows phase)
  if (!tui) {
    const statuses = summarizeStatuses(observation);
    const userTag = userMessage ? " | +operator msg" : "";
    process.stdout.write(
      `\r[poll #${pollCount}] ${sessionCount} sessions (${statuses}) | ${changeCount} changed${userTag}`
    );
  }

  // console: observation summary with per-session activity
  {
    const changeSummary = observation.changes.map((c) => `${c.title} (${c.tool}): ${c.status}`);
    const changedTitles = new Set(observation.changes.map((c) => c.title));
    const sessionInfos = observation.sessions.map((snap) => {
      const lines = snap.output.split("\n").filter((l) => l.trim());
      const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : undefined;
      return {
        title: snap.session.title,
        tool: snap.session.tool,
        status: snap.session.status,
        lastActivity: lastLine,
      };
    });
    const summaries = sessionInfos.length > 0
      ? formatSessionSummaries(sessionInfos, changedTitles)
      : undefined;
    reasonerConsole.writeObservation(sessionCount, changeCount, changeSummary, summaries);
  }

  // TUI: log narrated observation summary + event highlights
  if (tui) {
    const changedTitles = new Set(observation.changes.map((c) => c.title));
    const sessionInfos = observation.sessions.map((s) => ({
      title: s.session.title, status: s.session.status,
    }));
    const narration = narrateObservation(sessionInfos, changedTitles);
    tui.log("observation", narration + (userMessage ? " +your message" : ""));

    // event highlights — call attention to important events (with sessionId for mute filtering)
    for (const snap of observation.sessions) {
      const s = snap.session;
      if (s.status === "error" && changedTitles.has(s.title)) {
        tui.log("! action", `${s.title} hit an error! The AI will investigate.`, s.id);
      }
      if (s.status === "done" && changedTitles.has(s.title)) {
        tui.log("+ action", `${s.title} finished its task!`, s.id);
      }
      if (snap.userActive) {
        tui.log("status", `You're working in ${s.title} — the AI won't interfere.`, s.id);
      }
    }
  }

  // notify: session error/done events (fires for both TUI and non-TUI modes)
  {
    const changedSet = new Set(observation.changes.map((c) => c.title));
    for (const snap of observation.sessions) {
      const s = snap.session;
      if (s.status === "error" && changedSet.has(s.title)) {
        const filters = tui ? tui.getAllSessionNotifyFilters() : new Map();
        if (shouldNotifySession("session_error", s.title, filters, config.notifications?.events)) {
          sendNotification(config, { event: "session_error", timestamp: Date.now(), session: s.title, detail: `status: ${s.status}` });
        }
      }
      if (s.status === "done" && changedSet.has(s.title)) {
        const filters = tui ? tui.getAllSessionNotifyFilters() : new Map();
        if (shouldNotifySession("session_done", s.title, filters, config.notifications?.events)) {
          sendNotification(config, { event: "session_done", timestamp: Date.now(), session: s.title });
        }
      }
    }
  }

  if (skippedReason === "no changes") {
    if (config.verbose) {
      if (tui) tui.log("observation", "no changes, skipping reasoner"); else process.stdout.write(" | no changes, skipping reasoner\n");
    }
    return noStats;
  }

  // reasoning happened — show the AI's explanation prominently
  if (result) {
    if (result.reasoning) {
      // show reasoning as a plain-English explanation (always visible, not just verbose)
      reasonerConsole.writeExplanation(result.reasoning);
      if (tui) {
        tui.log("explain", result.reasoning);
      } else {
        process.stdout.write(`\n  AI: ${result.reasoning}\n`);
      }
    }

    const actionSummary = result.actions.map((a) => a.action).join(", ");
    const confidenceBadge = result.confidence
      ? result.confidence === "high"   ? " ▲ high confidence"
        : result.confidence === "low"  ? " ▼ low confidence"
        : ""
      : "";
    if (tui) {
      tui.log("reasoner", `decided: ${actionSummary}${confidenceBadge}`);
      // update header confidence badge — triggers an immediate header repaint
      tui.setLastConfidence(result.confidence ?? null);
    } else {
      process.stdout.write(` -> ${actionSummary}${confidenceBadge}\n`);
    }
  }

  // dry-run
  if (dryRunActions && dryRunActions.length > 0) {
    for (const action of dryRunActions) {
      const msg = `would ${action.action}: ${JSON.stringify(action)}`;
      if (tui) tui.log("+ action", `[dry-run] ${msg}`); else log(`[dry-run] ${msg}`);
      reasonerConsole.writeAction(action.action, "dry-run", true);
    }
    return {
      interrupted: false,
      decisionsThisTick: 1,
      actionsOk: 0,
      actionsFail: 0,
      reasonerDurationMs,
      reasonerActionCount,
      reasonerSummary,
    };
  }

  // execution results — resolve session IDs to titles for display
  if (tui) tui.updateState({ phase: "executing" });
  writeState("executing", { pollCount, sessionCount, changeCount, sessions: sessionStates });
  const sessionTitleMap = new Map(observation.sessions.map((s) => [s.session.id, s.session.title]));
  for (const entry of executed) {
    if (entry.action.action === "wait") continue;
    const tag = entry.success ? "+ action" : "! action";
    // resolve session title for rich display
    const sessionId = actionSession(entry.action);
    const sessionTitle = sessionId ? (sessionTitleMap.get(sessionId) ?? sessionId) : undefined;
    const actionText = actionDetail(entry.action) ?? entry.detail;

    // plain-English display for humans
    const plainEnglish = formatPlainEnglishAction(entry.action.action, sessionTitle, actionText, entry.success);
    // technical detail for the log file
    const richDetail = formatActionDetail(entry.action.action, sessionTitle, actionText);

    // friendly error translation for failed actions
    const displayText = !entry.success && entry.detail
      ? `${plainEnglish} — ${friendlyError(entry.detail)}`
      : plainEnglish;

    if (tui) {
      tui.log(tag, displayText, sessionId);
    } else {
      const icon = entry.success ? "+" : "!";
      log(`[${icon}] ${displayText}`);
    }
    reasonerConsole.writeAction(entry.action.action, richDetail, entry.success);
    // notify: action executed or failed (respects per-session filters)
    {
      const nEvent = entry.success ? "action_executed" as const : "action_failed" as const;
      const nFilters = tui ? tui.getAllSessionNotifyFilters() : new Map();
      if (shouldNotifySession(nEvent, sessionTitle, nFilters, config.notifications?.events)) {
        sendNotification(config, {
          event: nEvent,
          timestamp: Date.now(),
          session: sessionTitle,
          detail: `${entry.action.action}${actionText ? `: ${actionText.slice(0, 200)}` : ""}`,
        });
      }
    }
    // notify: task lifecycle events
    if (entry.success && entry.action.action === "complete_task" && sessionTitle) {
      const nFilters = tui ? tui.getAllSessionNotifyFilters() : new Map();
      if (shouldNotifySession("task_completed", sessionTitle, nFilters, config.notifications?.events)) {
        sendNotification(config, {
          event: "task_completed",
          timestamp: Date.now(),
          session: sessionTitle,
          detail: `completed: ${actionText ?? "task finished"}`,
        });
      }
    }
  }
  // auto-pause tracking: record stuck nudges for send_input actions targeting stuck sessions.
  // a "stuck nudge" = send_input to a session that hasn't had progress in >30 min.
  if (taskManager) {
    const maxNudges = config.policies.maxStuckNudgesBeforePause ?? 0;
    const stuckThresholdMs = 30 * 60 * 1000;
    const now = Date.now();
    for (const entry of executed) {
      if (entry.action.action !== "send_input" || !entry.success) continue;
      const sid = actionSession(entry.action);
      const title = sid ? (sessionTitleMap.get(sid) ?? sid) : undefined;
      if (!title) continue;
      const task = taskManager.getTaskForSession(title);
      if (!task || task.status !== "active") continue;
      const lastProgress = task.lastProgressAt ?? 0;
      if (lastProgress > 0 && (now - lastProgress) > stuckThresholdMs) {
        const paused = taskManager.recordStuckNudge(title, maxNudges);
        if (paused) {
          const msg = `auto-paused '${title}' after ${task.stuckNudgeCount} stuck nudges`;
          if (tui) tui.log("system", msg); else log(msg);
          appendSupervisorEvent({ at: Date.now(), detail: `auto-pause: ${title}` });
          const nFilters = tui ? tui.getAllSessionNotifyFilters() : new Map();
          if (shouldNotifySession("task_stuck", title, nFilters, config.notifications?.events)) {
            sendNotification(config, {
              event: "task_stuck",
              timestamp: Date.now(),
              session: title,
              detail: `auto-paused after ${task.stuckNudgeCount} stuck nudges with no progress`,
            });
          }
        }
      }
    }
  }

  // fire lifecycle hooks for completed actions
  if (tui) {
    const hooks = tui.getLifecycleHooks();
    if (hooks.length > 0) {
      for (const entry of executed) {
        if (entry.action.action === "wait" || !entry.success) continue;
        const sid = actionSession(entry.action);
        const title = sid ? (sessionTitleMap.get(sid) ?? sid) : undefined;
        if (!title || !sid) continue;
        // map action type → lifecycle event
        const eventMap: Record<string, LifecycleEvent> = {
          start_session: "post_start",
          stop_session: "post_stop",
          restart_session: "post_restart",
        };
        const event = eventMap[entry.action.action];
        if (!event) continue;
        const matched = matchLifecycleHooks(event, title, hooks);
        for (const hook of matched) {
          const env = buildHookEnv(title, sid);
          // inject session info as env vars by prefixing the command
          const wrappedCmd = `SESSION_TITLE='${title.replace(/'/g, "\\'")}' SESSION_ID='${sid}' ${hook.command}`;
          shellExec("sh", ["-c", wrappedCmd])
            .then(() => tui.log("system", `hook #${hook.id} (${event}): ${hook.command}`))
            .catch((err: unknown) => tui.log("! action", `hook #${hook.id} failed: ${err}`));
        }
      }
    }
  }

  const actionsOk = executed.filter((e) => e.success && e.action.action !== "wait").length;
  const actionsFail = executed.filter((e) => !e.success && e.action.action !== "wait").length;
  return {
    interrupted: false,
    decisionsThisTick: result ? 1 : 0,
    actionsOk,
    actionsFail,
    reasonerDurationMs,
    reasonerActionCount,
    reasonerSummary,
  };
}

class InterruptError extends Error { constructor() { super("interrupted"); this.name = "InterruptError"; } }

// prompt the user for y/n confirmation before an action runs.
// used by --confirm mode. returns true if approved, false if rejected.
function askConfirm(description: string, tui?: TUI | null): Promise<boolean> {
  return new Promise((resolve) => {
    const prompt = `\n${YELLOW}${BOLD}The AI wants to:${RESET} ${description}\n${DIM}Allow? (y/n):${RESET} `;
    if (tui) {
      tui.log("system", `The AI wants to: ${description}`);
    }
    process.stderr.write(prompt);

    // cleanup helper — ensures terminal is restored regardless of how we exit
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch { /* already restored */ }
    };

    // temporarily listen for a single keypress
    const onData = (data: Buffer) => {
      const ch = data.toString().trim().toLowerCase();
      cleanup();
      if (ch === "y" || ch === "yes") {
        process.stderr.write(`${GREEN}approved${RESET}\n`);
        resolve(true);
      } else {
        process.stderr.write(`${DIM}skipped${RESET}\n`);
        resolve(false);
      }
    };

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.once("data", onData);

    // if the process receives SIGINT while waiting, restore terminal and reject
    const onSignal = () => { cleanup(); resolve(false); };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

function summarizeStatuses(obs: Observation): string {
  const counts = new Map<string, number>();
  for (const snap of obs.sessions) {
    const s = snap.session.status;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, v]) => `${v} ${k}`).join(", ");
}

function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.error(`[${ts}] ${msg}`);
}

// race the reasoner against both a timeout and the interrupt flag file.
// accepts a factory that receives an AbortSignal so the underlying HTTP
// request / subprocess can be cancelled on timeout or interrupt.
function withTimeoutAndInterrupt<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T
): Promise<{ result: T; interrupted: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const ac = new AbortController();

    // poll for interrupt flag every 300ms
    const interruptInterval = setInterval(() => {
      if (settled) return;
      if (checkInterrupt()) {
        settled = true;
        ac.abort();
        clearInterval(interruptInterval);
        clearTimeout(timer);
        clearInterrupt();
        resolve({ result: fallback, interrupted: true });
      }
    }, 300);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ac.abort();
      clearInterval(interruptInterval);
      log(`reasoner timed out after ${ms}ms, using fallback`);
      resolve({ result: fallback, interrupted: false });
    }, ms);

    factory(ac.signal).then((result) => {
      if (settled) return;
      settled = true;
      clearInterval(interruptInterval);
      clearTimeout(timer);
      resolve({ result, interrupted: false });
    }).catch((err) => {
      if (settled) return;
      settled = true;
      clearInterval(interruptInterval);
      clearTimeout(timer);
      log(`reasoner error (using fallback): ${err}`);
      resolve({ result: fallback, interrupted: false });
    });
  });
}



// `aoaoe test-context` -- safe read-only scan: list sessions, resolve project dirs,
// discover context files. touches nothing, just prints what it finds.
async function testContext(): Promise<void> {
  const basePath = process.cwd();
  const config = loadConfig();
  const sessionDirs = Object.keys(config.sessionDirs).length ? config.sessionDirs : undefined;
  console.log(`base path: ${basePath}`);
  if (sessionDirs) {
    console.log(`sessionDirs config: ${JSON.stringify(sessionDirs)}`);
  }
  console.log();

  // 1. list sessions
  const listResult = await shellExec("aoe", ["list", "--json"]);
  if (listResult.exitCode !== 0) {
    console.error("failed to list sessions (is aoe running?)");
    console.error(listResult.stderr);
    process.exit(1);
  }

  let sessions: Array<{ id: string; title: string; path: string; tool: string }>;
  try {
    sessions = JSON.parse(listResult.stdout);
  } catch {
    console.error("failed to parse aoe list output");
    process.exit(1);
  }

  if (sessions.length === 0) {
    console.log("no active aoe sessions found");
    return;
  }

  console.log(`found ${sessions.length} session(s):\n`);

  for (const s of sessions) {
    const tmuxName = computeTmuxName(s.id, s.title);
    console.log(`--- ${s.title} (${s.id.slice(0, 8)}) ---`);
    console.log(`  tool:      ${s.tool}`);
    console.log(`  path:      ${s.path}`);
    console.log(`  tmux:      ${tmuxName}`);

    // resolve project directory
    const { dir: projectDir, source: resolutionSource } = resolveProjectDirWithSource(basePath, s.title, sessionDirs);
    const sourceLabel = resolutionSource ? ` (via ${resolutionSource})` : "";
    console.log(`  resolved:  ${projectDir ? projectDir + sourceLabel : "(not found — will fall back to session path)"}`);

    // discover context files in the resolved dir
    const scanDir = projectDir ?? s.path;
    const discovered = discoverContextFiles(scanDir);
    if (discovered.length > 0) {
      console.log(`  context files (${discovered.length}):`);
      for (const f of discovered) {
        const rel = f.startsWith(basePath) ? f.slice(basePath.length + 1) : f;
        try {
          const size = statSync(f).size;
          console.log(`    ${rel} (${(size / 1024).toFixed(1)}KB)`);
        } catch {
          console.log(`    ${rel} (unreadable)`);
        }
      }
    } else {
      console.log(`  context files: (none found)`);
    }

    // also check parent dir for group-level context
    if (projectDir) {
      const parentDir = resolve(projectDir, "..");
      const parentFiles = discoverContextFiles(parentDir);
      const parentOnly = parentFiles.filter((f) => !discovered.includes(f));
      if (parentOnly.length > 0) {
        console.log(`  group-level context (from parent):`);
        for (const f of parentOnly) {
          const rel = f.startsWith(basePath) ? f.slice(basePath.length + 1) : f;
          console.log(`    ${rel}`);
        }
      }
    }

    // show total loaded context size
    const fullContext = loadSessionContext(basePath, s.title, undefined, sessionDirs);
    const contextSize = Buffer.byteLength(fullContext, "utf-8");
    console.log(`  total context: ${(contextSize / 1024).toFixed(1)}KB`);
    console.log();
  }

  // global context
  const globalFiles = discoverContextFiles(basePath);
  if (globalFiles.length > 0) {
    console.log("--- global context (supervisor working directory) ---");
    for (const f of globalFiles) {
      const rel = f.startsWith(basePath) ? f.slice(basePath.length + 1) : f;
      console.log(`  ${rel}`);
    }
    const globalCtx = loadGlobalContext(basePath);
    console.log(`  total: ${(Buffer.byteLength(globalCtx, "utf-8") / 1024).toFixed(1)}KB\n`);
  }

  console.log("done — no sessions were modified.");
}

// `aoaoe register` -- register aoaoe as an AoE session using --cmd_override
// this makes aoaoe appear in `aoe list` so users can enter it via AoE's normal interface
async function registerAsAoeSession(title?: string): Promise<void> {
  const sessionTitle = title ?? "aoaoe";

  // resolve the path to chat.js -- works whether installed globally via npm or run from source
  const chatPath = resolve(__dirname, "chat.js");
  if (!existsSync(chatPath)) {
    console.error(`error: chat.js not found at ${chatPath}`);
    console.error("run 'npm run build' first if running from source");
    process.exit(1);
  }

  const cwd = process.cwd();

  // create a wrapper script that runs chat.js inside AoE's tmux pane.
  // we use /bin/sh (not bash) to avoid loading .bashrc which pollutes the pane,
  // and embed the full node path since nvm isn't available in a bare /bin/sh.
  //
  // AoE integration constraints (0.13.3):
  // 1. -c value must contain a known tool name (resolve_tool_name does substring match)
  // 2. -c value must contain a space or AoE won't store it (add.rs:183)
  // 3. yolo mode with EnvVar tools (opencode) breaks exec -- use claude (CliFlag) instead
  // 4. wrapper name contains "claude" so `-c "<path> --"` passes tool validation
  const wrapperPath = join(homedir(), ".aoaoe", "claude-aoaoe-chat.sh");
  mkdirSync(join(homedir(), ".aoaoe"), { recursive: true });
  const nodePath = process.execPath; // full path to current node binary
  writeFileSync(wrapperPath, `#!/bin/sh\nexec "${nodePath}" "${chatPath}"\n`);
  chmodSync(wrapperPath, 0o755);
  // trailing "--" ensures the command contains a space so AoE stores it
  const chatCmd = `${wrapperPath} --`;

  // check if already registered by looking at aoe list
  try {
    const listResult = await shellExec("aoe", ["list", "--json"]);
    if (listResult.exitCode === 0 && listResult.stdout.trim()) {
      const sessions = JSON.parse(listResult.stdout);
      const existing = sessions.find((s: { title: string }) => s.title === sessionTitle);
      if (existing) {
        console.log(`session '${sessionTitle}' already registered (id: ${existing.id})`);
        console.log(`start it with: aoe session start ${sessionTitle}`);
        console.log(`then enter it with: aoe (and select ${sessionTitle})`);
        return;
      }
    }
  } catch {
    // aoe list failed -- maybe no sessions, continue with registration
  }

  // register via aoe add with -c containing "opencode" in the env var to pass tool validation.
  // AoE stores the full command string and runs it directly in the tmux pane on session start.
  console.log(`registering '${sessionTitle}' as an AoE session...`);
  console.log(`  path: ${cwd}`);
  console.log(`  command: ${chatCmd}`);

  const addResult = await shellExec("aoe", [
    "add", cwd,
    "-t", sessionTitle,
    "-c", chatCmd,
  ]);

  if (addResult.exitCode !== 0) {
    console.error(`failed to register: ${addResult.stderr || addResult.stdout}`);
    process.exit(1);
  }

  console.log();
  console.log(`registered! next steps:`);
  console.log(`  1. start the daemon:  aoaoe`);
  console.log(`  2. start the session: aoe session start ${sessionTitle}`);
  console.log(`  3. enter via AoE:     aoe  (then select ${sessionTitle})`);
  console.log();
  console.log(`or start + enter immediately: aoe session start ${sessionTitle} && aoe`);
}

// `aoaoe notify-test` -- send a test notification to all configured webhooks and report results
async function runNotifyTest(): Promise<void> {
  const config = loadConfig();

  if (!config.notifications) {
    console.log("");
    console.log("  no notifications configured.");
    console.log("");
    console.log("  add to your config (~/.aoaoe/aoaoe.config.json):");
    console.log('    "notifications": {');
    console.log('      "webhookUrl": "https://example.com/webhook",');
    console.log('      "slackWebhookUrl": "https://hooks.slack.com/services/...",');
    console.log('      "events": ["session_error", "session_done", "daemon_started", "daemon_stopped"]');
    console.log("    }");
    console.log("");
    return;
  }

  if (!config.notifications.webhookUrl && !config.notifications.slackWebhookUrl) {
    console.log("");
    console.log("  notifications block exists but no webhook URLs configured.");
    console.log("  add webhookUrl and/or slackWebhookUrl to your notifications config.");
    console.log("");
    return;
  }

  console.log("");
  console.log("  sending test notification...");

  const result = await sendTestNotification(config);

  console.log("");
  if (result.webhookOk !== undefined) {
    const icon = result.webhookOk ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon} generic webhook: ${result.webhookOk ? "ok" : result.webhookError ?? "failed"}`);
  }
  if (result.slackOk !== undefined) {
    const icon = result.slackOk ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon} slack webhook:   ${result.slackOk ? "ok" : result.slackError ?? "failed"}`);
  }
  console.log("");
}

/**
 * Produce a human-readable line-by-line diff between two sessions' pane output.
 * Only lines unique to one side are shown — shared lines are collapsed.
 * Returns at most 40 diff lines to keep the activity log readable.
 */
function diffSessions(titleA: string, linesA: string[], titleB: string, linesB: string[]): string[] {
  const setA = new Set(linesA.map((l) => l.trim()).filter(Boolean));
  const setB = new Set(linesB.map((l) => l.trim()).filter(Boolean));
  const onlyA = [...setA].filter((l) => !setB.has(l));
  const onlyB = [...setB].filter((l) => !setA.has(l));
  const shared = [...setA].filter((l) => setB.has(l)).length;
  const out: string[] = [];
  out.push(`  ${shared} lines in common`);
  const MAX = 18;
  if (onlyA.length === 0 && onlyB.length === 0) {
    out.push("  sessions are identical");
    return out;
  }
  if (onlyA.length > 0) {
    out.push(`  only in ${titleA} (${onlyA.length}):`);
    for (const l of onlyA.slice(0, MAX)) out.push(`  - ${l.slice(0, 80)}`);
    if (onlyA.length > MAX) out.push(`    … +${onlyA.length - MAX} more`);
  }
  if (onlyB.length > 0) {
    out.push(`  only in ${titleB} (${onlyB.length}):`);
    for (const l of onlyB.slice(0, MAX)) out.push(`  + ${l.slice(0, 80)}`);
    if (onlyB.length > MAX) out.push(`    … +${onlyB.length - MAX} more`);
  }
  return out;
}

function readPkgVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function buildTaskSupervisorStatus(taskManager?: TaskManager): string {
  if (!taskManager) return "";
  const tasks = taskManager.tasks;
  const total = tasks.length;
  const active = tasks.filter((t) => t.status === "active").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const paused = tasks.filter((t) => t.status === "paused").length;
  const linked = tasks.filter((t) => !!t.sessionId).length;
  return `supervising ${total} tasks (${active} active, ${pending} pending, ${paused} paused) | ${linked} sessions linked | step-in: /task <session> :: <goal>`;
}

async function showSupervisorStatus(opts: { all?: boolean; since?: string; limit?: number; json?: boolean; ndjson?: boolean; watch?: boolean; changesOnly?: boolean; heartbeatSec?: number; intervalMs?: number }): Promise<void> {
  const basePath = process.cwd();
  const pollMs = opts.intervalMs && opts.intervalMs >= 500 ? opts.intervalMs : 5000;
  const heartbeatMs = opts.heartbeatSec && opts.heartbeatSec >= 1 ? opts.heartbeatSec * 1000 : 0;

  let maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  if (opts.since) {
    const parsed = parseDuration(opts.since);
    if (parsed === null) throw new Error(`invalid --since '${opts.since}' (examples: 30m, 2h, 7d)`);
    maxAgeMs = parsed;
  }

  const requestedLimit = opts.limit && opts.limit > 0 ? opts.limit : 5;
  const loadLimit = opts.all ? 1000 : Math.max(requestedLimit, 5);

  const formatAgoShort = (at: number): string => {
    const ms = Math.max(0, Date.now() - at);
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    return `${Math.floor(ms / 3_600_000)}h ago`;
  };

  const buildPayload = (emitReason: "snapshot" | "interval" | "change" | "heartbeat") => {
    const config = loadConfig();
    const taskProfiles = resolveProfiles(config);
    const defs = loadTaskDefinitions(basePath);
    const tm = defs.length > 0 ? new TaskManager(basePath, defs, taskProfiles) : undefined;
    const tasks = tm?.tasks ?? [];
    const eventsNewestFirst = loadSupervisorEvents(loadLimit, undefined, maxAgeMs).slice().reverse();

    const active = tasks.filter((t) => t.status === "active");
    const pending = tasks.filter((t) => t.status === "pending");
    const paused = tasks.filter((t) => t.status === "paused");
    const linked = tasks.filter((t) => !!t.sessionId);
    const topActive = active.slice(0, 4).map((t) => `${t.sessionTitle}${t.profile && t.profile !== "default" ? `@${t.profile}` : ""}`);
    const pendingPreview = pending.slice(0, 3).map((t) => t.sessionTitle);
    const pausedPreview = paused.slice(0, 3).map((t) => t.sessionTitle);
    const status = buildTaskSupervisorStatus(tm) || "supervisor: no task manager active";

    return {
      observedAt: Date.now(),
      emitReason,
      supervisor: status,
      summary: {
        total: tasks.length,
        active: active.length,
        pending: pending.length,
        paused: paused.length,
        linkedSessions: linked.length,
      },
      activeNow: topActive,
      needsKickoff: pendingPreview,
      pausedTasks: pausedPreview,
      options: {
        all: !!opts.all,
        limit: requestedLimit,
        since: opts.since ?? null,
        sinceMs: maxAgeMs,
        watch: !!opts.watch,
        intervalMs: pollMs,
      },
      recentEvents: eventsNewestFirst.map((evt) => ({ at: evt.at, ago: formatAgoShort(evt.at), detail: evt.detail })),
      stepIn: [
        "/task <session> :: <goal>",
        "/task new <title> <path> :: <goal>",
        ":<goal> in drill-down",
      ],
    };
  };

  const printPayload = (payload: ReturnType<typeof buildPayload>) => {
    if (opts.json || opts.ndjson) {
      const compact = !!opts.ndjson || !!opts.watch;
      console.log(compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`supervisor: ${payload.supervisor}`);
    console.log(`supervisor detail: ${payload.summary.active} active | ${payload.summary.pending} pending | ${payload.summary.paused} paused | ${payload.summary.linkedSessions} linked sessions`);
    console.log(payload.activeNow.length > 0 ? `active now: ${payload.activeNow.join(", ")}` : "active now: none");
    console.log(payload.needsKickoff.length > 0 ? `needs kickoff: ${payload.needsKickoff.join(", ")}${payload.summary.pending > payload.needsKickoff.length ? " ..." : ""}` : "needs kickoff: none");
    console.log(payload.pausedTasks.length > 0 ? `paused tasks: ${payload.pausedTasks.join(", ")}${payload.summary.paused > payload.pausedTasks.length ? " ..." : ""}` : "paused tasks: none");
    console.log("step-in paths: /task <session> :: <goal>  |  /task new <title> <path> :: <goal>  |  :<goal> in drill-down");
    if (payload.recentEvents.length > 0) {
      console.log(`supervisor recent (${payload.recentEvents.length} shown):`);
      for (const evt of payload.recentEvents) {
        console.log(`- ${evt.detail} (${evt.ago})`);
      }
    } else {
      console.log("supervisor recent: none");
    }
  };

  if (!opts.watch) {
    printPayload(buildPayload("snapshot"));
    return;
  }

  let lastFingerprint = "";
  let lastEmitAt = 0;
  if (!opts.json && !opts.ndjson) {
    console.log(`watching supervisor status every ${pollMs}ms (Ctrl+C to stop)`);
  }

  while (true) {
    let payloadReason: "interval" | "change" | "heartbeat" = "interval";
    const payload = buildPayload(payloadReason);
    const fingerprint = JSON.stringify({
      supervisor: payload.supervisor,
      summary: payload.summary,
      activeNow: payload.activeNow,
      needsKickoff: payload.needsKickoff,
      pausedTasks: payload.pausedTasks,
      recentEvents: payload.recentEvents.map((e) => ({ at: e.at, detail: e.detail })),
    });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = fingerprint;
    const now = Date.now();
    const heartbeatDue = opts.changesOnly && heartbeatMs > 0 && (now - lastEmitAt) >= heartbeatMs;
    if (opts.changesOnly && !changed && !heartbeatDue) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      continue;
    }
    if (changed) payloadReason = "change";
    else if (heartbeatDue) payloadReason = "heartbeat";
    const emitPayload = payloadReason === "interval" ? payload : buildPayload(payloadReason);
    lastEmitAt = now;
    if (!opts.json && !opts.ndjson) {
      console.log(`\n${DIM}--- supervisor tick ${new Date(emitPayload.observedAt).toLocaleTimeString()} (${payloadReason}) ---${RESET}`);
    }
    printPayload(emitPayload);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// `aoaoe tasks` -- show current task progress
// probe live AoE sessions for real-time status enrichment.
// returns a map of sessionTitle (lowercase) -> live status string.
async function probeLiveSessionStatus(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const result = await shellExec("aoe", ["list", "--json"]);
    if (result.exitCode === 0) {
      const sessions = JSON.parse(result.stdout);
      if (Array.isArray(sessions)) {
        for (const s of sessions) {
          if (typeof s.title === "string" && typeof s.status === "string") {
            map.set(s.title.toLowerCase(), s.status);
          } else if (typeof s.title === "string") {
            map.set(s.title.toLowerCase(), "running");
          }
        }
      }
    }
  } catch { /* aoe not available — that's fine */ }
  return map;
}

async function showTaskStatus(asJson = false): Promise<void> {
  const basePath = process.cwd();
  const defs = loadTaskDefinitions(basePath);
  const states = loadTaskState();

  if (defs.length === 0 && states.size === 0) {
    if (asJson) { console.log("[]"); return; }
    console.log("no tasks defined.");
    console.log("");
    console.log("create aoaoe.tasks.json:");
    console.log('  [{ "repo": "github/adventure", "goal": "Continue the roadmap" }]');
    return;
  }

  // merge definitions into state for display
  const taskProfiles = resolveProfiles(loadConfig());
  const tm = new TaskManager(basePath, defs, taskProfiles);

  if (asJson) {
    const liveStatus = await probeLiveSessionStatus();
    const payload = tm.tasks.map((t) => ({
      session: t.sessionTitle,
      repo: t.repo,
      taskStatus: t.status,
      liveStatus: liveStatus.get(t.sessionTitle.toLowerCase()) ?? null,
      profile: t.profile || "default",
      sessionId: t.sessionId ?? null,
      dependsOn: t.dependsOn ?? [],
      goal: t.goal,
      lastProgressAt: t.lastProgressAt ?? null,
      progressCount: t.progress.length,
      lastProgress: t.progress.length > 0 ? t.progress[t.progress.length - 1].summary : null,
    }));
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("");
  console.log(formatTaskTable(tm.tasks));
  console.log("");
}

async function showProgressDigest(since?: string, asJson = false): Promise<void> {
  const basePath = process.cwd();
  const defs = loadTaskDefinitions(basePath);
  const taskProfiles = resolveProfiles(loadConfig());
  const tm = defs.length > 0 ? new TaskManager(basePath, defs, taskProfiles) : undefined;
  const tasks = tm?.tasks ?? [];

  let maxAgeMs = 24 * 60 * 60 * 1000;
  if (since) {
    const parsed = parseDuration(since);
    if (parsed === null) throw new Error(`invalid --since '${since}' (examples: 1h, 8h, 7d)`);
    maxAgeMs = parsed;
  }

  if (asJson) {
    const now = Date.now();
    const cutoff = now - maxAgeMs;
    const liveStatus = await probeLiveSessionStatus();
    const payload = tasks.map((t) => ({
      session: t.sessionTitle,
      taskStatus: t.status,
      liveStatus: liveStatus.get(t.sessionTitle.toLowerCase()) ?? null,
      dependsOn: t.dependsOn ?? [],
      recentProgress: t.progress.filter((p) => p.at >= cutoff).map((p) => ({
        at: p.at,
        ago: formatAgo(now - p.at),
        summary: p.summary,
      })),
    }));
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (tasks.length === 0) {
    console.log("no tasks defined.");
    return;
  }

  // enrich with live session status
  const liveStatus = await probeLiveSessionStatus();
  const liveCount = liveStatus.size;
  const missingFromTasks = [...liveStatus.keys()].filter(
    (title) => !tasks.some((t) => t.sessionTitle.toLowerCase() === title)
  );

  console.log("");
  if (liveCount > 0) {
    console.log(`  ${DIM}live sessions: ${liveCount} (${[...liveStatus.entries()].map(([t, s]) => `${t}=${s}`).join(", ")})${RESET}`);
    if (missingFromTasks.length > 0) {
      console.log(`  ${YELLOW}untracked sessions: ${missingFromTasks.join(", ")} — use /task <name> :: <goal> to adopt${RESET}`);
    }
    console.log("");
  }
  console.log(formatProgressDigest(tasks, maxAgeMs));
}

import { resolveTemplate } from "./task-templates.js";
import { createBackup, restoreBackup, formatBackupResult, formatRestoreResult } from "./backup.js";
import { syncInit, syncPush, syncPull, syncDiff, syncStatus } from "./sync.js";
import { startWebServer, setResolveProfiles as setWebResolveProfiles } from "./web.js";

// adopt untracked live AoE sessions as tasks with optional template goal.
async function adoptUntrackedSessions(templateName?: string): Promise<void> {
  const basePath = process.cwd();
  const config = loadConfig();
  const taskProfiles = resolveProfiles(config);
  const defs = loadTaskDefinitions(basePath);
  const tm = defs.length > 0 ? new TaskManager(basePath, defs, taskProfiles) : undefined;
  const trackedTitles = new Set((tm?.tasks ?? []).map((t) => t.sessionTitle.toLowerCase()));

  const liveStatus = await probeLiveSessionStatus();
  const untracked = [...liveStatus.keys()].filter((t) => !trackedTitles.has(t));

  if (untracked.length === 0) {
    console.log("all live sessions are already tracked — nothing to adopt");
    return;
  }

  let goal = "Continue the roadmap in claude.md";
  if (templateName) {
    const tmpl = resolveTemplate(templateName);
    if (!tmpl) {
      console.error(`unknown template: ${templateName}`);
      return;
    }
    goal = tmpl.goal;
    console.log(`using template: ${tmpl.name}`);
  }

  const states = loadTaskState();
  let adopted = 0;
  for (const title of untracked) {
    const repo = resolveTaskRepoPath(basePath, basePath, title);
    const relRepo = repo.startsWith(basePath) ? repo.slice(basePath.length + 1) : repo;
    const task: TaskState = {
      repo: relRepo || basePath,
      sessionTitle: title,
      profile: "default",
      sessionMode: "existing",
      tool: "opencode",
      goal,
      status: "active",
      progress: [],
    };
    states.set(taskStateKey(relRepo || basePath, title), task);
    adopted++;
    console.log(`  adopted: ${title} (${relRepo || basePath})`);
  }

  saveTaskState(states);
  syncTaskDefinitionsFromState(basePath, states);
  console.log(`\nadopted ${adopted} session(s). run 'aoaoe tasks' to verify.`);
}

// one-liner fleet summary for shell prompts / tmux status bars.
// outputs plain text with no ANSI so it works in PS1/tmux.
function showFleetSummary(): void {
  const basePath = process.cwd();
  const defs = loadTaskDefinitions(basePath);
  const taskProfiles = resolveProfiles(loadConfig());
  const tm = defs.length > 0 ? new TaskManager(basePath, defs, taskProfiles) : undefined;
  const tasks = tm?.tasks ?? [];

  if (tasks.length === 0) {
    console.log("aoaoe: no tasks");
    return;
  }

  const active = tasks.filter((t) => t.status === "active").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const paused = tasks.filter((t) => t.status === "paused").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const stuck = tasks.filter((t) => t.status === "active" && t.lastProgressAt && (Date.now() - t.lastProgressAt > 30 * 60_000)).length;
  const healths = computeAllHealth(tasks);
  const avg = Math.round(healths.reduce((sum, h) => sum + h.score, 0) / healths.length);

  const parts = [`${tasks.length}t`];
  if (active > 0) parts.push(`${active}a`);
  if (pending > 0) parts.push(`${pending}p`);
  if (paused > 0) parts.push(`${paused}z`);
  if (completed > 0) parts.push(`${completed}✓`);
  if (stuck > 0) parts.push(`${stuck}!`);
  parts.push(`h:${avg}`);

  console.log(`aoaoe[${parts.join(" ")}]`);
}

function showHealthStatus(asJson = false): void {
  const basePath = process.cwd();
  const defs = loadTaskDefinitions(basePath);
  const taskProfiles = resolveProfiles(loadConfig());
  const tm = defs.length > 0 ? new TaskManager(basePath, defs, taskProfiles) : undefined;
  const tasks = tm?.tasks ?? [];

  if (tasks.length === 0) {
    if (asJson) { console.log("[]"); return; }
    console.log("no tasks defined.");
    return;
  }

  if (asJson) {
    const healths = computeAllHealth(tasks);
    console.log(JSON.stringify(healths, null, 2));
    return;
  }

  console.log("");
  console.log(formatHealthReport(tasks));
  console.log("");
}

// `aoaoe history` -- review recent actions from the persistent action log
async function showActionHistory(): Promise<void> {
  const logFile = join(homedir(), ".aoaoe", "actions.log");
  if (!existsSync(logFile)) {
    console.log("no action history found (no actions have been taken yet)");
    return;
  }

  let lines: string[];
  try {
    lines = readFileSync(logFile, "utf-8").trim().split("\n").filter((l) => l.trim());
  } catch {
    console.error("failed to read action log");
    return;
  }

  if (lines.length === 0) {
    console.log("action log is empty");
    return;
  }

  // show last 50 actions
  const recent = lines.slice(-50);

  console.log("");
  console.log(`  action history (last ${recent.length} of ${lines.length} total)`);
  console.log(`  ${"─".repeat(70)}`);

  for (const line of recent) {
    try {
      const entry = toActionLogEntry(JSON.parse(line));
      if (!entry) continue; // skip malformed lines
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const date = new Date(entry.timestamp).toLocaleDateString();
      const icon = entry.success ? `${GREEN}+${RESET}` : `${RED}!${RESET}`;
      const actionName = entry.action.action;
      const session = entry.action.session?.slice(0, 8) ?? entry.action.title ?? "";
      const detail = entry.detail.length > 50 ? entry.detail.slice(0, 47) + "..." : entry.detail;
      console.log(`  ${icon} ${DIM}${date} ${time}${RESET}  ${YELLOW}${actionName.padEnd(16)}${RESET} ${session.padEnd(10)} ${detail}`);
    } catch {
      // skip unparseable JSON lines
    }
  }

  console.log(`  ${"─".repeat(70)}`);

  // summary stats
  let successes = 0, failures = 0;
  const actionCounts = new Map<string, number>();
  for (const line of lines) {
    try {
      const e = toActionLogEntry(JSON.parse(line));
      if (!e) continue;
      if (e.success) successes++; else failures++;
      actionCounts.set(e.action.action, (actionCounts.get(e.action.action) ?? 0) + 1);
    } catch {
      // skip unparseable JSON lines
    }
  }
  const breakdown = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ");
  console.log(`  total: ${lines.length} actions (${GREEN}${successes} ok${RESET}, ${RED}${failures} failed${RESET})`);
  console.log(`  breakdown: ${breakdown}`);
  console.log("");
}

// `aoaoe logs` -- show conversation or action log entries
async function showLogs(actions: boolean, grep?: string, count?: number): Promise<void> {
  const n = count ?? 50;

  if (actions) {
    // show action log entries (JSONL from ~/.aoaoe/actions.log)
    const logFile = join(homedir(), ".aoaoe", "actions.log");
    if (!existsSync(logFile)) {
      console.log("no action log found (no actions have been taken yet)");
      return;
    }

    let lines: string[];
    try {
      lines = readFileSync(logFile, "utf-8").trim().split("\n").filter((l) => l.trim());
    } catch {
      console.error("failed to read action log");
      return;
    }

    if (lines.length === 0) {
      console.log("action log is empty");
      return;
    }

    // apply grep filter before slicing
    if (grep) {
      lines = filterLogLines(lines, grep);
      if (lines.length === 0) {
        console.log(`no action log entries matching '${grep}'`);
        return;
      }
    }

    const recent = lines.slice(-n);

    console.log("");
    console.log(`  action log (last ${recent.length} of ${lines.length}${grep ? ` matching '${grep}'` : ""})`);
    console.log(`  ${"─".repeat(70)}`);

    for (const line of recent) {
      try {
        const entry = toActionLogEntry(JSON.parse(line));
        if (!entry) continue;
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const date = new Date(entry.timestamp).toLocaleDateString();
        const icon = entry.success ? `${GREEN}+${RESET}` : `${RED}!${RESET}`;
        const actionName = entry.action.action;
        const session = entry.action.session?.slice(0, 8) ?? entry.action.title ?? "";
        const detail = entry.detail.length > 50 ? entry.detail.slice(0, 47) + "..." : entry.detail;
        console.log(`  ${icon} ${DIM}${date} ${time}${RESET}  ${YELLOW}${actionName.padEnd(16)}${RESET} ${session.padEnd(10)} ${detail}`);
      } catch {
        // skip unparseable lines
      }
    }

    console.log(`  ${"─".repeat(70)}`);
    console.log("");
  } else {
    // show conversation log entries (text from ~/.aoaoe/conversation.log)
    const logFile = join(homedir(), ".aoaoe", "conversation.log");
    if (!existsSync(logFile)) {
      console.log("no conversation log found (daemon hasn't run yet)");
      return;
    }

    let lines: string[];
    try {
      const content = readFileSync(logFile, "utf-8");
      lines = content.split("\n");
    } catch {
      console.error("failed to read conversation log");
      return;
    }

    // remove trailing empty line from split
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    if (lines.length === 0) {
      console.log("conversation log is empty");
      return;
    }

    // apply grep filter before slicing
    if (grep) {
      lines = filterLogLines(lines, grep);
      if (lines.length === 0) {
        console.log(`no conversation log entries matching '${grep}'`);
        return;
      }
    }

    const recent = lines.slice(-n);

    console.log("");
    console.log(`  conversation log (last ${recent.length} of ${lines.length}${grep ? ` matching '${grep}'` : ""})`);
    console.log(`  ${"─".repeat(70)}`);

    // colorize using the same function as the inline console output
    for (const line of recent) {
      console.log(`  ${colorizeConsoleLine(line)}`);
    }

    console.log(`  ${"─".repeat(70)}`);
    console.log("");
  }
}

// `aoaoe export` -- export session timeline as JSON or Markdown for post-mortems
async function runTimelineExport(format?: string, output?: string, last?: string): Promise<void> {
  const fmt = format ?? "json";
  if (fmt !== "json" && fmt !== "markdown" && fmt !== "md") {
    console.error(`error: --format must be "json" or "markdown", got "${fmt}"`);
    process.exit(1);
  }

  // parse time window (default 24h)
  const durationMs = last ? parseDuration(last) : 24 * 60 * 60 * 1000;
  if (durationMs === null) {
    console.error(`error: --last must be like "1h", "6h", "24h", "7d", got "${last}"`);
    process.exit(1);
  }

  // read actions.log
  const actionsFile = join(homedir(), ".aoaoe", "actions.log");
  let actionEntries: ReturnType<typeof parseActionLogEntries> = [];
  try {
    const lines = readFileSync(actionsFile, "utf-8").trim().split("\n").filter((l) => l.trim());
    actionEntries = parseActionLogEntries(lines);
  } catch {
    // no actions.log — that's fine
  }

  // read tui-history.jsonl
  const historyEntries = loadTuiHistory(10_000, undefined, durationMs);
  const activityEntries = parseActivityEntries(historyEntries);

  // merge and filter
  let timeline = mergeTimeline(actionEntries, activityEntries);
  timeline = filterByAge(timeline, durationMs);

  // format
  const isMarkdown = fmt === "markdown" || fmt === "md";
  const content = isMarkdown ? formatTimelineMarkdown(timeline) : formatTimelineJson(timeline);

  // output
  if (output) {
    writeFileSync(output, content);
    console.log(`exported ${timeline.length} entries to ${output}`);
  } else {
    process.stdout.write(content);
  }
}

// `aoaoe stats` -- show aggregate daemon statistics
async function runStatsCommand(last?: string): Promise<void> {
  const { parseActionStats, parseHistoryStats, combineStats, formatStats } = await import("./stats.js");
  const { parseDuration } = await import("./export.js");
  const { loadTuiHistory } = await import("./tui-history.js");

  const maxAgeMs = last ? parseDuration(last) : undefined;
  if (last && maxAgeMs === undefined) {
    console.error(`error: --last must be like "1h", "6h", "24h", "7d", got "${last}"`);
    process.exit(1);
  }

  const windowLabel = last ?? "all time";

  // read actions.log
  const actionsFile = join(homedir(), ".aoaoe", "actions.log");
  let actionLines: string[] = [];
  try {
    if (existsSync(actionsFile)) {
      actionLines = readFileSync(actionsFile, "utf-8").trim().split("\n").filter((l) => l.trim());
    }
  } catch {
    // no actions — that's fine
  }

  // read tui-history
  const retentionMs = maxAgeMs ?? 365 * 24 * 60 * 60 * 1000; // 1 year default
  const historyEntries = loadTuiHistory(100_000, undefined, retentionMs);

  const actionStats = parseActionStats(actionLines, maxAgeMs ?? undefined);
  const historyStats = parseHistoryStats(historyEntries, maxAgeMs ?? undefined);
  const combined = combineStats(actionStats, historyStats);

  console.log(formatStats(combined, windowLabel));
}

// `aoaoe test` -- dynamically import and run the integration test
async function runIntegrationTest(): Promise<void> {
  const testModule = resolve(__dirname, "integration-test.js");
  if (!existsSync(testModule)) {
    console.error("error: integration-test.js not found (run 'npm run build' first)");
    process.exit(1);
  }
  // the integration test is a self-contained script that runs main() on import
  await import(testModule);
}

// `aoaoe runbook` -- quick operator playbook for multi-session supervision.
function buildRunbookPayload(section?: string): {
  payload: {
    title: string;
    section: string;
    quickstart: Array<{ step: string; command: string }>;
    responseFlow: Array<{ when: string; action: string; command?: string }>;
  };
  includeQuickstart: boolean;
  includeResponseFlow: boolean;
  error?: string;
} {
  const rawSection = (section || "all").toLowerCase();
  const normalizedSection = rawSection === "incident" ? "response-flow" : rawSection;
  if (!["all", "quickstart", "response-flow"].includes(normalizedSection)) {
    return {
      payload: { title: "aoaoe operator playbook", section: normalizedSection, quickstart: [], responseFlow: [] },
      includeQuickstart: false,
      includeResponseFlow: false,
      error: `invalid --section '${section}' (use: quickstart, response-flow, incident, all)`,
    };
  }

  const includeQuickstart = normalizedSection === "all" || normalizedSection === "quickstart";
  const includeResponseFlow = normalizedSection === "all" || normalizedSection === "response-flow";

  return {
    payload: {
      title: "aoaoe operator playbook",
      section: normalizedSection,
      quickstart: includeQuickstart ? [
        {
          step: "start low-noise supervision stream",
          command: "aoaoe supervisor --watch --ndjson --changes-only --heartbeat 30",
        },
        {
          step: "force immediate task/session reconcile",
          command: "aoaoe task reconcile",
        },
        {
          step: "step in with new direction",
          command: "aoaoe-chat  # then: /task <session> :: <new goal>",
        },
      ] : [],
      responseFlow: includeResponseFlow ? [
        {
          when: "emitReason=change spikes",
          action: "inspect recent supervisor history",
          command: "aoaoe supervisor --since 30m --limit 20",
        },
        {
          when: "tasks are pending/paused too long",
          action: "reconcile then nudge via /task",
        },
        {
          when: "system is noisy but stable",
          action: "keep --changes-only + --heartbeat",
        },
      ] : [],
    },
    includeQuickstart,
    includeResponseFlow,
  };
}

function showRunbook(asJson = false, section?: string): void {
  const runbook = buildRunbookPayload(section);
  if (runbook.error) {
    console.error(`runbook: ${runbook.error}`);
    process.exitCode = 2;
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(runbook.payload, null, 2));
    return;
  }

  console.log("");
  console.log(`  ${BOLD}aoaoe operator playbook${RESET}`);
  console.log("  ─────────────────────────────────────────────");
  if (runbook.includeQuickstart) {
    console.log("  1) start low-noise supervision stream:");
    console.log(`     ${DIM}aoaoe supervisor --watch --ndjson --changes-only --heartbeat 30${RESET}`);
    console.log("  2) if tasks/sessions drift, force reconcile:");
    console.log(`     ${DIM}aoaoe task reconcile${RESET}`);
    console.log("  3) step in with new direction:");
    console.log(`     ${DIM}aoaoe-chat${RESET}`);
    console.log(`     ${DIM}/task <session> :: <new goal>${RESET}`);
  }
  if (runbook.includeResponseFlow) {
    if (runbook.includeQuickstart) console.log("");
    console.log("  recommended response flow:");
    console.log("    - emitReason=change spikes -> inspect recent supervisor history");
    console.log(`      ${DIM}aoaoe supervisor --since 30m --limit 20${RESET}`);
    console.log("    - pending/paused tasks too long -> reconcile then nudge via /task");
    console.log("    - noisy stable systems -> keep --changes-only + --heartbeat");
  }
  console.log("");
}

async function showIncidentStatus(opts: { since?: string; limit?: number; json?: boolean; ndjson?: boolean; watch?: boolean; changesOnly?: boolean; heartbeatSec?: number; intervalMs?: number }): Promise<void> {
  const basePath = process.cwd();
  const pollMs = opts.intervalMs && opts.intervalMs >= 500 ? opts.intervalMs : 5000;
  const heartbeatMs = opts.heartbeatSec && opts.heartbeatSec >= 1 ? opts.heartbeatSec * 1000 : 0;

  let maxAgeMs = 30 * 60 * 1000;
  if (opts.since) {
    const parsed = parseDuration(opts.since);
    if (parsed === null) throw new Error(`invalid --since '${opts.since}' (examples: 30m, 2h, 1d)`);
    maxAgeMs = parsed;
  }
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 5;

  const formatAgoShort = (at: number): string => {
    const ms = Math.max(0, Date.now() - at);
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    return `${Math.floor(ms / 3_600_000)}h ago`;
  };

  const buildPayload = (emitReason: "snapshot" | "interval" | "change" | "heartbeat") => {
    const config = loadConfig();
    const taskProfiles = resolveProfiles(config);
    const defs = loadTaskDefinitions(basePath);
    const tm = defs.length > 0 ? new TaskManager(basePath, defs, taskProfiles) : undefined;

    const tasks = tm?.tasks ?? [];
    const status = buildTaskSupervisorStatus(tm) || "supervisor: no task manager active";
    const active = tasks.filter((t) => t.status === "active").length;
    const pending = tasks.filter((t) => t.status === "pending").length;
    const paused = tasks.filter((t) => t.status === "paused").length;
    const runbook = buildRunbookPayload("incident");
    const recent = loadSupervisorEvents(limit, undefined, maxAgeMs).slice().reverse();

    return {
      observedAt: Date.now(),
      emitReason,
      incident: {
        supervisor: status,
        summary: { active, pending, paused },
        options: {
          since: opts.since ?? "30m",
          sinceMs: maxAgeMs,
          limit,
          watch: !!opts.watch,
          intervalMs: pollMs,
          changesOnly: !!opts.changesOnly,
          heartbeatSec: opts.heartbeatSec ?? null,
        },
        responseFlow: runbook.payload.responseFlow,
        recentEvents: recent.map((evt) => ({ at: evt.at, ago: formatAgoShort(evt.at), detail: evt.detail })),
        stepIn: "/task <session> :: <goal>",
      },
    };
  };

  const printPayload = (payload: ReturnType<typeof buildPayload>) => {
    if (opts.json || opts.ndjson) {
      const compact = !!opts.ndjson || !!opts.watch;
      console.log(compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
      return;
    }
    console.log("incident quick view:");
    console.log(`supervisor: ${payload.incident.supervisor}`);
    console.log(`incident focus: ${payload.incident.summary.active} active | ${payload.incident.summary.pending} pending | ${payload.incident.summary.paused} paused | events(window): ${payload.incident.recentEvents.length}`);
    console.log("runbook response-flow:");
    for (const step of payload.incident.responseFlow) {
      console.log(`- ${step.when} -> ${step.action}${step.command ? ` (${step.command})` : ""}`);
    }
    if (payload.incident.recentEvents.length > 0) {
      console.log("recent supervisor events:");
      for (const evt of payload.incident.recentEvents) {
        console.log(`- ${evt.detail} (${evt.ago})`);
      }
    } else {
      console.log("recent supervisor events: none in current window");
    }
    console.log("step-in now: /task <session> :: <goal>");
  };

  if (!opts.watch) {
    printPayload(buildPayload("snapshot"));
    return;
  }

  let lastFingerprint = "";
  let lastEmitAt = 0;
  if (!opts.json && !opts.ndjson) {
    console.log(`watching incident status every ${pollMs}ms (Ctrl+C to stop)`);
  }

  while (true) {
    let reason: "interval" | "change" | "heartbeat" = "interval";
    const payload = buildPayload(reason);
    const fingerprint = JSON.stringify({
      supervisor: payload.incident.supervisor,
      summary: payload.incident.summary,
      responseFlow: payload.incident.responseFlow,
      recentEvents: payload.incident.recentEvents.map((e) => ({ at: e.at, detail: e.detail })),
    });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = fingerprint;
    const now = Date.now();
    const heartbeatDue = !!opts.changesOnly && heartbeatMs > 0 && (now - lastEmitAt) >= heartbeatMs;
    if (opts.changesOnly && !changed && !heartbeatDue) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      continue;
    }
    if (changed) reason = "change";
    else if (heartbeatDue) reason = "heartbeat";
    const emitPayload = reason === "interval" ? payload : buildPayload(reason);
    lastEmitAt = now;
    if (!opts.json && !opts.ndjson) {
      console.log(`\n${DIM}--- incident tick ${new Date(emitPayload.observedAt).toLocaleTimeString()} (${reason}) ---${RESET}`);
    }
    printPayload(emitPayload);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// `aoaoe status` -- quick one-shot health check: is the daemon running? what's it doing?
function showDaemonStatus(): void {
  const state = readState();
  const running = isDaemonRunningFromState(state);
  const pkg = readPkgVersion();

  console.log("");
  console.log(`  aoaoe${pkg ? ` v${pkg}` : ""} — daemon status`);
  console.log(`  ${"─".repeat(50)}`);

  if (!running || !state) {
    console.log(`  ${RED}●${RESET} daemon is ${BOLD}not running${RESET}`);
    const configPath = findConfigFile();
    console.log(`  config: ${configPath ?? "none found (run 'aoaoe init')"}`);
    console.log("");
    console.log("  start with: aoaoe");
    console.log("  or observe: aoaoe --observe");
    console.log("");
    return;
  }

  // daemon is running — show details
  const elapsed = Date.now() - state.phaseStartedAt;
  const elapsedStr = elapsed < 60_000 ? `${Math.floor(elapsed / 1000)}s` : `${Math.floor(elapsed / 60_000)}m`;
  const phaseIcon = state.phase === "sleeping" ? `${DIM}○${RESET}` :
                    state.phase === "reasoning" ? `${YELLOW}●${RESET}` :
                    state.phase === "executing" ? `${GREEN}●${RESET}` :
                    state.phase === "polling" ? `${YELLOW}○${RESET}` :
                    `${RED}●${RESET}`;

  console.log(`  ${GREEN}●${RESET} daemon is ${BOLD}running${RESET}  (poll #${state.pollCount})`);
  console.log(`  ${phaseIcon} phase: ${state.phase} (${elapsedStr})`);
  if (state.paused) console.log(`  ${YELLOW}${BOLD}  PAUSED${RESET}`);
  console.log(`  poll interval: ${state.pollIntervalMs / 1000}s`);

  if (state.nextTickAt > Date.now()) {
    const countdown = Math.ceil((state.nextTickAt - Date.now()) / 1000);
    console.log(`  next tick: ${countdown}s`);
  }

  console.log("");

  // sessions
  if (state.sessions.length === 0) {
    console.log("  no active sessions");
  } else {
    console.log(`  ${state.sessions.length} session(s):`);
    for (const s of state.sessions) {
      const statusIcon = s.status === "working" || s.status === "running" ? `${GREEN}●${RESET}` :
                         s.status === "idle" ? `${DIM}○${RESET}` :
                         s.status === "error" ? `${RED}●${RESET}` :
                         s.status === "done" ? `${GREEN}✓${RESET}` :
                         `${DIM}?${RESET}`;
      const userTag = s.userActive ? ` ${DIM}(user active)${RESET}` : "";
      const taskTag = s.currentTask ? ` — ${DIM}${s.currentTask.slice(0, 50)}${RESET}` : "";
      console.log(`    ${statusIcon} ${BOLD}${s.title}${RESET} (${s.tool}) ${s.status}${userTag}${taskTag}`);
    }
  }

  // last action from actions.log
  try {
    const actionsLogPath = join(homedir(), ".aoaoe", "actions.log");
    if (existsSync(actionsLogPath)) {
      const content = readFileSync(actionsLogPath, "utf-8").trim();
      if (content) {
        const logLines = content.split("\n").filter((l) => l.trim());
        // find last non-wait action
        for (let i = logLines.length - 1; i >= 0; i--) {
          try {
            const entry = toActionLogEntry(JSON.parse(logLines[i]));
            if (!entry || entry.action.action === "wait") continue;
            const ago = Date.now() - entry.timestamp;
            const agoStr = ago < 60_000 ? `${Math.floor(ago / 1000)}s ago` :
                           ago < 3_600_000 ? `${Math.floor(ago / 60_000)}m ago` :
                           `${Math.floor(ago / 3_600_000)}h ago`;
            const icon = entry.success ? `${GREEN}+${RESET}` : `${RED}!${RESET}`;
            const session = entry.action.session?.slice(0, 8) ?? entry.action.title ?? "";
            const detail = entry.detail.length > 40 ? entry.detail.slice(0, 37) + "..." : entry.detail;
            console.log("");
            console.log(`  last action: ${icon} ${entry.action.action} ${session} ${DIM}(${agoStr})${RESET}`);
            if (detail) console.log(`    ${DIM}${detail}${RESET}`);
            break;
          } catch {
            // skip malformed lines
          }
        }
      }
    }
  } catch {
    // best-effort — actions.log might not exist
  }

  console.log("");
}

// `aoaoe config --validate` -- validate config file, field values, and tool availability
async function runConfigValidation(): Promise<void> {
  const configPath = findConfigFile();
  let checks = 0;
  let passed = 0;
  let warnings = 0;

  console.log("");
  console.log("  aoaoe — config validation");
  console.log(`  ${"─".repeat(50)}`);

  // 1. config file exists
  checks++;
  if (configPath) {
    console.log(`  ${GREEN}✓${RESET} config file found: ${configPath}`);
    passed++;
  } else {
    console.log(`  ${YELLOW}!${RESET} no config file found (using defaults)`);
    console.log(`    ${DIM}run 'aoaoe init' to create one${RESET}`);
    warnings++;
  }

  // 2. config parses + validates
  checks++;
  let config: AoaoeConfig;
  try {
    const configResult = loadConfig();
    config = configResult;
    console.log(`  ${GREEN}✓${RESET} config valid (all field values OK)`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${RED}✗${RESET} config validation failed:`);
    for (const line of msg.split("\n")) {
      console.log(`    ${line}`);
    }
    console.log("");
    console.log(`  ${passed}/${checks} checks passed, fix config errors and retry`);
    console.log("");
    process.exit(1);
    return; // unreachable, but satisfies TypeScript
  }

  // 3. required tools on PATH
  const tools = [
    { name: "aoe", label: "agent-of-empires CLI" },
    { name: "tmux", label: "terminal multiplexer" },
  ];
  if (config.reasoner === "opencode") {
    tools.push({ name: "opencode", label: "OpenCode CLI" });
  } else if (config.reasoner === "claude-code") {
    tools.push({ name: "claude", label: "Claude Code CLI" });
  }

  for (const tool of tools) {
    checks++;
    try {
      const { execFile: execFileCb } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFileCb);
      await execFileAsync("which", [tool.name]);
      console.log(`  ${GREEN}✓${RESET} ${tool.name} found on PATH (${tool.label})`);
      passed++;
    } catch {
      console.log(`  ${RED}✗${RESET} ${tool.name} not found on PATH (${tool.label})`);
    }
  }

  // 4. notifications config check
  checks++;
  if (config.notifications) {
    const hasWebhook = !!config.notifications.webhookUrl;
    const hasSlack = !!config.notifications.slackWebhookUrl;
    if (hasWebhook || hasSlack) {
      const targets = [hasWebhook && "webhook", hasSlack && "Slack"].filter(Boolean).join(" + ");
      console.log(`  ${GREEN}✓${RESET} notifications configured (${targets})`);
      console.log(`    ${DIM}run 'aoaoe notify-test' to verify delivery${RESET}`);
      passed++;
    } else {
      console.log(`  ${YELLOW}!${RESET} notifications block exists but no webhook URLs configured`);
      warnings++;
    }
  } else {
    console.log(`  ${DIM}○${RESET} notifications not configured (optional)`);
    passed++; // not configured is fine — it's optional
  }

  // 5. sessionDirs validation — check that mapped dirs exist
  if (config.sessionDirs && Object.keys(config.sessionDirs).length > 0) {
    const basePath = process.cwd();
    for (const [title, dir] of Object.entries(config.sessionDirs)) {
      checks++;
      const resolved = dir.startsWith("/") ? dir : resolve(basePath, dir);
      if (existsSync(resolved)) {
        console.log(`  ${GREEN}✓${RESET} sessionDirs.${title} → ${resolved}`);
        passed++;
      } else {
        console.log(`  ${YELLOW}!${RESET} sessionDirs.${title} → ${resolved} (not found)`);
        warnings++;
      }
    }
  }

  // summary
  const failed = checks - passed - warnings;
  console.log("");
  if (failed === 0 && warnings === 0) {
    console.log(`  ${GREEN}${BOLD}all ${checks} checks passed${RESET}`);
  } else if (failed === 0) {
    console.log(`  ${passed}/${checks} passed, ${YELLOW}${warnings} warning(s)${RESET}`);
  } else {
    console.log(`  ${passed}/${checks} passed, ${RED}${failed} failed${RESET}${warnings > 0 ? `, ${YELLOW}${warnings} warning(s)${RESET}` : ""}`);
  }
  console.log("");

  if (failed > 0) process.exit(1);
}

// `aoaoe doctor` -- comprehensive health check: config, tools, daemon, disk, sessions
async function runDoctorCheck(): Promise<void> {
  const pkg = readPkgVersion();
  let checks = 0;
  let passed = 0;
  let warnings = 0;

  console.log("");
  console.log(`  aoaoe${pkg ? ` v${pkg}` : ""} — doctor`);
  console.log(`  ${"─".repeat(50)}`);

  // ── 1. config ──────────────────────────────────────────────────────────
  console.log(`\n  ${BOLD}config${RESET}`);
  const configPath = findConfigFile();
  checks++;
  if (configPath) {
    console.log(`  ${GREEN}✓${RESET} config file: ${configPath}`);
    passed++;
  } else {
    console.log(`  ${YELLOW}!${RESET} no config file (using defaults)`);
    warnings++;
  }

  let config: AoaoeConfig;
  checks++;
  try {
    config = loadConfig();
    console.log(`  ${GREEN}✓${RESET} config validates OK`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${RED}✗${RESET} config invalid: ${msg.split("\n")[0]}`);
    // use defaults to continue checking other things
    config = loadConfig({});
  }

  // ── 2. tools ───────────────────────────────────────────────────────────
  console.log(`\n  ${BOLD}tools${RESET}`);
  const toolChecks: Array<{ cmd: string; label: string; versionArg: string[]; required: boolean }> = [
    { cmd: "node", label: "Node.js", versionArg: ["--version"], required: true },
    { cmd: "aoe", label: "agent-of-empires", versionArg: ["--version"], required: true },
    { cmd: "tmux", label: "terminal multiplexer", versionArg: ["-V"], required: true },
  ];
  if (config.reasoner === "opencode") {
    toolChecks.push({ cmd: "opencode", label: "OpenCode CLI", versionArg: ["version"], required: true });
  } else {
    toolChecks.push({ cmd: "claude", label: "Claude Code CLI", versionArg: ["--version"], required: true });
  }

  for (const tool of toolChecks) {
    checks++;
    try {
      const result = await shellExec(tool.cmd, tool.versionArg);
      const ver = result.stdout.trim().split("\n")[0].slice(0, 60) || result.stderr.trim().split("\n")[0].slice(0, 60);
      console.log(`  ${GREEN}✓${RESET} ${tool.cmd} — ${ver}`);
      passed++;
    } catch {
      if (tool.required) {
        console.log(`  ${RED}✗${RESET} ${tool.cmd} not found (${tool.label})`);
      } else {
        console.log(`  ${YELLOW}!${RESET} ${tool.cmd} not found (${tool.label}, optional)`);
        warnings++;
      }
    }
  }

  // ── 3. reasoner server ─────────────────────────────────────────────────
  if (config.reasoner === "opencode") {
    console.log(`\n  ${BOLD}reasoner${RESET}`);
    checks++;
    try {
      const resp = await fetch(`http://127.0.0.1:${config.opencode.port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        console.log(`  ${GREEN}✓${RESET} opencode serve responding on port ${config.opencode.port}`);
        passed++;
      } else {
        console.log(`  ${YELLOW}!${RESET} opencode serve on port ${config.opencode.port} returned ${resp.status}`);
        warnings++;
      }
    } catch {
      console.log(`  ${RED}✗${RESET} opencode serve not responding on port ${config.opencode.port}`);
      console.log(`    ${DIM}start with: opencode serve --port ${config.opencode.port}${RESET}`);
    }
  }

  // ── 4. daemon ──────────────────────────────────────────────────────────
  console.log(`\n  ${BOLD}daemon${RESET}`);
  const state = readState();
  const daemonRunning = isDaemonRunningFromState(state);
  checks++;
  if (daemonRunning && state) {
    console.log(`  ${GREEN}✓${RESET} daemon running (poll #${state.pollCount}, phase: ${state.phase})`);
    console.log(`    ${state.sessions.length} session(s) monitored`);
    passed++;
  } else {
    console.log(`  ${DIM}○${RESET} daemon not running`);
    passed++; // not running is fine for doctor — just informational
  }

  // lock file check
  const lockPath = join(homedir(), ".aoaoe", "daemon.lock");
  if (existsSync(lockPath) && !daemonRunning) {
    checks++;
    console.log(`  ${YELLOW}!${RESET} stale lock file found: ${lockPath}`);
    console.log(`    ${DIM}remove with: rm ${lockPath}${RESET}`);
    warnings++;
  }

  // ── 5. disk / data ─────────────────────────────────────────────────────
  console.log(`\n  ${BOLD}data${RESET}`);
  const aoaoeDir = join(homedir(), ".aoaoe");
  if (existsSync(aoaoeDir)) {
    checks++;
    try {
      const files = await import("node:fs").then(fs => fs.readdirSync(aoaoeDir));
      let totalSize = 0;
      for (const f of files) {
        try {
          totalSize += statSync(join(aoaoeDir, f)).size;
        } catch { /* skip unreadable */ }
      }
      const sizeStr = totalSize < 1024 ? `${totalSize}B` :
                      totalSize < 1_048_576 ? `${(totalSize / 1024).toFixed(1)}KB` :
                      `${(totalSize / 1_048_576).toFixed(1)}MB`;
      console.log(`  ${GREEN}✓${RESET} ~/.aoaoe/ — ${files.length} files, ${sizeStr}`);
      passed++;
    } catch {
      console.log(`  ${YELLOW}!${RESET} could not read ~/.aoaoe/`);
      warnings++;
    }

    // actions log stats
    const actionsPath = join(aoaoeDir, "actions.log");
    if (existsSync(actionsPath)) {
      checks++;
      try {
        const content = readFileSync(actionsPath, "utf-8").trim();
        const lineCount = content ? content.split("\n").length : 0;
        const size = statSync(actionsPath).size;
        const sizeStr = size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}KB`;
        console.log(`  ${GREEN}✓${RESET} actions.log — ${lineCount} entries, ${sizeStr}`);
        passed++;
      } catch {
        console.log(`  ${YELLOW}!${RESET} actions.log unreadable`);
        warnings++;
      }
    }
  } else {
    console.log(`  ${DIM}○${RESET} ~/.aoaoe/ does not exist yet (run 'aoaoe init')`);
  }

  // ── 6. aoe sessions ───────────────────────────────────────────────────
  console.log(`\n  ${BOLD}sessions${RESET}`);
  checks++;
  try {
    const listResult = await shellExec("aoe", ["list", "--json"]);
    if (listResult.exitCode === 0 && listResult.stdout.trim()) {
      const sessions = JSON.parse(listResult.stdout);
      if (Array.isArray(sessions) && sessions.length > 0) {
        console.log(`  ${GREEN}✓${RESET} ${sessions.length} aoe session(s) found`);
        for (const s of sessions.slice(0, 5)) {
          console.log(`    ${DIM}${s.title ?? s.id} (${s.tool ?? "?"})${RESET}`);
        }
        if (sessions.length > 5) console.log(`    ${DIM}...and ${sessions.length - 5} more${RESET}`);
        passed++;
      } else {
        console.log(`  ${DIM}○${RESET} no aoe sessions (start some with 'aoe add')`);
        passed++;
      }
    } else {
      console.log(`  ${YELLOW}!${RESET} aoe list returned non-zero (is aoe running?)`);
      warnings++;
    }
  } catch {
    console.log(`  ${RED}✗${RESET} could not run 'aoe list --json'`);
  }

  // ── 7. tasks ────────────────────────────────────────────────────────────
  console.log(`\n  ${BOLD}tasks${RESET}`);
  checks++;
  try {
    const defs = loadTaskDefinitions(process.cwd());
    const taskProfiles = resolveProfiles(config);
    if (defs.length === 0) {
      console.log(`  ${DIM}○${RESET} no task definitions (create aoaoe.tasks.json or run 'aoaoe init')`);
      passed++;
    } else {
      const tm = new TaskManager(process.cwd(), defs, taskProfiles);
      const tasks = tm.tasks;
      const active = tasks.filter((t) => t.status === "active").length;
      const pending = tasks.filter((t) => t.status === "pending").length;
      const paused = tasks.filter((t) => t.status === "paused").length;
      const completed = tasks.filter((t) => t.status === "completed").length;
      const stuck = tasks.filter((t) => t.status === "active" && t.lastProgressAt && (Date.now() - t.lastProgressAt > 30 * 60_000)).length;
      console.log(`  ${GREEN}✓${RESET} ${tasks.length} task(s): ${active} active, ${pending} pending, ${paused} paused, ${completed} completed`);
      if (stuck > 0) {
        console.log(`  ${YELLOW}!${RESET} ${stuck} task(s) possibly stuck (no progress >30min)`);
        warnings++;
      }
      // check for untracked sessions
      try {
        const liveStatus = await probeLiveSessionStatus();
        const trackedTitles = new Set(tasks.map((t) => t.sessionTitle.toLowerCase()));
        const untracked = [...liveStatus.keys()].filter((t) => !trackedTitles.has(t));
        if (untracked.length > 0) {
          console.log(`  ${YELLOW}!${RESET} ${untracked.length} untracked session(s): ${untracked.join(", ")}`);
          console.log(`    ${DIM}adopt with: /task <name> :: <goal>${RESET}`);
          warnings++;
        }
      } catch { /* aoe not available */ }
      passed++;
    }
  } catch (err) {
    console.log(`  ${RED}✗${RESET} task check failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── summary ────────────────────────────────────────────────────────────
  // warnings are informational sub-checks, not counted against the main tally
  const failed = Math.max(0, checks - passed);
  console.log("");
  console.log(`  ${"─".repeat(50)}`);
  if (failed === 0 && warnings === 0) {
    console.log(`  ${GREEN}${BOLD}all ${checks} checks passed${RESET} — looking healthy`);
  } else if (failed === 0) {
    console.log(`  ${GREEN}${passed}/${checks} passed${RESET}${warnings > 0 ? `, ${YELLOW}${warnings} warning(s)${RESET}` : ""}`);
  } else {
    console.log(`  ${passed}/${checks} passed, ${RED}${failed} failed${RESET}${warnings > 0 ? `, ${YELLOW}${warnings} warning(s)${RESET}` : ""}`);
  }
  console.log("");
}

// `aoaoe config --diff` -- show only fields that differ from defaults
function showConfigDiff(): void {
  const configPath = findConfigFile();
  const configResult = loadConfig();
  const { _configPath, ...config } = configResult as unknown as Record<string, unknown>;

  const diffs = computeConfigDiff(config, DEFAULTS as unknown as Record<string, unknown>);

  console.log("");
  console.log("  aoaoe — config diff (vs. defaults)");
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  source: ${configPath ?? "defaults (no config file found)"}`);
  console.log("");

  if (diffs.length === 0) {
    console.log("  (no differences — config matches defaults)");
  } else {
    for (const d of diffs) {
      const curStr = d.current === undefined ? `${DIM}(not set)${RESET}` : `${GREEN}${JSON.stringify(d.current)}${RESET}`;
      const defStr = d.default === undefined ? `${DIM}(not set)${RESET}` : `${DIM}${JSON.stringify(d.default)}${RESET}`;
      console.log(`  ${YELLOW}${d.path}${RESET}`);
      console.log(`    current:  ${curStr}`);
      console.log(`    default:  ${defStr}`);
    }
    console.log("");
    console.log(`  ${diffs.length} field(s) differ from defaults`);
  }
  console.log("");
}

// `aoaoe config` -- show the effective resolved config (defaults + file + any notes)
function showEffectiveConfig(): void {
  const configPath = findConfigFile();
  const configResult = loadConfig();
  // strip _configPath from output
  const { _configPath, ...config } = configResult as unknown as Record<string, unknown>;

  console.log("");
  console.log("  aoaoe — effective config");
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  source: ${configPath ?? "defaults (no config file found)"}`);
  console.log("");
  console.log(JSON.stringify(config, null, 2));
  console.log("");

  // helpful notes
  if (!configPath) {
    console.log(`  ${DIM}create a config: aoaoe init${RESET}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error(`fatal: ${err}`);
  process.exit(1);
});
