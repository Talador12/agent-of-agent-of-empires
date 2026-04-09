// daemon-context.ts — shared state bundle for TUI command handlers.
// extracted from index.ts to break the god-file. all fields are the same
// variables that main() instantiates; the TUI handlers close over them.

import type { AoaoeConfig, TaskState } from "./types.js";
import type { InputReader } from "./input.js";
import type { TUI } from "./tui.js";
import type { Executor } from "./executor.js";
import type { TaskManager } from "./task-manager.js";
import type { SessionSummarizer } from "./session-summarizer.js";
import type { ConflictDetector } from "./conflict-detector.js";
import type { ActivityTracker } from "./activity-heatmap.js";
import type { BudgetPredictor } from "./budget-predictor.js";
import type { TaskRetryManager } from "./task-retry.js";
import type { AdaptivePollController } from "./adaptive-poll.js";
import type { EscalationManager } from "./notify-escalation.js";
import type { SessionPoolManager } from "./session-pool.js";
import type { ReasonerCostTracker } from "./reasoner-cost.js";
import type { FleetSlaMonitor } from "./fleet-sla.js";
import type { ProgressVelocityTracker } from "./progress-velocity.js";
import type { FleetUtilizationTracker } from "./fleet-utilization.js";
import type { NudgeTracker } from "./nudge-tracker.js";
import type { ObservationCache } from "./observation-cache.js";
import type { FleetRateLimiter } from "./fleet-rate-limiter.js";
import type { RecoveryPlaybookManager } from "./recovery-playbook.js";
import type { ApprovalQueue } from "./approval-queue.js";
import type { GraduationManager } from "./session-graduation.js";
import type { TokenQuotaManager } from "./token-quota.js";
import type { ABReasoningTracker } from "./ab-reasoning.js";
import type { FleetEventBus } from "./fleet-event-bus.js";
import type { DaemonMetricsHistogram } from "./daemon-metrics-histogram.js";
import type { FleetIncidentTimeline } from "./fleet-incident-timeline.js";
import type { FleetCapacityForecaster } from "./fleet-capacity-forecaster.js";
import type { FleetCostRegression } from "./fleet-cost-regression.js";
import type { DaemonTickProfiler } from "./daemon-tick-profiler.js";
import type { SessionHealthHistory } from "./session-health-history.js";
import type { GoalProgressPredictor } from "./goal-progress-prediction.js";
import type { DaemonPerfRegression } from "./daemon-perf-regression.js";
import type { FleetCostTrend } from "./fleet-cost-trend.js";
import type { FleetUtilizationForecaster } from "./fleet-utilization-forecaster.js";
import type { DaemonStartupProfiler } from "./daemon-startup-profiler.js";
import type { OutputRedactor } from "./session-output-redaction.js";
import type { DaemonPluginHooks } from "./daemon-plugin-hooks.js";
import type { ApiServer } from "./api-server.js";

// types from modules that use factory functions (not classes)
import type { WorkflowState } from "./workflow-engine.js";
import type { WorkflowChain } from "./workflow-chain.js";
import type { RunbookExecution } from "./runbook-executor.js";
import type { SessionTagStore } from "./session-tag-manager.js";
import type { IdleDetectorState } from "./session-idle-detector.js";
import type { ThrottleState } from "./cost-anomaly-throttle.js";
import type { HeartbeatState } from "./session-heartbeat.js";
import type { ReplayState } from "./action-replay.js";
import type { IncrementalContextState } from "./incremental-context.js";
import type { PeerReviewState } from "./session-peer-review.js";
import type { WarmStandbyState } from "./fleet-warm-standby.js";
import type { BookmarkState } from "./session-output-bookmarks.js";
import type { CanaryState } from "./daemon-canary-mode.js";
import type { ConfigDiffState } from "./daemon-config-diff.js";
import type { WatchdogState } from "./daemon-watchdog.js";
import type { CascadeState } from "./goal-cascading.js";
import type { ReplayPlaybackState } from "./fleet-event-replay.js";
import type { GroupingState } from "./fleet-session-grouping.js";
import type { ContextDiffState } from "./session-context-diff.js";
import type { CompressionState } from "./fleet-snapshot-compression.js";
import type { AnnotationState } from "./session-output-annotations.js";
import type { SupervisorState } from "./daemon-process-supervisor.js";
import type { HotSwapState } from "./daemon-hot-swap.js";
import type { EvolutionState } from "./session-pattern-evolution.js";
import type { AlertDashboardState } from "./fleet-alert-dashboard.js";
import type { SlaState } from "./goal-sla-enforcement.js";
import type { AutoScalerState } from "./fleet-auto-scaler.js";
import type { XPState } from "./goal-gamification.js";
import type { ShutdownState } from "./daemon-graceful-shutdown.js";
import type { HeatmapState } from "./goal-progress-heatmap.js";
import type { EventStore } from "./daemon-event-sourcing.js";
import type { LockState } from "./daemon-distributed-lock.js";
import type { TimeMachineState } from "./fleet-snapshot-time-machine.js";
import type { TickBudgetState } from "./daemon-tick-budget.js";
import type { MutationState } from "./session-goal-mutation.js";
import type { AffinityState } from "./session-affinity-router.js";
import type { RateLimiterState } from "./api-rate-limiting.js";
import type { KnowledgeStore } from "./cross-session-knowledge.js";
import type { WebhookPushState } from "./api-webhook-push.js";
import type { RetentionState } from "./audit-trail-retention.js";
import type { ResourceMonitorState } from "./daemon-resource-monitor.js";
import type { BurndownState } from "./goal-progress-burndown.js";
import type { LeakDetectorState } from "./daemon-memory-leak-detector.js";
import type { InheritableRule } from "./alert-rule-inheritance.js";
import type { AlertRule } from "./alert-rules.js";

