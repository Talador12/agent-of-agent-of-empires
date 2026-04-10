#!/usr/bin/env node
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ index.ts — daemon entry point                                           │
// │                                                                         │
// │ TABLE OF CONTENTS (search for these markers):                           │
// │                                                                         │
// │   §IMPORTS        — import statements (~265 lines)                      │
// │   §MAIN           — main() function entry                               │
// │   §CLI            — CLI subcommand dispatch (early returns)             │
// │   §CONFIG         — config loading, lock, TUI setup                    │
// │   §MODULES        — intelligence module instantiation (~90 instances)   │
// │   §TUI-COMMANDS   — TUI slash command wiring (~3,600 lines)            │
// │   §SERVERS        — health server, API server setup                    │
// │   §SHUTDOWN       — signal handlers, cleanup                           │
// │   §LOOP           — the daemon loop (while running)                    │
// │   §TICK           — daemonTick() function                              │
// │   §HELPERS        — utility functions after main()                     │
// │                                                                         │
// │ If you're looking for the daemon loop, search for §LOOP.               │
// │ If you're adding a TUI command, search for §TUI-COMMANDS.              │
// │ If you're adding a module, search for §MODULES.                        │
// └──────────────────────────────────────────────────────────────────────────┘

// §IMPORTS ──────────────────────────────────────────────────────────────────
import { execSync } from "node:child_process";
import { loadConfig, validateEnvironment, parseCliArgs, printHelp, configFileExists, findConfigFile, DEFAULTS, computeConfigDiff, configWarnings } from "./config.js";
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
import { startApiServer, formatApiStatus } from "./api-server.js";
import type { ApiModules, ApiServer } from "./api-server.js";
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
import { computeSchedulingActions, getActivatableTasks, formatSchedulingActions } from "./dep-scheduler.js";
import { ObservationCache } from "./observation-cache.js";
import { FleetRateLimiter } from "./fleet-rate-limiter.js";
import { RecoveryPlaybookManager } from "./recovery-playbook.js";
import { compressObservation } from "./context-compressor.js";
import { filterByPriority } from "./priority-reasoning.js";
import { estimateCallCost } from "./reasoner-cost.js";
import { GraduationManager } from "./session-graduation.js";
import { filterThroughApproval, formatApprovalWorkflowStatus } from "./approval-workflow.js";
import { analyzeCompletedTasks, refineGoal, formatGoalRefinement } from "./goal-refiner.js";
import { generateHtmlReport, buildReportData } from "./fleet-export.js";
import { installService, ensureServiceInstalled } from "./service-generator.js";
import { buildSessionReplay, formatReplay, summarizeReplay } from "./session-replay.js";
import { createWorkflowState, advanceWorkflow, formatWorkflow } from "./workflow-engine.js";
import type { WorkflowState } from "./workflow-engine.js";
import { assignReasonerBackends, formatAssignments } from "./multi-reasoner.js";
import { TokenQuotaManager } from "./token-quota.js";
import { saveCheckpoint, loadCheckpoint, buildCheckpoint, formatCheckpointInfo, shouldRestoreCheckpoint } from "./session-checkpoint.js";
import { findWorkflowTemplate, instantiateWorkflow, formatWorkflowTemplateList } from "./workflow-templates.js";
import { ABReasoningTracker } from "./ab-reasoning.js";
import { forecastWorkflowCost, formatWorkflowCostForecast } from "./workflow-cost-forecast.js";
import { createWorkflowChain, advanceChain, formatWorkflowChain } from "./workflow-chain.js";
import type { WorkflowChain } from "./workflow-chain.js";
import { aggregateFederation, formatFederationOverview } from "./fleet-federation.js";
import type { FederatedFleetState } from "./fleet-federation.js";
import { archiveSessionOutput, formatArchiveList } from "./output-archival.js";
import { generateRunbooks, formatGeneratedRunbooks } from "./runbook-generator.js";
import { defaultAlertRules, evaluateAlertRules, formatFiredAlerts, formatAlertRules } from "./alert-rules.js";
import type { AlertContext } from "./alert-rules.js";
import { parseAlertRuleConfigs } from "./alert-rule-dsl.js";
import { forecastHealth, formatHealthForecast } from "./health-forecast.js";
import { tailSession, formatTail, parseTailArgs } from "./session-tail.js";
import { renderWorkflowDag, renderChainDag } from "./workflow-viz.js";
import { formatPrometheusMetrics, buildMetricsSnapshot } from "./metrics-export.js";
import { grepArchives, formatGrepResult } from "./fleet-grep.js";
import { createExecution, advanceExecution, formatExecution } from "./runbook-executor.js";
import type { RunbookExecution } from "./runbook-executor.js";
import { cloneSession, formatCloneResult } from "./session-clone.js";
import { findSimilarGoals, formatSimilarGoals } from "./goal-similarity.js";
import { groupByTag, formatTagReport, parseTags } from "./cost-allocation-tags.js";
import { recommendScaling, formatScalingRecommendation } from "./predictive-scaling.js";
import { createTagStore, setTag, formatTagStore } from "./session-tag-manager.js";
import type { SessionTagStore } from "./session-tag-manager.js";
import { compareSessions, formatComparison } from "./session-compare.js";
import { buildFleetSummary, formatFleetSummaryText, formatFleetSummaryTui } from "./fleet-summary-report.js";
import { buildTimeline, formatTimeline } from "./session-timeline.js";
import { generateChangelog, formatChangelog } from "./fleet-changelog.js";
import { createIdleDetector, recordActivity, detectIdleSessions, formatIdleAlerts } from "./session-idle-detector.js";
import { detectGoalConflicts, formatGoalConflicts } from "./goal-conflict-resolver.js";
import type { GoalInfo } from "./goal-conflict-resolver.js";
import { computeLeaderboard, formatLeaderboard } from "./fleet-leaderboard.js";
import type { LeaderboardInput } from "./fleet-leaderboard.js";
import { SessionHealthHistory, formatHealthHistory } from "./session-health-history.js";
import { createThrottleState, updateBurnRate, evaluateThrottles, formatThrottleState } from "./cost-anomaly-throttle.js";
import { suggestSessionNames, formatNameSuggestions } from "./smart-session-naming.js";
import { buildShiftHandoff, formatHandoffTui } from "./operator-shift-handoff.js";
import { detectDependencies, formatDetectedDeps } from "./session-dep-auto-detect.js";
import type { SessionInfo as DepSessionInfo } from "./session-dep-auto-detect.js";
import { projectCosts, evaluateCostAlerts, formatCostForecastAlerts, formatCostProjections } from "./cost-forecast-alert.js";
import { FleetEventBus, formatEventBus } from "./fleet-event-bus.js";
import { verifyCompletion, formatVerification } from "./goal-completion-verifier.js";
import { computeOutputDiff, formatOutputDiff } from "./session-output-diff.js";
import { createHeartbeatState, recordHeartbeat, evaluateHeartbeats, formatHeartbeats } from "./session-heartbeat.js";
import { buildReplayState, seekTo, step, currentEntry, filterBySession, formatReplayEntry, formatReplayStats } from "./action-replay.js";
import type { ReplayState } from "./action-replay.js";
import { listProfiles, getProfile, formatProfileList, formatProfileDetail } from "./fleet-config-profiles.js";
import { runDiagnostics, formatDiagnostics } from "./daemon-diagnostics.js";
import { formatStateMachine, canTransition, formatTransitionResult } from "./session-state-machine.js";
import type { SessionState as SMState } from "./session-state-machine.js";
import { createIncrementalState, detectChanges, formatIncrementalContext } from "./incremental-context.js";
import { DaemonMetricsHistogram, formatMetricsHistogram } from "./daemon-metrics-histogram.js";
import { createPeerReviewState, formatPeerReviews, requestReview, resolveReview, expireStaleReviews } from "./session-peer-review.js";
import { createWarmStandby, warmSlot, claimSlot, formatWarmStandby } from "./fleet-warm-standby.js";
import { OutputRedactor, formatRedactionStats } from "./session-output-redaction.js";
import { checkFleetCompliance, formatComplianceReport } from "./fleet-compliance-checker.js";
import type { SessionForCompliance } from "./fleet-compliance-checker.js";
import { DaemonPluginHooks, formatPluginHooks } from "./daemon-plugin-hooks.js";
import { FleetIncidentTimeline, formatIncidentTimeline } from "./fleet-incident-timeline.js";
import { createBookmarkState, addBookmark, removeBookmark, getBookmarks, searchBookmarks, formatBookmarks } from "./session-output-bookmarks.js";
import { createCanaryState, startCanary, recordCanaryHealth, evaluateCanary, promoteCanary, rollbackCanary, formatCanaryState } from "./daemon-canary-mode.js";
import { createConfigDiffState, recordConfig, computeConfigDiff as computeDaemonConfigDiff, formatConfigDiff } from "./daemon-config-diff.js";
import { rankGoals, formatGoalPriority } from "./goal-auto-priority.js";
import type { GoalPriorityInput } from "./goal-auto-priority.js";
import { FleetCapacityForecaster, formatCapacityForecast } from "./fleet-capacity-forecaster.js";
import { createWatchdog, tickWatchdog, checkWatchdog, formatWatchdog } from "./daemon-watchdog.js";
import { FleetCostRegression, formatCostRegression } from "./fleet-cost-regression.js";
import { createCascadeState, addParentGoal, cascadeChild, formatCascadeTree } from "./goal-cascading.js";
import { computeHealthScore, formatHealthScore } from "./daemon-health-score.js";
import { createEventReplay, stepForward, stepBackward, seekTo as seekEventReplay, setFilter as setEventReplayFilter, formatEventReplay } from "./fleet-event-replay.js";
import type { ReplayPlaybackState } from "./fleet-event-replay.js";
import { allocateContextBudget, formatContextBudget } from "./session-context-budget.js";
import type { ContextFile } from "./session-context-budget.js";
import { DaemonTickProfiler, formatTickProfiler } from "./daemon-tick-profiler.js";
import { estimateFleetConfidence, formatConfidence } from "./goal-confidence-estimator.js";
import type { ConfidenceInput } from "./goal-confidence-estimator.js";
import { planBudget, formatBudgetPlan } from "./fleet-budget-planner.js";
import type { BudgetPlanInput } from "./fleet-budget-planner.js";
import { analyzeFleetSentiment, formatSentiment } from "./session-sentiment.js";
import { analyzeBalance, formatBalanceReport } from "./fleet-workload-balancer.js";
import type { SessionLoad } from "./fleet-workload-balancer.js";
import { generateCrashReport, formatCrashReportTui } from "./daemon-crash-report.js";
import { createGroupingState, addToGroup, removeFromGroup, listGroups, formatGrouping } from "./fleet-session-grouping.js";
import { createContextDiffState, diffContextFiles, formatContextDiff } from "./session-context-diff.js";
import { validateConfigSchema, formatValidation } from "./daemon-config-schema.js";
import { buildTranscript, formatTranscriptPreview } from "./session-transcript-export.js";
import type { TranscriptInput } from "./session-transcript-export.js";
import { scoreDecomposition, formatDecompQuality } from "./goal-decomp-quality.js";
import { correlateAnomalies, formatCorrelations } from "./fleet-anomaly-correlation.js";
import type { AnomalyEvent } from "./fleet-anomaly-correlation.js";
import { computeCriticalPath, formatCriticalPath } from "./goal-critical-path.js";
import type { CriticalPathNode } from "./goal-critical-path.js";
import { createCompressionState, recordSnapshot as recordCompressedSnapshot, formatCompressionStats } from "./fleet-snapshot-compression.js";
import { createAnnotationState, annotate, getSessionAnnotations, formatAnnotations } from "./session-output-annotations.js";
import { celebrate, formatCelebrations } from "./goal-celebration.js";
import type { CelebrationInput } from "./goal-celebration.js";
import { evaluateReadiness, formatReadiness } from "./fleet-readiness-score.js";
import { createSupervisor, formatSupervisor } from "./daemon-process-supervisor.js";
import { buildDailyDigest, formatDigestTui } from "./fleet-daily-digest.js";
import { parseGoal, formatParsedGoal } from "./goal-nl-parser.js";
import { createHotSwapState, formatHotSwap } from "./daemon-hot-swap.js";
import { formatWebhookPreview } from "./fleet-webhook-integrations.js";
import type { WebhookEvent, WebhookPlatform } from "./fleet-webhook-integrations.js";
import { parseOutputLines, formatStructuredLog } from "./session-structured-log.js";
import { exportState, formatStateExport } from "./daemon-state-portable.js";
import { deduplicateOutput, formatDedup } from "./session-output-dedup.js";
import { migrateConfig, formatMigration } from "./daemon-config-migration.js";
import { GoalProgressPredictor, formatPredictions } from "./goal-progress-prediction.js";
import { buildDashboardData, formatOpsDashboard } from "./fleet-ops-dashboard.js";
import { findBrokenDeps, detectCycles as detectDepCycles, formatDepRepairs } from "./goal-dep-auto-repair.js";
import { createEvolutionState, recordWindow, formatPatternEvolution } from "./session-pattern-evolution.js";
import { createAlertDashboard, addAlert, acknowledgeAlert, formatAlertDashboard } from "./fleet-alert-dashboard.js";
import { detectFleetLanguages, formatLangDetection } from "./session-lang-detector.js";
import { createSlaState, registerGoalSla, checkGoalSlas, formatSlaChecks } from "./goal-sla-enforcement.js";
import { createAutoScaler, computeScaling, formatAutoScaler } from "./fleet-auto-scaler.js";
import { createXPState, formatGamification } from "./goal-gamification.js";
import { generateAuditReport, formatAuditReportTui } from "./daemon-audit-report.js";
import { DaemonStartupProfiler, formatStartupProfile } from "./daemon-startup-profiler.js";
import { computeAffinityGroups, formatAffinityGroups } from "./fleet-affinity-groups.js";
import { buildClipboardResult, formatClipboardResult } from "./session-clipboard.js";
import { createShutdownState, formatShutdownState } from "./daemon-graceful-shutdown.js";
import { computeImpact, formatImpact } from "./goal-dep-impact.js";
import { getRunbook, searchRunbooks, listRunbooks, formatRunbookList, formatRunbookSteps } from "./fleet-runbook-library.js";
import { formatGraphExport } from "./goal-dep-graph-export.js";
import type { GraphNode, GraphFormat } from "./goal-dep-graph-export.js";
import { DaemonPerfRegression, formatPerfRegression } from "./daemon-perf-regression.js";
import { generateComplianceReport as generateCompReport, formatComplianceReportTui as formatCompReportTui } from "./fleet-compliance-report.js";
import { analyzeCostOptimizations, formatCostOptimizer } from "./fleet-cost-optimizer.js";
import { createHeatmapState as createProgressHeatmap, formatProgressHeatmap } from "./goal-progress-heatmap.js";
import { createModuleDepGraph, formatModuleDeps } from "./daemon-module-deps.js";
import { FleetCostTrend, formatCostTrend } from "./fleet-cost-trend.js";
import { tagFleetComplexity, formatComplexityTags } from "./goal-complexity-tagger.js";
import { createEventStore, formatEventStore } from "./daemon-event-sourcing.js";
import { createLockState, acquireLock as acquireDaemonLock, formatLockState } from "./daemon-distributed-lock.js";
import { findCorrelations, formatCorrelationPairs } from "./session-output-correlation.js";
import { FleetUtilizationForecaster, formatUtilizationForecast } from "./fleet-utilization-forecaster.js";
import { createTimeMachine, takeSnapshot, compareSnapshots, latestSnapshot, getSnapshot, formatTimeMachine, formatSnapshotDiff } from "./fleet-snapshot-time-machine.js";
import { buildSparklineEntries, formatSparklineDashboard } from "./goal-sparkline-dashboard.js";
import { createTickBudget, formatTickBudget } from "./daemon-tick-budget.js";
import { createMutationState, formatMutationHistory } from "./session-goal-mutation.js";
import { generateChargeback, formatChargeback } from "./fleet-cost-chargeback.js";
import { ensemblePredict, buildPredictionMethods, formatEnsemblePredictions } from "./goal-prediction-ensemble.js";
import { resolveInheritance, formatInheritanceTree } from "./alert-rule-inheritance.js";
import type { InheritableRule } from "./alert-rule-inheritance.js";
import { createAffinityState, routeSessions, formatAffinityRouting } from "./session-affinity-router.js";
import { parseManifest, applyManifest, formatManifest, formatAssignment, generateTemplate } from "./batch-goal-assignment.js";
import { createRateLimiter, formatRateLimiter } from "./api-rate-limiting.js";
import { createKnowledgeStore, addKnowledge, searchKnowledge, formatKnowledgeStore } from "./cross-session-knowledge.js";
import { buildPriorityMatrix, formatPriorityMatrix } from "./fleet-priority-matrix.js";
import type { MatrixInput } from "./fleet-priority-matrix.js";
import { createWebhookPush, addWebhook, formatWebhookPush, pushEvent } from "./api-webhook-push.js";
import { createRetentionState, formatRetention } from "./audit-trail-retention.js";
import { normalizeFleet, formatNormalizedVelocity } from "./goal-velocity-normalization.js";
import type { VelocityInput } from "./goal-velocity-normalization.js";
import { scanForErrors, formatErrorScan, supportedLanguages } from "./session-error-pattern-library.js";
import { createResourceMonitor, recordSample, formatResourceMonitor } from "./daemon-resource-monitor.js";
import { createBurndown, recordProgress as recordBurndownProgress, formatBurndown } from "./goal-progress-burndown.js";
import type { BurndownState } from "./goal-progress-burndown.js";
import { createLeakDetector, recordHeapSample, formatLeakDetector } from "./daemon-memory-leak-detector.js";
import { buildTopology, formatTopology } from "./fleet-session-topology.js";
import { buildLifecycleRecords, computeLifecycleStats, formatLifecycleStats } from "./lifecycle-analytics.js";
import { buildCostAttributions, computeCostReport, formatCostReport } from "./cost-attribution.js";
import { decomposeGoal, formatDecomposition } from "./goal-decomposer.js";
import { loadSessionMemory, formatSessionMemory, listSessionMemories } from "./session-memory.js";
import { buildGraph, renderGraph, detectCycles, formatCycles } from "./dep-graph-viz.js";
import { ApprovalQueue } from "./approval-queue.js";
import { compareLatestSnapshots, formatFleetDiff } from "./fleet-diff.js";
import { findTemplate, formatTemplateList, formatTemplateDetail } from "./session-templates.js";
import { scoreDifficulty, formatDifficultyScores } from "./difficulty-scorer.js";
import { generateNudge, buildNudgeContext, formatNudgePreview } from "./smart-nudge.js";
import { FleetUtilizationTracker } from "./fleet-utilization.js";
import { detectTemplate, formatDetectionResult } from "./template-detector.js";
import { searchFleet, formatFleetSearchResults } from "./fleet-search.js";
import { NudgeTracker } from "./nudge-tracker.js";
import { computeAllocation, formatAllocation } from "./difficulty-allocator.js";
import { ConfigWatcher, formatConfigChange } from "./config-watcher.js";
import { parseActionLogEntries, parseActivityEntries, mergeTimeline, filterByAge, parseDuration, formatTimelineJson, formatTimelineMarkdown, formatTaskExportJson, formatTaskExportMarkdown } from "./export.js";
import type { AoaoeConfig, Observation, TaskState } from "./types.js";
import { actionSession, actionDetail, toActionLogEntry } from "./types.js";
import { YELLOW, GREEN, DIM, BOLD, RED, RESET } from "./colors.js";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, chmodSync, unlinkSync, createWriteStream } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AOAOE_DIR = join(homedir(), ".aoaoe");
const INPUT_FILE = join(AOAOE_DIR, "pending-input.txt");
const TASK_RECONCILE_EVERY_POLLS = 6;
const DAEMON_TMUX_SESSION = "aoaoe-daemon";

