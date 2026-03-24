#!/usr/bin/env node
import { execSync } from "node:child_process";
import { loadConfig, validateEnvironment, parseCliArgs, printHelp, configFileExists, findConfigFile, DEFAULTS, computeConfigDiff } from "./config.js";
import { Poller, computeTmuxName } from "./poller.js";
import { createReasoner } from "./reasoner/index.js";
import { Executor } from "./executor.js";
import { printDashboard } from "./dashboard.js";
import { InputReader } from "./input.js";
import { ReasonerConsole } from "./console.js";
import { writeState, buildSessionStates, checkInterrupt, clearInterrupt, cleanupState, acquireLock, readState } from "./daemon-state.js";
import { formatSessionSummaries, formatActionDetail, formatPlainEnglishAction, narrateObservation, summarizeRecentActions, friendlyError, colorizeConsoleLine, filterLogLines } from "./console.js";
import { type SessionPolicyState } from "./reasoner/prompt.js";
import { loadGlobalContext, resolveProjectDirWithSource, discoverContextFiles, loadSessionContext } from "./context.js";
import { tick as loopTick } from "./loop.js";
import { exec as shellExec } from "./shell.js";
import { wakeableSleep } from "./wake.js";
import { classifyMessages, formatUserMessages, buildReceipts, shouldSkipSleep, hasPendingFile, isInsistMessage, stripInsistPrefix } from "./message.js";
import { TaskManager, loadTaskDefinitions, loadTaskState, formatTaskTable, importAoeSessionsToTasks } from "./task-manager.js";
import { goalToList } from "./types.js";
import { runTaskCli, handleTaskSlashCommand, quickTaskUpdate } from "./task-cli.js";
import { TUI, hitTestSession, nextSortMode, SORT_MODES, formatUptime, formatClipText, CLIP_DEFAULT_COUNT, loadTuiPrefs, saveTuiPrefs, BUILTIN_COMMANDS, validateGroupName, CONTEXT_BURN_THRESHOLD, buildSnapshotData, formatSnapshotJson, formatSnapshotMarkdown, formatBroadcastSummary, WATCHDOG_DEFAULT_MINUTES, rankSessions, TOP_SORT_MODES, formatIdleSince, CONTEXT_CEILING_THRESHOLD, buildSessionStats, formatSessionStatsLines, formatStatsJson, validateSessionTag, validateColorName, SESSION_COLOR_NAMES, TIMELINE_DEFAULT_COUNT, computeErrorTrend, parseQuietHoursRange, computeCostSummary, formatSessionReport, formatQuietStatus, formatSessionAge, formatHealthTrendChart, isOverBudget, DRAIN_ICON, formatSessionsTable } from "./tui.js";
import type { SessionReportData } from "./tui.js";
import type { TopSortMode } from "./tui.js";
import type { SortMode } from "./tui.js";
import { isDaemonRunningFromState } from "./chat.js";
import { sendNotification, sendTestNotification } from "./notify.js";
import { startHealthServer } from "./health.js";
import { loadTuiHistory, searchHistory, TUI_HISTORY_FILE, computeHistoryStats } from "./tui-history.js";
import { ConfigWatcher, formatConfigChange } from "./config-watcher.js";
import { parseActionLogEntries, parseActivityEntries, mergeTimeline, filterByAge, parseDuration, formatTimelineJson, formatTimelineMarkdown } from "./export.js";
import type { AoaoeConfig, Observation, ReasonerResult, TaskState, ActionLogEntry } from "./types.js";
import { actionSession, actionDetail, toActionLogEntry } from "./types.js";
import { YELLOW, GREEN, DIM, BOLD, RED, RESET } from "./colors.js";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AOAOE_DIR = join(homedir(), ".aoaoe"); // watch dir for wakeable sleep
const INPUT_FILE = join(AOAOE_DIR, "pending-input.txt"); // file IPC from chat.ts