/** all shared state that TUI command handlers need from the daemon */
export interface DaemonContext {
  // core
  config: AoaoeConfig;
  tui: TUI;
  input: InputReader;
  executor: Executor | null;
  taskManager: TaskManager | undefined;
  basePath: string;
  taskProfiles: string[];
  configPath: string;

  // intelligence modules (classes)
  sessionSummarizer: SessionSummarizer;
  conflictDetector: ConflictDetector;
  activityTracker: ActivityTracker;
  budgetPredictor: BudgetPredictor;
  taskRetryManager: TaskRetryManager;
  adaptivePollController: AdaptivePollController;
  escalationManager: EscalationManager;
  sessionPoolManager: SessionPoolManager;
  reasonerCostTracker: ReasonerCostTracker;
  fleetSlaMonitor: FleetSlaMonitor;
  progressVelocityTracker: ProgressVelocityTracker;
  fleetUtilizationTracker: FleetUtilizationTracker;
  nudgeTracker: NudgeTracker;
  observationCache: ObservationCache;
  fleetRateLimiter: FleetRateLimiter;
  recoveryPlaybookManager: RecoveryPlaybookManager;
  approvalQueue: ApprovalQueue;
  graduationManager: GraduationManager;
  tokenQuotaManager: TokenQuotaManager;
  abReasoningTracker: ABReasoningTracker;
  fleetEventBus: FleetEventBus;
  daemonMetrics: DaemonMetricsHistogram;
  incidentTimeline: FleetIncidentTimeline;
  capacityForecaster: FleetCapacityForecaster;
  costRegressionDetector: FleetCostRegression;
  tickProfiler: DaemonTickProfiler;
  sessionHealthHistory: SessionHealthHistory;
  progressPredictor: GoalProgressPredictor;
  perfRegressionDetector: DaemonPerfRegression;
  costTrendTracker: FleetCostTrend;
  utilForecaster: FleetUtilizationForecaster;
  startupProfiler: DaemonStartupProfiler;
  outputRedactor: OutputRedactor;
  daemonPluginHooks: DaemonPluginHooks;

  // intelligence modules (state objects from factory functions)
  alertRules: AlertRule[];
  activeWorkflow: { value: WorkflowState | null };   // wrapped for mutation
  activeWorkflowChain: { value: WorkflowChain | null };
  activeRunbookExec: { value: RunbookExecution | null };
  sessionTagStore: SessionTagStore;
  idleDetectorState: IdleDetectorState;
  costThrottleState: ThrottleState;
  heartbeatState: HeartbeatState;
  actionReplayState: { value: ReplayState | null };
  incrementalContextState: IncrementalContextState;
  peerReviewState: PeerReviewState;
  warmStandbyState: WarmStandbyState;
  bookmarkState: BookmarkState;
  canaryState: CanaryState;
  configDiffState: ConfigDiffState;
  watchdogState: WatchdogState;
  cascadeState: CascadeState;
  eventReplayState: { value: ReplayPlaybackState | null };
  sessionGroupingState: GroupingState;
  contextDiffState: ContextDiffState;
  snapshotCompressionState: CompressionState;
  outputAnnotationState: AnnotationState;
  processSupervisorState: SupervisorState;
  hotSwapState: HotSwapState;
  patternEvolutionState: EvolutionState;
  alertDashboardState: AlertDashboardState;
  goalSlaState: SlaState;
  autoScalerState: AutoScalerState;
  xpState: XPState;
  shutdownState: ShutdownState;
  progressHeatmapState: HeatmapState;
  daemonEventStore: EventStore;
  daemonLock: LockState;
  timeMachineState: TimeMachineState;
  tickBudgetState: TickBudgetState;
  goalMutationState: MutationState;
  affinityRouterState: AffinityState;
  apiRateLimiterState: RateLimiterState;
  knowledgeStore: KnowledgeStore;
  webhookPushState: WebhookPushState;
  auditRetentionState: RetentionState;
  resourceMonitorState: ResourceMonitorState;
  burndownStates: Map<string, BurndownState>;
  leakDetectorState: LeakDetectorState;

  // shared maps/state
  previousOutputs: Map<string, string>;

  // API server (optional)
  apiServer: ApiServer | null;

  // scalar state (counters, timestamps)
  totalPolls: number;
  daemonStartedAt: number;

  // closures from main
  persistPrefs: () => void;
  refreshTaskSupervisorState: (reason?: string) => void;
}