async function attachToDaemon(): Promise<void> {
  // Check if daemon tmux session exists
  const check = execSync(`tmux has-session -t ${DAEMON_TMUX_SESSION} 2>/dev/null; echo $?`, { encoding: "utf-8" }).trim();
  if (check !== "0") {
    // No daemon running — start one, then attach
    const args = process.argv.slice(1).filter(a => a !== "attach").map(a => a.includes(" ") ? `"${a}"` : a).join(" ");
    const nodeCmd = `AOAOE_IN_TMUX=1 node ${process.argv[1]} ${args}`;
    execSync(`tmux new-session -d -s ${DAEMON_TMUX_SESSION} '${nodeCmd}'`);
  }
  execSync(`tmux attach -t ${DAEMON_TMUX_SESSION}`, { stdio: "inherit" });
}

// §MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  // §CLI ──────────────────────────────────────────────────────────────────
   const { overrides, help, version, register, testContext: isTestContext, runTest, showTasks, showTasksJson, runProgress, progressSince, progressJson, runHealth, healthJson, runSummary, runAdopt, adoptTemplate, showHistory, showStatus, runRunbook, runbookJson, runbookSection, runIncident, incidentSince, incidentLimit, incidentJson, incidentNdjson, incidentWatch, incidentChangesOnly, incidentHeartbeatSec, incidentIntervalMs, runSupervisor, supervisorAll, supervisorSince, supervisorLimit, supervisorJson, supervisorNdjson, supervisorWatch, supervisorChangesOnly, supervisorHeartbeatSec, supervisorIntervalMs, showConfig, configValidate, configDiff, notifyTest, runDoctor, runBackup, backupOutput, runRestore, restoreInput, runSync, syncAction, syncRemote, runWeb, webPort, runLogs, logsActions, logsGrep, logsCount, runExport, exportFormat, exportOutput, exportLast, runInit, initForce, runTaskCli: isTaskCli, runTail: isTail, tailFollow, tailCount, logFile, runStats: isStats, statsLast, runReplay: isReplay, replaySpeed, replayLast, registerTitle, runService, runAttach, runCompletions, completionsShell } = parseCliArgs(process.argv);

  // --log-file: redirect all output to a file (for background/daemon mode)
  if (logFile) {
    const logStream = createWriteStream(logFile, { flags: "a" });
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stderr.write = (chunk: any, ...args: any[]) => { logStream.write(chunk); return true; };
    process.stdout.write = (chunk: any, ...args: any[]) => { logStream.write(chunk); return true; };
    // keep console.error/log working — they write to stderr/stdout
    console.error(`[${new Date().toISOString()}] logging to ${logFile}`);
  }

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

  if (runService) {
    const lines = installService({ workingDir: process.cwd() });
    for (const l of lines) console.log(l);
    return;
  }

  if (runAttach) {
    await attachToDaemon();
    return;
  }

  if (runCompletions) {
    const { generateCompletion } = await import("./cli-completions.js");
    const shell = (completionsShell ?? "bash") as "bash" | "zsh" | "fish";
    console.log(generateCompletion(shell));
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

  // §TMUX-WRAP — run inside a named tmux session so `aoaoe attach` works.
  // Skip if: --log-file (background/service mode), or already wrapped.
  if (!logFile && !process.env.AOAOE_IN_TMUX) {
    const args = process.argv.slice(1).map(a => a.includes(" ") ? `"${a}"` : a).join(" ");
    const nodeCmd = `AOAOE_IN_TMUX=1 node ${process.argv[1]} ${args}`;
    try { execSync(`tmux kill-session -t ${DAEMON_TMUX_SESSION} 2>/dev/null`, { stdio: "ignore" }); } catch {}
    execSync(`tmux new-session -d -s ${DAEMON_TMUX_SESSION} '${nodeCmd}'`);
    execSync(`tmux attach -t ${DAEMON_TMUX_SESSION}`, { stdio: "inherit" });
    process.exit(0);
  }

  // §CONFIG ────────────────────────────────────────────────────────────────
  const configResult = loadConfig(overrides);
  const configPath = configResult._configPath;
  let config: AoaoeConfig = configResult; // strip _configPath from type for downstream (let: hot-reloaded)

  // acquire daemon lock — prevent two daemons from running simultaneously
  const lock = acquireLock();
  if (!lock.acquired) {
    console.error("");
    console.error(`  another aoaoe daemon is already running (pid ${lock.existingPid ?? "unknown"})`);
    console.error("  only one daemon can manage sessions at a time.");
    console.error(`  stop the other daemon first, or use: kill ${lock.existingPid ?? "<pid>"}`);
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
      console.error(`  try manually: opencode serve --port ${config.opencode.port}`);
      console.error(`  check log: ~/.aoaoe/opencode-serve.log`);
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

  // §MODULES ──────────────────────────────────────────────────────────────
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
  const fleetUtilizationTracker = new FleetUtilizationTracker();
  const nudgeTracker = new NudgeTracker();
  const observationCache = new ObservationCache();
  const fleetRateLimiter = new FleetRateLimiter();
  const recoveryPlaybookManager = new RecoveryPlaybookManager();
  const approvalQueue = new ApprovalQueue();
  const graduationManager = new GraduationManager();
  let activeWorkflow: WorkflowState | null = null;
  let activeWorkflowChain: WorkflowChain | null = null;
  const tokenQuotaManager = new TokenQuotaManager();
  const abReasoningTracker = new ABReasoningTracker(config.reasoner, "claude-code");
  const alertRules = defaultAlertRules();
  let activeRunbookExec: RunbookExecution | null = null;
  const sessionTagStore = createTagStore();
  const idleDetectorState = createIdleDetector();
  const sessionHealthHistory = new SessionHealthHistory();
  const costThrottleState = createThrottleState();
  const fleetEventBus = new FleetEventBus();
  const previousOutputs = new Map<string, string>(); // session -> last captured output for diff
  const heartbeatState = createHeartbeatState();
  let actionReplayState: ReplayState | null = null;
  const incrementalContextState = createIncrementalState();
  const daemonMetrics = new DaemonMetricsHistogram();
  const peerReviewState = createPeerReviewState();
  const warmStandbyState = createWarmStandby();
  const outputRedactor = new OutputRedactor();
  const daemonPluginHooks = new DaemonPluginHooks();
  const incidentTimeline = new FleetIncidentTimeline();
  const bookmarkState = createBookmarkState();
  const canaryState = createCanaryState();
  const configDiffState = createConfigDiffState();
  const capacityForecaster = new FleetCapacityForecaster();
  const watchdogState = createWatchdog();
  const costRegressionDetector = new FleetCostRegression();
  const cascadeState = createCascadeState();
  let eventReplayState: ReplayPlaybackState | null = null;
  const tickProfiler = new DaemonTickProfiler();
  const sessionGroupingState = createGroupingState();
  const contextDiffState = createContextDiffState();
  const snapshotCompressionState = createCompressionState();
  const outputAnnotationState = createAnnotationState();
  const processSupervisorState = createSupervisor();
  const hotSwapState = createHotSwapState();
  const progressPredictor = new GoalProgressPredictor();
  const patternEvolutionState = createEvolutionState();
  const alertDashboardState = createAlertDashboard();
  const goalSlaState = createSlaState();
  const autoScalerState = createAutoScaler();
  const xpState = createXPState();
  const startupProfiler = new DaemonStartupProfiler();
  const shutdownState = createShutdownState();
  const perfRegressionDetector = new DaemonPerfRegression();
  const progressHeatmapState = createProgressHeatmap();
  const costTrendTracker = new FleetCostTrend();
  const daemonEventStore = createEventStore();
  const daemonLock = createLockState();
  const utilForecaster = new FleetUtilizationForecaster();
  const timeMachineState = createTimeMachine();
  const tickBudgetState = createTickBudget();
  const goalMutationState = createMutationState();
  const affinityRouterState = createAffinityState();
  const apiRateLimiterState = createRateLimiter();
  const knowledgeStore = createKnowledgeStore();
  const webhookPushState = createWebhookPush();
  const auditRetentionState = createRetentionState();
  const resourceMonitorState = createResourceMonitor();
  const burndownStates = new Map<string, BurndownState>();
  const leakDetectorState = createLeakDetector();

  // checkpoint restore: load previous daemon state if available
  if (shouldRestoreCheckpoint()) {
    const cp = loadCheckpoint();
    if (cp) {
      // restore adaptive poll interval
      if (cp.pollInterval && cp.pollInterval !== config.pollIntervalMs) {
        // poll controller will naturally adjust, but log what was saved
      }
      const restoredSessions = Object.keys(cp.graduation).length;
      if (restoredSessions > 0) {
        audit("daemon_start", `restored checkpoint: ${restoredSessions} graduation states, cache ${cp.cacheStats.hits}/${cp.cacheStats.misses}`);
      }
    }
  }

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
    log(`initializing ${config.reasoner} reasoner...`);
    await reasoner.init();
    log(`${config.reasoner} reasoner ready`);
  }

  // clear startup summary so the user knows what to expect
  {
    const mode = config.observe ? "observe-only (no reasoning)" : config.dryRun ? "dry-run (reason but don't execute)" : "autonomous";
    const pollSec = Math.round(config.pollIntervalMs / 1000);
    const reasonSec = Math.round(config.reasonIntervalMs / 1000);
    const summary = [
      `aoaoe v${pkg ?? "?"} — ${mode} mode`,
      `  poll: every ${pollSec}s | reason: every ${reasonSec}s | backend: ${config.reasoner}`,
    ];
    if (config.apiPort) summary.push(`  API: http://127.0.0.1:${config.apiPort}/api/v1`);
    if (config.healthPort) summary.push(`  health: http://127.0.0.1:${config.healthPort}/health`);
    summary.push(`  config: ${configPath} (hot-reloaded on change)`);
    summary.push(`  type /help for commands, ESC ESC to interrupt`);
    for (const line of summary) {
      if (tui) tui.log("system", line); else log(line);
    }
    // surface config warnings that were printed to stderr before TUI started
    if (configWarnings.length > 0) {
      for (const w of configWarnings) {
        if (tui) tui.log("error", `config: ${w}`); else console.error(`[config] ${w}`);
      }
    }
  }

  // restore aliases from sticky prefs
  if (tui) {
    const prefs = loadTuiPrefs();
    if (prefs.aliases) input.setAliases(prefs.aliases);
  }

  // start interactive input listener and conversation log
  input.start();
  await reasonerConsole.start();

  // §TUI-COMMANDS ─────────────────────────────────────────────────────────
  // ~3,600 lines of input.on*() handler wiring for all 197 TUI slash commands.
  // each handler closes over the module instances above. search for a specific
  // command by name, e.g. "onBurndown" or "onTopology".
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
    // wire /memory — session memory viewer
    input.onMemory((target) => {
      const memory = loadSessionMemory(target);
      const lines = formatSessionMemory(memory);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /dep-graph — dependency graph visualization
    input.onDepGraph(() => {
      const tasks = taskManager?.tasks ?? [];
      const nodes = buildGraph(tasks);
      const lines = renderGraph(nodes);
      for (const line of lines) tui!.log("system", line);
      const cycles = detectCycles(tasks);
      const cycleLines = formatCycles(cycles);
      for (const line of cycleLines) tui!.log("system", line);
    });
    // wire /approvals — approval queue viewer
    input.onApprovalQueue(() => {
      const lines = approvalQueue.formatQueue();
      for (const line of lines) tui!.log("system", line);
    });
    // wire /approve — approve pending decision
    input.onApprove((target) => {
      if (target === "all") {
        const count = approvalQueue.approveAll();
        tui!.log("system", `approved ${count} pending decision${count !== 1 ? "s" : ""}`);
      } else {
        const ok = approvalQueue.approve(target);
        tui!.log("system", ok ? `approved: ${target}` : `not found: ${target}`);
      }
    });
    // wire /reject — reject pending decision
    input.onReject((target) => {
      if (target === "all") {
        const count = approvalQueue.rejectAll();
        tui!.log("system", `rejected ${count} pending decision${count !== 1 ? "s" : ""}`);
      } else {
        const ok = approvalQueue.reject(target);
        tui!.log("system", ok ? `rejected: ${target}` : `not found: ${target}`);
      }
    });
    // wire /fleet-diff — compare latest fleet snapshots
    input.onFleetDiff(() => {
      const result = compareLatestSnapshots();
      if (!result) { tui!.log("system", "fleet-diff: need at least 2 fleet snapshots"); return; }
      const lines = formatFleetDiff(result);
      for (const line of lines) tui!.log("system", line);
    });
    // wire /template — session template viewer
    input.onSessionTemplate((name) => {
      if (!name) { const lines = formatTemplateList(); for (const l of lines) tui!.log("system", l); return; }
      const tmpl = findTemplate(name);
      if (!tmpl) { tui!.log("system", `template not found: ${name}`); const lines = formatTemplateList(); for (const l of lines) tui!.log("system", l); return; }
      const lines = formatTemplateDetail(tmpl);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /difficulty — task difficulty scores
    input.onDifficulty(() => {
      const tasks = taskManager?.tasks ?? [];
      if (tasks.length === 0) { tui!.log("system", "difficulty: no tasks"); return; }
      const scores = tasks.map((t) => {
        const elapsed = t.createdAt ? Date.now() - t.createdAt : 0;
        return scoreDifficulty(t.sessionTitle, t.goal, t.progress.length, elapsed);
      });
      const lines = formatDifficultyScores(scores);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /smart-nudge — preview context-aware nudge
    input.onSmartNudge((target) => {
      const tasks = taskManager?.tasks ?? [];
      const task = tasks.find((t) => t.sessionTitle.toLowerCase() === target.toLowerCase());
      if (!task) { tui!.log("system", `smart-nudge: task not found: ${target}`); return; }
      const summary = sessionSummarizer.get(task.sessionTitle);
      const activity = summary ? SessionSummarizer.format(summary) : undefined;
      const lastChange = tui!.getAllLastChangeAt().get(tui!.getSessions().find((s) => s.title === task.sessionTitle)?.id ?? "");
      const idleMs = lastChange ? Date.now() - lastChange : 0;
      const ctx = buildNudgeContext(task, activity, idleMs);
      const nudge = generateNudge(ctx);
      const lines = formatNudgePreview(task.sessionTitle, nudge);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /utilization — fleet utilization heatmap
    input.onUtilization(() => {
      const lines = fleetUtilizationTracker.formatHeatmap();
      for (const l of lines) tui!.log("system", l);
    });
    // wire /detect-template — infer template from session's repo files
    input.onDetectTemplate((target) => {
      // use session's path to list files (simplified: use lastActivity as proxy)
      const sessions = tui!.getSessions();
      const session = sessions.find((s) => s.title.toLowerCase() === target.toLowerCase());
      if (!session) { tui!.log("system", `detect-template: session not found: ${target}`); return; }
      // use whatever file hints we can get from the session path
      const path = session.path ?? "";
      const fileHints = path.split("/").filter(Boolean); // minimal — in practice would readdir
      const result = detectTemplate(fileHints);
      const lines = formatDetectionResult(session.title, result);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /fleet-search — search all session outputs
    input.onFleetSearch((query) => {
      const sessions = tui!.getSessions();
      const outputs = new Map<string, { title: string; lines: string[] }>();
      for (const s of sessions) {
        const sessionLines = tui!.getSessionOutput(s.id) ?? [];
        outputs.set(s.id, { title: s.title, lines: sessionLines });
      }
      const result = searchFleet(outputs, query);
      const lines = formatFleetSearchResults(result);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /nudge-stats — nudge effectiveness
    input.onNudgeStats(() => {
      const lines = nudgeTracker.formatReport();
      for (const l of lines) tui!.log("system", l);
    });
    // wire /allocation — difficulty-based resource allocation
    input.onAllocation(() => {
      const tasks = taskManager?.tasks ?? [];
      if (tasks.length === 0) { tui!.log("system", "allocation: no tasks"); return; }
      const scores = tasks.map((t) => {
        const elapsed = t.createdAt ? Date.now() - t.createdAt : 0;
        return scoreDifficulty(t.sessionTitle, t.goal, t.progress.length, elapsed);
      });
      const poolStatus = sessionPoolManager.getStatus(tasks);
      const results = computeAllocation(scores, poolStatus.maxConcurrent);
      const lines = formatAllocation(results);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /graduation — session trust graduation states
    input.onGraduation(() => {
      const lines = graduationManager.formatAll();
      for (const l of lines) tui!.log("system", l);
    });
    // wire /refine — goal refinement suggestions
    input.onRefine((target) => {
      const tasks = taskManager?.tasks ?? [];
      const task = tasks.find((t) => t.sessionTitle.toLowerCase() === target.toLowerCase());
      if (!task) { tui!.log("system", `refine: task not found: ${target}`); return; }
      const patterns = analyzeCompletedTasks(tasks);
      const refinement = refineGoal(task.goal, patterns);
      const lines = formatGoalRefinement(refinement);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /export — generate fleet HTML report
    input.onExport(() => {
      const sessions = tui!.getSessions();
      const tasks = taskManager?.tasks ?? [];
      const data = buildReportData(sessions, tasks, pkg ?? "dev");
      const html = generateHtmlReport(data);
      const { writeFileSync } = require("node:fs");
      const { join } = require("node:path");
      const { homedir } = require("node:os");
      const filepath = join(homedir(), ".aoaoe", `fleet-report-${new Date().toISOString().slice(0, 10)}.html`);
      writeFileSync(filepath, html);
      tui!.log("system", `fleet report exported: ${filepath}`);
    });
    // wire /service — generate systemd/launchd service file
    input.onService(() => {
      const lines = installService({ workingDir: process.cwd() });
      for (const l of lines) tui!.log("system", l);
    });
    // wire /session-replay — session activity timeline replay
    input.onSessionReplay((target) => {
      const replay = buildSessionReplay(target);
      if (replay.events.length === 0) {
        tui!.log("system", `replay: no events for "${target}" — run the daemon to generate audit data first`);
        return;
      }
      const summary = summarizeReplay(replay);
      for (const l of summary) tui!.log("system", l);
      tui!.log("system", "");
      const detailed = formatReplay(replay);
      for (const l of detailed) tui!.log("system", l);
    });
    // wire /workflow — show active workflow state
    input.onWorkflow(() => {
      if (!activeWorkflow) {
        tui!.log("system", "workflow: no active workflow (define one in aoaoe.tasks.json with workflow stages)");
        return;
      }
      const lines = formatWorkflow(activeWorkflow);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /multi-reasoner — show reasoner assignments
    input.onMultiReasoner(() => {
      const sessions = tui!.getSessions();
      const sessionInfos = sessions.map((s) => ({ title: s.title, template: undefined as string | undefined, difficultyScore: undefined as number | undefined }));
      const assignments = assignReasonerBackends(sessionInfos, { defaultBackend: config.reasoner as any });
      const lines = formatAssignments(assignments);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /token-quota — per-model token quotas
    input.onTokenQuota(() => {
      const lines = tokenQuotaManager.formatAll();
      for (const l of lines) tui!.log("system", l);
    });
    // wire /checkpoint — show checkpoint info
    input.onCheckpoint(() => {
      const lines = formatCheckpointInfo();
      for (const l of lines) tui!.log("system", l);
    });
    // wire /workflow-new — create workflow from template
    input.onWorkflowNew((args) => {
      const parts = args.split(/\s+/);
      const templateName = parts[0];
      const prefix = parts[1] ?? "wf";
      const template = findWorkflowTemplate(templateName);
      if (!template) {
        tui!.log("system", `workflow-new: template "${templateName}" not found`);
        const lines = formatWorkflowTemplateList();
        for (const l of lines) tui!.log("system", l);
        return;
      }
      const def = instantiateWorkflow(template, prefix);
      // show cost forecast before creating
      const forecast = forecastWorkflowCost(def);
      const forecastLines = formatWorkflowCostForecast(forecast);
      for (const l of forecastLines) tui!.log("system", l);
      activeWorkflow = createWorkflowState(def);
      tui!.log("+ action", `workflow "${def.name}" created from template "${templateName}" (${def.stages.length} stages)`);
      audit("task_created", `workflow created: ${def.name} from ${templateName}`, undefined, { stages: def.stages.length });
      const lines = formatWorkflow(activeWorkflow);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /ab-stats — A/B reasoning statistics
    input.onABStats(() => {
      const lines = abReasoningTracker.formatStats();
      for (const l of lines) tui!.log("system", l);
    });
    // wire /workflow-chain — show active workflow chain
    input.onWorkflowChain(() => {
      if (!activeWorkflowChain) {
        tui!.log("system", "workflow-chain: no active chain");
        return;
      }
      const lines = formatWorkflowChain(activeWorkflowChain);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /workflow-forecast — preview cost estimate for a template
    input.onWorkflowForecast((templateName) => {
      const template = findWorkflowTemplate(templateName);
      if (!template) {
        tui!.log("system", `workflow-forecast: template "${templateName}" not found`);
        return;
      }
      const def = instantiateWorkflow(template, "preview");
      const forecast = forecastWorkflowCost(def);
      const lines = formatWorkflowCostForecast(forecast);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /federation — multi-host fleet overview
    input.onFederation(() => {
      // in practice, would fetch from configured peers; show local state as single peer
      const sessions = tui!.getSessions();
      const tasks = taskManager?.tasks ?? [];
      const scores = sessions.map((s) => s.status === "working" || s.status === "running" ? 80 : s.status === "error" ? 20 : 50);
      const health = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 100;
      let cost = 0;
      for (const s of sessions) { const m = s.costStr?.match(/\$(\d+(?:\.\d+)?)/); if (m) cost += parseFloat(m[1]); }
      const localState: FederatedFleetState = { peer: "local", sessions: sessions.length, activeTasks: tasks.filter((t) => t.status === "active").length, fleetHealth: health, totalCostUsd: cost, lastUpdatedAt: Date.now() };
      const overview = aggregateFederation([localState]);
      const lines = formatFederationOverview(overview);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /archives — show output archive list
    input.onArchives(() => {
      const lines = formatArchiveList();
      for (const l of lines) tui!.log("system", l);
    });
    // wire /runbook-gen — generate runbooks from audit trail
    input.onRunbookGen(() => {
      const runbooks = generateRunbooks();
      const lines = formatGeneratedRunbooks(runbooks);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /alert-rules — show alert rules and their status
    input.onAlertRules(() => {
      const lines = formatAlertRules(alertRules);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /tail — live tail of session output
    input.onSessionTail((args) => {
      const opts = parseTailArgs(args);
      const sessions = tui!.getSessions();
      const session = sessions.find((s) => s.title.toLowerCase() === opts.sessionTitle.toLowerCase());
      if (!session) { tui!.log("system", `tail: session not found: ${opts.sessionTitle}`); return; }
      const output = tui!.getSessionOutput(session.id) ?? [];
      const tailed = tailSession(output, opts);
      const lines = formatTail(session.title, tailed, output.length);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /health-forecast — predict fleet health trend
    input.onHealthForecast(() => {
      // build health samples from SLA monitor history (simplified: use current fleet health)
      const sessions = tui!.getSessions();
      const scores = sessions.map((s) => s.status === "working" || s.status === "running" ? 80 : s.status === "error" ? 20 : 50);
      const currentHealth = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 100;
      // build a simple 3-sample history from current tick
      const now = Date.now();
      const samples = [
        { timestamp: now - 2 * 60_000, health: currentHealth + Math.round(Math.random() * 4 - 2) },
        { timestamp: now - 60_000, health: currentHealth + Math.round(Math.random() * 2 - 1) },
        { timestamp: now, health: currentHealth },
      ];
      const forecast = forecastHealth(samples);
      if (!forecast) { tui!.log("system", "health-forecast: insufficient data"); return; }
      const lines = formatHealthForecast(forecast);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /workflow-viz — ASCII DAG visualization
    input.onWorkflowViz(() => {
      if (activeWorkflow) {
        const lines = renderWorkflowDag(activeWorkflow);
        for (const l of lines) tui!.log("system", l);
      }
      if (activeWorkflowChain) {
        const lines = renderChainDag(activeWorkflowChain);
        for (const l of lines) tui!.log("system", l);
      }
      if (!activeWorkflow && !activeWorkflowChain) {
        tui!.log("system", "workflow-viz: no active workflow or chain");
      }
    });
    // wire /metrics — Prometheus metrics snapshot
    input.onMetrics(() => {
      const sessions = tui!.getSessions();
      const tasks = taskManager?.tasks ?? [];
      const scores = sessions.map((s) => s.status === "working" || s.status === "running" ? 80 : s.status === "error" ? 20 : 50);
      const health = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 100;
      let cost = 0;
      for (const s of sessions) { const m = s.costStr?.match(/\$(\d+(?:\.\d+)?)/); if (m) cost += parseFloat(m[1]); }
      const cacheStats = observationCache.getStats();
      const reasonerStats = reasonerCostTracker.getSummary();
      const nudgeReport = nudgeTracker.getReport();
      const snapshot = buildMetricsSnapshot({
        fleetHealth: health, totalSessions: sessions.length,
        activeSessions: sessions.filter((s) => s.status === "working" || s.status === "running").length,
        errorSessions: sessions.filter((s) => s.status === "error").length,
        totalTasks: tasks.length, activeTasks: tasks.filter((t) => t.status === "active").length,
        completedTasks: tasks.filter((t) => t.status === "completed").length,
        failedTasks: tasks.filter((t) => t.status === "failed").length,
        totalCostUsd: cost, reasonerCallsTotal: reasonerStats.totalCalls,
        reasonerCostTotal: reasonerStats.totalCostUsd,
        cacheHits: cacheStats.totalHits, cacheMisses: cacheStats.totalMisses,
        nudgesSent: nudgeReport.totalNudges, nudgesEffective: nudgeReport.effectiveNudges,
        pollIntervalMs: adaptivePollController.intervalMs,
        uptimeMs: Date.now() - daemonStartedAt,
      });
      const text = formatPrometheusMetrics(snapshot);
      for (const l of text.split("\n").filter(Boolean)) tui!.log("system", l);
    });
    // wire /fleet-grep — search archived outputs
    input.onFleetGrep((pattern) => {
      const result = grepArchives(pattern);
      const lines = formatGrepResult(result);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /runbook-exec — execute/advance runbook
    input.onRunbookExec(() => {
      if (!activeRunbookExec) {
        const runbooks = generateRunbooks();
        if (runbooks.length === 0) { tui!.log("system", "runbook-exec: no runbooks to execute (need audit data)"); return; }
        activeRunbookExec = createExecution(runbooks[0]);
        tui!.log("+ action", `runbook-exec: starting "${runbooks[0].title}"`);
      }
      const step = advanceExecution(activeRunbookExec);
      if (step) {
        tui!.log("system", `runbook-exec: executing step — ${step.action}: ${step.detail}`);
      } else {
        const lines = formatExecution(activeRunbookExec);
        for (const l of lines) tui!.log("system", l);
        activeRunbookExec = null;
      }
    });
    // wire /clone — clone a session
    input.onClone((args) => {
      const parts = args.split(/\s+/);
      const [sourceTitle, cloneTitle, ...goalParts] = parts;
      if (!sourceTitle || !cloneTitle) { tui!.log("system", "clone: usage: /clone <source> <new-name> [goal]"); return; }
      const tasks = taskManager?.tasks ?? [];
      const source = tasks.find((t) => t.sessionTitle.toLowerCase() === sourceTitle.toLowerCase());
      if (!source) { tui!.log("system", `clone: source "${sourceTitle}" not found`); return; }
      const goalOverride = goalParts.length > 0 ? goalParts.join(" ") : undefined;
      const def = cloneSession(source, { sourceTitle, cloneTitle, goalOverride });
      tui!.log("+ action", `cloned "${sourceTitle}" → "${cloneTitle}"`);
      const lines = formatCloneResult({ original: sourceTitle, clone: cloneTitle, goal: def.goal as string, tool: def.tool ?? "opencode" });
      for (const l of lines) tui!.log("system", l);
    });
    // wire /similar-goals — find overlapping goals
    input.onSimilarGoals(() => {
      const tasks = taskManager?.tasks ?? [];
      const pairs = findSimilarGoals(tasks);
      const lines = formatSimilarGoals(pairs);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /cost-tags — group costs by tag
    input.onCostTags((tagKey) => {
      const tasks = taskManager?.tasks ?? [];
      const sessions = tui!.getSessions();
      const tagged = tasks.map((t) => {
        const s = sessions.find((s) => s.title === t.sessionTitle);
        let cost = 0;
        if (s?.costStr) { const m = s.costStr.match(/\$(\d+(?:\.\d+)?)/); if (m) cost = parseFloat(m[1]); }
        return { sessionTitle: t.sessionTitle, tags: parseTags((t as any).tags ?? ""), costUsd: cost };
      });
      const report = groupByTag(tagged, tagKey);
      const lines = formatTagReport(report);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /scaling — predictive pool scaling
    input.onScaling(() => {
      const tasks = taskManager?.tasks ?? [];
      const poolStatus = sessionPoolManager.getStatus(tasks);
      const activeSessions = poolStatus.activeCount;
      const pendingTasks = poolStatus.pendingCount;
      const utilPct = poolStatus.maxConcurrent > 0 ? Math.round((activeSessions / poolStatus.maxConcurrent) * 100) : 0;
      const rec = recommendScaling({
        currentPoolSize: poolStatus.maxConcurrent,
        activeSessions, pendingTasks,
        recentUtilizationPct: utilPct, peakUtilizationPct: utilPct,
        averageTaskDurationMs: 3_600_000,
      });
      const lines = formatScalingRecommendation(rec);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /session-diff — show recent session output changes
    input.onSessionDiff((args) => {
      const sessionTitle = args.trim();
      const sessions = tui!.getSessions();
      const session = sessions.find((s) => s.title.toLowerCase() === sessionTitle.toLowerCase());
      if (!session) { tui!.log("system", `session-diff: "${sessionTitle}" not found`); return; }
      const output = tui!.getSessionOutput(session.id) ?? [];
      // show last 20 lines as recent output
      const recent = output.slice(-20);
      tui!.log("system", `session-diff: "${session.title}" last ${recent.length} lines:`);
      for (const l of recent) tui!.log("system", `  ${l.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").slice(0, 120)}`);
    });
    // wire /session-tag — set/show session tags
    input.onSessionTag((args) => {
      const parts = args.split(/\s+/);
      if (parts.length === 0 || !parts[0]) {
        const lines = formatTagStore(sessionTagStore);
        for (const l of lines) tui!.log("system", l);
        return;
      }
      if (parts.length >= 3) {
        // /tag <session> <key>=<value>
        const [sessionTitle, ...tagParts] = parts;
        for (const tp of tagParts) {
          const [k, ...v] = tp.split("=");
          if (k && v.length > 0) setTag(sessionTagStore, sessionTitle, k, v.join("="));
        }
        tui!.log("system", `tag: updated tags for "${sessionTitle}"`);
      } else {
        const lines = formatTagStore(sessionTagStore);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /compare — side-by-side session comparison
    input.onCompare((args) => {
      const [titleA, titleB] = args.split(/\s+/);
      if (!titleA || !titleB) { tui!.log("system", "compare: usage: /compare <session-a> <session-b>"); return; }
      const sessions = tui!.getSessions();
      const tasks = taskManager?.tasks ?? [];
      const sA = sessions.find((s) => s.title.toLowerCase() === titleA.toLowerCase());
      const sB = sessions.find((s) => s.title.toLowerCase() === titleB.toLowerCase());
      if (!sA || !sB) { tui!.log("system", `compare: session not found`); return; }
      const tA = tasks.find((t) => t.sessionTitle === sA.title);
      const tB = tasks.find((t) => t.sessionTitle === sB.title);
      const cmp = compareSessions({ session: sA, task: tA }, { session: sB, task: tB });
      const lines = formatComparison(cmp);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /fleet-report — compact text summary for Slack/clipboard
    input.onFleetReport(() => {
      const sessions = tui!.getSessions();
      const tasks = taskManager?.tasks ?? [];
      const summary = buildFleetSummary(sessions, tasks);
      const lines = formatFleetSummaryTui(summary);
      for (const l of lines) tui!.log("system", l);
      tui!.log("system", `  (copy text: ${formatFleetSummaryText(summary).replace(/\n/g, " | ")})`);
    });
    // wire /task-timeline — session event timeline
    input.onTaskTimeline((target) => {
      const tasks = taskManager?.tasks ?? [];
      const task = tasks.find((t) => t.sessionTitle.toLowerCase() === target.toLowerCase());
      if (!task) { tui!.log("system", `timeline: "${target}" not found`); return; }
      const events = buildTimeline(task);
      const lines = formatTimeline(task.sessionTitle, events);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /changelog — fleet event changelog
    input.onChangelog((args) => {
      const durationStr = args.trim() || "1h";
      const match = durationStr.match(/^(\d+)(m|h|d)$/);
      let sinceMs = Date.now() - 3_600_000; // default 1h
      if (match) {
        const n = parseInt(match[1], 10);
        const unit = match[2];
        const ms = unit === "d" ? n * 86_400_000 : unit === "h" ? n * 3_600_000 : n * 60_000;
        sinceMs = Date.now() - ms;
      }
      const entries = generateChangelog(sinceMs);
      const lines = formatChangelog(entries, durationStr);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /idle-detect — show idle session alerts
    input.onIdleDetect(() => {
      const sessions = tui!.getSessions();
      const activeTitles = sessions.filter((s) => s.status === "working" || s.status === "running").map((s) => s.title);
      // record activity for sessions that have recent output changes
      for (const s of sessions) {
        if (s.status === "working" || s.status === "running") {
          recordActivity(idleDetectorState, s.title);
        }
      }
      const idles = detectIdleSessions(idleDetectorState, activeTitles);
      const lines = formatIdleAlerts(idles);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /goal-conflicts — detect conflicting goals across sessions
    input.onGoalConflicts2(() => {
      const tasks = taskManager?.tasks ?? [];
      const goalInfos: GoalInfo[] = tasks.filter((t) => t.status === "active").map((t) => ({
        sessionTitle: t.sessionTitle,
        goal: t.goal,
        repo: t.repo,
      }));
      const deps = new Map<string, string[]>();
      for (const t of tasks) {
        if (t.dependsOn && t.dependsOn.length > 0) deps.set(t.sessionTitle, t.dependsOn);
      }
      const conflicts = detectGoalConflicts(goalInfos, deps);
      const lines = formatGoalConflicts(conflicts);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /leaderboard — fleet productivity rankings
    input.onLeaderboard(() => {
      const tasks = taskManager?.tasks ?? [];
      const inputs: LeaderboardInput[] = [];
      const sessionTitles = new Set(tasks.map((t) => t.sessionTitle));
      for (const title of sessionTitles) {
        const sessionTasks = tasks.filter((t) => t.sessionTitle === title);
        const completed = sessionTasks.filter((t) => t.status === "completed").length;
        const total = sessionTasks.length;
        // get velocity from progress velocity tracker if available
        const vel = progressVelocityTracker.estimate(title);
        const costStr = tui!.getAllSessionCosts().get(title) ?? "0";
        const costUsd = parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0;
        inputs.push({ sessionTitle: title, completedTasks: completed, totalTasks: total, velocityPctPerHr: vel?.velocityPerHour ?? 0, costUsd });
      }
      const board = computeLeaderboard(inputs);
      const lines = formatLeaderboard(board);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /health-history — per-session health score sparklines
    input.onHealthHistory(() => {
      const trends = sessionHealthHistory.getAllTrends();
      const lines = formatHealthHistory(trends);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /cost-throttle — cost anomaly throttle state
    input.onCostThrottle(() => {
      const sessions = tui!.getSessions();
      const activeTitles = sessions.filter((s) => s.status === "working" || s.status === "running").map((s) => s.title);
      const results = evaluateThrottles(costThrottleState, activeTitles);
      const lines = formatThrottleState(results);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /suggest-name — smart session name suggestions
    input.onSuggestName((args) => {
      const parts = args.split(/\s+/);
      const repoPath = parts[0] ?? "";
      const goal = parts.slice(1).join(" ") || "";
      const sessions = tui!.getSessions();
      const existingTitles = sessions.map((s) => s.title);
      const suggestions = suggestSessionNames(repoPath, goal, existingTitles);
      const lines = formatNameSuggestions(suggestions);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /handoff — operator shift handoff notes
    input.onShiftHandoff(() => {
      const tasks = taskManager?.tasks ?? [];
      const sessions = tui!.getSessions();
      const healthScores = new Map<string, number>();
      for (const s of sessions) healthScores.set(s.title, s.status === "working" ? 80 : s.status === "error" ? 20 : 50);
      const costMap = new Map<string, number>();
      const allCosts = tui!.getAllSessionCosts();
      for (const [title, costStr] of allCosts) costMap.set(title, parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0);
      const pendingApprovals = approvalQueue.getPending().map((p) => `${p.sessionTitle}: ${p.detail}`);
      const handoff = buildShiftHandoff(tasks, healthScores, costMap, [], pendingApprovals);
      const lines = formatHandoffTui(handoff);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /auto-deps — auto-detect inter-session dependencies
    input.onAutoDeps(() => {
      const tasks = taskManager?.tasks ?? [];
      const depSessions: DepSessionInfo[] = tasks.filter((t) => t.status === "active" || t.status === "pending").map((t) => ({
        title: t.sessionTitle,
        repo: t.repo,
        goal: t.goal,
        dependsOn: t.dependsOn,
      }));
      const deps = detectDependencies(depSessions);
      const lines = formatDetectedDeps(deps);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /cost-forecast — proactive cost forecast alerts
    input.onCostForecast(() => {
      const tasks = taskManager?.tasks ?? [];
      const allCosts = tui!.getAllSessionCosts();
      const projections = tasks.filter((t) => t.status === "active").map((t) => {
        const costStr = allCosts.get(t.sessionTitle) ?? "0";
        const costUsd = parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0;
        const burnRate = costThrottleState.burnRates.get(t.sessionTitle) ?? 0;
        return projectCosts(t.sessionTitle, costUsd, burnRate);
      });
      const alerts = evaluateCostAlerts(projections);
      const alertLines = formatCostForecastAlerts(alerts);
      const projLines = formatCostProjections(projections);
      for (const l of alertLines) tui!.log("system", l);
      for (const l of projLines) tui!.log("system", l);
    });
    // wire /event-bus — show fleet event bus state
    input.onEventBus(() => {
      const lines = formatEventBus(fleetEventBus);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /verify-goals — double-check completed goals for regressions
    input.onVerifyGoals(() => {
      const tasks = taskManager?.tasks ?? [];
      const recentlyCompleted = tasks.filter((t) => t.status === "completed" && t.completedAt && Date.now() - t.completedAt < 3_600_000);
      if (recentlyCompleted.length === 0) { tui!.log("system", "verify-goals: no recently completed tasks (last 1h)"); return; }
      const results = recentlyCompleted.map((t) => {
        const output = tui!.getSessionOutput(t.sessionId ?? "") ?? [];
        return verifyCompletion(t.sessionTitle, t.goal, output.join("\n"));
      });
      const lines = formatVerification(results);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /output-diff — show line-level diff for a session
    input.onOutputDiff((target) => {
      const sessions = tui!.getSessions();
      const session = sessions.find((s) => s.title.toLowerCase() === target.toLowerCase());
      if (!session) { tui!.log("system", `output-diff: "${target}" not found`); return; }
      const currentOutput = (tui!.getSessionOutput(session.id) ?? []).join("\n");
      const prevOutput = previousOutputs.get(session.title) ?? "";
      const diff = computeOutputDiff(session.title, prevOutput, currentOutput);
      previousOutputs.set(session.title, currentOutput);
      const lines = formatOutputDiff(diff);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /heartbeat — session liveness monitoring
    input.onHeartbeat(() => {
      const sessions = tui!.getSessions();
      const activeTitles = sessions.filter((s) => s.status === "working" || s.status === "running").map((s) => s.title);
      // record current output hashes
      for (const s of sessions) {
        const output = (tui!.getSessionOutput(s.id) ?? []).join("");
        const hash = output.length.toString(36) + output.slice(-100); // cheap hash
        recordHeartbeat(heartbeatState, s.title, hash);
      }
      const hbs = evaluateHeartbeats(heartbeatState, activeTitles);
      const lines = formatHeartbeats(hbs);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /replay — action replay debugger
    input.onActionReplay((args) => {
      const subcmd = args.split(/\s+/)[0] ?? "stats";
      // lazy-load replay state from action log
      if (!actionReplayState) {
        try {
          const logPath = resolve(homedir(), ".aoaoe", "actions.log");
          const content = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
          const logLines = content.split("\n").filter(Boolean);
          actionReplayState = buildReplayState(logLines);
        } catch { actionReplayState = buildReplayState([]); }
      }
      if (subcmd === "stats") {
        const lines = formatReplayStats(actionReplayState);
        for (const l of lines) tui!.log("system", l);
      } else if (subcmd === "next" || subcmd === "forward") {
        const entry = step(actionReplayState, "forward");
        const lines = formatReplayEntry(entry, actionReplayState.entries.length);
        for (const l of lines) tui!.log("system", l);
      } else if (subcmd === "prev" || subcmd === "backward") {
        const entry = step(actionReplayState, "backward");
        const lines = formatReplayEntry(entry, actionReplayState.entries.length);
        for (const l of lines) tui!.log("system", l);
      } else if (/^\d+$/.test(subcmd)) {
        const entry = seekTo(actionReplayState, parseInt(subcmd, 10));
        const lines = formatReplayEntry(entry, actionReplayState.entries.length);
        for (const l of lines) tui!.log("system", l);
      } else {
        const filtered = filterBySession(actionReplayState, subcmd);
        tui!.log("system", `replay: filtered to "${subcmd}" — ${filtered.length} ticks`);
        const entry = currentEntry(actionReplayState);
        const lines = formatReplayEntry(entry, actionReplayState.entries.length);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /profiles — fleet config profiles
    input.onConfigProfiles((args) => {
      const subcmd = args.trim();
      if (!subcmd) {
        const profiles = listProfiles();
        const lines = formatProfileList(profiles);
        for (const l of lines) tui!.log("system", l);
      } else {
        const profile = getProfile(subcmd);
        if (profile) {
          const lines = formatProfileDetail(profile);
          for (const l of lines) tui!.log("system", l);
        } else {
          tui!.log("system", `profiles: "${subcmd}" not found (try: dev, ci, incident, conservative, overnight)`);
        }
      }
    });
    // wire /doctor — daemon self-diagnostics
    input.onDoctor(() => {
      const sessions = tui!.getSessions();
      const report = runDiagnostics({
        reasonerBackend: config.reasoner,
        pollIntervalMs: config.pollIntervalMs,
        sessionCount: sessions.length,
        uptimeMs: Date.now() - daemonStartedAt,
        tickCount: pollCount,
      });
      const lines = formatDiagnostics(report);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /state-machine — session lifecycle state machine
    input.onStateMachine((args) => {
      const currentState = args.trim() as SMState | undefined;
      if (args.includes("→") || args.includes("->")) {
        const parts = args.replace("→", "->").split("->");
        const from = parts[0].trim() as SMState;
        const to = parts[1].trim() as SMState;
        const result = canTransition(from, to);
        const lines = formatTransitionResult(result);
        for (const l of lines) tui!.log("system", l);
      } else {
        const lines = formatStateMachine(currentState || undefined);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /context-stats — incremental context loading stats
    input.onContextStats(() => {
      const lines = formatIncrementalContext(incrementalContextState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /metrics-hist — daemon latency histogram
    input.onMetricsHist(() => {
      const lines = formatMetricsHistogram(daemonMetrics);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /peer-review — manage peer reviews
    input.onPeerReview((args) => {
      const parts = args.split(/\s+/);
      const subcmd = parts[0] ?? "";
      if (subcmd === "approve" || subcmd === "reject") {
        const id = parseInt(parts[1] ?? "0", 10);
        const feedback = parts.slice(2).join(" ") || undefined;
        const result = resolveReview(peerReviewState, id, subcmd === "approve" ? "approved" : "rejected", feedback);
        if (result) tui!.log("system", `peer-review: #${id} ${result.status}`);
        else tui!.log("system", `peer-review: #${id} not found or already resolved`);
      } else if (subcmd === "request" && parts.length >= 3) {
        const reviewer = parts[1];
        const target = parts[2];
        const tasks = taskManager?.tasks ?? [];
        const task = tasks.find((t) => t.sessionTitle.toLowerCase() === target.toLowerCase());
        const goal = task?.goal ?? "unknown";
        const output = (tui!.getSessionOutput(task?.sessionId ?? "") ?? []).join("\n");
        const review = requestReview(peerReviewState, reviewer, target, goal, output);
        tui!.log("system", `peer-review: created #${review.id} (${target} → ${reviewer})`);
      } else {
        expireStaleReviews(peerReviewState);
        const lines = formatPeerReviews(peerReviewState);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /warm-standby — manage warm slots
    input.onWarmStandby((args) => {
      const parts = args.split(/\s+/);
      const subcmd = parts[0] ?? "";
      if (subcmd === "warm" && parts[1]) {
        const repo = parts[1];
        const slot = warmSlot(warmStandbyState, repo, []);
        if (slot) tui!.log("system", `warm-standby: slot #${slot.id} warmed for ${repo}`);
        else tui!.log("system", "warm-standby: pool full");
      } else if (subcmd === "claim" && parts[1] && parts[2]) {
        const slot = claimSlot(warmStandbyState, parts[1], parts[2]);
        if (slot) tui!.log("system", `warm-standby: slot #${slot.id} claimed by ${parts[2]}`);
        else tui!.log("system", `warm-standby: no warm slot for ${parts[1]}`);
      } else {
        const lines = formatWarmStandby(warmStandbyState);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /redaction-stats — output redaction stats
    input.onRedactionStats(() => {
      const lines = formatRedactionStats(outputRedactor);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /compliance — fleet compliance check
    input.onCompliance(() => {
      const tasks = taskManager?.tasks ?? [];
      const sessions = tui!.getSessions();
      const allCosts = tui!.getAllSessionCosts();
      const compSessions: SessionForCompliance[] = tasks.map((t) => {
        const costStr = allCosts.get(t.sessionTitle) ?? "0";
        const costUsd = parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0;
        return {
          title: t.sessionTitle,
          goal: t.goal,
          repo: t.repo,
          costUsd,
          tags: new Map<string, string>(),
          idleMinutes: 0,
        };
      });
      const violations = checkFleetCompliance(compSessions);
      const lines = formatComplianceReport(violations, compSessions.length);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /plugin-hooks — show plugin hooks state
    input.onPluginHooks(() => {
      const lines = formatPluginHooks(daemonPluginHooks);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /incidents — fleet incident timeline
    input.onIncidentTimeline(() => {
      const lines = formatIncidentTimeline(incidentTimeline);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /bookmark — session output bookmarks
    input.onBookmark((args) => {
      const parts = args.split(/\s+/);
      const subcmd = parts[0] ?? "";
      if (subcmd === "add" && parts.length >= 3) {
        const session = parts[1];
        const label = parts.slice(2).join(" ");
        const output = (tui!.getSessionOutput(session) ?? []);
        const lastLine = output.length > 0 ? output[output.length - 1] : "";
        const bm = addBookmark(bookmarkState, session, lastLine, label);
        tui!.log("system", `bookmark: #${bm.id} added for ${session} "${label}"`);
      } else if (subcmd === "rm" && parts[1]) {
        const id = parseInt(parts[1], 10);
        if (removeBookmark(bookmarkState, id)) tui!.log("system", `bookmark: #${id} removed`);
        else tui!.log("system", `bookmark: #${id} not found`);
      } else if (subcmd === "search" && parts[1]) {
        const results = searchBookmarks(bookmarkState, parts.slice(1).join(" "));
        const lines = formatBookmarks(results);
        for (const l of lines) tui!.log("system", l);
      } else {
        const session = subcmd || undefined;
        const bms = getBookmarks(bookmarkState, session);
        const lines = formatBookmarks(bms);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /canary — canary mode management
    input.onCanaryMode((args) => {
      const parts = args.split(/\s+/);
      const subcmd = parts[0] ?? "";
      if (subcmd === "start" && parts[1]) {
        const sessions = tui!.getSessions();
        const avgHealth = sessions.length > 0 ? 70 : 0;
        const avgCost = 1.0;
        startCanary(canaryState, parts[1], {}, avgHealth, avgCost);
        tui!.log("system", `canary: started on ${parts[1]}`);
      } else if (subcmd === "promote") {
        const overrides = promoteCanary(canaryState);
        if (overrides) tui!.log("system", `canary: promoted — overrides: ${JSON.stringify(overrides)}`);
        else tui!.log("system", "canary: nothing to promote");
      } else if (subcmd === "rollback") {
        rollbackCanary(canaryState);
        tui!.log("system", "canary: rolled back");
      } else {
        const lines = formatCanaryState(canaryState);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /config-diff — show config changes
    input.onConfigDiff(() => {
      const diff = computeDaemonConfigDiff(configDiffState);
      const lines = formatConfigDiff(diff);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /goal-priority — auto-prioritize goals
    input.onGoalPriority(() => {
      const tasks = taskManager?.tasks ?? [];
      const inputs: GoalPriorityInput[] = tasks.filter((t) => t.status === "active" || t.status === "pending").map((t) => {
        const depCount = tasks.filter((d) => d.dependsOn?.includes(t.sessionTitle)).length;
        return {
          sessionTitle: t.sessionTitle,
          goal: t.goal,
          repo: t.repo,
          createdAt: t.createdAt ?? Date.now(),
          dependencyCount: depCount,
          tags: new Map<string, string>(),
          status: t.status,
        };
      });
      const ranked = rankGoals(inputs);
      const lines = formatGoalPriority(ranked);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /capacity-forecast — fleet capacity prediction
    input.onCapacityForecast(() => {
      const lines = formatCapacityForecast(capacityForecaster);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /watchdog-status — daemon watchdog state
    input.onWatchdogStatus(() => {
      const lines = formatWatchdog(watchdogState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /cost-regression — fleet cost regression alerts
    input.onCostRegression(() => {
      const allCosts = tui!.getAllSessionCosts();
      const currentRates = new Map<string, number>();
      for (const [title, costStr] of allCosts) {
        const rate = costThrottleState.burnRates.get(title) ?? 0;
        currentRates.set(title, rate);
      }
      const lines = formatCostRegression(costRegressionDetector, currentRates);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /goal-cascade — goal cascading tree
    input.onGoalCascade((args) => {
      const parts = args.split(/\s+/);
      const subcmd = parts[0] ?? "";
      if (subcmd === "add" && parts.length >= 3) {
        const session = parts[1];
        const goal = parts.slice(2).join(" ");
        const tasks = taskManager?.tasks ?? [];
        const task = tasks.find((t) => t.sessionTitle === session);
        const repo = task?.repo ?? "";
        const g = addParentGoal(cascadeState, session, goal, repo);
        tui!.log("system", `goal-cascade: root #${g.id} created for ${session}`);
      } else if (subcmd === "child" && parts.length >= 4) {
        const parentId = parseInt(parts[1], 10);
        const session = parts[2];
        const goal = parts.slice(3).join(" ");
        const tasks = taskManager?.tasks ?? [];
        const task = tasks.find((t) => t.sessionTitle === session);
        const repo = task?.repo ?? "";
        const c = cascadeChild(cascadeState, parentId, session, goal, repo);
        if (c) tui!.log("system", `goal-cascade: child #${c.id} created under #${parentId}`);
        else tui!.log("system", `goal-cascade: failed (invalid parent or max depth)`);
      } else {
        const lines = formatCascadeTree(cascadeState);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /health-score — composite daemon health metric
    input.onHealthScore(() => {
      const check = checkWatchdog(watchdogState);
      const report = computeHealthScore({
        watchdogStalled: check.stalled,
        slaHealthPct: 80, // would come from slaMonitor in real wiring
        errorRatePct: 5,
        cacheHitRatePct: Math.round(observationCache.getStats().hitRate * 100),
        avgSessionHealthPct: 70,
        stallCount: watchdogState.stallCount,
        unresolvedIncidents: incidentTimeline.unresolvedCount(),
        complianceViolations: 0,
      });
      const lines = formatHealthScore(report);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /event-replay — replay event bus history
    input.onEventReplay((args) => {
      if (!eventReplayState) {
        eventReplayState = createEventReplay(fleetEventBus.getHistory(undefined, 500));
      }
      const subcmd = args.split(/\s+/)[0] ?? "";
      if (subcmd === "next") {
        const events = stepForward(eventReplayState, 1);
        if (events.length === 0) tui!.log("system", "event-replay: at end");
      } else if (subcmd === "prev") {
        stepBackward(eventReplayState, 1);
      } else if (subcmd === "reload") {
        eventReplayState = createEventReplay(fleetEventBus.getHistory(undefined, 500));
        tui!.log("system", "event-replay: reloaded");
      } else if (/^\d+$/.test(subcmd)) {
        seekEventReplay(eventReplayState, parseInt(subcmd, 10));
      } else if (subcmd === "filter") {
        const filterType = args.split(/\s+/)[1] as import("./fleet-event-bus.js").EventType | undefined;
        setEventReplayFilter(eventReplayState, filterType);
      }
      const lines = formatEventReplay(eventReplayState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /context-budget — context token budget allocation
    input.onContextBudget(() => {
      const tasks = taskManager?.tasks ?? [];
      const activeGoal = tasks.find((t) => t.status === "active")?.goal ?? "";
      const trackedFiles = Array.from(incrementalContextState.fingerprints.entries()).map(([path, fp]) => ({
        path,
        sizeBytes: fp.size,
        lastModifiedMs: fp.mtimeMs,
      }));
      const alloc = allocateContextBudget(trackedFiles, activeGoal, 8000);
      const lines = formatContextBudget(alloc);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /tick-profiler — per-phase tick timing breakdown
    input.onTickProfiler(() => {
      const lines = formatTickProfiler(tickProfiler);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /goal-confidence — completion probability estimates
    input.onGoalConfidence(() => {
      const tasks = taskManager?.tasks ?? [];
      const inputs: ConfidenceInput[] = tasks.filter((t) => t.status === "active").map((t) => {
        const vel = progressVelocityTracker.estimate(t.sessionTitle);
        return {
          sessionTitle: t.sessionTitle,
          goal: t.goal,
          progressPct: t.progress.length * 15,
          velocityPctPerHr: vel?.velocityPerHour ?? 0,
          errorCount: 0,
          elapsedHours: t.createdAt ? (Date.now() - t.createdAt) / 3_600_000 : 0,
          positiveSignals: 0,
          negativeSignals: 0,
          stuckTicks: 0,
        };
      });
      const results = estimateFleetConfidence(inputs);
      const lines = formatConfidence(results);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /budget-plan — fleet budget allocation
    input.onBudgetPlan(() => {
      const tasks = taskManager?.tasks ?? [];
      const allCosts = tui!.getAllSessionCosts();
      const inputs: BudgetPlanInput[] = tasks.map((t) => {
        const costStr = allCosts.get(t.sessionTitle) ?? "0";
        const costUsd = parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0;
        const burnRate = costThrottleState.burnRates.get(t.sessionTitle) ?? 0;
        return {
          sessionTitle: t.sessionTitle,
          priorityScore: 50,
          progressPct: Math.min(100, t.progress.length * 15),
          costUsd,
          burnRatePerHr: burnRate,
          status: t.status,
        };
      });
      const plan = planBudget(inputs, config.costBudgets?.globalBudgetUsd ?? 100);
      const lines = formatBudgetPlan(plan);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /sentiment — session output sentiment analysis
    input.onSentiment(() => {
      const sessions = tui!.getSessions();
      const sentimentInputs = sessions.map((s) => ({
        title: s.title,
        output: (tui!.getSessionOutput(s.id) ?? []).join("\n"),
      }));
      const results = analyzeFleetSentiment(sentimentInputs);
      const lines = formatSentiment(results);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /workload-balance — fleet workload balance report
    input.onWorkloadBalance(() => {
      const tasks = taskManager?.tasks ?? [];
      const allCosts = tui!.getAllSessionCosts();
      const sessionTitles = new Set(tasks.map((t) => t.sessionTitle));
      const loads: SessionLoad[] = Array.from(sessionTitles).map((title) => {
        const sessionTasks = tasks.filter((t) => t.sessionTitle === title && t.status === "active");
        const burnRate = costThrottleState.burnRates.get(title) ?? 0;
        return { sessionTitle: title, activeTasks: sessionTasks.length, burnRatePerHr: burnRate, healthScore: 70, repo: tasks.find((t) => t.sessionTitle === title)?.repo ?? "" };
      });
      const report = analyzeBalance(loads);
      const lines = formatBalanceReport(report);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /crash-report — preview crash diagnostic report
    input.onCrashReport(() => {
      const report = generateCrashReport({
        uptimeMs: Date.now() - daemonStartedAt,
        tickCount: pollCount,
        activeSessions: tui!.getSessions().map((s) => s.title),
        unresolvedIncidents: incidentTimeline.unresolvedCount(),
        healthScore: 70,
      });
      const lines = formatCrashReportTui(report);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /group — session groups
    input.onSessionGroup((args) => {
      const parts = args.split(/\s+/);
      const subcmd = parts[0] ?? "";
      if (subcmd === "add" && parts[1] && parts[2]) {
        addToGroup(sessionGroupingState, parts[1], parts[2]);
        tui!.log("system", `group: added ${parts[2]} to ${parts[1]}`);
      } else if (subcmd === "rm" && parts[1] && parts[2]) {
        if (removeFromGroup(sessionGroupingState, parts[1], parts[2])) tui!.log("system", `group: removed ${parts[2]} from ${parts[1]}`);
        else tui!.log("system", `group: not found`);
      } else {
        const groups = listGroups(sessionGroupingState);
        const lines = formatGrouping(groups);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /context-diff — show context file changes
    input.onContextDiff(() => {
      const contextFiles = new Map<string, string>();
      for (const [path, fp] of incrementalContextState.fingerprints) {
        contextFiles.set(path, `${fp.mtimeMs}:${fp.size}`); // use mtime+size as proxy for content
      }
      const changes = diffContextFiles(contextDiffState, contextFiles);
      const lines = formatContextDiff(changes);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /config-validate — validate config against schema
    input.onConfigSchema(() => {
      const result = validateConfigSchema(config as unknown as Record<string, unknown>);
      const lines = formatValidation(result);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /transcript — export session transcript as markdown
    input.onTranscriptExport((sessionArg) => {
      const tasks = taskManager?.tasks ?? [];
      const task = tasks.find((t) => t.sessionTitle.toLowerCase() === sessionArg.toLowerCase());
      if (!task) { tui!.log("system", `transcript: "${sessionArg}" not found`); return; }
      const allCosts = tui!.getAllSessionCosts();
      const costStr = allCosts.get(task.sessionTitle) ?? "0";
      const costUsd = parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0;
      const output = tui!.getSessionOutput(task.sessionId ?? "") ?? [];
      const input_: TranscriptInput = {
        sessionTitle: task.sessionTitle, goal: task.goal, repo: task.repo,
        status: task.status, startedAt: task.createdAt ?? Date.now(), costUsd,
        progressEntries: task.progress, recentOutput: output,
        actions: [],
      };
      const lines = formatTranscriptPreview(input_);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /decomp-quality — goal decomposition quality
    input.onDecompQuality(() => {
      const tasks = taskManager?.tasks ?? [];
      const roots = tasks.filter((t) => !t.dependsOn || t.dependsOn.length === 0);
      if (roots.length === 0) { tui!.log("system", "decomp-quality: no root goals found"); return; }
      for (const root of roots.slice(0, 3)) {
        const children = tasks.filter((t) => t.dependsOn?.includes(root.sessionTitle));
        if (children.length === 0) continue;
        const result = scoreDecomposition({ parentGoal: root.goal, subGoals: children.map((c) => c.goal) });
        const lines = formatDecompQuality(result);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /anomaly-corr — correlated anomalies
    input.onAnomalyCorrelation(() => {
      const events = incidentTimeline.getEvents({ sinceMs: 3_600_000 });
      const anomalyEvents: AnomalyEvent[] = events.map((e) => ({
        sessionTitle: e.sessionTitle, type: e.type, timestamp: e.timestamp, detail: e.message,
      }));
      const clusters = correlateAnomalies(anomalyEvents);
      const lines = formatCorrelations(clusters);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /critical-path — goal dependency critical path
    input.onCriticalPath(() => {
      const tasks = taskManager?.tasks ?? [];
      const nodes: CriticalPathNode[] = tasks.map((t) => ({
        sessionTitle: t.sessionTitle,
        goal: t.goal,
        durationEstHours: t.createdAt ? Math.max(0.5, (Date.now() - t.createdAt) / 3_600_000) : 2,
        dependsOn: t.dependsOn ?? [],
        depth: 0,
      }));
      const result = computeCriticalPath(nodes);
      const lines = formatCriticalPath(result);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /snap-compress — snapshot compression stats
    input.onSnapshotCompression(() => {
      const lines = formatCompressionStats(snapshotCompressionState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /annotate — output annotations
    input.onOutputAnnotations((args) => {
      const parts = args.split(/\s+/);
      const subcmd = parts[0] ?? "";
      if (subcmd === "add" && parts.length >= 4) {
        const session = parts[1];
        const label = parts[2];
        const note = parts.slice(3).join(" ");
        const output = tui!.getSessionOutput(session) ?? [];
        const lastLine = output.length > 0 ? output[output.length - 1] : "";
        const ann = annotate(outputAnnotationState, session, output.length - 1, lastLine, label, "info", "operator", note);
        tui!.log("system", `annotate: #${ann.id} added to ${session}`);
      } else if (parts[0]) {
        const anns = getSessionAnnotations(outputAnnotationState, parts[0]);
        const lines = formatAnnotations(anns);
        for (const l of lines) tui!.log("system", l);
      } else {
        const lines = formatAnnotations(outputAnnotationState.annotations);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /celebrate — goal completion celebrations
    input.onCelebration(() => {
      const tasks = taskManager?.tasks ?? [];
      const completed = tasks.filter((t) => t.status === "completed" && t.completedAt);
      if (completed.length === 0) { tui!.log("system", "celebrate: no completed goals"); return; }
      const allCosts = tui!.getAllSessionCosts();
      const results = completed.slice(-5).map((t) => {
        const costStr = allCosts.get(t.sessionTitle) ?? "0";
        const costUsd = parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0;
        const input_: CelebrationInput = {
          sessionTitle: t.sessionTitle, goal: t.goal, repo: t.repo,
          startedAt: t.createdAt ?? Date.now(), completedAt: t.completedAt!,
          costUsd, progressEntries: t.progress.length, taskCount: 1, errorCount: 0,
        };
        return celebrate(input_);
      });
      const lines = formatCelebrations(results);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /readiness — fleet operational readiness
    input.onReadiness(() => {
      const sessions = tui!.getSessions();
      const report = evaluateReadiness({
        configValid: true,
        reasonerConnected: true,
        sessionCount: sessions.length,
        poolCapacity: sessionPoolManager.getStatus(taskManager?.tasks ?? []).maxConcurrent,
        healthScore: 70,
        complianceViolations: 0,
        unresolvedIncidents: incidentTimeline.unresolvedCount(),
        watchdogEnabled: watchdogState.enabled,
        costBudgetSet: !!(config.costBudgets?.globalBudgetUsd),
        contextFilesLoaded: incrementalContextState.fingerprints.size > 0,
      });
      const lines = formatReadiness(report);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /supervisor — process supervisor state
    input.onProcessSupervisor(() => {
      const lines = formatSupervisor(processSupervisorState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /daily-digest — fleet daily summary
    input.onDailyDigest(() => {
      const tasks = taskManager?.tasks ?? [];
      const allCosts = tui!.getAllSessionCosts();
      let totalCost = 0;
      for (const [, costStr] of allCosts) totalCost += parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0;
      const digest = buildDailyDigest({
        periodLabel: new Date().toISOString().slice(0, 10),
        completedGoals: tasks.filter((t) => t.status === "completed").map((t) => `${t.sessionTitle}: ${t.goal.slice(0, 40)}`),
        failedGoals: tasks.filter((t) => t.status === "failed").map((t) => `${t.sessionTitle}: ${t.goal.slice(0, 40)}`),
        activeGoals: tasks.filter((t) => t.status === "active").map((t) => `${t.sessionTitle}: ${t.goal.slice(0, 40)}`),
        totalCostUsd: totalCost, avgHealthPct: 70, incidentCount: incidentTimeline.totalCount(),
        topBurnSession: null, topBurnRatePerHr: 0, nudgesSent: 0,
        reasonerCalls: 0, uptimeHours: (Date.now() - daemonStartedAt) / 3_600_000,
      });
      const lines = formatDigestTui(digest);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /parse-goal — natural language goal parser
    input.onGoalParser((text) => {
      const parsed = parseGoal(text);
      const lines = formatParsedGoal(parsed);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /hot-swap — module hot-swapping state
    input.onHotSwap(() => {
      const lines = formatHotSwap(hotSwapState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /webhook-preview — preview webhook payloads
    input.onWebhookPreview((args) => {
      const platform = (args.trim() || "slack") as WebhookPlatform;
      const event: WebhookEvent = { type: "goal-completed", title: "Fleet Update", message: "Preview event", severity: "info", fields: [{ label: "Sessions", value: String(tui!.getSessions().length) }] };
      const lines = formatWebhookPreview(event, platform);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /structured-log — parse session output into structured events
    input.onStructuredLog(() => {
      const sessions = tui!.getSessions();
      const allEntries = sessions.flatMap((s) => {
        const output = tui!.getSessionOutput(s.id) ?? [];
        return parseOutputLines(s.title, output.slice(-20));
      });
      const lines = formatStructuredLog(allEntries);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /state-export — export daemon state
    input.onStateExport(() => {
      const tasks = taskManager?.tasks ?? [];
      const state = exportState({
        daemonVersion: "5.3.0", tasks, config: config as unknown as Record<string, unknown>,
        healthScore: 70, uptimeMs: Date.now() - daemonStartedAt, tickCount: pollCount,
        moduleCount: 144, commandCount: 145, testCount: 4275,
      });
      const lines = formatStateExport(state);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /output-dedup — deduplicate session output
    input.onOutputDedup((sessionArg) => {
      const output = tui!.getSessionOutput(sessionArg) ?? [];
      const result = deduplicateOutput(output);
      const lines = formatDedup(result);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /config-migrate — auto-upgrade config
    input.onConfigMigrate(() => {
      const result = migrateConfig(config as unknown as Record<string, unknown>);
      const lines = formatMigration(result);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /progress-predict — statistical completion prediction
    input.onProgressPredict(() => {
      const tasks = taskManager?.tasks ?? [];
      const active = tasks.filter((t) => t.status === "active");
      const predictions = active.map((t) => {
        const vel = progressVelocityTracker.estimate(t.sessionTitle);
        return progressPredictor.predict({
          sessionTitle: t.sessionTitle,
          goal: t.goal,
          currentProgressPct: Math.min(100, t.progress.length * 15),
          elapsedHours: t.createdAt ? (Date.now() - t.createdAt) / 3_600_000 : 0,
          errorCount: 0,
        });
      });
      const lines = formatPredictions(predictions);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /ops-dashboard — full-screen fleet operations dashboard
    input.onOpsDashboard(() => {
      const sessions = tui!.getSessions();
      const allCosts = tui!.getAllSessionCosts();
      let totalCost = 0;
      const dashSessions = sessions.map((s) => {
        const costStr = allCosts.get(s.title) ?? "0";
        const costUsd = parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0;
        totalCost += costUsd;
        return { title: s.title, status: s.status, healthPct: 70, costUsd, progressPct: 50, sentiment: "progress", idleMinutes: 0 };
      });
      const data = buildDashboardData({
        sessions: dashSessions, fleetHealth: 70, totalCostUsd: totalCost,
        unresolvedIncidents: incidentTimeline.unresolvedCount(),
        poolUtilizationPct: Math.round((sessions.length / sessionPoolManager.getStatus(taskManager?.tasks ?? []).maxConcurrent) * 100),
        readinessGrade: "READY", recentEvents: incidentTimeline.getEvents().slice(-3).map((e) => `${e.type}: ${e.message.slice(0, 40)}`),
        uptimeHours: (Date.now() - daemonStartedAt) / 3_600_000, tickCount: pollCount,
      });
      const lines = formatOpsDashboard(data);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /dep-repair — auto-repair broken dependency chains
    input.onDepRepair(() => {
      const tasks = taskManager?.tasks ?? [];
      const depInfos = tasks.map((t) => ({ sessionTitle: t.sessionTitle, status: t.status, dependsOn: t.dependsOn ?? [] }));
      const repairs = findBrokenDeps(depInfos);
      const cycles = detectDepCycles(depInfos);
      const lines = formatDepRepairs(repairs, cycles);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /pattern-evolution — output pattern evolution tracking
    input.onPatternEvolution(() => {
      // record current window from all session outputs
      const sessions = tui!.getSessions();
      const allLines = sessions.flatMap((s) => (tui!.getSessionOutput(s.id) ?? []).slice(-20));
      if (allLines.length > 0) recordWindow(patternEvolutionState, allLines);
      const lines = formatPatternEvolution(patternEvolutionState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /alert-dashboard — unified alert view
    input.onAlertDashboard((args) => {
      const parts = args.split(/\s+/);
      if (parts[0] === "ack" && parts[1]) {
        const id = parseInt(parts[1], 10);
        if (acknowledgeAlert(alertDashboardState, id)) tui!.log("system", `alert: #${id} acknowledged`);
        else tui!.log("system", `alert: #${id} not found or already ack'd`);
      } else {
        const lines = formatAlertDashboard(alertDashboardState);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /lang-detect — programming language detection
    input.onLangDetect(() => {
      const sessions = tui!.getSessions();
      const inputs = sessions.map((s) => ({ title: s.title, output: (tui!.getSessionOutput(s.id) ?? []).join("\n") }));
      const results = detectFleetLanguages(inputs);
      const lines = formatLangDetection(results);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /goal-sla — SLA enforcement
    input.onGoalSla((args) => {
      const parts = args.split(/\s+/);
      if (parts[0] === "set" && parts[1] && parts[2]) {
        const session = parts[1];
        const hours = parseFloat(parts[2]);
        const tasks = taskManager?.tasks ?? [];
        const task = tasks.find((t) => t.sessionTitle === session);
        registerGoalSla(goalSlaState, session, task?.goal ?? "", hours);
        tui!.log("system", `goal-sla: ${session} set to ${hours}h`);
      } else {
        const checks = checkGoalSlas(goalSlaState);
        const lines = formatSlaChecks(checks);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /auto-scaler — fleet auto-scaling
    input.onAutoScaler(() => {
      const tasks = taskManager?.tasks ?? [];
      const poolStatus = sessionPoolManager.getStatus(tasks);
      const decision = computeScaling(autoScalerState, {
        currentSlots: poolStatus.maxConcurrent,
        activeSlots: poolStatus.activeCount,
        queuedTasks: poolStatus.pendingCount,
        completionsPerHour: 0,
        arrivalsPerHour: 0,
      });
      const lines = formatAutoScaler(decision, autoScalerState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /gamification — XP leaderboard
    input.onGamification(() => {
      const lines = formatGamification(xpState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /audit-report — compliance audit report
    input.onAuditReport(() => {
      const report = generateAuditReport({
        periodLabel: new Date().toISOString().slice(0, 10),
        actions: [], approvals: [],
        escalations: 0, errors: 0,
        totalCostUsd: 0, reasonerCalls: 0,
      });
      const lines = formatAuditReportTui(report);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /startup-profile — daemon startup timings
    input.onStartupProfile(() => {
      const lines = formatStartupProfile(startupProfiler);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /affinity-groups — auto-group sessions by repo
    input.onAffinityGroups(() => {
      const tasks = taskManager?.tasks ?? [];
      const inputs = tasks.map((t) => ({ sessionTitle: t.sessionTitle, repo: t.repo }));
      const groups = computeAffinityGroups(inputs);
      const lines = formatAffinityGroups(groups);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /clipboard — copy session output to clipboard
    input.onClipboard((sessionArg) => {
      const output = tui!.getSessionOutput(sessionArg) ?? [];
      if (output.length === 0) { tui!.log("system", `clipboard: no output for "${sessionArg}"`); return; }
      const result = buildClipboardResult(output);
      const lines = formatClipboardResult(result);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /shutdown-status — graceful shutdown state
    input.onGracefulShutdown(() => {
      const lines = formatShutdownState(shutdownState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /dep-impact — dependency impact analysis
    input.onDepImpact((sessionArg) => {
      const tasks = taskManager?.tasks ?? [];
      const nodes = tasks.map((t) => ({ sessionTitle: t.sessionTitle, goal: t.goal, status: t.status, dependsOn: t.dependsOn ?? [] }));
      const result = computeImpact(nodes, sessionArg, "failure");
      const lines = formatImpact([result]);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /runbook — runbook library
    input.onRunbookLibrary((args) => {
      if (!args) {
        const lines = formatRunbookList(listRunbooks());
        for (const l of lines) tui!.log("system", l);
      } else {
        const rb = getRunbook(args);
        if (rb) {
          const lines = formatRunbookSteps(rb);
          for (const l of lines) tui!.log("system", l);
        } else {
          const results = searchRunbooks(args);
          const lines = formatRunbookList(results);
          for (const l of lines) tui!.log("system", l);
        }
      }
    });
    // wire /dep-graph-export — export dep graph
    input.onDepGraphExport((args) => {
      const format = (args.trim() || "dot") as GraphFormat;
      const tasks = taskManager?.tasks ?? [];
      const nodes: GraphNode[] = tasks.map((t) => ({ sessionTitle: t.sessionTitle, status: t.status, dependsOn: t.dependsOn ?? [] }));
      const lines = formatGraphExport(nodes, format);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /perf-regression — performance regression detector
    input.onPerfRegression(() => {
      const lines = formatPerfRegression(perfRegressionDetector);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /compliance-report — generate compliance report
    input.onComplianceReport2(() => {
      const tasks = taskManager?.tasks ?? [];
      const allCosts = tui!.getAllSessionCosts();
      let totalCost = 0;
      for (const [, costStr] of allCosts) totalCost += parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0;
      const report = generateCompReport({
        periodLabel: new Date().toISOString().slice(0, 10),
        complianceViolations: [], slaBreaches: [],
        incidents: incidentTimeline.getEvents().map((e) => ({ session: e.sessionTitle, type: e.type, resolved: e.resolved })),
        totalCostUsd: totalCost, budgetUsd: config.costBudgets?.globalBudgetUsd ?? 100,
        sessionCount: tasks.length, healthScore: 70,
      });
      const lines = formatCompReportTui(report);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /cost-optimizer — cost optimization recommendations
    input.onCostOptimizer(() => {
      const tasks = taskManager?.tasks ?? [];
      const allCosts = tui!.getAllSessionCosts();
      const inputs = tasks.map((t) => {
        const costStr = allCosts.get(t.sessionTitle) ?? "0";
        return { sessionTitle: t.sessionTitle, costUsd: parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0, burnRatePerHr: costThrottleState.burnRates.get(t.sessionTitle) ?? 0, progressPct: Math.min(100, t.progress.length * 15), idleMinutes: 0, status: t.status };
      });
      const report = analyzeCostOptimizations(inputs);
      const lines = formatCostOptimizer(report);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /progress-heatmap — hourly progress visualization
    input.onProgressHeatmap(() => {
      const lines = formatProgressHeatmap(progressHeatmapState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /module-deps — daemon module dependency graph
    input.onModuleDeps(() => {
      const graph = createModuleDepGraph([
        { moduleName: "poller", dependsOn: [], category: "core" },
        { moduleName: "reasoner", dependsOn: ["poller"], category: "core" },
        { moduleName: "executor", dependsOn: ["reasoner"], category: "core" },
        { moduleName: "tui", dependsOn: ["poller", "reasoner"], category: "tui" },
        { moduleName: "intelligence", dependsOn: ["poller"], category: "intelligence" },
      ]);
      const lines = formatModuleDeps(graph);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /cost-trend — cost trend analysis
    input.onCostTrend(() => {
      const lines = formatCostTrend(costTrendTracker);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /complexity — goal complexity tagging
    input.onComplexityTagger(() => {
      const tasks = taskManager?.tasks ?? [];
      const inputs = tasks.filter((t) => t.status === "active" || t.status === "pending").map((t) => ({
        sessionTitle: t.sessionTitle, goal: t.goal,
        depCount: t.dependsOn?.length ?? 0, subGoalCount: 0,
      }));
      const tags = tagFleetComplexity(inputs);
      const lines = formatComplexityTags(tags);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /event-store — daemon event store
    input.onEventSourcing(() => {
      const lines = formatEventStore(daemonEventStore);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /daemon-lock — distributed lock state
    input.onDaemonLock(() => {
      const lines = formatLockState(daemonLock);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /output-correlation — find related sessions
    input.onOutputCorrelation(() => {
      const sessions = tui!.getSessions();
      const inputs = sessions.map((s) => ({ title: s.title, output: (tui!.getSessionOutput(s.id) ?? []).join("\n") }));
      const pairs = findCorrelations(inputs);
      const lines = formatCorrelationPairs(pairs);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /util-forecast — utilization prediction
    input.onUtilForecast(() => {
      const tomorrow = (new Date().getDay() + 1) % 7;
      const lines = formatUtilizationForecast(utilForecaster, tomorrow);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /time-machine — fleet snapshot browser
    input.onTimeMachine((args) => {
      if (args === "snap") {
        const sessions = tui!.getSessions();
        const allCosts = tui!.getAllSessionCosts();
        let totalCost = 0;
        for (const [, c] of allCosts) totalCost += parseFloat(c.replace(/[^0-9.]/g, "")) || 0;
        takeSnapshot(timeMachineState, { timestamp: Date.now(), sessionCount: sessions.length, activeSessions: sessions.map((s) => s.title), healthScore: 70, totalCostUsd: totalCost });
        tui!.log("system", "time-machine: snapshot taken");
      } else if (args.startsWith("diff") && args.split(/\s+/).length >= 3) {
        const ids = args.split(/\s+/).slice(1).map((x) => parseInt(x, 10));
        const a = getSnapshot(timeMachineState, ids[0]);
        const b = getSnapshot(timeMachineState, ids[1]);
        if (a && b) {
          const diff = compareSnapshots(a, b);
          const lines = formatSnapshotDiff(diff);
          for (const l of lines) tui!.log("system", l);
        } else tui!.log("system", "time-machine: snapshot not found");
      } else {
        const lines = formatTimeMachine(timeMachineState);
        for (const l of lines) tui!.log("system", l);
      }
    });
    // wire /sparkline-dash — all-session progress sparklines
    input.onSparklineDash(() => {
      const tasks = taskManager?.tasks ?? [];
      const entries = buildSparklineEntries(tasks.filter((t) => t.status === "active").map((t) => ({
        title: t.sessionTitle,
        progressHistory: t.progress.map((_, i) => Math.min(100, (i + 1) * 15)),
      })));
      const lines = formatSparklineDashboard(entries);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /tick-budget — phase compute budgets
    input.onTickBudget(() => {
      const lines = formatTickBudget(tickBudgetState);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /goal-mutations — track goal changes
    input.onGoalMutation((args) => {
      const session = args.trim() || undefined;
      const lines = formatMutationHistory(goalMutationState, session);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /chargeback — cost chargeback report
    input.onChargeback(() => {
      const tasks = taskManager?.tasks ?? [];
      const allCosts = tui!.getAllSessionCosts();
      const inputs = tasks.map((t) => {
        const costStr = allCosts.get(t.sessionTitle) ?? "0";
        return { sessionTitle: t.sessionTitle, costUsd: parseFloat(costStr.replace(/[^0-9.]/g, "")) || 0, tags: new Map<string, string>() };
      });
      const report = generateChargeback(inputs, "team", new Date().toISOString().slice(0, 7));
      const lines = formatChargeback(report);
      for (const l of lines) tui!.log("system", l);
    });
    // wire /prediction-ensemble — ensemble completion predictions
    input.onPredictionEnsemble(() => {
      const tasks = taskManager?.tasks ?? [];
      const predictions = tasks.filter((t) => t.status === "active").map((t) => {
        const vel = progressVelocityTracker.estimate(t.sessionTitle);
        const progressPct = Math.min(100, t.progress.length * 15);
        const elapsed = t.createdAt ? (Date.now() - t.createdAt) / 3_600_000 : 0;
        const methods = buildPredictionMethods({ currentProgressPct: progressPct, elapsedHours: elapsed, velocityPctPerHr: vel?.velocityPerHour ?? 0 });
        return ensemblePredict(t.sessionTitle, methods);
      });
      const lines = formatEnsemblePredictions(predictions);
      for (const l of lines) tui!.log("system", l);
    });
    input.onApiStatus(() => {
      if (!apiServer) {
        tui!.log("system", "API server not running (set apiPort in config to enable)");
        return;
      }
      const lines = formatApiStatus(apiServer.stats(), config.apiPort!, !!config.apiToken);
      for (const l of lines) tui!.log("system", l);
    });
    input.onAlertInheritance(() => {
      // build inheritable rules from existing alert rules + any parent refs
      const rules: InheritableRule[] = alertRules.map((r, i) => ({
        id: r.name ?? `rule-${i}`,
        name: r.name ?? `rule-${i}`,
        severity: r.severity as any,
        cooldownMs: r.cooldownMs,
      }));
      const result = resolveInheritance(rules);
      const lines = formatInheritanceTree(result);
      for (const l of lines) tui!.log("system", l);
    });
    input.onAffinityRouter(() => {
      const sessions = tui!.getSessions();
      const routable = sessions.map((s) => ({
        title: s.title,
        repo: s.path,
        tags: [...(tui!.getSessionTags(s.title) ?? [])],
      }));
      // single instance for now — extensible when multi-reasoner is active
      const instances = [{ id: config.reasoner, backend: config.reasoner, maxConcurrent: 5, currentLoad: sessions.filter((s) => s.status === "working" || s.status === "running").length }];
      const result = routeSessions(routable, instances, affinityRouterState);
      const lines = formatAffinityRouting(result);
      for (const l of lines) tui!.log("system", l);
    });
    input.onBatchGoal((args) => {
      if (!args) {
        // generate template
        const sessions = tui!.getSessions();
        const template = generateTemplate(sessions.map((s) => ({ title: s.title, repo: s.path })));
        for (const l of template.split("\n")) tui!.log("system", l);
        return;
      }
      // parse manifest from args (inline text)
      const manifest = parseManifest(args);
      const manifestLines = formatManifest(manifest);
      for (const l of manifestLines) tui!.log("system", l);
      if (manifest.goals.length > 0) {
        const sessions = tui!.getSessions().map((s) => s.title);
        const assignment = applyManifest(manifest, sessions);
        const assignLines = formatAssignment(assignment);
        for (const l of assignLines) tui!.log("system", l);
      }
    });
    input.onApiRateLimit(() => {
      const lines = formatRateLimiter(apiRateLimiterState);
      for (const l of lines) tui!.log("system", l);
    });
    input.onKnowledge((args) => {
      if (!args) {
        const lines = formatKnowledgeStore(knowledgeStore);
        for (const l of lines) tui!.log("system", l);
        return;
      }
      // search knowledge by keyword
      const results = searchKnowledge(knowledgeStore, { keyword: args, limit: 10 });
      if (results.length === 0) {
        tui!.log("system", `knowledge: no entries matching "${args}"`);
        return;
      }
      tui!.log("system", `knowledge: ${results.length} entries matching "${args}":`);
      for (const e of results) {
        tui!.log("system", `  [${e.category}] ${e.summary} (from ${e.sourceSession}, ${e.useCount} uses)`);
      }
    });
    input.onPriorityMatrix(() => {
      const tasks = taskManager?.tasks ?? [];
      const sessions = tui!.getSessions();
      const inputs: MatrixInput[] = tasks.filter((t) => t.status !== "completed").map((t) => {
        const s = sessions.find((ss) => ss.title === t.sessionTitle);
        return {
          sessionTitle: t.sessionTitle,
          hasErrors: s?.status === "error",
          isStuck: (t.stuckNudgeCount ?? 0) > 0,
          stuckDurationMs: t.lastProgressAt ? Date.now() - t.lastProgressAt : 0,
          nudgeCount: t.stuckNudgeCount ?? 0,
          healthScore: 70,
          priority: "normal",
          dependentCount: tasks.filter((other) => other.dependsOn?.includes(t.sessionTitle)).length,
          costUsd: 0,
          progressPct: Math.min(100, (t.progress?.length ?? 0) * 15),
          isBlocking: tasks.some((other) => other.dependsOn?.includes(t.sessionTitle) && other.status !== "completed"),
        };
      });
      const result = buildPriorityMatrix(inputs);
      const lines = formatPriorityMatrix(result);
      for (const l of lines) tui!.log("system", l);
    });
    input.onWebhookPush((args) => {
      if (!args) {
        const lines = formatWebhookPush(webhookPushState);
        for (const l of lines) tui!.log("system", l);
        return;
      }
      // "add <url> [event1,event2]" syntax
      const parts = args.split(/\s+/);
      if (parts[0] === "add" && parts[1]) {
        const events = parts[2] ? parts[2].split(",") : ["*"];
        const sub = addWebhook(webhookPushState, parts[1], events);
        tui!.log("system", `webhook added: ${sub.id} → ${sub.url} (events: ${events.join(", ")})`);
      } else {
        tui!.log("system", "usage: /webhook-push [add <url> [event1,event2,...]]");
      }
    });
    input.onAuditRetention(() => {
      const entries = readRecentAuditEntries(200).map((e) => ({ type: e.type, timestamp: new Date(e.timestamp).getTime(), detail: e.detail }));
      const lines = formatRetention(auditRetentionState, entries);
      for (const l of lines) tui!.log("system", l);
    });
    input.onVelocityNorm(() => {
      const tasks = taskManager?.tasks ?? [];
      const velocityInputs: VelocityInput[] = tasks.filter((t) => t.status !== "completed" && t.status !== "pending").map((t) => {
        const vel = progressVelocityTracker.estimate(t.sessionTitle);
        const elapsed = t.createdAt ? (Date.now() - t.createdAt) / 3_600_000 : 0;
        return {
          sessionTitle: t.sessionTitle,
          rawVelocityPctHr: vel?.velocityPerHour ?? 0,
          complexity: "moderate", // default; would use complexity tagger if available
          elapsedHours: elapsed,
          progressPct: Math.min(100, (t.progress?.length ?? 0) * 15),
        };
      });
      const result = normalizeFleet(velocityInputs);
      const lines = formatNormalizedVelocity(result);
      for (const l of lines) tui!.log("system", l);
    });
    input.onErrorPattern((args) => {
      // scan a specific session's output, or show supported languages
      if (!args || args === "languages") {
        const langs = supportedLanguages();
        tui!.log("system", `error pattern library: supports ${langs.join(", ")} + general patterns`);
        return;
      }
      // find session by name/number
      const sessions = tui!.getSessions();
      const num = /^\d+$/.test(args) ? parseInt(args, 10) : undefined;
      const session = num !== undefined ? sessions[num - 1] : sessions.find((s) => s.title.toLowerCase().includes(args.toLowerCase()));
      if (!session) {
        tui!.log("system", `error-patterns: session "${args}" not found`);
        return;
      }
      const output = tui!.getSessionOutput(session.title);
      const outputLines = Array.isArray(output) ? output : (output ?? "").split("\n");
      const result = scanForErrors(outputLines);
      const lines = formatErrorScan(result);
      for (const l of lines) tui!.log("system", l);
    });
    input.onResourceMonitor(() => {
      recordSample(resourceMonitorState, totalPolls);
      const lines = formatResourceMonitor(resourceMonitorState);
      for (const l of lines) tui!.log("system", l);
    });
    input.onBurndown(() => {
      const tasks = taskManager?.tasks ?? [];
      // update burndowns from current task progress
      for (const t of tasks) {
        if (t.status === "completed" || t.status === "pending") continue;
        if (!burndownStates.has(t.sessionTitle)) {
          burndownStates.set(t.sessionTitle, createBurndown(t.sessionTitle, t.createdAt ?? Date.now()));
        }
        const pct = Math.min(100, (t.progress?.length ?? 0) * 15);
        recordBurndownProgress(burndownStates.get(t.sessionTitle)!, pct);
      }
      const states = [...burndownStates.values()];
      const lines = formatBurndown(states);
      for (const l of lines) tui!.log("system", l);
    });
    input.onLeakDetector(() => {
      recordHeapSample(leakDetectorState);
      const lines = formatLeakDetector(leakDetectorState);
      for (const l of lines) tui!.log("system", l);
    });
    input.onTopology(() => {
      const tasks = taskManager?.tasks ?? [];
      const sessions = tui!.getSessions().map((s) => s.title);
      // gather deps from task definitions
      const deps: { from: string; to: string }[] = [];
      for (const t of tasks) {
        for (const dep of t.dependsOn ?? []) {
          deps.push({ from: dep, to: t.sessionTitle });
        }
      }
      // gather shared files from conflict detector
      const sharedFiles: { session1: string; session2: string; file: string }[] = [];
      // gather from the conflict detector's recent conflicts
      const conflicts: { session1: string; session2: string }[] = [];
      const result = buildTopology(sessions, deps, sharedFiles, [], [], conflicts);
      const lines = formatTopology(result);
      for (const l of lines) tui!.log("system", l);
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

  // §SERVERS ──────────────────────────────────────────────────────────────
  // health check HTTP server (opt-in via config.healthPort)
  const daemonStartedAt = Date.now();
  let healthServer: ReturnType<typeof startHealthServer> | null = null;
  if (config.healthPort) {
    healthServer = startHealthServer(config.healthPort, daemonStartedAt);
    const msg = `health server listening on http://127.0.0.1:${config.healthPort}/health`;
    if (tui) tui.log("system", msg); else log(msg);
  }

  // ── REST API server (opt-in via config.apiPort) ────────────────────────────
  let apiServer: ApiServer | null = null;
  if (config.apiPort) {
    const apiModules: ApiModules = {
      getters: new Map<string, () => unknown>([
        ["health", () => {
          const state = readState();
          return state ? { status: "ok", phase: state.phase, pollCount: state.pollCount, sessionCount: state.sessionCount, paused: state.paused } : { status: "error" };
        }],
        ["fleet-sla", () => fleetSlaMonitor.formatStatus()],
        ["session-pool", () => sessionPoolManager.formatStatus(taskManager?.tasks ?? [])],
        ["reasoner-cost", () => reasonerCostTracker.getSummary()],
        ["adaptive-poll", () => adaptivePollController.formatStatus()],
        ["observation-cache", () => observationCache.getStats()],
        ["fleet-rate-limit", () => fleetRateLimiter.getStatus()],
        ["escalations", () => escalationManager.getAllStates()],
        ["nudge-tracker", () => nudgeTracker.getReport()],
        ["fleet-event-bus", () => ({ subscriptions: fleetEventBus.getSubscriptionCount(), counts: Object.fromEntries(fleetEventBus.getCounts()) })],
        ["tick-profiler", () => tickProfiler.getStats()],
        ["cost-trend", () => costTrendTracker.computeTrend()],
        ["cost-regression", () => costRegressionDetector.detect(new Map())],
        ["capacity-forecast", () => capacityForecaster.forecast()],
        ["heartbeat", () => evaluateHeartbeats(heartbeatState, tui?.getSessions().map((s) => s.title) ?? [])],
        ["incidents", () => incidentTimeline.getEvents({ unresolvedOnly: false })],
        ["watchdog", () => formatWatchdog(watchdogState)],
        ["daemon-metrics", () => daemonMetrics.allStats()],
        ["perf-regression", () => perfRegressionDetector.recentAlerts()],
        ["util-forecast", () => utilForecaster.forecast(new Date().getDay())],
      ]),
      actions: new Map<string, (body: unknown) => unknown>([
        ["pause", () => {
          writeState("sleeping", { paused: true });
          return { ok: true, paused: true };
        }],
        ["resume", () => {
          writeState("sleeping", { paused: false });
          return { ok: true, paused: false };
        }],
      ]),
      onEvent: (cb) => {
        const subId = fleetEventBus.on("*", (event) => {
          cb({ type: event.type, data: event, timestamp: event.timestamp });
        });
        return () => { fleetEventBus.off(subId); };
      },
    };
    apiServer = startApiServer({ port: config.apiPort, token: config.apiToken, modules: apiModules });
    const msg = `API server listening on http://127.0.0.1:${config.apiPort}/api/v1`;
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

  // §SHUTDOWN ─────────────────────────────────────────────────────────────
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
    if (apiServer) apiServer.close();
    // notify: daemon stopped (fire-and-forget, don't block shutdown)
    sendNotification(config, { event: "daemon_stopped", timestamp: Date.now(), detail: `polls: ${totalPolls}, actions: ${totalActionsExecuted}` });
    input.stop();
    Promise.resolve()
      .then(() => reasonerConsole.stop())
      .then(() => reasoner?.shutdown())
      .catch((err) => console.error(`[shutdown] error during cleanup: ${err}`))
      .finally(() => {
         // save daemon state checkpoint before exit
         try {
           const cp = buildCheckpoint({
             graduation: Object.fromEntries(
               [...(tui?.getSessions() ?? [])].map((s) => [s.title, {
                 mode: graduationManager.getState(s.title)?.currentMode ?? "confirm",
                 successes: graduationManager.getState(s.title)?.successfulActions ?? 0,
                 failures: graduationManager.getState(s.title)?.failedActions ?? 0,
                 rate: graduationManager.getState(s.title)?.successRate ?? 0,
               }])
             ),
             escalation: {},
             velocitySamples: {},
             nudgeRecords: [],
             budgetSamples: {},
             cacheStats: { hits: observationCache.getStats().totalHits, misses: observationCache.getStats().totalMisses },
             slaHistory: [],
             pollInterval: adaptivePollController.intervalMs,
           });
           saveCheckpoint(cp);
           audit("daemon_stop", "daemon stopped, checkpoint saved");
         } catch { /* best-effort */ }
         cleanupState();
         process.exit(0);
       });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

   // auto-install service for boot restart (real runs only)
  if (!config.observe && !config.dryRun) {
    const svcMsg = ensureServiceInstalled({ workingDir: process.cwd() });
    if (svcMsg) {
      if (tui) tui.log("system", svcMsg); else log(svcMsg);
    }
  }

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

  // repeated-error suppression state
  let lastTickError = "";
  let repeatedErrorCount = 0;

  // §LOOP ────────────────────────────────────────────────────────────────
  // THE DAEMON LOOP — poll → reason → execute, repeat until shutdown.
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
          const hint = pollCount <= 1
            ? "no active aoe sessions found — create one with: aoe add <path> -t <title> -c opencode -y"
            : "waiting for aoe sessions...";
          if (tui) tui.log("observation", hint); else log(hint);
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
          observationCache,
          fleetRateLimiter,
          reasonerCostTracker,
          nudgeTracker,
          escalationManager,
          graduationManager,
          approvalQueue,
          tokenQuotaManager,
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

        // recovery playbook: auto-execute recovery steps when health drops
        if (tui && taskManager) {
          const sessions = tui.getSessions();
          for (const s of sessions) {
            const healthScore = s.status === "working" || s.status === "running" ? 80 : s.status === "error" ? 20 : 50;
            const recoveryActions = recoveryPlaybookManager.evaluate(s.title, healthScore);
            for (const ra of recoveryActions) {
              tui.log("status", `🏥 recovery: ${s.title} → ${ra.action}: ${ra.detail}`);
              audit("session_restart", `recovery ${ra.action}: ${ra.detail}`, s.title, { action: ra.action });
              // execute recovery action
              if (ra.action === "pause") {
                const task = taskManager.getTaskForSession(s.title);
                if (task && task.status === "active") task.status = "paused";
              }
              // nudge and escalate are informational — logged but not auto-executed here
              // restart would need the executor which isn't available in main loop
            }
          }
        }

        // dep scheduler: auto-activate pending tasks when prerequisites complete
        if (taskManager) {
          const tasks = taskManager.tasks;
          const activatable = getActivatableTasks(tasks, sessionPoolManager.getStatus(tasks).maxConcurrent);
          for (const title of activatable) {
            const task = taskManager.getTaskForSession(title);
            if (task && task.status === "pending") {
              task.status = "active";
              if (tui) tui.log("+ action", `dep-scheduler: activated "${title}" (dependencies met)`);
              audit("task_created", `dep-scheduler activated: ${title}`, title);
            }
          }
        }

        // fleet utilization: record events for active sessions
        if (tui) {
          for (const s of tui.getSessions()) {
            if (s.status === "working" || s.status === "running") {
              fleetUtilizationTracker.recordEvent(s.title);
            }
          }
        }

        // session graduation: evaluate per tick and log promotions/demotions
        if (tui) {
          for (const s of tui.getSessions()) {
            const result = graduationManager.evaluate(s.title);
            if (result.action === "promote") {
              tui.log("+ action", `🎓 graduated "${s.title}": ${result.from} → ${result.to}`);
              audit("config_change", `graduation: ${s.title} promoted ${result.from} → ${result.to}`, s.title);
            } else if (result.action === "demote") {
              tui.log("status", `⬇ demoted "${s.title}": ${result.from} → ${result.to}`);
              audit("config_change", `graduation: ${s.title} demoted ${result.from} → ${result.to}`, s.title);
            }
          }
        }

        // workflow engine: advance active workflow based on task states
        if (activeWorkflow && taskManager && tui) {
          const wf = activeWorkflow; // capture before potential null assignment
          const taskStates = new Map(taskManager.tasks.map((t) => [t.sessionTitle, t.status]));
          const { actions: wfActions, completed } = advanceWorkflow(wf, taskStates);
          for (const a of wfActions) {
            if (a.type === "activate_task") {
              const task = taskManager.getTaskForSession(a.detail);
              if (task && task.status === "pending") task.status = "active";
            }
            tui.log("status", `workflow: ${a.type} — ${a.detail}`);
            audit("task_created", `workflow ${a.type}: ${a.detail}`, a.detail);
          }
          if (completed) {
            tui.log("+ action", `workflow "${wf.name}" completed`);
            activeWorkflow = null;
          }
        }

        // workflow chain: advance cross-workflow dependencies
        if (activeWorkflowChain && tui) {
          const chain = activeWorkflowChain;
          const wfStates = new Map<string, WorkflowState>();
          const { activate, completed: chainDone, failed: chainFailed } = advanceChain(chain, wfStates);
          for (const name of activate) {
            tui.log("status", `workflow-chain: activating workflow "${name}"`);
            audit("task_created", `chain activated: ${name}`, name);
          }
          if (chainDone) {
            tui.log("+ action", `workflow chain "${chain.name}" completed`);
            activeWorkflowChain = null;
          }
          if (chainFailed) {
            tui.log("status", `workflow chain "${chain.name}" has failures`);
          }
        }

        // custom alert rules: evaluate fleet conditions per tick
        if (tui) {
          const sessions = tui.getSessions();
          const tasks = taskManager?.tasks ?? [];
          const scores = sessions.map((s) => s.status === "working" || s.status === "running" ? 80 : s.status === "error" ? 20 : 50);
          const fleetHealth = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 100;
          const activeSessions = sessions.filter((s) => s.status === "working" || s.status === "running").length;
          const errorSessions = sessions.filter((s) => s.status === "error").length;
          const stuckSessions = tasks.filter((t) => t.status === "active" && (t.stuckNudgeCount ?? 0) > 0).length;
          let hourlyCost = 0;
          for (const s of sessions) { const m = s.costStr?.match(/\$(\d+(?:\.\d+)?)/); if (m) hourlyCost += parseFloat(m[1]); }
          const alertCtx: AlertContext = { fleetHealth, activeSessions, errorSessions, totalCostUsd: hourlyCost, hourlyCostRate: hourlyCost, stuckSessions, idleMinutes: new Map() };
          const firedAlerts = evaluateAlertRules(alertRules, alertCtx);
          for (const alert of firedAlerts) {
            tui.log("status", `${alert.severity === "critical" ? "🚨" : alert.severity === "warning" ? "⚠" : "ℹ"} ALERT: ${alert.message}`);
            audit("session_error", `alert fired: ${alert.ruleName} — ${alert.message}`, undefined, { severity: alert.severity });
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
      const errStr = String(err);
      if (errStr === lastTickError) {
        repeatedErrorCount++;
        if (repeatedErrorCount === 3) {
          const msg = `same error repeated 3 times — suppressing until it changes`;
          if (tui) tui.log("error", msg); else console.error(`[error] ${msg}`);
        } else if (repeatedErrorCount > 3 && repeatedErrorCount % 10 === 0) {
          const msg = `same error repeated ${repeatedErrorCount} times: ${errStr.slice(0, 80)}`;
          if (tui) tui.log("error", msg); else console.error(`[error] ${msg}`);
        }
        // suppress individual messages after 3 repeats
      } else {
        lastTickError = errStr;
        repeatedErrorCount = 1;
        const msg = `tick ${pollCount} failed: ${errStr}`;
        if (tui) tui.log("error", msg); else console.error(`[error] ${msg}`);
      }
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
// §TICK ──────────────────────────────────────────────────────────────────
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
    observationCache: ObservationCache;
    fleetRateLimiter: FleetRateLimiter;
    reasonerCostTracker: ReasonerCostTracker;
    nudgeTracker: NudgeTracker;
    escalationManager: EscalationManager;
    graduationManager: GraduationManager;
    approvalQueue: ApprovalQueue;
    tokenQuotaManager: TokenQuotaManager;
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

  // wrap reasoner with timeout + interrupt + intelligence pipeline
  const wrappedReasoner: import("./types.js").Reasoner = {
    init: () => reasoner.init(),
    shutdown: () => reasoner.shutdown(),
    decide: async (obs) => {
      // ── gate 0: per-model token quota — block if model quota exceeded ──
      if (intelligence?.tokenQuotaManager.isBlocked(config.reasoner)) {
        const status = intelligence.tokenQuotaManager.getStatus(config.reasoner);
        if (tui) tui.log("status", `⏸ token quota exceeded for ${config.reasoner}: ${status.reason}`);
        audit("reasoner_action", `token quota blocked: ${config.reasoner} — ${status.reason}`);
        return { actions: [{ action: "wait" as const, reason: `token quota: ${status.reason}` }] };
      }

      // ── gate 1: fleet rate limiter — block if over API spend limits ──
      if (intelligence?.fleetRateLimiter.isBlocked()) {
        const status = intelligence.fleetRateLimiter.getStatus();
        if (tui) tui.log("status", `⏸ reasoning blocked: ${status.reason}`);
        audit("reasoner_action", `blocked by fleet rate limiter: ${status.reason}`);
        return { actions: [{ action: "wait" as const, reason: `rate limited: ${status.reason}` }] };
      }

      // ── gate 2: observation cache — skip LLM for duplicate observations ──
      const obsJson = JSON.stringify({ sessions: obs.sessions.map((s) => s.outputHash), changes: obs.changes.length });
      const cached = intelligence?.observationCache.get(obsJson);
      if (cached) {
        if (tui) tui.log("status", `cache hit — skipping LLM call (${intelligence!.observationCache.getStats().totalHits} hits)`);
        return cached;
      }

      // ── gate 3: priority filtering — only send highest-priority sessions ──
      let filteredObs = obs;
      if (tui && taskManager) {
        const sessions = tui.getSessions();
        const tasks = taskManager.tasks;
        const priorityInputs = sessions.map((s) => {
          const task = tasks.find((t) => t.sessionTitle === s.title);
          const lastChange = tui.getAllLastChangeAt().get(s.id);
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
        const ranked = rankSessionsByPriority(priorityInputs);
        const changedTitles = new Set(obs.changes.map((c) => c.title));
        const { filtered, excluded } = filterByPriority(obs, ranked, changedTitles);
        if (excluded.length > 0) {
          tui.log("status", `priority filter: ${excluded.length} session${excluded.length !== 1 ? "s" : ""} excluded from reasoning`);
        }
        filteredObs = filtered;
      }

      // ── gate 4: context compression — compress old pane output ──
      const compressedObs = { ...filteredObs };
      // compress session output for each snapshot to reduce token usage
      for (const snap of compressedObs.sessions) {
        const lines = snap.output.split("\n");
        if (lines.length > 50) {
          const compressed = compressObservation(lines, 30, 8);
          snap.output = compressed.text;
        }
      }

      writeState("reasoning", { pollCount, pollIntervalMs: config.pollIntervalMs });
      if (tui) tui.updateState({ phase: "reasoning" }); else process.stdout.write(" | reasoning...");

      const startedAt = Date.now();
      const { result: r, interrupted } = await withTimeoutAndInterrupt(
        (signal) => reasoner.decide(compressedObs, signal),
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

      // record cost + cache result
      if (intelligence) {
        const tokenEstimate = Math.ceil(JSON.stringify(compressedObs).length / 4);
        const outputEstimate = Math.ceil(JSON.stringify(r).length / 4);
        intelligence.reasonerCostTracker.recordCall("fleet", tokenEstimate, outputEstimate, reasonerDurationMs);
        intelligence.fleetRateLimiter.recordCost(estimateCallCost(tokenEstimate, outputEstimate));
        intelligence.observationCache.set(obsJson, r);
        // per-model token quota tracking
        intelligence.tokenQuotaManager.recordUsage(config.reasoner, tokenEstimate, outputEstimate);

        // approval workflow: gate risky/low-confidence actions through approval queue
        if (config.confirm || r.confidence === "low") {
          const { immediate, queued } = filterThroughApproval(r, intelligence.approvalQueue);
          if (queued.length > 0) {
            const status = formatApprovalWorkflowStatus(queued.length, immediate.length);
            if (tui) tui.log("status", `🔒 approval: ${status}`);
            audit("operator_command", `approval workflow: ${status}`);
          }
          return { ...r, actions: immediate };
        }
      }

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
      const hint = pollCount <= 1
        ? "no active aoe sessions found — create one with: aoe add <path> -t <title> -c opencode -y"
        : "waiting for aoe sessions...";
      if (tui) tui.log("observation", hint); else log(hint);
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
  // session graduation: record action outcomes for trust tracking
  if (intelligence) {
    for (const entry of executed) {
      if (entry.action.action === "wait") continue;
      const sid = actionSession(entry.action);
      const title = sid ? (sessionTitleMap.get(sid) ?? sid) : undefined;
      if (!title) continue;
      if (entry.success) intelligence.graduationManager.recordSuccess(title);
      else intelligence.graduationManager.recordFailure(title);
    }
  }

  // auto-pause tracking + smart nudge + nudge effectiveness + escalation
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

      // track nudge for effectiveness measurement
      const nudgeText = actionDetail(entry.action) ?? "";
      if (intelligence) intelligence.nudgeTracker.recordNudge(title, nudgeText, now);

      const lastProgress = task.lastProgressAt ?? 0;
      if (lastProgress > 0 && (now - lastProgress) > stuckThresholdMs) {
        // escalation: track stuck notifications
        if (intelligence) {
          const escalation = intelligence.escalationManager.recordStuck(title, now);
          if (escalation) {
            audit("stuck_nudge", escalation.message, title, { level: escalation.level });
          }
        }

        const paused = taskManager.recordStuckNudge(title, maxNudges);
        if (paused) {
          const msg = `auto-paused '${title}' after ${task.stuckNudgeCount} stuck nudges`;
          if (tui) tui.log("system", msg); else log(msg);
          appendSupervisorEvent({ at: Date.now(), detail: `auto-pause: ${title}` });
          if (intelligence) intelligence.escalationManager.clearSession(title); // clear escalation on pause
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

    // record progress events for nudge effectiveness tracking
    for (const entry of executed) {
      if (entry.action.action === "report_progress" && entry.success) {
        const sid = actionSession(entry.action);
        const title = sid ? (sessionTitleMap.get(sid) ?? sid) : undefined;
        if (title && intelligence) {
          intelligence.nudgeTracker.recordProgress(title, now);
          intelligence.escalationManager.clearSession(title); // progress = not stuck anymore
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

// §HELPERS ───────────────────────────────────────────────────────────────
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
    console.error("failed to list sessions — is aoe installed? (https://github.com/njbrake/agent-of-empires)");
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
    toolChecks.push({ cmd: "opencode", label: "OpenCode CLI", versionArg: ["--version"], required: true });
  } else {
    toolChecks.push({ cmd: "claude", label: "Claude Code CLI", versionArg: ["--version"], required: true });
  }

  for (const tool of toolChecks) {
    checks++;
    try {
      const result = await shellExec(tool.cmd, tool.versionArg);
      // filter out error lines that some tools print alongside version info
      const cleanStdout = result.stdout.trim().split("\n").filter((l: string) => !l.startsWith("Error:") && !l.startsWith("error:")).join("\n");
      const cleanStderr = result.stderr.trim().split("\n").filter((l: string) => !l.startsWith("Error:") && !l.startsWith("error:")).join("\n");
      const ver = (cleanStdout.split("\n")[0] || cleanStderr.split("\n")[0] || "installed").slice(0, 60);
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
    try {
      unlinkSync(lockPath);
      console.log(`  ${GREEN}✓${RESET} cleaned up stale lock file: ${lockPath}`);
    } catch {
      console.log(`  ${YELLOW}!${RESET} stale lock file found: ${lockPath}`);
      console.log(`    ${DIM}remove with: rm ${lockPath}${RESET}`);
      warnings++;
    }
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
      console.log(`  ${YELLOW}!${RESET} aoe list returned non-zero — is aoe installed? (https://github.com/njbrake/agent-of-empires)`);
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