async function main() {
   const { overrides, help, version, register, testContext: isTestContext, runTest, showTasks, showHistory, showStatus, showConfig, configValidate, configDiff, notifyTest, runDoctor, runLogs, logsActions, logsGrep, logsCount, runExport, exportFormat, exportOutput, exportLast, runInit, initForce, runTaskCli: isTaskCli, runTail: isTail, tailFollow, tailCount, runStats: isStats, statsLast, runReplay: isReplay, replaySpeed, replayLast, registerTitle } = parseCliArgs(process.argv);

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

  // `aoaoe tasks` -- show current task state
  if (showTasks) {
    await showTaskStatus();
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
  if (runDoctor) {
    await runDoctorCheck();
    return;
  }

  // `aoaoe logs` -- show conversation or action log entries
  if (runLogs) {
    await showLogs(logsActions, logsGrep, logsCount);
    return;
  }

  // `aoaoe export` -- export session timeline as JSON or Markdown
  if (runExport) {
    await runTimelineExport(exportFormat, exportOutput, exportLast);
    return;
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
  const importedTasks = await importAoeSessionsToTasks(basePath);
  if (importedTasks.imported.length > 0) {
    console.error(`  tasks: imported ${importedTasks.imported.length} AoE session(s) into task list`);
  }
  const taskDefs = loadTaskDefinitions(basePath);
  let taskManager: TaskManager | undefined;

  if (taskDefs.length > 0) {
    taskManager = new TaskManager(basePath, taskDefs);
    console.error(`  tasks: ${taskDefs.length} defined`);
    for (const t of taskManager.tasks) {
      const icon = t.status === "active" ? "~" : t.status === "completed" ? "+" : ".";
      const goalItems = goalToList(t.goal);
      console.error(`    [${icon}] ${t.repo}:`);
      for (const item of goalItems) console.error(`          - ${item}`);
    }
    console.error("");

    // reconcile: create missing AoE sessions, start them
    log("reconciling task sessions...");
    const { created, linked } = await taskManager.reconcileSessions();
    if (created.length > 0) log(`created sessions: ${created.join(", ")}`);
    if (linked.length > 0) log(`linked existing sessions: ${linked.join(", ")}`);
  }

  const poller = new Poller(config);
  const reasoner = config.observe ? null : createReasoner(config, globalContext || undefined);
  const executor = config.observe ? null : new Executor(config);
  if (taskManager && executor) executor.setTaskManager(taskManager);
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
    // wire /budget cost alerts
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
    tui.updateState({ reasonerName: getReasonerLabel() });

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

    // handle built-in command markers (from stdin or chat.ts file IPC)
    for (const cmd of commands) {
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
          if (tui) tui.log("system", output); else log(output);
          reasonerConsole.writeSystem(output);
        } catch (err) {
          const msg = `quick task error: ${err}`;
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
      const msSinceLastReason = Date.now() - lastReasonerAt;
      const reasonDue = lastReasonerAt === 0
        || msSinceLastReason >= config.reasonIntervalMs
        || !!userMessage
        || forceDashboard;

      if (!reasonDue) {
        // Observation-only tick: poll sessions, update TUI state, skip LLM
        const observation = await poller.poll();
        const sessionStates = buildSessionStates(observation);
        if (tui) tui.updateState({ phase: "sleeping", pollCount, sessions: sessionStates });
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
        } = await daemonTick(config, poller, reasoner, executor, reasonerConsole, pollCount, policyStates, userMessage, forceDashboard, activeTaskContext, taskManager, tui);
        totalDecisions += decisionsThisTick;
        totalActionsExecuted += actionsOk;
        totalActionsFailed += actionsFail;
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
        const nextTickAt = Date.now() + config.pollIntervalMs;
        const nextReasonAtFull = lastReasonerAt > 0 ? lastReasonerAt + config.reasonIntervalMs : Date.now() + config.reasonIntervalMs;
        if (tui) tui.updateState({ phase: "sleeping", nextTickAt, nextReasonAt: nextReasonAtFull });
        writeState("sleeping", { pollCount, pollIntervalMs: config.pollIntervalMs, nextTickAt, paused: false });

        const wake = await wakeableSleep(config.pollIntervalMs, AOAOE_DIR);
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
        sendNotification(config, { event: "session_error", timestamp: Date.now(), session: s.title, detail: `status: ${s.status}` });
      }
      if (s.status === "done" && changedSet.has(s.title)) {
        sendNotification(config, { event: "session_done", timestamp: Date.now(), session: s.title });
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
    if (tui) {
      tui.log("reasoner", `decided: ${actionSummary}`);
    } else {
      process.stdout.write(` -> ${actionSummary}\n`);
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
    // notify: action executed or failed
    sendNotification(config, {
      event: entry.success ? "action_executed" : "action_failed",
      timestamp: Date.now(),
      session: sessionTitle,
      detail: `${entry.action.action}${actionText ? `: ${actionText.slice(0, 200)}` : ""}`,
    });
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

function readPkgVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

// `aoaoe tasks` -- show current task progress
async function showTaskStatus(): Promise<void> {
  const basePath = process.cwd();
  const defs = loadTaskDefinitions(basePath);
  const states = loadTaskState();

  if (defs.length === 0 && states.size === 0) {
    console.log("no tasks defined.");
    console.log("");
    console.log("create aoaoe.tasks.json:");
    console.log('  [{ "repo": "github/adventure", "goal": "Continue the roadmap" }]');
    return;
  }

  // merge definitions into state for display
  const tm = new TaskManager(basePath, defs);
  console.log("");
  console.log(formatTaskTable(tm.tasks));
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

  // ── summary ────────────────────────────────────────────────────────────
  const failed = checks - passed - warnings;
  console.log("");
  console.log(`  ${"─".repeat(50)}`);
  if (failed === 0 && warnings === 0) {
    console.log(`  ${GREEN}${BOLD}all ${checks} checks passed${RESET} — looking healthy`);
  } else if (failed === 0) {
    console.log(`  ${passed}/${checks} passed, ${YELLOW}${warnings} warning(s)${RESET}`);
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
