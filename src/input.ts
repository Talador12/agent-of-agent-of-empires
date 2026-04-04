// interactive stdin input -- lets the user send messages to the reasoner
// and run built-in slash commands while the daemon is running.
// in v0.32.0+ the daemon runs interactively in the same terminal (no separate attach).
import { createInterface, emitKeypressEvents, type Interface } from "node:readline";
import { requestInterrupt } from "./daemon-state.js";

import { GREEN, DIM, YELLOW, RED, BOLD, RESET } from "./colors.js";
import { resolveAlias, validateAliasName, MAX_ALIASES } from "./tui.js";

// ESC-ESC interrupt detection
const ESC_DOUBLE_TAP_MS = 500;

export type ScrollDirection = "up" | "down" | "top" | "bottom";

export const INSIST_PREFIX = "__INSIST__";

export type ViewHandler = (target: string | null) => void; // null = back to overview
export type SearchHandler = (pattern: string | null) => void; // null = clear search
export type QuickSwitchHandler = (sessionNum: number) => void; // 1-indexed session number
export type SortHandler = (mode: string | null) => void; // null = cycle to next mode
export type CompactHandler = () => void; // toggle compact mode
export type PinHandler = (target: string) => void; // session index or name to pin/unpin
export type BellHandler = () => void; // toggle bell notifications
export type FocusHandler = () => void; // toggle focus mode
export type MarkHandler = () => void; // add bookmark
export type JumpHandler = (num: number) => void; // jump to bookmark N
export type MarksHandler = () => void; // list bookmarks
export type MuteHandler = (target: string) => void; // session index or name to mute/unmute
export type UnmuteAllHandler = () => void; // clear all mutes at once
export type TagFilterHandler = (tag: string | null) => void; // set or clear tag filter
export type UptimeHandler = () => void; // list all session uptimes
export type AutoPinHandler = () => void; // toggle auto-pin on error
export type NoteHandler = (target: string, text: string) => void; // session + note text (empty = clear)
export type NotesHandler = () => void;
export type ClipHandler = (count: number) => void;
export type DiffHandler = (bookmarkNum: number) => void;
export type WhoHandler = () => void;
export type AliasChangeHandler = () => void; // list all session notes
export type GoalCaptureModeHandler = () => boolean;
export type GroupHandler = (target: string, group: string) => void; // session + group tag (empty = clear)
export type GroupsHandler = () => void; // list all groups
export type GroupFilterHandler = (group: string | null) => void; // filter sessions to a group (null = clear)
export type BurnRateHandler = () => void; // show current context burn rates
export type SnapshotHandler = (format: "json" | "md") => void; // export snapshot
export type BroadcastHandler = (message: string, group: string | null) => void; // broadcast to sessions
export type WatchdogHandler = (thresholdMinutes: number | null) => void; // set watchdog (null = off)
export type TopHandler = (mode: string) => void; // show ranked session view
export type CeilingHandler = () => void; // show context ceiling for all sessions
export type RenameHandler = (target: string, name: string) => void; // rename a session display name
export type CopySessionHandler = (target: string | null) => void; // copy session pane output (null = current drilldown)
export type StatsHandler = () => void; // show per-session stats summary
export type StatsLiveHandler = () => void; // toggle auto-refreshing stats every N seconds
export type RecallHandler = (keyword: string, maxResults: number) => void; // search history
export type PinAllErrorsHandler = () => void; // pin all sessions currently in error
export type ExportStatsHandler = () => void; // export /stats to JSON file
export type MuteErrorsHandler = () => void; // toggle suppression of error-tagged entries
export type PrevGoalHandler = (target: string, nBack: number) => void; // restore previous goal
export type TagHandler = (target: string, tags: string[]) => void; // set session tags (empty = clear)
export type TagsListHandler = () => void; // list all session tags
export type TagFilterHandler2 = (tag: string | null) => void; // filter sessions by freeform tag (null = clear)
export type FindHandler = (text: string) => void; // search session outputs
export type ResetHealthHandler = (target: string) => void; // reset a session's health state
export type TimelineHandler = (target: string, count: number) => void; // show session activity timeline
export type ColorHandler = (target: string, colorName: string) => void; // set session accent color
export type ClearHistoryHandler = () => void; // truncate tui-history.jsonl
export type DuplicateHandler = (target: string, newTitle: string) => void; // clone a session
export type ColorAllHandler = (colorName: string) => void; // set color for all sessions
export type QuietHoursHandler = (specs: string[]) => void; // set quiet hours (empty = clear)
export type HistoryStatsHandler = () => void; // show aggregate history stats
export type CostSummaryHandler = () => void; // show cost summary across sessions
export type SessionReportHandler = (target: string) => void; // generate session markdown report
export type QuietStatusHandler = () => void; // show quiet hours status
export type AlertLogHandler = (count: number) => void; // show recent auto-generated alerts
export type BudgetHandler = (target: string | null, budgetUSD: number | null) => void; // set cost budget
export type BulkControlHandler = (action: "pause" | "resume") => void; // pause-all / resume-all
export type HealthTrendHandler = (target: string, height: number) => void; // show health trend chart
export type AlertMuteHandler = (pattern: string | null) => void; // add/clear alert mute pattern
export type BudgetsListHandler = () => void; // list all active budgets
export type BudgetStatusHandler = () => void; // show which sessions are over/under budget
export type FlapLogHandler = () => void; // show recent flap events
export type DrainHandler = (target: string, drain: boolean) => void; // drain/undrain a session
export type ExportAllHandler = () => void; // bulk export snapshot+stats for all sessions
export type NoteHistoryHandler = (target: string) => void; // show note history for a session
export type LabelHandler = (target: string, label: string) => void; // set/clear session label
export type SessionsTableHandler = () => void; // show rich sessions table
export type LabelsHandler = () => void; // list all active session labels
export type PinDrainingHandler = () => void; // pin all draining sessions
export type IconHandler = (target: string, emoji: string | null) => void; // set/clear session emoji icon
export type DiffSessionsHandler = (a: string, b: string) => void; // compare two sessions' pane output
export type FanOutHandler = () => void; // generate starter task list from active sessions
export type TrustHandler = (arg: string) => void; // /trust [level|auto|off|on]
export type CtxBudgetHandler = () => void; // show smart context budget allocations
export type ProfileHandler = () => void; // show active profiles summary
export type ReplayHandler = (target: string, speed: number | null) => void; // replay session output
export type NotifyFilterHandler = (sessionTitle: string | null, events: string[]) => void; // per-session notification filter
export type DepsHandler = () => void; // show session dependency graph
export type FullSearchHandler = (query: string) => void; // ranked full-text search across session outputs
export type RelayHandler = (args: string) => void; // cross-session relay management
export type ThrottleHandler = (args: string) => void; // per-session action throttle
export type SnapHandler = (target: string) => void; // save output snapshot
export type SnapDiffHandler = (target: string) => void; // diff current output vs snapshot
export type AlertPatternHandler = (args: string) => void; // output pattern alerting management
export type HookHandler = (args: string) => void; // session lifecycle hook management
export type ActivityHandler = () => void; // show plain-English session activity summaries
export type ConflictsHandler = () => void; // show cross-session file edit conflicts
export type HeatmapHandler = () => void; // show per-session activity heatmap sparklines
export type AuditHandler = (count: number) => void; // show recent audit trail entries
export type AuditStatsHandler = () => void; // show audit event type counts
export type FleetSnapHandler = () => void; // take a manual fleet snapshot
export type BudgetPredictHandler = () => void; // show predictive budget exhaustion estimates
export type RetriesHandler = () => void; // show task retry states
export type AuditSearchHandler = (query: string) => void; // search audit trail
export type FleetForecastHandler = () => void; // show fleet-wide cost forecast
export type PriorityQueueHandler = () => void; // show session priority ranking
export type EscalationsHandler = () => void; // show notification escalation states
export type PollStatusHandler = () => void; // show adaptive poll interval status
export type DriftHandler = () => void; // show drift detection for all sessions
export type GoalProgressHandler = () => void; // show goal progress estimates
export type PoolHandler = () => void; // show session pool status
export type ReasonerCostHandler = () => void; // show reasoner cost tracking
export type AnomalyHandler = () => void; // show anomaly detection results
export type SlaHandler = () => void; // show fleet health SLA status
export type VelocityHandler = () => void; // show progress velocity + ETA
export type ScheduleHandler = () => void; // show dependency-aware scheduling actions
export type CacheHandler = () => void; // show observation cache stats
export type RateLimitHandler = () => void; // show fleet rate limit status
export type RecoveryHandler = () => void; // show recovery playbook states
export type LifecycleHandler = () => void; // show task lifecycle analytics
export type CostReportHandler = () => void; // show cost attribution report
export type DecomposeHandler = (target: string) => void; // decompose a task's goal
export type MemoryHandler = (target: string) => void; // show session memory
export type DepGraphHandler = () => void; // show dependency graph visualization
export type ApprovalQueueHandler = () => void; // show approval queue
export type ApproveHandler = (target: string) => void; // approve pending decision
export type RejectHandler = (target: string) => void; // reject pending decision
export type FleetDiffHandler = () => void; // compare latest fleet snapshots
export type SessionTemplateHandler = (name: string) => void; // show/apply session template
export type DifficultyHandler = () => void; // show task difficulty scores
export type SmartNudgeHandler = (target: string) => void; // preview smart nudge for session
export type UtilizationHandler = () => void; // show fleet utilization heatmap
export type DetectTemplateHandler = (target: string) => void; // detect template from repo
export type FleetSearchHandler = (query: string) => void; // search all session outputs
export type NudgeStatsHandler = () => void; // show nudge effectiveness stats
export type AllocationHandler = () => void; // show difficulty-based allocation
export type GraduationHandler = () => void; // show session graduation states
export type RefineHandler = (target: string) => void; // suggest goal refinements
export type ExportHandler = () => void; // generate fleet HTML report
export type ServiceHandler = () => void; // generate service file for boot
export type SessionReplayHandler = (target: string) => void; // replay session activity
export type WorkflowHandler = () => void; // show workflow state
export type MultiReasonerHandler = () => void; // show reasoner assignments
export type TokenQuotaHandler = () => void; // show per-model token quotas
export type CheckpointHandler = () => void; // show checkpoint info
export type WorkflowNewHandler = (template: string) => void; // create workflow from template
export type ABStatsHandler = () => void; // show A/B reasoning stats
export type WorkflowChainHandler = () => void; // show workflow chain state
export type WorkflowForecastHandler = (template: string) => void; // show workflow cost forecast
export type FederationHandler = () => void; // show federation overview
export type ArchivesHandler = () => void; // show output archives
export type RunbookGenHandler = () => void; // generate runbooks from audit trail
export type AlertRulesHandler = () => void; // show alert rules status
export type SessionTailHandler = (args: string) => void; // tail session output
export type HealthForecastHandler = () => void; // show health trend forecast
export type WorkflowVizHandler = () => void; // show workflow ASCII DAG
export type SessionDiffHandler = (args: string) => void; // diff session output
export type SessionTagHandler = (args: string) => void; // set/show session tags
export type CompareHandler = (args: string) => void; // compare two sessions
export type FleetReportHandler = () => void; // generate fleet summary report
export type TaskTimelineHandler = (target: string) => void; // show session task timeline
export type ChangelogHandler = (args: string) => void; // show fleet changelog
export type MetricsHandler = () => void; // show Prometheus metrics
export type FleetGrepHandler = (pattern: string) => void; // grep archived outputs
export type RunbookExecHandler = () => void; // execute/advance runbook
export type CloneHandler = (args: string) => void; // clone a session
export type SimilarGoalsHandler = () => void; // find similar goals
export type CostTagsHandler = (tagKey: string) => void; // group costs by tag
export type ScalingHandler = () => void; // show scaling recommendation
export type IdleDetectHandler = () => void; // show idle session alerts
export type GoalConflictsHandler = () => void; // show goal conflict analysis
export type LeaderboardHandler = () => void; // show fleet productivity leaderboard
export type HealthHistoryHandler = () => void; // show per-session health history sparklines
export type CostThrottleHandler = () => void; // show cost anomaly throttle state
export type SuggestNameHandler = (args: string) => void; // suggest session names from repo+goal
export type ShiftHandoffHandler = () => void; // generate operator shift handoff notes
export type AutoDepsHandler = () => void; // auto-detect session dependencies
export type CostForecastHandler = () => void; // show cost forecast alerts + projections
export type EventBusHandler = () => void; // show fleet event bus state
export type VerifyGoalsHandler = () => void; // verify completed goals for regressions
export type OutputDiffHandler = (target: string) => void; // show output diff for a session
export type HeartbeatHandler = () => void; // show session heartbeat status
export type ActionReplayHandler = (args: string) => void; // action replay navigation
export type ConfigProfilesHandler = (args: string) => void; // show/apply config profiles
export type DoctorHandler = () => void; // run daemon self-diagnostics
export type StateMachineHandler = (args: string) => void; // show session state machine
export type ContextStatsHandler = () => void; // show incremental context stats
export type MetricsHistHandler = () => void; // show daemon metrics histogram
export type PeerReviewHandler = (args: string) => void; // manage peer reviews
export type WarmStandbyHandler = (args: string) => void; // manage warm standby slots
export type RedactionStatsHandler = () => void; // show output redaction stats
export type ComplianceHandler = () => void; // run fleet compliance check
export type PluginHooksHandler = () => void; // show daemon plugin hooks state
export type IncidentTimelineHandler = () => void; // show fleet incident timeline
export type BookmarkHandler = (args: string) => void; // manage output bookmarks
export type CanaryModeHandler = (args: string) => void; // manage canary mode
export type ConfigDiffHandler = () => void; // show config diff between reloads
export type GoalPriorityHandler = () => void; // show auto-prioritized goals
export type CapacityForecastHandler = () => void; // show fleet capacity forecast
export type WatchdogStatusHandler = () => void; // show daemon watchdog status
export type CostRegressionHandler = () => void; // show fleet cost regression alerts
export type GoalCascadeHandler = (args: string) => void; // manage goal cascading
export type HealthScoreHandler = () => void; // show daemon composite health score
export type EventReplayHandler = (args: string) => void; // replay event bus history
export type ContextBudgetHandler = () => void; // show context budget allocation
export type TickProfilerHandler = () => void; // show tick profiler stats
export type GoalConfidenceHandler = () => void; // show goal confidence estimates
export type BudgetPlanHandler = () => void; // show fleet budget allocation plan
export type SentimentHandler = () => void; // show session output sentiment analysis
export type WorkloadBalanceHandler = () => void; // show fleet workload balance report
export type CrashReportHandler = () => void; // show crash report preview
export type SessionGroupHandler = (args: string) => void; // manage session groups
export type ContextDiffHandler = () => void; // show context file diffs
export type ConfigSchemaHandler = () => void; // validate config against schema
export type TranscriptExportHandler = (session: string) => void; // export session transcript
export type DecompQualityHandler = () => void; // show goal decomposition quality
export type AnomalyCorrelationHandler = () => void; // show correlated anomalies
export type CriticalPathHandler = () => void; // show goal dependency critical path
export type SnapshotCompressionHandler = () => void; // show snapshot compression stats
export type OutputAnnotationsHandler = (args: string) => void; // manage output annotations
export type CelebrationHandler = () => void; // show goal completion celebrations
export type ReadinessHandler = () => void; // show fleet operational readiness score
export type ProcessSupervisorHandler = () => void; // show process supervisor state
export type DailyDigestHandler = () => void; // show fleet daily digest
export type GoalParserHandler = (text: string) => void; // parse natural language goal
export type HotSwapHandler = (args: string) => void; // manage module hot-swapping
export type WebhookPreviewHandler = (args: string) => void; // preview webhook payloads
export type StructuredLogHandler = () => void; // parse output into structured events
export type StateExportHandler = () => void; // export daemon state
export type OutputDedupHandler = (session: string) => void; // deduplicate session output
export type ConfigMigrateHandler = () => void; // migrate config to latest version
export type ProgressPredictHandler = () => void; // predict goal completion times
export type OpsDashboardHandler = () => void; // show fleet ops dashboard
export type DepRepairHandler = () => void; // auto-repair broken dependency chains
export type PatternEvolutionHandler = () => void; // show output pattern evolution
export type AlertDashboardHandler = (args: string) => void; // manage alert dashboard
export type LangDetectHandler = () => void; // detect programming languages
export type GoalSlaHandler = (args: string) => void; // manage goal SLA enforcement
export type AutoScalerHandler = () => void; // show auto-scaler state
export type GamificationHandler = () => void; // show XP/level leaderboard
export type AuditReportHandler = () => void; // generate audit compliance report
export type StartupProfileHandler = () => void; // show startup profiler timings
export type AffinityGroupsHandler = () => void; // show session affinity groups
export type ClipboardHandler = (session: string) => void; // copy output to clipboard
export type GracefulShutdownHandler = () => void; // show shutdown state
export type DepImpactHandler = (session: string) => void; // analyze dependency impact
export type RunbookLibraryHandler = (args: string) => void; // browse/search runbooks
export type DepGraphExportHandler = (args: string) => void; // export dep graph
export type PerfRegressionHandler = () => void; // show perf regression state
export type ComplianceReportHandler2 = () => void; // generate compliance report

// ── Mouse event types ───────────────────────────────────────────────────────

export interface MouseEvent {
  button: number;  // 0=left, 1=middle, 2=right, 64=scroll-up, 65=scroll-down
  col: number;     // 1-indexed column
  row: number;     // 1-indexed row
  press: boolean;  // true=press (M suffix), false=release (m suffix)
}

export type MouseClickHandler = (row: number, col: number) => void;
export type MouseWheelHandler = (direction: "up" | "down") => void;
export type MouseMoveHandler = (row: number, col: number) => void;

// SGR extended mouse format: \x1b[<btn;col;rowM (press) or \x1b[<btn;col;rowm (release)
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

// X10/normal mouse format: \x1b[M followed by 3 raw bytes (btn+32, col+32, row+32)
// Matches the 3-byte payload after \x1b[M
const X10_MOUSE_PREFIX = "\x1b[M";

/** Parse an SGR extended mouse event from raw terminal data. Returns null if not a mouse event. */
export function parseMouseEvent(data: string): MouseEvent | null {
  // SGR format: \x1b[<btn;col;rowM
  const m = SGR_MOUSE_RE.exec(data);
  if (m) {
    return {
      button: parseInt(m[1], 10),
      col: parseInt(m[2], 10),
      row: parseInt(m[3], 10),
      press: m[4] === "M",
    };
  }
  // X10/normal format: \x1b[M + 3 raw bytes
  if (data.startsWith(X10_MOUSE_PREFIX) && data.length >= X10_MOUSE_PREFIX.length + 3) {
    const btn = data.charCodeAt(X10_MOUSE_PREFIX.length) - 32;
    const col = data.charCodeAt(X10_MOUSE_PREFIX.length + 1) - 32;
    const row = data.charCodeAt(X10_MOUSE_PREFIX.length + 2) - 32;
    return { button: btn, col, row, press: true };
  }
  return null;
}

/**
 * Returns true if the string looks like raw terminal mouse/escape data that
 * should never reach the reasoner queue.
 * Covers:
 *   - Sequences starting with ESC (any ANSI/VT control sequence)
 *   - Bare mouse sequence payloads that leaked after readline consumed the ESC:
 *     e.g. "35;127;16M", "[<35;127;16M", "M" alone, etc.
 */
export function isMouseOrEscapeSequence(line: string): boolean {
  if (!line) return false;
  // starts with ESC byte — any ANSI control sequence
  if (line.charCodeAt(0) === 0x1b) return true;
  // bare SGR mouse payload: digits + semicolons + [MmCDA] (leaked after ESC stripped)
  // e.g. "35;127;16M", "[<35;127;16M", "<35;127;16M"
  if (/^[\[<]?\d+;\d+;\d+[MmCDA]/.test(line)) return true;
  // X10 mouse without ESC prefix: "M" + two non-printable chars
  if (line.startsWith("M") && line.length === 3 &&
      line.charCodeAt(1) > 31 && line.charCodeAt(1) < 128 &&
      line.charCodeAt(2) > 31 && line.charCodeAt(2) < 128) return true;
  // lines consisting entirely of non-printable/control characters
  if (line.length > 0 && /^[\x00-\x1f\x7f-\x9f]+$/.test(line)) return true;
  return false;
}

/**
 * Parse a plain-English task intent from a user-typed line.
 * Returns { session, goal } when matched, null otherwise.
 *
 * Recognised patterns (case-insensitive):
 *   "task for <session>: <goal>"
 *   "task for <session> - <goal>"
 *   "task <session>: <goal>"
 *   "<session>: <goal>"   (only when session name contains no spaces, to avoid false positives)
 *
 * The session token must be a single word (no spaces) to avoid treating
 * arbitrary sentences like "implement login: use JWT" as task intents.
 */
export function parseNaturalTaskIntent(line: string): { session: string; goal: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // "task for <session>: <goal>" or "task for <session> - <goal>"
  const forMatch = trimmed.match(/^task\s+for\s+(\S+)\s*[:\-]\s*(.+)$/i);
  if (forMatch) {
    const goal = forMatch[2].trim();
    if (goal) return { session: forMatch[1], goal };
  }

  // "task <session>: <goal>"
  const shortMatch = trimmed.match(/^task\s+(\S+)\s*:\s*(.+)$/i);
  if (shortMatch) {
    const goal = shortMatch[2].trim();
    if (goal) return { session: shortMatch[1], goal };
  }

  // "<session>: <goal>" — only when session is a single word (no spaces)
  // This avoids treating "fix the login bug: use JWT" as session="fix" goal="the login bug: use JWT"
  const colonMatch = trimmed.match(/^(\S+):\s*(.+)$/);
  if (colonMatch) {
    const goal = colonMatch[2].trim();
    // reject if it looks like a URL scheme, a time (12:30), or a single-char prefix
    if (
      goal &&
      colonMatch[1].length > 1 &&
      !/^\d+$/.test(colonMatch[1]) &&       // not a bare number
      !/^https?$/i.test(colonMatch[1])       // not a URL scheme
    ) {
      return { session: colonMatch[1], goal };
    }
  }

  return null;
}

export class InputReader {
  private rl: Interface | null = null;
  private queue: string[] = []; // pending user messages for the reasoner
  private paused = false;
  private lastEscTime = 0;
  private scrollHandler: ((dir: ScrollDirection) => void) | null = null;
  private queueChangeHandler: ((count: number) => void) | null = null;
  private viewHandler: ViewHandler | null = null;
  private mouseClickHandler: MouseClickHandler | null = null;
  private mouseWheelHandler: MouseWheelHandler | null = null;
  private mouseMoveHandler: MouseMoveHandler | null = null;
  private lastMoveRow = 0; // debounce: only fire move handler when row changes
  private searchHandler: SearchHandler | null = null;
  private quickSwitchHandler: QuickSwitchHandler | null = null;
  private sortHandler: SortHandler | null = null;
  private compactHandler: CompactHandler | null = null;
  private pinHandler: PinHandler | null = null;
  private bellHandler: BellHandler | null = null;
  private focusHandler: FocusHandler | null = null;
  private markHandler: MarkHandler | null = null;
  private jumpHandler: JumpHandler | null = null;
  private marksHandler: MarksHandler | null = null;
  private muteHandler: MuteHandler | null = null;
  private unmuteAllHandler: UnmuteAllHandler | null = null;
  private tagFilterHandler: TagFilterHandler | null = null;
  private uptimeHandler: UptimeHandler | null = null;
  private autoPinHandler: AutoPinHandler | null = null;
  private noteHandler: NoteHandler | null = null;
  private notesHandler: NotesHandler | null = null;
  private clipHandler: ClipHandler | null = null;
  private diffHandler: DiffHandler | null = null;
  private whoHandler: WhoHandler | null = null;
  private aliasChangeHandler: AliasChangeHandler | null = null;
  private goalCaptureModeHandler: GoalCaptureModeHandler | null = null;
  private groupHandler: GroupHandler | null = null;
  private groupsHandler: GroupsHandler | null = null;
  private groupFilterHandler: GroupFilterHandler | null = null;
  private burnRateHandler: BurnRateHandler | null = null;
  private snapshotHandler: SnapshotHandler | null = null;
  private broadcastHandler: BroadcastHandler | null = null;
  private watchdogHandler: WatchdogHandler | null = null;
  private topHandler: TopHandler | null = null;
  private ceilingHandler: CeilingHandler | null = null;
  private renameHandler: RenameHandler | null = null;
  private copySessionHandler: CopySessionHandler | null = null;
  private statsHandler: StatsHandler | null = null;
  private statsLiveHandler: StatsLiveHandler | null = null;
  private recallHandler: RecallHandler | null = null;
  private pinAllErrorsHandler: PinAllErrorsHandler | null = null;
  private exportStatsHandler: ExportStatsHandler | null = null;
  private muteErrorsHandler: MuteErrorsHandler | null = null;
  private prevGoalHandler: PrevGoalHandler | null = null;
  private tagHandler: TagHandler | null = null;
  private tagsListHandler: TagsListHandler | null = null;
  private tagFilter2Handler: TagFilterHandler2 | null = null;
  private findHandler: FindHandler | null = null;
  private resetHealthHandler: ResetHealthHandler | null = null;
  private timelineHandler: TimelineHandler | null = null;
  private colorHandler: ColorHandler | null = null;
  private clearHistoryHandler: ClearHistoryHandler | null = null;
  private duplicateHandler: DuplicateHandler | null = null;
  private colorAllHandler: ColorAllHandler | null = null;
  private quietHoursHandler: QuietHoursHandler | null = null;
  private historyStatsHandler: HistoryStatsHandler | null = null;
  private costSummaryHandler: CostSummaryHandler | null = null;
  private activityHandler: ActivityHandler | null = null;
  private conflictsHandler: ConflictsHandler | null = null;
  private heatmapHandler: HeatmapHandler | null = null;
  private auditHandler: AuditHandler | null = null;
  private auditStatsHandler: AuditStatsHandler | null = null;
  private fleetSnapHandler: FleetSnapHandler | null = null;
  private budgetPredictHandler: BudgetPredictHandler | null = null;
  private retriesHandler: RetriesHandler | null = null;
  private auditSearchHandler: AuditSearchHandler | null = null;
  private fleetForecastHandler: FleetForecastHandler | null = null;
  private priorityQueueHandler: PriorityQueueHandler | null = null;
  private escalationsHandler: EscalationsHandler | null = null;
  private pollStatusHandler: PollStatusHandler | null = null;
  private driftHandler: DriftHandler | null = null;
  private goalProgressHandler: GoalProgressHandler | null = null;
  private poolHandler: PoolHandler | null = null;
  private reasonerCostHandler: ReasonerCostHandler | null = null;
  private anomalyHandler: AnomalyHandler | null = null;
  private slaHandler: SlaHandler | null = null;
  private velocityHandler: VelocityHandler | null = null;
  private scheduleHandler: ScheduleHandler | null = null;
  private cacheHandler: CacheHandler | null = null;
  private rateLimitHandler: RateLimitHandler | null = null;
  private recoveryHandler: RecoveryHandler | null = null;
  private lifecycleHandler: LifecycleHandler | null = null;
  private costReportHandler: CostReportHandler | null = null;
  private decomposeHandler: DecomposeHandler | null = null;
  private memoryHandler: MemoryHandler | null = null;
  private depGraphHandler: DepGraphHandler | null = null;
  private approvalQueueHandler: ApprovalQueueHandler | null = null;
  private approveHandler: ApproveHandler | null = null;
  private rejectHandler: RejectHandler | null = null;
  private fleetDiffHandler: FleetDiffHandler | null = null;
  private sessionTemplateHandler: SessionTemplateHandler | null = null;
  private difficultyHandler: DifficultyHandler | null = null;
  private smartNudgeHandler: SmartNudgeHandler | null = null;
  private utilizationHandler: UtilizationHandler | null = null;
  private sessionReportHandler: SessionReportHandler | null = null;
  private quietStatusHandler: QuietStatusHandler | null = null;
  private alertLogHandler: AlertLogHandler | null = null;
  private budgetHandler: BudgetHandler | null = null;
  private bulkControlHandler: BulkControlHandler | null = null;
  private healthTrendHandler: HealthTrendHandler | null = null;
  private alertMuteHandler: AlertMuteHandler | null = null;
  private budgetsListHandler: BudgetsListHandler | null = null;
  private budgetStatusHandler: BudgetStatusHandler | null = null;
  private flapLogHandler: FlapLogHandler | null = null;
  private drainHandler: DrainHandler | null = null;
  private exportAllHandler: ExportAllHandler | null = null;
  private noteHistoryHandler: NoteHistoryHandler | null = null;
  private labelHandler: LabelHandler | null = null;
  private sessionsTableHandler: SessionsTableHandler | null = null;
  private labelsHandler: LabelsHandler | null = null;
  private pinDrainingHandler: PinDrainingHandler | null = null;
  private iconHandler: IconHandler | null = null;
  private diffSessionsHandler: DiffSessionsHandler | null = null;
  private fanOutHandler: FanOutHandler | null = null;
  private trustHandler: TrustHandler | null = null;
  private ctxBudgetHandler: CtxBudgetHandler | null = null;
  private profileHandler: ProfileHandler | null = null;
  private replayHandler: ReplayHandler | null = null;
  private notifyFilterHandler: NotifyFilterHandler | null = null;
  private depsHandler: DepsHandler | null = null;
  private fullSearchHandler: FullSearchHandler | null = null;
  private relayHandler: RelayHandler | null = null;
  private throttleHandler: ThrottleHandler | null = null;
  private snapHandler: SnapHandler | null = null;
  private snapDiffHandler: SnapDiffHandler | null = null;
  private alertPatternHandler: AlertPatternHandler | null = null;
  private hookHandler: HookHandler | null = null;
  private aliases = new Map<string, string>(); // /shortcut → /full command
  private mouseDataListener: ((data: Buffer) => void) | null = null;

  // register a callback for scroll key events (PgUp/PgDn/Home/End)
  onScroll(handler: (dir: ScrollDirection) => void): void {
    this.scrollHandler = handler;
  }

  // register a callback for queue size changes (for TUI pending count display)
  onQueueChange(handler: (count: number) => void): void {
    this.queueChangeHandler = handler;
  }

  // register a callback for view commands (/view, /back)
  onView(handler: ViewHandler): void {
    this.viewHandler = handler;
  }

  // register a callback for mouse left-click events (row, col are 1-indexed)
  onMouseClick(handler: MouseClickHandler): void {
    this.mouseClickHandler = handler;
  }

  // register a callback for mouse wheel events (scroll up/down)
  onMouseWheel(handler: MouseWheelHandler): void {
    this.mouseWheelHandler = handler;
  }

  // register a callback for mouse move events (only fires on row change for efficiency)
  onMouseMove(handler: MouseMoveHandler): void {
    this.mouseMoveHandler = handler;
  }

  // register a callback for search commands (/search <pattern> or /search to clear)
  onSearch(handler: SearchHandler): void {
    this.searchHandler = handler;
  }

  // register a callback for quick-switch (bare digit 1-9 on empty input line)
  onQuickSwitch(handler: QuickSwitchHandler): void {
    this.quickSwitchHandler = handler;
  }

  // register a callback for sort commands (/sort <mode> or /sort to cycle)
  onSort(handler: SortHandler): void {
    this.sortHandler = handler;
  }

  // register a callback for compact mode toggle (/compact)
  onCompact(handler: CompactHandler): void {
    this.compactHandler = handler;
  }

  // register a callback for pin/unpin commands (/pin <target>)
  onPin(handler: PinHandler): void {
    this.pinHandler = handler;
  }

  // register a callback for bell toggle (/bell)
  onBell(handler: BellHandler): void {
    this.bellHandler = handler;
  }

  // register a callback for focus mode toggle (/focus)
  onFocus(handler: FocusHandler): void {
    this.focusHandler = handler;
  }

  // register a callback for adding bookmarks (/mark)
  onMark(handler: MarkHandler): void {
    this.markHandler = handler;
  }

  // register a callback for jumping to bookmarks (/jump N)
  onJump(handler: JumpHandler): void {
    this.jumpHandler = handler;
  }

  // register a callback for listing bookmarks (/marks)
  onMarks(handler: MarksHandler): void {
    this.marksHandler = handler;
  }

  // register a callback for mute/unmute commands (/mute <target>)
  onMute(handler: MuteHandler): void {
    this.muteHandler = handler;
  }

  // register a callback for unmuting all sessions (/unmute-all)
  onUnmuteAll(handler: UnmuteAllHandler): void {
    this.unmuteAllHandler = handler;
  }

  // register a callback for tag filter commands (/filter <tag>)
  onTagFilter(handler: TagFilterHandler): void {
    this.tagFilterHandler = handler;
  }

  // register a callback for uptime listing (/uptime)
  onUptime(handler: UptimeHandler): void {
    this.uptimeHandler = handler;
  }

  // register a callback for auto-pin toggle (/auto-pin)
  onAutoPin(handler: AutoPinHandler): void {
    this.autoPinHandler = handler;
  }

  // register a callback for note commands (/note <target> <text>)
  onNote(handler: NoteHandler): void {
    this.noteHandler = handler;
  }

  // register a callback for listing notes (/notes)
  onNotes(handler: NotesHandler): void {
    this.notesHandler = handler;
  }

  // register a callback for fleet status (/who)
  onWho(handler: WhoHandler): void {
    this.whoHandler = handler;
  }

  // register a callback for alias changes (to persist)
  onAliasChange(handler: AliasChangeHandler): void {
    this.aliasChangeHandler = handler;
  }

  // register a callback to decide whether plain text should update goals (task capture mode)
  onGoalCaptureMode(handler: GoalCaptureModeHandler): void {
    this.goalCaptureModeHandler = handler;
  }

  // register a callback for group assignment (/group <N|name> <tag>)
  onGroup(handler: GroupHandler): void {
    this.groupHandler = handler;
  }

  // register a callback for listing groups (/groups)
  onGroups(handler: GroupsHandler): void {
    this.groupsHandler = handler;
  }

  // register a callback for group filter (/group-filter <name> or /group-filter to clear)
  onGroupFilter(handler: GroupFilterHandler): void {
    this.groupFilterHandler = handler;
  }

  // register a callback for burn-rate reporting (/burn-rate)
  onBurnRate(handler: BurnRateHandler): void {
    this.burnRateHandler = handler;
  }

  // register a callback for snapshot export (/snapshot [md])
  onSnapshot(handler: SnapshotHandler): void {
    this.snapshotHandler = handler;
  }

  // register a callback for broadcast (/broadcast [group:<tag>] <message>)
  onBroadcast(handler: BroadcastHandler): void {
    this.broadcastHandler = handler;
  }

  // register a callback for watchdog (/watchdog [N] | /watchdog off)
  onWatchdog(handler: WatchdogHandler): void {
    this.watchdogHandler = handler;
  }

  // register a callback for /top [mode]
  onTop(handler: TopHandler): void {
    this.topHandler = handler;
  }

  // register a callback for /ceiling
  onCeiling(handler: CeilingHandler): void {
    this.ceilingHandler = handler;
  }

  // register a callback for /rename <N|name> [display name]
  onRename(handler: RenameHandler): void {
    this.renameHandler = handler;
  }

  // register a callback for /copy [N|name] — copy session pane output
  onCopySession(handler: CopySessionHandler): void {
    this.copySessionHandler = handler;
  }

  // register a callback for /stats — per-session stats summary
  onStats(handler: StatsHandler): void {
    this.statsHandler = handler;
  }

  // register a callback for /stats-live — toggle periodic stats refresh
  onStatsLive(handler: StatsLiveHandler): void {
    this.statsLiveHandler = handler;
  }

  // register a callback for /recall <keyword> [N] — search history
  onRecall(handler: RecallHandler): void {
    this.recallHandler = handler;
  }

  // register a callback for /pin-all-errors — pin all error sessions
  onPinAllErrors(handler: PinAllErrorsHandler): void {
    this.pinAllErrorsHandler = handler;
  }

  // register a callback for /export-stats — export stats to JSON file
  onExportStats(handler: ExportStatsHandler): void {
    this.exportStatsHandler = handler;
  }

  // register a callback for /mute-errors — toggle error-tag suppression
  onMuteErrors(handler: MuteErrorsHandler): void {
    this.muteErrorsHandler = handler;
  }

  // register a callback for /prev-goal <N|name> [nBack] — restore previous goal
  onPrevGoal(handler: PrevGoalHandler): void {
    this.prevGoalHandler = handler;
  }

  // register a callback for /tag <N|name> [tag1,tag2] — set session tags
  onTag(handler: TagHandler): void {
    this.tagHandler = handler;
  }

  // register a callback for /tags — list all session tags
  onTagsList(handler: TagsListHandler): void {
    this.tagsListHandler = handler;
  }

  // register a callback for /tag-filter <tag> — filter session panel by freeform tag
  onTagFilter2(handler: TagFilterHandler2): void {
    this.tagFilter2Handler = handler;
  }

  // register a callback for /find <text> — search session outputs
  onFind(handler: FindHandler): void {
    this.findHandler = handler;
  }

  // register a callback for /reset-health <N|name> — clear session health state
  onResetHealth(handler: ResetHealthHandler): void {
    this.resetHealthHandler = handler;
  }

  // register a callback for /timeline <N|name> [count]
  onTimeline(handler: TimelineHandler): void {
    this.timelineHandler = handler;
  }

  // register a callback for /color <N|name> [colorname]
  onColor(handler: ColorHandler): void {
    this.colorHandler = handler;
  }

  // register a callback for /clear-history
  onClearHistory(handler: ClearHistoryHandler): void {
    this.clearHistoryHandler = handler;
  }

  onDuplicate(handler: DuplicateHandler): void { this.duplicateHandler = handler; }
  onColorAll(handler: ColorAllHandler): void { this.colorAllHandler = handler; }
  onQuietHours(handler: QuietHoursHandler): void { this.quietHoursHandler = handler; }
  onHistoryStats(handler: HistoryStatsHandler): void { this.historyStatsHandler = handler; }
  onCostSummary(handler: CostSummaryHandler): void { this.costSummaryHandler = handler; }
  onSessionReport(handler: SessionReportHandler): void { this.sessionReportHandler = handler; }
  onQuietStatus(handler: QuietStatusHandler): void { this.quietStatusHandler = handler; }
  onAlertLog(handler: AlertLogHandler): void { this.alertLogHandler = handler; }
  onBudget(handler: BudgetHandler): void { this.budgetHandler = handler; }
  onBulkControl(handler: BulkControlHandler): void { this.bulkControlHandler = handler; }
  onHealthTrend(handler: HealthTrendHandler): void { this.healthTrendHandler = handler; }
  onAlertMute(handler: AlertMuteHandler): void { this.alertMuteHandler = handler; }
  onBudgetsList(handler: BudgetsListHandler): void { this.budgetsListHandler = handler; }
  onBudgetStatus(handler: BudgetStatusHandler): void { this.budgetStatusHandler = handler; }
  onFlapLog(handler: FlapLogHandler): void { this.flapLogHandler = handler; }
  onDrain(handler: DrainHandler): void { this.drainHandler = handler; }
  onExportAll(handler: ExportAllHandler): void { this.exportAllHandler = handler; }
  onNoteHistory(handler: NoteHistoryHandler): void { this.noteHistoryHandler = handler; }
  onLabel(handler: LabelHandler): void { this.labelHandler = handler; }
  onSessionsTable(handler: SessionsTableHandler): void { this.sessionsTableHandler = handler; }
  onLabels(handler: LabelsHandler): void { this.labelsHandler = handler; }
  onPinDraining(handler: PinDrainingHandler): void { this.pinDrainingHandler = handler; }
  onIcon(handler: IconHandler): void { this.iconHandler = handler; }
  onDiffSessions(handler: DiffSessionsHandler): void { this.diffSessionsHandler = handler; }
  onFanOut(handler: FanOutHandler): void { this.fanOutHandler = handler; }
  onTrust(handler: TrustHandler): void { this.trustHandler = handler; }
  onCtxBudget(handler: CtxBudgetHandler): void { this.ctxBudgetHandler = handler; }
  onProfile(handler: ProfileHandler): void { this.profileHandler = handler; }
  onReplay(handler: ReplayHandler): void { this.replayHandler = handler; }
  onNotifyFilter(handler: NotifyFilterHandler): void { this.notifyFilterHandler = handler; }
  onDeps(handler: DepsHandler): void { this.depsHandler = handler; }
  onFullSearch(handler: FullSearchHandler): void { this.fullSearchHandler = handler; }
  onRelay(handler: RelayHandler): void { this.relayHandler = handler; }
  onThrottle(handler: ThrottleHandler): void { this.throttleHandler = handler; }
  onSnap(handler: SnapHandler): void { this.snapHandler = handler; }
  onSnapDiff(handler: SnapDiffHandler): void { this.snapDiffHandler = handler; }
  onAlertPattern(handler: AlertPatternHandler): void { this.alertPatternHandler = handler; }
  onHook(handler: HookHandler): void { this.hookHandler = handler; }
  onActivity(handler: ActivityHandler): void { this.activityHandler = handler; }
  onConflicts(handler: ConflictsHandler): void { this.conflictsHandler = handler; }
  onHeatmap(handler: HeatmapHandler): void { this.heatmapHandler = handler; }
  onAudit(handler: AuditHandler): void { this.auditHandler = handler; }
  onAuditStats(handler: AuditStatsHandler): void { this.auditStatsHandler = handler; }
  onFleetSnap(handler: FleetSnapHandler): void { this.fleetSnapHandler = handler; }
  onBudgetPredict(handler: BudgetPredictHandler): void { this.budgetPredictHandler = handler; }
  onRetries(handler: RetriesHandler): void { this.retriesHandler = handler; }
  onAuditSearch(handler: AuditSearchHandler): void { this.auditSearchHandler = handler; }
  onFleetForecast(handler: FleetForecastHandler): void { this.fleetForecastHandler = handler; }
  onPriorityQueue(handler: PriorityQueueHandler): void { this.priorityQueueHandler = handler; }
  onEscalations(handler: EscalationsHandler): void { this.escalationsHandler = handler; }
  onPollStatus(handler: PollStatusHandler): void { this.pollStatusHandler = handler; }
  onDrift(handler: DriftHandler): void { this.driftHandler = handler; }
  onGoalProgress(handler: GoalProgressHandler): void { this.goalProgressHandler = handler; }
  onPool(handler: PoolHandler): void { this.poolHandler = handler; }
  onReasonerCost(handler: ReasonerCostHandler): void { this.reasonerCostHandler = handler; }
  onAnomaly(handler: AnomalyHandler): void { this.anomalyHandler = handler; }
  onSla(handler: SlaHandler): void { this.slaHandler = handler; }
  onVelocity(handler: VelocityHandler): void { this.velocityHandler = handler; }
  onSchedule(handler: ScheduleHandler): void { this.scheduleHandler = handler; }
  onCache(handler: CacheHandler): void { this.cacheHandler = handler; }
  onRateLimit(handler: RateLimitHandler): void { this.rateLimitHandler = handler; }
  onRecovery(handler: RecoveryHandler): void { this.recoveryHandler = handler; }
  onLifecycle(handler: LifecycleHandler): void { this.lifecycleHandler = handler; }
  onCostReport(handler: CostReportHandler): void { this.costReportHandler = handler; }
  onDecompose(handler: DecomposeHandler): void { this.decomposeHandler = handler; }
  onMemory(handler: MemoryHandler): void { this.memoryHandler = handler; }
  onDepGraph(handler: DepGraphHandler): void { this.depGraphHandler = handler; }
  onApprovalQueue(handler: ApprovalQueueHandler): void { this.approvalQueueHandler = handler; }
  onApprove(handler: ApproveHandler): void { this.approveHandler = handler; }
  onReject(handler: RejectHandler): void { this.rejectHandler = handler; }
  onFleetDiff(handler: FleetDiffHandler): void { this.fleetDiffHandler = handler; }
  onSessionTemplate(handler: SessionTemplateHandler): void { this.sessionTemplateHandler = handler; }
  onDifficulty(handler: DifficultyHandler): void { this.difficultyHandler = handler; }
  onSmartNudge(handler: SmartNudgeHandler): void { this.smartNudgeHandler = handler; }
  onUtilization(handler: UtilizationHandler): void { this.utilizationHandler = handler; }
  private detectTemplateHandler: DetectTemplateHandler | null = null;
  private fleetSearchHandler: FleetSearchHandler | null = null;
  private nudgeStatsHandler: NudgeStatsHandler | null = null;
  private allocationHandler: AllocationHandler | null = null;
  private graduationHandler: GraduationHandler | null = null;
  private refineHandler: RefineHandler | null = null;
  private exportHandler: ExportHandler | null = null;
  onDetectTemplate(handler: DetectTemplateHandler): void { this.detectTemplateHandler = handler; }
  onGraduation(handler: GraduationHandler): void { this.graduationHandler = handler; }
  onRefine(handler: RefineHandler): void { this.refineHandler = handler; }
  onExport(handler: ExportHandler): void { this.exportHandler = handler; }
  private serviceHandler: ServiceHandler | null = null;
  private sessionReplayHandler: SessionReplayHandler | null = null;
  private workflowHandler: WorkflowHandler | null = null;
  onService(handler: ServiceHandler): void { this.serviceHandler = handler; }
  onSessionReplay(handler: SessionReplayHandler): void { this.sessionReplayHandler = handler; }
  onWorkflow(handler: WorkflowHandler): void { this.workflowHandler = handler; }
  private multiReasonerHandler: MultiReasonerHandler | null = null;
  private tokenQuotaHandler: TokenQuotaHandler | null = null;
  private checkpointHandler: CheckpointHandler | null = null;
  private workflowNewHandler: WorkflowNewHandler | null = null;
  onMultiReasoner(handler: MultiReasonerHandler): void { this.multiReasonerHandler = handler; }
  onTokenQuota(handler: TokenQuotaHandler): void { this.tokenQuotaHandler = handler; }
  onCheckpoint(handler: CheckpointHandler): void { this.checkpointHandler = handler; }
  onWorkflowNew(handler: WorkflowNewHandler): void { this.workflowNewHandler = handler; }
  private abStatsHandler: ABStatsHandler | null = null;
  private workflowChainHandler: WorkflowChainHandler | null = null;
  private workflowForecastHandler: WorkflowForecastHandler | null = null;
  onABStats(handler: ABStatsHandler): void { this.abStatsHandler = handler; }
  onWorkflowChain(handler: WorkflowChainHandler): void { this.workflowChainHandler = handler; }
  onWorkflowForecast(handler: WorkflowForecastHandler): void { this.workflowForecastHandler = handler; }
  private federationHandler: FederationHandler | null = null;
  private archivesHandler: ArchivesHandler | null = null;
  private runbookGenHandler: RunbookGenHandler | null = null;
  private alertRulesHandler: AlertRulesHandler | null = null;
  onFederation(handler: FederationHandler): void { this.federationHandler = handler; }
  onArchives(handler: ArchivesHandler): void { this.archivesHandler = handler; }
  onRunbookGen(handler: RunbookGenHandler): void { this.runbookGenHandler = handler; }
  onAlertRules(handler: AlertRulesHandler): void { this.alertRulesHandler = handler; }
  private sessionTailHandler: SessionTailHandler | null = null;
  private healthForecastHandler: HealthForecastHandler | null = null;
  private workflowVizHandler: WorkflowVizHandler | null = null;
  onSessionTail(handler: SessionTailHandler): void { this.sessionTailHandler = handler; }
  onHealthForecast(handler: HealthForecastHandler): void { this.healthForecastHandler = handler; }
  onWorkflowViz(handler: WorkflowVizHandler): void { this.workflowVizHandler = handler; }
  private metricsHandler: MetricsHandler | null = null;
  private fleetGrepHandler: FleetGrepHandler | null = null;
  private runbookExecHandler: RunbookExecHandler | null = null;
  private cloneHandler: CloneHandler | null = null;
  private similarGoalsHandler: SimilarGoalsHandler | null = null;
  private costTagsHandler: CostTagsHandler | null = null;
  private scalingHandler: ScalingHandler | null = null;
  private sessionDiffHandler: SessionDiffHandler | null = null;
  private sessionTagHandler: SessionTagHandler | null = null;
  private compareHandler: CompareHandler | null = null;
  private fleetReportHandler: FleetReportHandler | null = null;
  onSessionDiff(handler: SessionDiffHandler): void { this.sessionDiffHandler = handler; }
  onSessionTag(handler: SessionTagHandler): void { this.sessionTagHandler = handler; }
  onCompare(handler: CompareHandler): void { this.compareHandler = handler; }
  onFleetReport(handler: FleetReportHandler): void { this.fleetReportHandler = handler; }
  private taskTimelineHandler: TaskTimelineHandler | null = null;
  private changelogHandler: ChangelogHandler | null = null;
  onTaskTimeline(handler: TaskTimelineHandler): void { this.taskTimelineHandler = handler; }
  onChangelog(handler: ChangelogHandler): void { this.changelogHandler = handler; }
  onMetrics(handler: MetricsHandler): void { this.metricsHandler = handler; }
  onFleetGrep(handler: FleetGrepHandler): void { this.fleetGrepHandler = handler; }
  onRunbookExec(handler: RunbookExecHandler): void { this.runbookExecHandler = handler; }
  onClone(handler: CloneHandler): void { this.cloneHandler = handler; }
  onSimilarGoals(handler: SimilarGoalsHandler): void { this.similarGoalsHandler = handler; }
  onCostTags(handler: CostTagsHandler): void { this.costTagsHandler = handler; }
  onScaling(handler: ScalingHandler): void { this.scalingHandler = handler; }
  private idleDetectHandler: IdleDetectHandler | null = null;
  private goalConflictsHandler2: GoalConflictsHandler | null = null;
  private leaderboardHandler: LeaderboardHandler | null = null;
  onIdleDetect(handler: IdleDetectHandler): void { this.idleDetectHandler = handler; }
  onGoalConflicts2(handler: GoalConflictsHandler): void { this.goalConflictsHandler2 = handler; }
  onLeaderboard(handler: LeaderboardHandler): void { this.leaderboardHandler = handler; }
  private healthHistoryHandler: HealthHistoryHandler | null = null;
  private costThrottleHandler: CostThrottleHandler | null = null;
  private suggestNameHandler: SuggestNameHandler | null = null;
  onHealthHistory(handler: HealthHistoryHandler): void { this.healthHistoryHandler = handler; }
  onCostThrottle(handler: CostThrottleHandler): void { this.costThrottleHandler = handler; }
  onSuggestName(handler: SuggestNameHandler): void { this.suggestNameHandler = handler; }
  private shiftHandoffHandler: ShiftHandoffHandler | null = null;
  private autoDepsHandler: AutoDepsHandler | null = null;
  private costForecastHandler: CostForecastHandler | null = null;
  onShiftHandoff(handler: ShiftHandoffHandler): void { this.shiftHandoffHandler = handler; }
  onAutoDeps(handler: AutoDepsHandler): void { this.autoDepsHandler = handler; }
  onCostForecast(handler: CostForecastHandler): void { this.costForecastHandler = handler; }
  private eventBusHandler: EventBusHandler | null = null;
  private verifyGoalsHandler: VerifyGoalsHandler | null = null;
  private outputDiffHandler: OutputDiffHandler | null = null;
  onEventBus(handler: EventBusHandler): void { this.eventBusHandler = handler; }
  onVerifyGoals(handler: VerifyGoalsHandler): void { this.verifyGoalsHandler = handler; }
  onOutputDiff(handler: OutputDiffHandler): void { this.outputDiffHandler = handler; }
  private heartbeatHandler: HeartbeatHandler | null = null;
  private actionReplayHandler: ActionReplayHandler | null = null;
  private configProfilesHandler: ConfigProfilesHandler | null = null;
  onHeartbeat(handler: HeartbeatHandler): void { this.heartbeatHandler = handler; }
  onActionReplay(handler: ActionReplayHandler): void { this.actionReplayHandler = handler; }
  onConfigProfiles(handler: ConfigProfilesHandler): void { this.configProfilesHandler = handler; }
  private doctorHandler: DoctorHandler | null = null;
  private stateMachineHandler: StateMachineHandler | null = null;
  private contextStatsHandler: ContextStatsHandler | null = null;
  onDoctor(handler: DoctorHandler): void { this.doctorHandler = handler; }
  onStateMachine(handler: StateMachineHandler): void { this.stateMachineHandler = handler; }
  onContextStats(handler: ContextStatsHandler): void { this.contextStatsHandler = handler; }
  private metricsHistHandler: MetricsHistHandler | null = null;
  private peerReviewHandler: PeerReviewHandler | null = null;
  private warmStandbyHandler: WarmStandbyHandler | null = null;
  onMetricsHist(handler: MetricsHistHandler): void { this.metricsHistHandler = handler; }
  onPeerReview(handler: PeerReviewHandler): void { this.peerReviewHandler = handler; }
  onWarmStandby(handler: WarmStandbyHandler): void { this.warmStandbyHandler = handler; }
  private redactionStatsHandler: RedactionStatsHandler | null = null;
  private complianceHandler: ComplianceHandler | null = null;
  private pluginHooksHandler: PluginHooksHandler | null = null;
  onRedactionStats(handler: RedactionStatsHandler): void { this.redactionStatsHandler = handler; }
  onCompliance(handler: ComplianceHandler): void { this.complianceHandler = handler; }
  onPluginHooks(handler: PluginHooksHandler): void { this.pluginHooksHandler = handler; }
  private incidentTimelineHandler: IncidentTimelineHandler | null = null;
  private bookmarkHandler: BookmarkHandler | null = null;
  private canaryModeHandler: CanaryModeHandler | null = null;
  onIncidentTimeline(handler: IncidentTimelineHandler): void { this.incidentTimelineHandler = handler; }
  onBookmark(handler: BookmarkHandler): void { this.bookmarkHandler = handler; }
  onCanaryMode(handler: CanaryModeHandler): void { this.canaryModeHandler = handler; }
  private configDiffHandler: ConfigDiffHandler | null = null;
  private goalPriorityHandler: GoalPriorityHandler | null = null;
  private capacityForecastHandler: CapacityForecastHandler | null = null;
  onConfigDiff(handler: ConfigDiffHandler): void { this.configDiffHandler = handler; }
  onGoalPriority(handler: GoalPriorityHandler): void { this.goalPriorityHandler = handler; }
  onCapacityForecast(handler: CapacityForecastHandler): void { this.capacityForecastHandler = handler; }
  private watchdogStatusHandler: WatchdogStatusHandler | null = null;
  private costRegressionHandler: CostRegressionHandler | null = null;
  private goalCascadeHandler: GoalCascadeHandler | null = null;
  onWatchdogStatus(handler: WatchdogStatusHandler): void { this.watchdogStatusHandler = handler; }
  onCostRegression(handler: CostRegressionHandler): void { this.costRegressionHandler = handler; }
  onGoalCascade(handler: GoalCascadeHandler): void { this.goalCascadeHandler = handler; }
  private healthScoreHandler: HealthScoreHandler | null = null;
  private eventReplayHandler: EventReplayHandler | null = null;
  private contextBudgetHandler: ContextBudgetHandler | null = null;
  onHealthScore(handler: HealthScoreHandler): void { this.healthScoreHandler = handler; }
  onEventReplay(handler: EventReplayHandler): void { this.eventReplayHandler = handler; }
  onContextBudget(handler: ContextBudgetHandler): void { this.contextBudgetHandler = handler; }
  private tickProfilerHandler: TickProfilerHandler | null = null;
  private goalConfidenceHandler: GoalConfidenceHandler | null = null;
  private budgetPlanHandler: BudgetPlanHandler | null = null;
  onTickProfiler(handler: TickProfilerHandler): void { this.tickProfilerHandler = handler; }
  onGoalConfidence(handler: GoalConfidenceHandler): void { this.goalConfidenceHandler = handler; }
  onBudgetPlan(handler: BudgetPlanHandler): void { this.budgetPlanHandler = handler; }
  private sentimentHandler: SentimentHandler | null = null;
  private workloadBalanceHandler: WorkloadBalanceHandler | null = null;
  private crashReportHandler: CrashReportHandler | null = null;
  onSentiment(handler: SentimentHandler): void { this.sentimentHandler = handler; }
  onWorkloadBalance(handler: WorkloadBalanceHandler): void { this.workloadBalanceHandler = handler; }
  onCrashReport(handler: CrashReportHandler): void { this.crashReportHandler = handler; }
  private sessionGroupHandler: SessionGroupHandler | null = null;
  private contextDiffHandler: ContextDiffHandler | null = null;
  private configSchemaHandler: ConfigSchemaHandler | null = null;
  onSessionGroup(handler: SessionGroupHandler): void { this.sessionGroupHandler = handler; }
  onContextDiff(handler: ContextDiffHandler): void { this.contextDiffHandler = handler; }
  onConfigSchema(handler: ConfigSchemaHandler): void { this.configSchemaHandler = handler; }
  private transcriptExportHandler: TranscriptExportHandler | null = null;
  private decompQualityHandler: DecompQualityHandler | null = null;
  private anomalyCorrelationHandler: AnomalyCorrelationHandler | null = null;
  onTranscriptExport(handler: TranscriptExportHandler): void { this.transcriptExportHandler = handler; }
  onDecompQuality(handler: DecompQualityHandler): void { this.decompQualityHandler = handler; }
  onAnomalyCorrelation(handler: AnomalyCorrelationHandler): void { this.anomalyCorrelationHandler = handler; }
  private criticalPathHandler: CriticalPathHandler | null = null;
  private snapshotCompressionHandler: SnapshotCompressionHandler | null = null;
  private outputAnnotationsHandler: OutputAnnotationsHandler | null = null;
  onCriticalPath(handler: CriticalPathHandler): void { this.criticalPathHandler = handler; }
  onSnapshotCompression(handler: SnapshotCompressionHandler): void { this.snapshotCompressionHandler = handler; }
  onOutputAnnotations(handler: OutputAnnotationsHandler): void { this.outputAnnotationsHandler = handler; }
  private celebrationHandler: CelebrationHandler | null = null;
  private readinessHandler: ReadinessHandler | null = null;
  private processSupervisorHandler: ProcessSupervisorHandler | null = null;
  onCelebration(handler: CelebrationHandler): void { this.celebrationHandler = handler; }
  onReadiness(handler: ReadinessHandler): void { this.readinessHandler = handler; }
  onProcessSupervisor(handler: ProcessSupervisorHandler): void { this.processSupervisorHandler = handler; }
  private dailyDigestHandler: DailyDigestHandler | null = null;
  private goalParserHandler: GoalParserHandler | null = null;
  private hotSwapHandler: HotSwapHandler | null = null;
  onDailyDigest(handler: DailyDigestHandler): void { this.dailyDigestHandler = handler; }
  onGoalParser(handler: GoalParserHandler): void { this.goalParserHandler = handler; }
  onHotSwap(handler: HotSwapHandler): void { this.hotSwapHandler = handler; }
  private webhookPreviewHandler: WebhookPreviewHandler | null = null;
  private structuredLogHandler: StructuredLogHandler | null = null;
  private stateExportHandler: StateExportHandler | null = null;
  onWebhookPreview(handler: WebhookPreviewHandler): void { this.webhookPreviewHandler = handler; }
  onStructuredLog(handler: StructuredLogHandler): void { this.structuredLogHandler = handler; }
  onStateExport(handler: StateExportHandler): void { this.stateExportHandler = handler; }
  private outputDedupHandler: OutputDedupHandler | null = null;
  private configMigrateHandler: ConfigMigrateHandler | null = null;
  private progressPredictHandler: ProgressPredictHandler | null = null;
  onOutputDedup(handler: OutputDedupHandler): void { this.outputDedupHandler = handler; }
  onConfigMigrate(handler: ConfigMigrateHandler): void { this.configMigrateHandler = handler; }
  onProgressPredict(handler: ProgressPredictHandler): void { this.progressPredictHandler = handler; }
  private opsDashboardHandler: OpsDashboardHandler | null = null;
  private depRepairHandler: DepRepairHandler | null = null;
  private patternEvolutionHandler: PatternEvolutionHandler | null = null;
  onOpsDashboard(handler: OpsDashboardHandler): void { this.opsDashboardHandler = handler; }
  onDepRepair(handler: DepRepairHandler): void { this.depRepairHandler = handler; }
  onPatternEvolution(handler: PatternEvolutionHandler): void { this.patternEvolutionHandler = handler; }
  private alertDashboardHandler: AlertDashboardHandler | null = null;
  private langDetectHandler: LangDetectHandler | null = null;
  private goalSlaHandler: GoalSlaHandler | null = null;
  onAlertDashboard(handler: AlertDashboardHandler): void { this.alertDashboardHandler = handler; }
  onLangDetect(handler: LangDetectHandler): void { this.langDetectHandler = handler; }
  onGoalSla(handler: GoalSlaHandler): void { this.goalSlaHandler = handler; }
  private autoScalerHandler: AutoScalerHandler | null = null;
  private gamificationHandler: GamificationHandler | null = null;
  private auditReportHandler: AuditReportHandler | null = null;
  onAutoScaler(handler: AutoScalerHandler): void { this.autoScalerHandler = handler; }
  onGamification(handler: GamificationHandler): void { this.gamificationHandler = handler; }
  onAuditReport(handler: AuditReportHandler): void { this.auditReportHandler = handler; }
  private startupProfileHandler: StartupProfileHandler | null = null;
  private affinityGroupsHandler: AffinityGroupsHandler | null = null;
  private clipboardHandler: ClipboardHandler | null = null;
  onStartupProfile(handler: StartupProfileHandler): void { this.startupProfileHandler = handler; }
  onAffinityGroups(handler: AffinityGroupsHandler): void { this.affinityGroupsHandler = handler; }
  onClipboard(handler: ClipboardHandler): void { this.clipboardHandler = handler; }
  private gracefulShutdownHandler: GracefulShutdownHandler | null = null;
  private depImpactHandler: DepImpactHandler | null = null;
  private runbookLibraryHandler: RunbookLibraryHandler | null = null;
  onGracefulShutdown(handler: GracefulShutdownHandler): void { this.gracefulShutdownHandler = handler; }
  onDepImpact(handler: DepImpactHandler): void { this.depImpactHandler = handler; }
  onRunbookLibrary(handler: RunbookLibraryHandler): void { this.runbookLibraryHandler = handler; }
  private depGraphExportHandler: DepGraphExportHandler | null = null;
  private perfRegressionHandler: PerfRegressionHandler | null = null;
  private complianceReportHandler2: ComplianceReportHandler2 | null = null;
  onDepGraphExport(handler: DepGraphExportHandler): void { this.depGraphExportHandler = handler; }
  onPerfRegression(handler: PerfRegressionHandler): void { this.perfRegressionHandler = handler; }
  onComplianceReport2(handler: ComplianceReportHandler2): void { this.complianceReportHandler2 = handler; }
  onFleetSearch(handler: FleetSearchHandler): void { this.fleetSearchHandler = handler; }
  onNudgeStats(handler: NudgeStatsHandler): void { this.nudgeStatsHandler = handler; }
  onAllocation(handler: AllocationHandler): void { this.allocationHandler = handler; }

  /** Set aliases from persisted prefs. */
  setAliases(aliases: Record<string, string>): void {
    this.aliases.clear();
    for (const [k, v] of Object.entries(aliases)) this.aliases.set(k, v);
  }

  /** Get current aliases as a plain object. */
  getAliases(): Record<string, string> {
    return Object.fromEntries(this.aliases);
  }

  // register a callback for clipboard export (/clip [N])
  onClip(handler: ClipHandler): void {
    this.clipHandler = handler;
  }

  // register a callback for bookmark diff (/diff N)
  onDiff(handler: DiffHandler): void {
    this.diffHandler = handler;
  }

  private notifyQueueChange(): void {
    this.queueChangeHandler?.(this.queue.length);
  }

   start(): void {
    // only works if stdin is a TTY (not piped)
    if (!process.stdin.isTTY) return;

    // ESC-ESC interrupt detection — must be set up before readline so
    // emitKeypressEvents doesn't interfere with our raw data listener order
    emitKeypressEvents(process.stdin);

    // Register the mouse data listener with prependListener so it fires
    // BEFORE readline's internal data handler. This ensures we see the
    // full \x1b[<btn;col;rowM sequence intact before readline has a chance
    // to split or consume escape bytes.
    this.mouseDataListener = (data: Buffer) => {
      const str = data.toString("utf8");
      const evt = parseMouseEvent(str);
      if (!evt) return;
      // left click press
      if (evt.press && evt.button === 0 && this.mouseClickHandler) {
        this.mouseClickHandler(evt.row, evt.col);
      }
      // mouse wheel: button 64 = scroll up, 65 = scroll down
      if (evt.button === 64 && this.mouseWheelHandler) {
        this.mouseWheelHandler("up");
      } else if (evt.button === 65 && this.mouseWheelHandler) {
        this.mouseWheelHandler("down");
      }
      // mouse motion: bit 5 set (button 32-35), only fire on row change
      if (evt.button >= 32 && evt.button <= 35 && this.mouseMoveHandler) {
        if (evt.row !== this.lastMoveRow) {
          this.lastMoveRow = evt.row;
          this.mouseMoveHandler(evt.row, evt.col);
        }
      }
    };
    // prependListener: fires before readline's internal data handler so we
    // see intact sequences first
    process.stdin.prependListener("data", this.mouseDataListener);

    this.rl = createInterface({
      input: process.stdin,
      output: process.stderr, // prompt goes to stderr so stdout stays clean
      prompt: `${GREEN}you >${RESET} `,
      terminal: true,
    });

    this.rl.on("line", (line) => this.handleLine(line.trim()));
    this.rl.on("close", () => { this.rl = null; });

    process.stdin.on("keypress", (_ch: string | undefined, key: { name?: string; sequence?: string }) => {
      if (key?.name === "escape" || key?.sequence === "\x1b") {
        const now = Date.now();
        if (now - this.lastEscTime < ESC_DOUBLE_TAP_MS) {
          this.handleEscInterrupt();
          this.lastEscTime = 0;
        } else {
          this.lastEscTime = now;
        }
      } else {
        this.lastEscTime = 0;
      }
      // scroll key detection (PgUp, PgDn, Home, End)
      if (this.scrollHandler) {
        if (key?.name === "pageup" || key?.sequence === "\x1b[5~") {
          this.scrollHandler("up");
        } else if (key?.name === "pagedown" || key?.sequence === "\x1b[6~") {
          this.scrollHandler("down");
        } else if (key?.name === "home" || key?.sequence === "\x1b[1~") {
          this.scrollHandler("top");
        } else if (key?.name === "end" || key?.sequence === "\x1b[4~") {
          this.scrollHandler("bottom");
        }
      }
    });

    // show hint on startup
    console.error(`${DIM}type a message to talk to the AI supervisor, /help for commands, ESC ESC to interrupt${RESET}`);
    this.rl.prompt();
  }

  // drain all pending user messages (called each tick)
  drain(): string[] {
    const msgs = this.queue.splice(0);
    if (msgs.length > 0) this.notifyQueueChange();
    return msgs;
  }

  isPaused(): boolean {
    return this.paused;
  }

  // check if there are queued messages without draining them
  hasPending(): boolean {
    return this.queue.length > 0;
  }

  // inject a message directly into the queue (used after interrupt to feed text into next tick)
  inject(msg: string): void {
    this.queue.push(msg);
    this.notifyQueueChange();
  }

  // re-show the prompt (called after daemon prints output)
  prompt(): void {
    this.rl?.prompt(true);
  }

  stop(): void {
    if (this.mouseDataListener) {
      process.stdin.removeListener("data", this.mouseDataListener);
      this.mouseDataListener = null;
    }
    this.rl?.close();
    this.rl = null;
  }

  private handleEscInterrupt(): void {
    requestInterrupt();
    this.queue.push("__CMD_INTERRUPT__");
    this.notifyQueueChange();
    console.error(`\n${RED}${BOLD}>>> interrupting reasoner <<<${RESET}`);
    console.error(`${YELLOW}type your message now -- it will be sent before the next cycle${RESET}`);
    this.rl?.prompt(true);
  }

  private handleInsist(msg: string): void {
    requestInterrupt();
    this.queue.push("__CMD_INTERRUPT__");
    this.queue.push(`${INSIST_PREFIX}${msg}`);
    this.notifyQueueChange();
    console.error(`${RED}${BOLD}!${RESET} ${GREEN}insist${RESET} ${DIM}— interrupting + delivering your message immediately${RESET}`);
  }

   private handleLine(line: string): void {
    if (!line) {
      this.rl?.prompt();
      return;
    }

    // Safety net: drop any line that looks like raw terminal mouse tracking data
    // or ANSI escape sequences. These can leak into the readline buffer when
    // tmux mouse tracking is active and the terminal sends sequences like
    // \x1b[<35;127;16M that readline partially consumes, leaving "35;127;16M"
    // as a bare "line". Never send these to the reasoner.
    if (isMouseOrEscapeSequence(line)) {
      this.rl?.prompt();
      return;
    }

    // quick-switch: bare digit 1-9, or g+N for sessions 1-99
    const gSwitch = line.match(/^g([1-9]\d?)$/);
    if (gSwitch && this.quickSwitchHandler) {
      this.quickSwitchHandler(parseInt(gSwitch[1], 10));
      this.rl?.prompt();
      return;
    }
    if (/^[1-9]$/.test(line) && this.quickSwitchHandler) {
      this.quickSwitchHandler(parseInt(line, 10));
      this.rl?.prompt();
      return;
    }

    // ultra-fast task capture: ":<goal>" updates current drill-down session task
    if (line.startsWith(":") && line.trim().length > 1) {
      const goal = line.slice(1).trim();
      this.queue.push(`__CMD_QUICKTASK__${goal}`);
      this.notifyQueueChange();
      console.error(`${GREEN}captured${RESET} ${DIM}task goal queued for current session${RESET}`);
      this.rl?.prompt();
      return;
    }

    // built-in slash commands (resolve aliases first)
    if (line.startsWith("/")) {
      this.handleCommand(resolveAlias(line, this.aliases));
      this.rl?.prompt();
      return;
    }

    // ! prefix = insist mode: interrupt + priority message
    if (line.startsWith("!") && line.length > 1) {
      const msg = line.slice(1).trim();
      if (msg) {
        this.handleInsist(msg);
        this.rl?.prompt();
        return;
      }
    }

    // plain text in drill-down defaults to task goal capture
    if (this.goalCaptureModeHandler?.()) {
      this.queue.push(`__CMD_QUICKTASK__${line}`);
      this.notifyQueueChange();
      console.error(`${GREEN}captured${RESET} ${DIM}goal updated for current session${RESET}`);
      this.rl?.prompt();
      return;
    }

    // natural language task intent in overview mode:
    // "task for adventure: implement login" or "adventure: implement login"
    // Parsed before the generic queue push so it routes to task management directly.
    const taskIntent = parseNaturalTaskIntent(line);
    if (taskIntent) {
      // __CMD_NATURALTASK__<session>\t<goal> — tab-separated so both parts are recoverable
      this.queue.push(`__CMD_NATURALTASK__${taskIntent.session}\t${taskIntent.goal}`);
      this.notifyQueueChange();
      console.error(`${GREEN}task intent${RESET} ${DIM}→ ${taskIntent.session}: ${taskIntent.goal}${RESET}`);
      this.rl?.prompt();
      return;
    }

    // otherwise, queue as a user message for the reasoner
    this.queue.push(line);
    this.notifyQueueChange();
    const pending = this.queue.filter(m => !m.startsWith("__CMD_")).length;
    console.error(`${GREEN}queued${RESET} ${DIM}(${pending} pending) — will be read next cycle${RESET}`);
    this.rl?.prompt();
  }

  private handleCommand(line: string): void {
    const [cmd] = line.split(/\s+/);

    switch (cmd) {
      case "/help":
        console.error(`
${BOLD}talking to the AI:${RESET}
  just type          in drill-down: update goal for that session; otherwise message AI
  !message           insist — interrupt + deliver message immediately
  /insist <msg>      same as !message
  /explain           ask the AI to explain what's happening right now

${BOLD}controls:${RESET}
  /pause             pause the supervisor
  /resume            resume the supervisor
  /mode [name]       set mode: observe, dry-run, confirm, autopilot (no arg = show)
   /profile           show active AoE profiles and session counts
   /replay <N> [lps]  play back a session's output history (default 10 lines/sec)
   /notify-filter [s] [events]  set per-session notification filter (no args = list, 'clear' = remove)
   /trust [arg]       trust ladder: no arg = show status, arg = observe/dry-run/confirm/autopilot/auto/off
  /interrupt         interrupt the AI mid-thought
  ESC ESC            same as /interrupt (shortcut)

${BOLD}navigation:${RESET}
  1-9                quick-switch: jump to session N (type digit + Enter)
  g1-g99             quick-switch for sessions 10+ (e.g. g12 jumps to session 12)
  /view [N|name]     drill into a session's live output (default: 1)
  /back              return to overview from drill-down
  /sort [mode]       sort sessions: status, name, activity, default (or cycle)
  /compact           toggle compact mode (dense session panel)
  /pin [N|name]      pin/unpin a session to the top (toggle)
  /pin-save <name>   save current pins as a named preset
  /pin-load <name>   restore a saved pin preset
  /pin-delete <name> delete a saved preset
  /pin-presets       list saved pin presets
  /bell              toggle terminal bell on errors/completions
  /focus             toggle focus mode (show only pinned sessions)
  /mute [N|name]     mute/unmute a session's activity entries (toggle)
  /unmute-all        unmute all sessions at once
  /filter [tag]      filter activity by tag — presets: errors, actions, system (no arg = clear)
  /who               show fleet status (all sessions at a glance)
  /uptime            show session uptimes (time since first observed)
  /auto-pin          toggle auto-pin on error (pin sessions that emit errors)
  /note N|name text  attach a note to a session (no text = clear)
  /notes             list all session notes
  /group N|name tag  assign session to a group (no tag = clear)
  /groups            list all groups and their sessions
  /group-filter tag  show only sessions in a group (no arg = clear)
  /burn-rate         show context token burn rates for all sessions
  /snapshot [md]     export session state snapshot to JSON (or Markdown with md)
  /broadcast <msg>   send message to all sessions; /broadcast group:<tag> <msg> for group
  /watchdog [N]      alert if session stalls N minutes (default 10); /watchdog off to disable
  /top [mode]        rank sessions by errors (default), burn, or idle
  /ceiling           show context token usage vs limit for all sessions
  /rename N|name [display] set custom display name in TUI (no display = clear)
  /copy [N|name]     copy session's current pane output to clipboard (default: current drill-down)
  /ctx-budget        show smart context budget allocations per session
   /deps              show session dependency graph (path, goal, task cross-refs)
   /relay [args]      cross-session relay: no args=list, <src> <tgt> <pattern>=add, rm <id>=remove
   /throttle [s] [ms] per-session action cooldown: no args=show, <session> <ms>=set, <session> clear=remove
   /snap <N|name>     save a snapshot of session output for later diffing
   /snap-diff <N|name> diff current output against last /snap snapshot
   /alert-pattern [args] output alerting: no args=list, <regex> [label]=add, rm <id>=remove
   /hook [args]        lifecycle hooks: no args=list, <event> <session|*> <cmd>=add, rm <id>=remove
   /stats             show per-session health, errors, burn rate, context %, uptime
   /stats-live        toggle auto-refresh of /stats every 5 seconds (like top)
   /recall <keyword>  search persisted activity history (last 7 days) for keyword
   /pin-all-errors    pin every session currently in error status
   /pin-draining      pin all draining sessions to the top
   /labels            list all active session labels
   /sort-by-health    sort sessions by health score (ascending, worst first)
   /icon N [emoji]    set a single emoji shown in the session row (no emoji = clear)
  /export-stats      export /stats output as JSON to ~/.aoaoe/stats-<ts>.json
  /mute-errors       toggle suppression of error/! action entries in activity log
  /prev-goal N [n]   restore Nth session's goal from history (n=1 most recent)
  /tag N tag1,tag2   set freeform tags on a session (no tags = clear)
  /tags              list all session tags
  /tag-filter [tag]  show only sessions with given freeform tag (no arg = clear)
  /find <text>       search session pane outputs for text
   /search-all <q>    ranked full-text search across all session outputs (multi-word)
  /reset-health N    clear error counts + context history for a session
  /timeline N [n]    show last n activity entries for session N (default 30)
  /color N [color]   set accent color for session (lime/amber/rose/teal/sky/slate; no color = clear)
  /clear-history     truncate persisted activity history (tui-history.jsonl)
  /duplicate N [t]   spawn a new session cloned from session N (same tool/path)
  /color-all [c]     set accent color for all sessions (no color = clear all)
  /quiet-hours [H-H] suppress watchdog+burn alerts during hours (e.g. 22-06; no arg = clear)
  /quiet-status      show whether quiet hours are currently active
  /budget [N] [$]    set cost budget: /budget 1 2.50 (session), /budget 2.50 (global), /budget clear
  /pause-all         send interrupt to all sessions
  /resume-all        send resume to all sessions
   /alert-log [N]     show last N auto-generated alerts (burn-rate/watchdog/ceiling; default 20)
   /alert-mute [pat]  suppress alerts containing pattern; no arg = list; clear = remove all
   /health-trend N    show ASCII health score chart for session N [height]
   /budgets           list all active cost budgets
   /budget-status     show which sessions are over or under budget
   /flap-log          show sessions recently flagged as flapping
   /drain N           mark session N as draining (supervisor will skip it)
   /undrain N         remove drain mark from session N
   /export-all        bulk export snapshot + stats JSON for all sessions
   /note-history N    show previous notes for a session (before they were cleared)
   /label N [text]    set a freeform label shown in the session card (no text = clear)
   /sessions          show rich session table (status, health, group, cost, flags)
   /diff-sessions A B compare pane output of two sessions line by line
    /fan-out           generate task list entries for all sessions missing one
    /history-stats     show aggregate statistics from persisted activity history
  /cost-summary      show total estimated spend across all sessions
  /session-report N  generate full markdown report for a session → ~/.aoaoe/report-<name>-<ts>.md
  /clip [N]          copy last N activity entries to clipboard (default 20)
  /diff N            show activity since bookmark N
  /mark              bookmark current activity position
  /jump N            jump to bookmark N
  /marks             list all bookmarks
  /search <pattern>  filter activity entries by substring (case-insensitive)
  /search            clear active search filter
  click session      click an agent card to drill down (click again to go back)
  mouse wheel        scroll activity (overview) or session output (drill-down)
  PgUp / PgDn        scroll through activity or session output
  Home / End         jump to oldest / return to live

${BOLD}info:${RESET}
  /status            show daemon state
  /progress [opts]   what each session accomplished recently; opts: --since <1h|8h|24h> --json
  /health            session health scores (0-100 per task, fleet average)
  /prompt-template [name] set/show reasoner prompt strategy (default, hands-off, aggressive, review-focused, shipping)
  /incident [opts]   quick incident view; opts: --since <30m|2h|1d> --limit N --json --ndjson --follow (watch via CLI)
  /runbook [section] show operator playbook (opts: quickstart|response-flow|incident|all, --json)
  /supervisor [opts] show judge/orchestrator status; opts: --all --since <1h|30m|2d> --limit N --json
  /dashboard         show full dashboard
  /tasks             show task progress table
  /task [sub] [args] task management (list, reconcile, start, stop, edit, new, rm, help)
  /task <s> :: <g>   quick update goal <g> for session/task <s>
  :<goal>            fastest path: set goal for current drill-down session

${BOLD}other:${RESET}
  /alias /x /cmd     create alias (/x expands to /cmd). no args = list all
  /verbose           toggle detailed logging
  /clear             clear the screen
`);
        break;

      case "/pause":
        this.paused = true;
        console.error(`${YELLOW}paused -- reasoner will not be called until /resume${RESET}`);
        break;

      case "/resume":
        this.paused = false;
        console.error(`${GREEN}resumed${RESET}`);
        break;

      case "/status":
        this.queue.push("__CMD_STATUS__");
        break;

      case "/progress":
        this.queue.push(`__CMD_PROGRESS__${line.slice("/progress".length)}`);
        break;

      case "/runbook":
        this.queue.push(`__CMD_RUNBOOK__${line.slice("/runbook".length)}`);
        break;

      case "/incident":
        this.queue.push(`__CMD_INCIDENT__${line.slice("/incident".length)}`);
        break;

      case "/supervisor":
        this.queue.push(`__CMD_SUPERVISOR__${line.slice("/supervisor".length)}`);
        break;

      case "/mode": {
        const modeArg = line.slice("/mode".length).trim().toLowerCase();
        this.queue.push(`__CMD_MODE__${modeArg}`);
        break;
      }

      case "/profile":
        if (this.profileHandler) this.profileHandler();
        else console.error(`${DIM}profile not available (no TUI)${RESET}`);
        break;

      case "/replay": {
        const rpArgs = line.slice("/replay".length).trim().split(/\s+/);
        const rpTarget = rpArgs[0];
        if (!rpTarget) {
          console.error(`${DIM}usage: /replay <N|name> [lps]  — play back session output${RESET}`);
          break;
        }
        const rpSpeed = rpArgs[1] ? parseInt(rpArgs[1], 10) : null;
        if (this.replayHandler) this.replayHandler(rpTarget, isNaN(rpSpeed as number) ? null : rpSpeed);
        else console.error(`${DIM}replay not available (no TUI)${RESET}`);
        break;
      }

      case "/notify-filter": {
        const nfArgs = line.slice("/notify-filter".length).trim().split(/\s+/).filter(Boolean);
        if (nfArgs.length === 0) {
          // no args: list current filters
          if (this.notifyFilterHandler) this.notifyFilterHandler(null, []);
          else console.error(`${DIM}notify-filter not available (no TUI)${RESET}`);
        } else if (nfArgs.length === 1 && nfArgs[0].toLowerCase() === "clear") {
          // /notify-filter clear — remove all filters
          if (this.notifyFilterHandler) this.notifyFilterHandler("__CLEAR_ALL__", []);
          else console.error(`${DIM}notify-filter not available (no TUI)${RESET}`);
        } else {
          // /notify-filter <session> [event1 event2 ...]
          const session = nfArgs[0];
          const events = nfArgs.slice(1);
          if (events.length === 1 && events[0].toLowerCase() === "clear") {
            // /notify-filter <session> clear — remove filter for this session
            if (this.notifyFilterHandler) this.notifyFilterHandler(session, ["__CLEAR__"]);
            else console.error(`${DIM}notify-filter not available (no TUI)${RESET}`);
          } else {
            if (this.notifyFilterHandler) this.notifyFilterHandler(session, events);
            else console.error(`${DIM}notify-filter not available (no TUI)${RESET}`);
          }
        }
        break;
      }

      case "/trust": {
        const trustArg = line.slice("/trust".length).trim().toLowerCase();
        if (this.trustHandler) this.trustHandler(trustArg);
        else console.error(`${DIM}trust not available (no TUI)${RESET}`);
        break;
      }

      case "/dashboard":
        this.queue.push("__CMD_DASHBOARD__");
        break;

      case "/explain":
        this.queue.push("__CMD_EXPLAIN__");
        console.error(`${GREEN}Got it!${RESET} ${DIM}Asking the AI for a plain-English summary...${RESET}`);
        break;

      case "/verbose":
        this.queue.push("__CMD_VERBOSE__");
        break;

      case "/interrupt":
        this.handleEscInterrupt();
        break;

      case "/insist": {
        const insistMsg = line.slice("/insist".length).trim();
        if (insistMsg) {
          this.handleInsist(insistMsg);
        } else {
          console.error(`${DIM}usage: /insist <message> — interrupts and delivers your message immediately${RESET}`);
        }
        break;
      }

      case "/tasks":
        this.queue.push("__CMD_TASK__list");
        break;

      case "/t":
      case "/todo":
      case "/idea": {
        const taskArgs = line.slice(cmd.length).trim();
        this.queue.push(`__CMD_TASK__${taskArgs}`);
        break;
      }

      case "/task": {
        // pass arguments after "/task" as __CMD_TASK__ marker with args
        const taskArgs = line.slice("/task".length).trim();
        this.queue.push(`__CMD_TASK__${taskArgs}`);
        break;
      }

      case "/view": {
        const viewArg = line.slice("/view".length).trim();
        if (this.viewHandler) {
          this.viewHandler(viewArg || "1"); // default to session 1
        } else {
          console.error(`${DIM}drill-down not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/back":
        if (this.viewHandler) {
          this.viewHandler(null); // null = back to overview
        } else {
          console.error(`${DIM}already in overview${RESET}`);
        }
        break;

      case "/sort": {
        const sortArg = line.slice("/sort".length).trim().toLowerCase();
        if (this.sortHandler) {
          this.sortHandler(sortArg || null); // empty = cycle to next mode
        } else {
          console.error(`${DIM}sort not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/compact":
        if (this.compactHandler) {
          this.compactHandler();
        } else {
          console.error(`${DIM}compact mode not available (no TUI)${RESET}`);
        }
        break;

      case "/pin": {
        const pinArg = line.slice("/pin".length).trim();
        if (this.pinHandler) {
          if (pinArg) {
            this.pinHandler(pinArg);
          } else {
            console.error(`${DIM}usage: /pin <N|name> — toggle pin for a session${RESET}`);
          }
        } else {
          console.error(`${DIM}pin not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/pin-save":
        this.queue.push(`__CMD_PIN_SAVE__${line.slice("/pin-save".length)}`);
        break;

      case "/pin-load":
        this.queue.push(`__CMD_PIN_LOAD__${line.slice("/pin-load".length)}`);
        break;

      case "/pin-delete":
        this.queue.push(`__CMD_PIN_DELETE__${line.slice("/pin-delete".length)}`);
        break;

      case "/pin-presets":
        this.queue.push("__CMD_PIN_PRESETS__");
        break;

      case "/prompt-template":
        this.queue.push(`__CMD_PROMPT_TEMPLATE__${line.slice("/prompt-template".length)}`);
        break;

      case "/health":
        this.queue.push("__CMD_HEALTH__");
        break;

      case "/bell":
        if (this.bellHandler) {
          this.bellHandler();
        } else {
          console.error(`${DIM}bell not available (no TUI)${RESET}`);
        }
        break;

      case "/focus":
        if (this.focusHandler) {
          this.focusHandler();
        } else {
          console.error(`${DIM}focus not available (no TUI)${RESET}`);
        }
        break;

      case "/mute": {
        const muteArg = line.slice("/mute".length).trim();
        if (this.muteHandler) {
          if (muteArg) {
            this.muteHandler(muteArg);
          } else {
            console.error(`${DIM}usage: /mute <N|name> — toggle mute for a session${RESET}`);
          }
        } else {
          console.error(`${DIM}mute not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/unmute-all":
        if (this.unmuteAllHandler) {
          this.unmuteAllHandler();
        } else {
          console.error(`${DIM}unmute-all not available (no TUI)${RESET}`);
        }
        break;

      case "/filter": {
        const filterArg = line.slice("/filter".length).trim();
        if (this.tagFilterHandler) {
          this.tagFilterHandler(filterArg || null);
        } else {
          console.error(`${DIM}filter not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/who":
        if (this.whoHandler) {
          this.whoHandler();
        } else {
          console.error(`${DIM}who not available (no TUI)${RESET}`);
        }
        break;

      case "/uptime":
        if (this.uptimeHandler) {
          this.uptimeHandler();
        } else {
          console.error(`${DIM}uptime not available (no TUI)${RESET}`);
        }
        break;

      case "/auto-pin":
        if (this.autoPinHandler) {
          this.autoPinHandler();
        } else {
          console.error(`${DIM}auto-pin not available (no TUI)${RESET}`);
        }
        break;

      case "/note": {
        const noteArg = line.slice("/note".length).trim();
        if (this.noteHandler) {
          // split: first word is target, rest is note text
          const spaceIdx = noteArg.indexOf(" ");
          if (spaceIdx > 0) {
            const target = noteArg.slice(0, spaceIdx);
            const text = noteArg.slice(spaceIdx + 1).trim();
            this.noteHandler(target, text);
          } else if (noteArg) {
            // target only, no text — clear note
            this.noteHandler(noteArg, "");
          } else {
            console.error(`${DIM}usage: /note <N|name> <text> — set note, or /note <N|name> — clear${RESET}`);
          }
        } else {
          console.error(`${DIM}notes not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/notes":
        if (this.notesHandler) {
          this.notesHandler();
        } else {
          console.error(`${DIM}notes not available (no TUI)${RESET}`);
        }
        break;

      case "/clip": {
        const clipArg = line.slice("/clip".length).trim();
        const clipCount = clipArg ? parseInt(clipArg, 10) : 20;
        if (this.clipHandler && !isNaN(clipCount) && clipCount > 0) {
          this.clipHandler(clipCount);
        } else if (!this.clipHandler) {
          console.error(`${DIM}clip not available (no TUI)${RESET}`);
        } else {
          console.error(`${DIM}usage: /clip [N] — copy last N activity entries to clipboard${RESET}`);
        }
        break;
      }

      case "/diff": {
        const diffArg = line.slice("/diff".length).trim();
        const diffNum = parseInt(diffArg, 10);
        if (this.diffHandler && !isNaN(diffNum) && diffNum > 0) {
          this.diffHandler(diffNum);
        } else if (!this.diffHandler) {
          console.error(`${DIM}diff not available (no TUI)${RESET}`);
        } else {
          console.error(`${DIM}usage: /diff N — show activity since bookmark N${RESET}`);
        }
        break;
      }

      case "/mark":
        if (this.markHandler) {
          this.markHandler();
        } else {
          console.error(`${DIM}bookmarks not available (no TUI)${RESET}`);
        }
        break;

      case "/jump": {
        const jumpArg = line.slice("/jump".length).trim();
        const jumpNum = parseInt(jumpArg, 10);
        if (this.jumpHandler && !isNaN(jumpNum) && jumpNum > 0) {
          this.jumpHandler(jumpNum);
        } else if (!this.jumpHandler) {
          console.error(`${DIM}bookmarks not available (no TUI)${RESET}`);
        } else {
          console.error(`${DIM}usage: /jump N — jump to bookmark number N${RESET}`);
        }
        break;
      }

      case "/marks":
        if (this.marksHandler) {
          this.marksHandler();
        } else {
          console.error(`${DIM}bookmarks not available (no TUI)${RESET}`);
        }
        break;

      case "/search": {
        const searchArg = line.slice("/search".length).trim();
        if (this.searchHandler) {
          this.searchHandler(searchArg || null); // empty = clear search
        } else {
          console.error(`${DIM}search not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/alias": {
        const aliasArgs = line.slice("/alias".length).trim();
        if (!aliasArgs) {
          // list all aliases
          if (this.aliases.size === 0) {
            console.error(`${DIM}no aliases — use /alias /shortcut /command${RESET}`);
          } else {
            for (const [k, v] of this.aliases) console.error(`${DIM}  ${k} → ${v}${RESET}`);
          }
        } else {
          const parts = aliasArgs.split(/\s+/);
          const name = parts[0].startsWith("/") ? parts[0] : `/${parts[0]}`;
          const target = parts.slice(1).join(" ");
          if (!target) {
            // clear alias
            if (this.aliases.has(name)) {
              this.aliases.delete(name);
              console.error(`${DIM}alias ${name} removed${RESET}`);
              this.aliasChangeHandler?.();
            } else {
              console.error(`${DIM}no alias ${name} to remove${RESET}`);
            }
          } else {
            const err = validateAliasName(name);
            if (err) {
              console.error(`${RED}${err}${RESET}`);
            } else if (this.aliases.size >= MAX_ALIASES && !this.aliases.has(name)) {
              console.error(`${RED}max ${MAX_ALIASES} aliases — remove one first${RESET}`);
            } else {
              const targetCmd = target.startsWith("/") ? target : `/${target}`;
              this.aliases.set(name, targetCmd);
              console.error(`${DIM}alias ${name} → ${targetCmd}${RESET}`);
              this.aliasChangeHandler?.();
            }
          }
        }
        break;
      }

      case "/group": {
        const groupArg = line.slice("/group".length).trim();
        if (this.groupHandler) {
          const spaceIdx = groupArg.indexOf(" ");
          if (spaceIdx > 0) {
            const target = groupArg.slice(0, spaceIdx);
            const tag = groupArg.slice(spaceIdx + 1).trim();
            this.groupHandler(target, tag);
          } else if (groupArg) {
            // target only — clear group
            this.groupHandler(groupArg, "");
          } else {
            console.error(`${DIM}usage: /group <N|name> <tag> — assign group, or /group <N|name> — clear${RESET}`);
          }
        } else {
          console.error(`${DIM}groups not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/groups":
        if (this.groupsHandler) {
          this.groupsHandler();
        } else {
          console.error(`${DIM}groups not available (no TUI)${RESET}`);
        }
        break;

      case "/group-filter": {
        const gfArg = line.slice("/group-filter".length).trim();
        if (this.groupFilterHandler) {
          this.groupFilterHandler(gfArg || null);
        } else {
          console.error(`${DIM}group filter not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/mute-errors":
        if (this.muteErrorsHandler) {
          this.muteErrorsHandler();
        } else {
          console.error(`${DIM}mute-errors not available (no TUI)${RESET}`);
        }
        break;

      case "/prev-goal": {
        const pgArgs = line.slice("/prev-goal".length).trim().split(/\s+/);
        const pgTarget = pgArgs[0] ?? "";
        const pgN = pgArgs[1] ? parseInt(pgArgs[1], 10) : 1;
        if (!pgTarget) {
          console.error(`${DIM}usage: /prev-goal <N|name> [n] — restore nth most-recent goal (default 1)${RESET}`);
          break;
        }
        if (this.prevGoalHandler) {
          this.prevGoalHandler(pgTarget, isNaN(pgN) || pgN < 1 ? 1 : pgN);
        } else {
          console.error(`${DIM}prev-goal not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/tag": {
        const tagArgs = line.slice("/tag".length).trim();
        if (!tagArgs) {
          console.error(`${DIM}usage: /tag <N|name> [tag1,tag2,...] — set tags (no tags = clear)${RESET}`);
          break;
        }
        if (this.tagHandler) {
          const spaceIdx = tagArgs.indexOf(" ");
          if (spaceIdx > 0) {
            const target = tagArgs.slice(0, spaceIdx);
            const rawTags = tagArgs.slice(spaceIdx + 1).trim();
            const tags = rawTags ? rawTags.split(",").map((t) => t.trim()).filter(Boolean) : [];
            this.tagHandler(target, tags);
          } else {
            // target only — clear tags
            this.tagHandler(tagArgs, []);
          }
        } else {
          console.error(`${DIM}tag not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/tags":
        if (this.tagsListHandler) {
          this.tagsListHandler();
        } else {
          console.error(`${DIM}tags not available (no TUI)${RESET}`);
        }
        break;

      case "/tag-filter": {
        const tf2Arg = line.slice("/tag-filter".length).trim() || null;
        if (this.tagFilter2Handler) {
          this.tagFilter2Handler(tf2Arg);
        } else {
          console.error(`${DIM}tag-filter not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/find": {
        const findArg = line.slice("/find".length).trim();
        if (!findArg) {
          console.error(`${DIM}usage: /find <text> — search session pane outputs${RESET}`);
          break;
        }
        if (this.findHandler) {
          this.findHandler(findArg);
        } else {
          console.error(`${DIM}find not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/search-all": {
        const saQuery = line.slice("/search-all".length).trim();
        if (!saQuery) {
          console.error(`${DIM}usage: /search-all <query> — ranked full-text search across session outputs${RESET}`);
          break;
        }
        if (this.fullSearchHandler) this.fullSearchHandler(saQuery);
        else console.error(`${DIM}search-all not available (no TUI)${RESET}`);
        break;
      }

      case "/timeline": {
        const tlArgs = line.slice("/timeline".length).trim().split(/\s+/);
        const tlTarget = tlArgs[0] ?? "";
        const tlCount = tlArgs[1] ? parseInt(tlArgs[1], 10) : 30;
        if (!tlTarget) {
          console.error(`${DIM}usage: /timeline <N|name> [count] — show last N activity entries for session${RESET}`);
          break;
        }
        if (this.timelineHandler) {
          this.timelineHandler(tlTarget, isNaN(tlCount) || tlCount < 1 ? 30 : Math.min(tlCount, 500));
        } else {
          console.error(`${DIM}timeline not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/color": {
        const colorArgs = line.slice("/color".length).trim();
        if (!colorArgs) {
          console.error(`${DIM}usage: /color <N|name> [color] — set accent color (lime/amber/rose/teal/sky/slate; no color = clear)${RESET}`);
          break;
        }
        if (this.colorHandler) {
          const spaceIdx = colorArgs.indexOf(" ");
          if (spaceIdx > 0) {
            this.colorHandler(colorArgs.slice(0, spaceIdx), colorArgs.slice(spaceIdx + 1).trim().toLowerCase());
          } else {
            // no color = clear
            this.colorHandler(colorArgs, "");
          }
        } else {
          console.error(`${DIM}color not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/duplicate": {
        const dupArg = line.slice("/duplicate".length).trim();
        if (!dupArg) {
          console.error(`${DIM}usage: /duplicate <N|name> [new-title]${RESET}`);
          break;
        }
        if (this.duplicateHandler) {
          const spaceIdx = dupArg.indexOf(" ");
          const target = spaceIdx > 0 ? dupArg.slice(0, spaceIdx) : dupArg;
          const newTitle = spaceIdx > 0 ? dupArg.slice(spaceIdx + 1).trim() : "";
          this.duplicateHandler(target, newTitle);
        } else {
          console.error(`${DIM}duplicate not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/color-all": {
        const caArg = line.slice("/color-all".length).trim().toLowerCase() || "";
        if (this.colorAllHandler) {
          this.colorAllHandler(caArg);
        } else {
          console.error(`${DIM}color-all not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/quiet-hours": {
        const qhArg = line.slice("/quiet-hours".length).trim();
        if (this.quietHoursHandler) {
          const specs = qhArg ? qhArg.split(/[\s,]+/).filter(Boolean) : [];
          this.quietHoursHandler(specs);
        } else {
          console.error(`${DIM}quiet-hours not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/history-stats":
        if (this.historyStatsHandler) {
          this.historyStatsHandler();
        } else {
          console.error(`${DIM}history-stats not available (no TUI)${RESET}`);
        }
        break;

      case "/budget": {
        const bArgs = line.slice("/budget".length).trim().split(/\s+/).filter(Boolean);
        if (bArgs.length === 0 || bArgs[0] === "clear") {
          // clear global budget
          if (this.budgetHandler) this.budgetHandler(null, null);
          else console.error(`${DIM}budget not available${RESET}`);
          break;
        }
        if (this.budgetHandler) {
          // /budget <$N> → global, /budget <N|name> <$N> → per-session
          const maybeUSD = parseFloat(bArgs[bArgs.length - 1].replace("$", ""));
          if (!isNaN(maybeUSD) && bArgs.length === 1) {
            this.budgetHandler(null, maybeUSD); // global
          } else if (!isNaN(maybeUSD) && bArgs.length >= 2) {
            this.budgetHandler(bArgs[0], maybeUSD); // per-session
          } else {
            console.error(`${DIM}usage: /budget [$N.NN] — global, /budget <N|name> $N.NN — per-session, /budget clear — remove${RESET}`);
          }
        } else {
          console.error(`${DIM}budget not available${RESET}`);
        }
        break;
      }

      case "/pause-all":
        if (this.bulkControlHandler) this.bulkControlHandler("pause");
        else console.error(`${DIM}pause-all not available${RESET}`);
        break;

      case "/resume-all":
        if (this.bulkControlHandler) this.bulkControlHandler("resume");
        else console.error(`${DIM}resume-all not available${RESET}`);
        break;

      case "/health-trend": {
        const htArgs = line.slice("/health-trend".length).trim().split(/\s+/).filter(Boolean);
        const htTarget = htArgs[0] ?? "";
        const htHeight = htArgs[1] ? parseInt(htArgs[1], 10) : 6;
        if (!htTarget) { console.error(`${DIM}usage: /health-trend <N|name> [height]${RESET}`); break; }
        if (this.healthTrendHandler) this.healthTrendHandler(htTarget, isNaN(htHeight) || htHeight < 2 ? 6 : Math.min(htHeight, 20));
        else console.error(`${DIM}health-trend not available${RESET}`);
        break;
      }

      case "/alert-mute": {
        const amArg = line.slice("/alert-mute".length).trim();
        if (this.alertMuteHandler) {
          if (amArg.toLowerCase() === "clear") this.alertMuteHandler(null);
          else this.alertMuteHandler(amArg || null);
        } else console.error(`${DIM}alert-mute not available${RESET}`);
        break;
      }

      case "/budgets":
        if (this.budgetsListHandler) this.budgetsListHandler();
        else console.error(`${DIM}budgets not available${RESET}`);
        break;

      case "/flap-log":
        if (this.flapLogHandler) this.flapLogHandler();
        else console.error(`${DIM}flap-log not available${RESET}`);
        break;

      case "/drain": {
        const drainArg = line.slice("/drain".length).trim();
        if (!drainArg) { console.error(`${DIM}usage: /drain <N|name>${RESET}`); break; }
        if (this.drainHandler) this.drainHandler(drainArg, true);
        else console.error(`${DIM}drain not available${RESET}`);
        break;
      }

      case "/undrain": {
        const undrainArg = line.slice("/undrain".length).trim();
        if (!undrainArg) { console.error(`${DIM}usage: /undrain <N|name>${RESET}`); break; }
        if (this.drainHandler) this.drainHandler(undrainArg, false);
        else console.error(`${DIM}undrain not available${RESET}`);
        break;
      }

      case "/note-history": {
        const nhArg = line.slice("/note-history".length).trim();
        if (!nhArg) { console.error(`${DIM}usage: /note-history <N|name>${RESET}`); break; }
        if (this.noteHistoryHandler) this.noteHistoryHandler(nhArg);
        else console.error(`${DIM}note-history not available${RESET}`);
        break;
      }

      case "/label": {
        const lblArgs = line.slice("/label".length).trim();
        if (!lblArgs) { console.error(`${DIM}usage: /label <N|name> [text]${RESET}`); break; }
        if (this.labelHandler) {
          const spaceIdx = lblArgs.indexOf(" ");
          if (spaceIdx > 0) {
            this.labelHandler(lblArgs.slice(0, spaceIdx), lblArgs.slice(spaceIdx + 1).trim());
          } else {
            this.labelHandler(lblArgs, ""); // clear
          }
        } else console.error(`${DIM}label not available${RESET}`);
        break;
      }

      case "/sessions":
        if (this.sessionsTableHandler) this.sessionsTableHandler();
        else console.error(`${DIM}sessions not available${RESET}`);
        break;

      case "/diff-sessions": {
        const dsArgs = line.slice("/diff-sessions".length).trim().split(/\s+/);
        if (dsArgs.length < 2 || !dsArgs[0] || !dsArgs[1]) {
          console.error(`${DIM}usage: /diff-sessions <A> <B> — compare pane output of two sessions${RESET}`);
          break;
        }
        if (this.diffSessionsHandler) this.diffSessionsHandler(dsArgs[0], dsArgs[1]);
        else console.error(`${DIM}diff-sessions not available (no TUI)${RESET}`);
        break;
      }

      case "/fan-out":
        if (this.fanOutHandler) this.fanOutHandler();
        else console.error(`${DIM}fan-out not available (no TUI)${RESET}`);
        break;

      case "/export-all":
        if (this.exportAllHandler) this.exportAllHandler();
        else console.error(`${DIM}export-all not available${RESET}`);
        break;

      case "/budget-status":
        if (this.budgetStatusHandler) this.budgetStatusHandler();
        else console.error(`${DIM}budget-status not available${RESET}`);
        break;

      case "/quiet-status":
        if (this.quietStatusHandler) this.quietStatusHandler();
        else console.error(`${DIM}quiet-status not available (no TUI)${RESET}`);
        break;

      case "/alert-log": {
        const alN = parseInt(line.slice("/alert-log".length).trim() || "20", 10);
        const alCount = isNaN(alN) || alN < 1 ? 20 : Math.min(alN, 200);
        if (this.alertLogHandler) this.alertLogHandler(alCount);
        else console.error(`${DIM}alert-log not available (no TUI)${RESET}`);
        break;
      }

      case "/cost-summary":
        if (this.costSummaryHandler) this.costSummaryHandler();
        else console.error(`${DIM}cost-summary not available (no TUI)${RESET}`);
        break;

      case "/session-report": {
        const srArg = line.slice("/session-report".length).trim();
        if (!srArg) { console.error(`${DIM}usage: /session-report <N|name>${RESET}`); break; }
        if (this.sessionReportHandler) this.sessionReportHandler(srArg);
        else console.error(`${DIM}session-report not available (no TUI)${RESET}`);
        break;
      }

      case "/clear-history":
        if (this.clearHistoryHandler) {
          this.clearHistoryHandler();
        } else {
          console.error(`${DIM}clear-history not available (no TUI)${RESET}`);
        }
        break;

      case "/reset-health": {
        const rhArg = line.slice("/reset-health".length).trim();
        if (!rhArg) {
          console.error(`${DIM}usage: /reset-health <N|name> — clear error counts + context history${RESET}`);
          break;
        }
        if (this.resetHealthHandler) {
          this.resetHealthHandler(rhArg);
        } else {
          console.error(`${DIM}reset-health not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/pin-all-errors":
        if (this.pinAllErrorsHandler) {
          this.pinAllErrorsHandler();
        } else {
          console.error(`${DIM}pin-all-errors not available (no TUI)${RESET}`);
        }
        break;

      case "/pin-draining":
        if (this.pinDrainingHandler) {
          this.pinDrainingHandler();
        } else {
          console.error(`${DIM}pin-draining not available (no TUI)${RESET}`);
        }
        break;

      case "/labels":
        if (this.labelsHandler) {
          this.labelsHandler();
        } else {
          console.error(`${DIM}labels not available (no TUI)${RESET}`);
        }
        break;

      case "/sort-by-health":
        if (this.sortHandler) {
          this.sortHandler("health");
        } else {
          console.error(`${DIM}sort not available (no TUI)${RESET}`);
        }
        break;

      case "/icon": {
        const iconArgs = line.slice("/icon".length).trim();
        if (!iconArgs) { console.error(`${DIM}usage: /icon <N|name> <emoji>${RESET}`); break; }
        const iconSpaceIdx = iconArgs.indexOf(" ");
        if (iconSpaceIdx < 0) { console.error(`${DIM}usage: /icon <N|name> <emoji>${RESET}`); break; }
        const iconTarget = iconArgs.slice(0, iconSpaceIdx).trim();
        const iconEmoji  = iconArgs.slice(iconSpaceIdx + 1).trim();
        if (this.iconHandler) {
          this.iconHandler(iconTarget, iconEmoji || null);
        } else {
          console.error(`${DIM}icon not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/export-stats":
        if (this.exportStatsHandler) {
          this.exportStatsHandler();
        } else {
          console.error(`${DIM}export-stats not available (no TUI)${RESET}`);
        }
        break;

      case "/recall": {
        const recallArgs = line.slice("/recall".length).trim().split(/\s+/);
        const keyword = recallArgs[0] ?? "";
        if (!keyword) {
          console.error(`${DIM}usage: /recall <keyword> [N] — search activity history (default: last 50 matches)${RESET}`);
          break;
        }
        const maxN = recallArgs[1] ? parseInt(recallArgs[1], 10) : 50;
        const limit = isNaN(maxN) || maxN < 1 ? 50 : Math.min(maxN, 500);
        if (this.recallHandler) {
          this.recallHandler(keyword, limit);
        } else {
          console.error(`${DIM}recall not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/deps":
        if (this.depsHandler) this.depsHandler();
        else console.error(`${DIM}deps not available (no TUI)${RESET}`);
        break;

      case "/relay": {
        const relayArgs = line.slice("/relay".length).trim();
        if (this.relayHandler) this.relayHandler(relayArgs);
        else console.error(`${DIM}relay not available (no TUI)${RESET}`);
        break;
      }

      case "/throttle": {
        const thArgs = line.slice("/throttle".length).trim();
        if (this.throttleHandler) this.throttleHandler(thArgs);
        else console.error(`${DIM}throttle not available (no TUI)${RESET}`);
        break;
      }

      case "/snap": {
        const snapTarget = line.slice("/snap".length).trim();
        if (!snapTarget) { console.error(`${DIM}usage: /snap <N|name> — save output snapshot${RESET}`); break; }
        if (this.snapHandler) this.snapHandler(snapTarget);
        else console.error(`${DIM}snap not available (no TUI)${RESET}`);
        break;
      }

      case "/snap-diff": {
        const sdTarget = line.slice("/snap-diff".length).trim();
        if (!sdTarget) { console.error(`${DIM}usage: /snap-diff <N|name> — diff vs last snapshot${RESET}`); break; }
        if (this.snapDiffHandler) this.snapDiffHandler(sdTarget);
        else console.error(`${DIM}snap-diff not available (no TUI)${RESET}`);
        break;
      }

      case "/alert-pattern": {
        const apArgs = line.slice("/alert-pattern".length).trim();
        if (this.alertPatternHandler) this.alertPatternHandler(apArgs);
        else console.error(`${DIM}alert-pattern not available (no TUI)${RESET}`);
        break;
      }

      case "/hook": {
        const hookArgs = line.slice("/hook".length).trim();
        if (this.hookHandler) this.hookHandler(hookArgs);
        else console.error(`${DIM}hook not available (no TUI)${RESET}`);
        break;
      }

      case "/ctx-budget":
        if (this.ctxBudgetHandler) {
          this.ctxBudgetHandler();
        } else {
          console.error(`${DIM}ctx-budget not available (no TUI)${RESET}`);
        }
        break;

      case "/stats":
        if (this.statsHandler) {
          this.statsHandler();
        } else {
          console.error(`${DIM}stats not available (no TUI)${RESET}`);
        }
        break;

      case "/stats-live":
        if (this.statsLiveHandler) {
          this.statsLiveHandler();
        } else {
          console.error(`${DIM}stats-live not available (no TUI)${RESET}`);
        }
        break;

      case "/copy": {
        const copyArg = line.slice("/copy".length).trim() || null;
        if (this.copySessionHandler) {
          this.copySessionHandler(copyArg);
        } else {
          console.error(`${DIM}copy not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/rename": {
        const renameArg = line.slice("/rename".length).trim();
        if (!renameArg) {
          console.error(`${DIM}usage: /rename <N|name> [display name] — set custom display name (no name = clear)${RESET}`);
          break;
        }
        if (this.renameHandler) {
          const spaceIdx = renameArg.indexOf(" ");
          if (spaceIdx > 0) {
            const target = renameArg.slice(0, spaceIdx);
            const display = renameArg.slice(spaceIdx + 1).trim();
            this.renameHandler(target, display);
          } else {
            // target only — clear alias
            this.renameHandler(renameArg, "");
          }
        } else {
          console.error(`${DIM}rename not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/ceiling":
        if (this.ceilingHandler) {
          this.ceilingHandler();
        } else {
          console.error(`${DIM}ceiling not available (no TUI)${RESET}`);
        }
        break;

      case "/top": {
        const topArg = line.slice("/top".length).trim().toLowerCase() || "default";
        if (this.topHandler) {
          this.topHandler(topArg);
        } else {
          console.error(`${DIM}top not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/watchdog": {
        const wdArg = line.slice("/watchdog".length).trim().toLowerCase();
        if (this.watchdogHandler) {
          if (!wdArg || wdArg === "on") {
            this.watchdogHandler(10); // default 10 min
          } else if (wdArg === "off") {
            this.watchdogHandler(null);
          } else {
            const mins = parseInt(wdArg, 10);
            if (!isNaN(mins) && mins > 0) {
              this.watchdogHandler(mins);
            } else {
              console.error(`${DIM}usage: /watchdog [N]  set N-minute stall alert (default 10), or /watchdog off${RESET}`);
            }
          }
        } else {
          console.error(`${DIM}watchdog not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/burn-rate":
        if (this.burnRateHandler) {
          this.burnRateHandler();
        } else {
          console.error(`${DIM}burn-rate not available (no TUI)${RESET}`);
        }
        break;

      case "/broadcast": {
        const broadcastArg = line.slice("/broadcast".length).trim();
        if (!broadcastArg) {
          console.error(`${DIM}usage: /broadcast <message>  or  /broadcast group:<tag> <message>${RESET}`);
          break;
        }
        if (this.broadcastHandler) {
          // check for group:<tag> prefix
          const groupMatch = broadcastArg.match(/^group:([a-z0-9_-]+)\s+([\s\S]+)$/i);
          if (groupMatch) {
            this.broadcastHandler(groupMatch[2].trim(), groupMatch[1].toLowerCase());
          } else {
            this.broadcastHandler(broadcastArg, null);
          }
        } else {
          console.error(`${DIM}broadcast not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/snapshot": {
        const snapArg = line.slice("/snapshot".length).trim().toLowerCase();
        const fmt = snapArg === "md" || snapArg === "markdown" ? "md" : "json";
        if (this.snapshotHandler) {
          this.snapshotHandler(fmt);
        } else {
          console.error(`${DIM}snapshot not available (no TUI)${RESET}`);
        }
        break;
      }

      case "/activity":
        if (this.activityHandler) this.activityHandler();
        else console.error(`${DIM}activity not available (no TUI)${RESET}`);
        break;

      case "/conflicts":
        if (this.conflictsHandler) this.conflictsHandler();
        else console.error(`${DIM}conflicts not available (no TUI)${RESET}`);
        break;

      case "/heatmap":
        if (this.heatmapHandler) this.heatmapHandler();
        else console.error(`${DIM}heatmap not available (no TUI)${RESET}`);
        break;

      case "/audit": {
        const auditArg = line.slice("/audit".length).trim();
        const auditCount = auditArg ? parseInt(auditArg, 10) : 25;
        if (this.auditHandler) this.auditHandler(isNaN(auditCount) ? 25 : auditCount);
        else console.error(`${DIM}audit not available (no TUI)${RESET}`);
        break;
      }

      case "/audit-stats":
        if (this.auditStatsHandler) this.auditStatsHandler();
        else console.error(`${DIM}audit-stats not available (no TUI)${RESET}`);
        break;

      case "/fleet-snap":
        if (this.fleetSnapHandler) this.fleetSnapHandler();
        else console.error(`${DIM}fleet-snap not available (no TUI)${RESET}`);
        break;

      case "/budget-predict":
        if (this.budgetPredictHandler) this.budgetPredictHandler();
        else console.error(`${DIM}budget-predict not available (no TUI)${RESET}`);
        break;

      case "/retries":
        if (this.retriesHandler) this.retriesHandler();
        else console.error(`${DIM}retries not available (no TUI)${RESET}`);
        break;

      case "/audit-search": {
        const asArg = line.slice("/audit-search".length).trim();
        if (!asArg) { console.error(`${DIM}usage: /audit-search <query> — e.g. type:auto_complete session:adventure last:1h${RESET}`); break; }
        if (this.auditSearchHandler) this.auditSearchHandler(asArg);
        else console.error(`${DIM}audit-search not available (no TUI)${RESET}`);
        break;
      }

      case "/fleet-forecast":
        if (this.fleetForecastHandler) this.fleetForecastHandler();
        else console.error(`${DIM}fleet-forecast not available (no TUI)${RESET}`);
        break;

      case "/priority":
        if (this.priorityQueueHandler) this.priorityQueueHandler();
        else console.error(`${DIM}priority not available (no TUI)${RESET}`);
        break;

      case "/escalations":
        if (this.escalationsHandler) this.escalationsHandler();
        else console.error(`${DIM}escalations not available (no TUI)${RESET}`);
        break;

      case "/poll-status":
        if (this.pollStatusHandler) this.pollStatusHandler();
        else console.error(`${DIM}poll-status not available (no TUI)${RESET}`);
        break;

      case "/drift":
        if (this.driftHandler) this.driftHandler();
        else console.error(`${DIM}drift not available (no TUI)${RESET}`);
        break;

      case "/goal-progress":
        if (this.goalProgressHandler) this.goalProgressHandler();
        else console.error(`${DIM}goal-progress not available (no TUI)${RESET}`);
        break;

      case "/pool":
        if (this.poolHandler) this.poolHandler();
        else console.error(`${DIM}pool not available (no TUI)${RESET}`);
        break;

      case "/reasoner-cost":
        if (this.reasonerCostHandler) this.reasonerCostHandler();
        else console.error(`${DIM}reasoner-cost not available (no TUI)${RESET}`);
        break;

      case "/anomaly":
        if (this.anomalyHandler) this.anomalyHandler();
        else console.error(`${DIM}anomaly not available (no TUI)${RESET}`);
        break;

      case "/sla":
        if (this.slaHandler) this.slaHandler();
        else console.error(`${DIM}sla not available (no TUI)${RESET}`);
        break;

      case "/velocity":
        if (this.velocityHandler) this.velocityHandler();
        else console.error(`${DIM}velocity not available (no TUI)${RESET}`);
        break;

      case "/schedule":
        if (this.scheduleHandler) this.scheduleHandler();
        else console.error(`${DIM}schedule not available (no TUI)${RESET}`);
        break;

      case "/cache":
        if (this.cacheHandler) this.cacheHandler();
        else console.error(`${DIM}cache not available (no TUI)${RESET}`);
        break;

      case "/rate-limit":
        if (this.rateLimitHandler) this.rateLimitHandler();
        else console.error(`${DIM}rate-limit not available (no TUI)${RESET}`);
        break;

      case "/recovery":
        if (this.recoveryHandler) this.recoveryHandler();
        else console.error(`${DIM}recovery not available (no TUI)${RESET}`);
        break;

      case "/lifecycle":
        if (this.lifecycleHandler) this.lifecycleHandler();
        else console.error(`${DIM}lifecycle not available (no TUI)${RESET}`);
        break;

      case "/cost-report":
        if (this.costReportHandler) this.costReportHandler();
        else console.error(`${DIM}cost-report not available (no TUI)${RESET}`);
        break;

      case "/decompose": {
        const dcArg = line.slice("/decompose".length).trim();
        if (!dcArg) { console.error(`${DIM}usage: /decompose <N|name>${RESET}`); break; }
        if (this.decomposeHandler) this.decomposeHandler(dcArg);
        else console.error(`${DIM}decompose not available (no TUI)${RESET}`);
        break;
      }

      case "/memory": {
        const memArg = line.slice("/memory".length).trim();
        if (!memArg) { console.error(`${DIM}usage: /memory <N|name>${RESET}`); break; }
        if (this.memoryHandler) this.memoryHandler(memArg);
        else console.error(`${DIM}memory not available (no TUI)${RESET}`);
        break;
      }

      case "/dep-graph":
        if (this.depGraphHandler) this.depGraphHandler();
        else console.error(`${DIM}dep-graph not available (no TUI)${RESET}`);
        break;

      case "/approvals":
        if (this.approvalQueueHandler) this.approvalQueueHandler();
        else console.error(`${DIM}approvals not available (no TUI)${RESET}`);
        break;

      case "/approve": {
        const apArg = line.slice("/approve".length).trim();
        if (!apArg) { console.error(`${DIM}usage: /approve <id|all>${RESET}`); break; }
        if (this.approveHandler) this.approveHandler(apArg);
        else console.error(`${DIM}approve not available (no TUI)${RESET}`);
        break;
      }

      case "/reject": {
        const rjArg = line.slice("/reject".length).trim();
        if (!rjArg) { console.error(`${DIM}usage: /reject <id|all>${RESET}`); break; }
        if (this.rejectHandler) this.rejectHandler(rjArg);
        else console.error(`${DIM}reject not available (no TUI)${RESET}`);
        break;
      }

      case "/fleet-diff":
        if (this.fleetDiffHandler) this.fleetDiffHandler();
        else console.error(`${DIM}fleet-diff not available (no TUI)${RESET}`);
        break;

      case "/template": {
        const tmplArg = line.slice("/template".length).trim();
        if (this.sessionTemplateHandler) this.sessionTemplateHandler(tmplArg);
        else console.error(`${DIM}template not available (no TUI)${RESET}`);
        break;
      }

      case "/difficulty":
        if (this.difficultyHandler) this.difficultyHandler();
        else console.error(`${DIM}difficulty not available (no TUI)${RESET}`);
        break;

      case "/smart-nudge": {
        const snArg = line.slice("/smart-nudge".length).trim();
        if (!snArg) { console.error(`${DIM}usage: /smart-nudge <N|name>${RESET}`); break; }
        if (this.smartNudgeHandler) this.smartNudgeHandler(snArg);
        else console.error(`${DIM}smart-nudge not available (no TUI)${RESET}`);
        break;
      }

      case "/utilization":
        if (this.utilizationHandler) this.utilizationHandler();
        else console.error(`${DIM}utilization not available (no TUI)${RESET}`);
        break;

      case "/detect-template": {
        const dtArg = line.slice("/detect-template".length).trim();
        if (!dtArg) { console.error(`${DIM}usage: /detect-template <N|name>${RESET}`); break; }
        if (this.detectTemplateHandler) this.detectTemplateHandler(dtArg);
        else console.error(`${DIM}detect-template not available (no TUI)${RESET}`);
        break;
      }

      case "/fleet-search": {
        const fsArg = line.slice("/fleet-search".length).trim();
        if (!fsArg) { console.error(`${DIM}usage: /fleet-search <query>${RESET}`); break; }
        if (this.fleetSearchHandler) this.fleetSearchHandler(fsArg);
        else console.error(`${DIM}fleet-search not available (no TUI)${RESET}`);
        break;
      }

      case "/nudge-stats":
        if (this.nudgeStatsHandler) this.nudgeStatsHandler();
        else console.error(`${DIM}nudge-stats not available (no TUI)${RESET}`);
        break;

      case "/allocation":
        if (this.allocationHandler) this.allocationHandler();
        else console.error(`${DIM}allocation not available (no TUI)${RESET}`);
        break;

      case "/graduation":
        if (this.graduationHandler) this.graduationHandler();
        else console.error(`${DIM}graduation not available (no TUI)${RESET}`);
        break;

      case "/refine": {
        const rfArg = line.slice("/refine".length).trim();
        if (!rfArg) { console.error(`${DIM}usage: /refine <N|name>${RESET}`); break; }
        if (this.refineHandler) this.refineHandler(rfArg);
        else console.error(`${DIM}refine not available (no TUI)${RESET}`);
        break;
      }

      case "/export":
        if (this.exportHandler) this.exportHandler();
        else console.error(`${DIM}export not available (no TUI)${RESET}`);
        break;

      case "/service":
        if (this.serviceHandler) this.serviceHandler();
        else console.error(`${DIM}service not available (no TUI)${RESET}`);
        break;

      case "/session-replay": {
        const rpArg = line.slice("/session-replay".length).trim();
        if (!rpArg) { console.error(`${DIM}usage: /session-replay <session-name>${RESET}`); break; }
        if (this.sessionReplayHandler) this.sessionReplayHandler(rpArg);
        else console.error(`${DIM}session-replay not available (no TUI)${RESET}`);
        break;
      }

      case "/workflow":
        if (this.workflowHandler) this.workflowHandler();
        else console.error(`${DIM}workflow not available (no TUI)${RESET}`);
        break;

      case "/multi-reasoner":
        if (this.multiReasonerHandler) this.multiReasonerHandler();
        else console.error(`${DIM}multi-reasoner not available (no TUI)${RESET}`);
        break;

      case "/token-quota":
        if (this.tokenQuotaHandler) this.tokenQuotaHandler();
        else console.error(`${DIM}token-quota not available (no TUI)${RESET}`);
        break;

      case "/checkpoint":
        if (this.checkpointHandler) this.checkpointHandler();
        else console.error(`${DIM}checkpoint not available (no TUI)${RESET}`);
        break;

      case "/workflow-new": {
        const wnArg = line.slice("/workflow-new".length).trim();
        if (!wnArg) { console.error(`${DIM}usage: /workflow-new <template> <prefix>${RESET}`); break; }
        if (this.workflowNewHandler) this.workflowNewHandler(wnArg);
        else console.error(`${DIM}workflow-new not available (no TUI)${RESET}`);
        break;
      }

      case "/ab-stats":
        if (this.abStatsHandler) this.abStatsHandler();
        else console.error(`${DIM}ab-stats not available (no TUI)${RESET}`);
        break;

      case "/workflow-chain":
        if (this.workflowChainHandler) this.workflowChainHandler();
        else console.error(`${DIM}workflow-chain not available (no TUI)${RESET}`);
        break;

      case "/workflow-forecast": {
        const wfArg = line.slice("/workflow-forecast".length).trim();
        if (!wfArg) { console.error(`${DIM}usage: /workflow-forecast <template>${RESET}`); break; }
        if (this.workflowForecastHandler) this.workflowForecastHandler(wfArg);
        else console.error(`${DIM}workflow-forecast not available (no TUI)${RESET}`);
        break;
      }

      case "/federation":
        if (this.federationHandler) this.federationHandler();
        else console.error(`${DIM}federation not available (no TUI)${RESET}`);
        break;

      case "/archives":
        if (this.archivesHandler) this.archivesHandler();
        else console.error(`${DIM}archives not available (no TUI)${RESET}`);
        break;

      case "/runbook-gen":
        if (this.runbookGenHandler) this.runbookGenHandler();
        else console.error(`${DIM}runbook-gen not available (no TUI)${RESET}`);
        break;

      case "/alert-rules":
        if (this.alertRulesHandler) this.alertRulesHandler();
        else console.error(`${DIM}alert-rules not available (no TUI)${RESET}`);
        break;

      case "/tail": {
        const tlArg = line.slice("/tail".length).trim();
        if (!tlArg) { console.error(`${DIM}usage: /tail <session> [count] [pattern]${RESET}`); break; }
        if (this.sessionTailHandler) this.sessionTailHandler(tlArg);
        else console.error(`${DIM}tail not available (no TUI)${RESET}`);
        break;
      }

      case "/health-forecast":
        if (this.healthForecastHandler) this.healthForecastHandler();
        else console.error(`${DIM}health-forecast not available (no TUI)${RESET}`);
        break;

      case "/workflow-viz":
        if (this.workflowVizHandler) this.workflowVizHandler();
        else console.error(`${DIM}workflow-viz not available (no TUI)${RESET}`);
        break;

      case "/session-diff": {
        const sdArg = line.slice("/session-diff".length).trim();
        if (!sdArg) { console.error(`${DIM}usage: /session-diff <session>${RESET}`); break; }
        if (this.sessionDiffHandler) this.sessionDiffHandler(sdArg);
        else console.error(`${DIM}session-diff not available (no TUI)${RESET}`);
        break;
      }

      case "/session-tag": {
        const tgArg = line.slice("/session-tag".length).trim();
        if (this.sessionTagHandler) this.sessionTagHandler(tgArg);
        else console.error(`${DIM}session-tag not available (no TUI)${RESET}`);
        break;
      }

      case "/compare": {
        const cpArg = line.slice("/compare".length).trim();
        if (!cpArg) { console.error(`${DIM}usage: /compare <session-a> <session-b>${RESET}`); break; }
        if (this.compareHandler) this.compareHandler(cpArg);
        else console.error(`${DIM}compare not available (no TUI)${RESET}`);
        break;
      }

      case "/fleet-report":
        if (this.fleetReportHandler) this.fleetReportHandler();
        else console.error(`${DIM}fleet-report not available (no TUI)${RESET}`);
        break;

      case "/task-timeline": {
        const tlArg = line.slice("/task-timeline".length).trim();
        if (!tlArg) { console.error(`${DIM}usage: /task-timeline <session>${RESET}`); break; }
        if (this.taskTimelineHandler) this.taskTimelineHandler(tlArg);
        else console.error(`${DIM}task-timeline not available (no TUI)${RESET}`);
        break;
      }

      case "/changelog": {
        const clArg = line.slice("/changelog".length).trim();
        if (this.changelogHandler) this.changelogHandler(clArg);
        else console.error(`${DIM}changelog not available (no TUI)${RESET}`);
        break;
      }

      case "/metrics":
        if (this.metricsHandler) this.metricsHandler();
        else console.error(`${DIM}metrics not available (no TUI)${RESET}`);
        break;

      case "/fleet-grep": {
        const fgArg = line.slice("/fleet-grep".length).trim();
        if (!fgArg) { console.error(`${DIM}usage: /fleet-grep <pattern>${RESET}`); break; }
        if (this.fleetGrepHandler) this.fleetGrepHandler(fgArg);
        else console.error(`${DIM}fleet-grep not available (no TUI)${RESET}`);
        break;
      }

      case "/runbook-exec":
        if (this.runbookExecHandler) this.runbookExecHandler();
        else console.error(`${DIM}runbook-exec not available (no TUI)${RESET}`);
        break;

      case "/clone": {
        const clArg = line.slice("/clone".length).trim();
        if (!clArg) { console.error(`${DIM}usage: /clone <source> <new-name> [goal-override]${RESET}`); break; }
        if (this.cloneHandler) this.cloneHandler(clArg);
        else console.error(`${DIM}clone not available (no TUI)${RESET}`);
        break;
      }

      case "/similar-goals":
        if (this.similarGoalsHandler) this.similarGoalsHandler();
        else console.error(`${DIM}similar-goals not available (no TUI)${RESET}`);
        break;

      case "/cost-tags": {
        const ctArg = line.slice("/cost-tags".length).trim() || "team";
        if (this.costTagsHandler) this.costTagsHandler(ctArg);
        else console.error(`${DIM}cost-tags not available (no TUI)${RESET}`);
        break;
      }

      case "/scaling":
        if (this.scalingHandler) this.scalingHandler();
        else console.error(`${DIM}scaling not available (no TUI)${RESET}`);
        break;

      case "/idle-detect":
        if (this.idleDetectHandler) this.idleDetectHandler();
        else console.error(`${DIM}idle-detect not available (no TUI)${RESET}`);
        break;

      case "/goal-conflicts":
        if (this.goalConflictsHandler2) this.goalConflictsHandler2();
        else console.error(`${DIM}goal-conflicts not available (no TUI)${RESET}`);
        break;

      case "/leaderboard":
        if (this.leaderboardHandler) this.leaderboardHandler();
        else console.error(`${DIM}leaderboard not available (no TUI)${RESET}`);
        break;

      case "/health-history":
        if (this.healthHistoryHandler) this.healthHistoryHandler();
        else console.error(`${DIM}health-history not available (no TUI)${RESET}`);
        break;

      case "/cost-throttle":
        if (this.costThrottleHandler) this.costThrottleHandler();
        else console.error(`${DIM}cost-throttle not available (no TUI)${RESET}`);
        break;

      case "/suggest-name": {
        const snArg = line.slice("/suggest-name".length).trim();
        if (!snArg) { console.error(`${DIM}usage: /suggest-name <repo-path> [goal text]${RESET}`); break; }
        if (this.suggestNameHandler) this.suggestNameHandler(snArg);
        else console.error(`${DIM}suggest-name not available (no TUI)${RESET}`);
        break;
      }

      case "/handoff":
        if (this.shiftHandoffHandler) this.shiftHandoffHandler();
        else console.error(`${DIM}handoff not available (no TUI)${RESET}`);
        break;

      case "/auto-deps":
        if (this.autoDepsHandler) this.autoDepsHandler();
        else console.error(`${DIM}auto-deps not available (no TUI)${RESET}`);
        break;

      case "/cost-forecast":
        if (this.costForecastHandler) this.costForecastHandler();
        else console.error(`${DIM}cost-forecast not available (no TUI)${RESET}`);
        break;

      case "/event-bus":
        if (this.eventBusHandler) this.eventBusHandler();
        else console.error(`${DIM}event-bus not available (no TUI)${RESET}`);
        break;

      case "/verify-goals":
        if (this.verifyGoalsHandler) this.verifyGoalsHandler();
        else console.error(`${DIM}verify-goals not available (no TUI)${RESET}`);
        break;

      case "/output-diff": {
        const odArg = line.slice("/output-diff".length).trim();
        if (!odArg) { console.error(`${DIM}usage: /output-diff <session>${RESET}`); break; }
        if (this.outputDiffHandler) this.outputDiffHandler(odArg);
        else console.error(`${DIM}output-diff not available (no TUI)${RESET}`);
        break;
      }

      case "/heartbeat":
        if (this.heartbeatHandler) this.heartbeatHandler();
        else console.error(`${DIM}heartbeat not available (no TUI)${RESET}`);
        break;

      case "/replay": {
        const rpArg = line.slice("/replay".length).trim() || "stats";
        if (this.actionReplayHandler) this.actionReplayHandler(rpArg);
        else console.error(`${DIM}replay not available (no TUI)${RESET}`);
        break;
      }

      case "/profiles": {
        const pfArg = line.slice("/profiles".length).trim();
        if (this.configProfilesHandler) this.configProfilesHandler(pfArg);
        else console.error(`${DIM}profiles not available (no TUI)${RESET}`);
        break;
      }

      case "/doctor":
        if (this.doctorHandler) this.doctorHandler();
        else console.error(`${DIM}doctor not available (no TUI)${RESET}`);
        break;

      case "/state-machine": {
        const smArg = line.slice("/state-machine".length).trim();
        if (this.stateMachineHandler) this.stateMachineHandler(smArg);
        else console.error(`${DIM}state-machine not available (no TUI)${RESET}`);
        break;
      }

      case "/context-stats":
        if (this.contextStatsHandler) this.contextStatsHandler();
        else console.error(`${DIM}context-stats not available (no TUI)${RESET}`);
        break;

      case "/metrics-hist":
        if (this.metricsHistHandler) this.metricsHistHandler();
        else console.error(`${DIM}metrics-hist not available (no TUI)${RESET}`);
        break;

      case "/peer-review": {
        const prArg = line.slice("/peer-review".length).trim();
        if (this.peerReviewHandler) this.peerReviewHandler(prArg);
        else console.error(`${DIM}peer-review not available (no TUI)${RESET}`);
        break;
      }

      case "/warm-standby": {
        const wsArg = line.slice("/warm-standby".length).trim();
        if (this.warmStandbyHandler) this.warmStandbyHandler(wsArg);
        else console.error(`${DIM}warm-standby not available (no TUI)${RESET}`);
        break;
      }

      case "/redaction-stats":
        if (this.redactionStatsHandler) this.redactionStatsHandler();
        else console.error(`${DIM}redaction-stats not available (no TUI)${RESET}`);
        break;

      case "/compliance":
        if (this.complianceHandler) this.complianceHandler();
        else console.error(`${DIM}compliance not available (no TUI)${RESET}`);
        break;

      case "/plugin-hooks":
        if (this.pluginHooksHandler) this.pluginHooksHandler();
        else console.error(`${DIM}plugin-hooks not available (no TUI)${RESET}`);
        break;

      case "/incidents":
        if (this.incidentTimelineHandler) this.incidentTimelineHandler();
        else console.error(`${DIM}incidents not available (no TUI)${RESET}`);
        break;

      case "/bookmark": {
        const bmArg = line.slice("/bookmark".length).trim();
        if (this.bookmarkHandler) this.bookmarkHandler(bmArg);
        else console.error(`${DIM}bookmark not available (no TUI)${RESET}`);
        break;
      }

      case "/canary": {
        const cnArg = line.slice("/canary".length).trim();
        if (this.canaryModeHandler) this.canaryModeHandler(cnArg);
        else console.error(`${DIM}canary not available (no TUI)${RESET}`);
        break;
      }

      case "/config-diff":
        if (this.configDiffHandler) this.configDiffHandler();
        else console.error(`${DIM}config-diff not available (no TUI)${RESET}`);
        break;

      case "/goal-priority":
        if (this.goalPriorityHandler) this.goalPriorityHandler();
        else console.error(`${DIM}goal-priority not available (no TUI)${RESET}`);
        break;

      case "/capacity-forecast":
        if (this.capacityForecastHandler) this.capacityForecastHandler();
        else console.error(`${DIM}capacity-forecast not available (no TUI)${RESET}`);
        break;

      case "/watchdog-status":
        if (this.watchdogStatusHandler) this.watchdogStatusHandler();
        else console.error(`${DIM}watchdog-status not available (no TUI)${RESET}`);
        break;

      case "/cost-regression":
        if (this.costRegressionHandler) this.costRegressionHandler();
        else console.error(`${DIM}cost-regression not available (no TUI)${RESET}`);
        break;

      case "/goal-cascade": {
        const gcArg = line.slice("/goal-cascade".length).trim();
        if (this.goalCascadeHandler) this.goalCascadeHandler(gcArg);
        else console.error(`${DIM}goal-cascade not available (no TUI)${RESET}`);
        break;
      }

      case "/health-score":
        if (this.healthScoreHandler) this.healthScoreHandler();
        else console.error(`${DIM}health-score not available (no TUI)${RESET}`);
        break;

      case "/event-replay": {
        const erArg = line.slice("/event-replay".length).trim();
        if (this.eventReplayHandler) this.eventReplayHandler(erArg);
        else console.error(`${DIM}event-replay not available (no TUI)${RESET}`);
        break;
      }

      case "/context-budget":
        if (this.contextBudgetHandler) this.contextBudgetHandler();
        else console.error(`${DIM}context-budget not available (no TUI)${RESET}`);
        break;

      case "/tick-profiler":
        if (this.tickProfilerHandler) this.tickProfilerHandler();
        else console.error(`${DIM}tick-profiler not available (no TUI)${RESET}`);
        break;

      case "/goal-confidence":
        if (this.goalConfidenceHandler) this.goalConfidenceHandler();
        else console.error(`${DIM}goal-confidence not available (no TUI)${RESET}`);
        break;

      case "/budget-plan":
        if (this.budgetPlanHandler) this.budgetPlanHandler();
        else console.error(`${DIM}budget-plan not available (no TUI)${RESET}`);
        break;

      case "/sentiment":
        if (this.sentimentHandler) this.sentimentHandler();
        else console.error(`${DIM}sentiment not available (no TUI)${RESET}`);
        break;

      case "/workload-balance":
        if (this.workloadBalanceHandler) this.workloadBalanceHandler();
        else console.error(`${DIM}workload-balance not available (no TUI)${RESET}`);
        break;

      case "/crash-report":
        if (this.crashReportHandler) this.crashReportHandler();
        else console.error(`${DIM}crash-report not available (no TUI)${RESET}`);
        break;

      case "/group": {
        const grpArg = line.slice("/group".length).trim();
        if (this.sessionGroupHandler) this.sessionGroupHandler(grpArg);
        else console.error(`${DIM}group not available (no TUI)${RESET}`);
        break;
      }

      case "/context-diff":
        if (this.contextDiffHandler) this.contextDiffHandler();
        else console.error(`${DIM}context-diff not available (no TUI)${RESET}`);
        break;

      case "/config-validate":
        if (this.configSchemaHandler) this.configSchemaHandler();
        else console.error(`${DIM}config-validate not available (no TUI)${RESET}`);
        break;

      case "/transcript": {
        const trArg = line.slice("/transcript".length).trim();
        if (!trArg) { console.error(`${DIM}usage: /transcript <session>${RESET}`); break; }
        if (this.transcriptExportHandler) this.transcriptExportHandler(trArg);
        else console.error(`${DIM}transcript not available (no TUI)${RESET}`);
        break;
      }

      case "/decomp-quality":
        if (this.decompQualityHandler) this.decompQualityHandler();
        else console.error(`${DIM}decomp-quality not available (no TUI)${RESET}`);
        break;

      case "/anomaly-corr":
        if (this.anomalyCorrelationHandler) this.anomalyCorrelationHandler();
        else console.error(`${DIM}anomaly-corr not available (no TUI)${RESET}`);
        break;

      case "/critical-path":
        if (this.criticalPathHandler) this.criticalPathHandler();
        else console.error(`${DIM}critical-path not available (no TUI)${RESET}`);
        break;

      case "/snap-compress":
        if (this.snapshotCompressionHandler) this.snapshotCompressionHandler();
        else console.error(`${DIM}snap-compress not available (no TUI)${RESET}`);
        break;

      case "/annotate": {
        const annArg = line.slice("/annotate".length).trim();
        if (this.outputAnnotationsHandler) this.outputAnnotationsHandler(annArg);
        else console.error(`${DIM}annotate not available (no TUI)${RESET}`);
        break;
      }

      case "/celebrate":
        if (this.celebrationHandler) this.celebrationHandler();
        else console.error(`${DIM}celebrate not available (no TUI)${RESET}`);
        break;

      case "/readiness":
        if (this.readinessHandler) this.readinessHandler();
        else console.error(`${DIM}readiness not available (no TUI)${RESET}`);
        break;

      case "/supervisor":
        if (this.processSupervisorHandler) this.processSupervisorHandler();
        else console.error(`${DIM}supervisor not available (no TUI)${RESET}`);
        break;

      case "/daily-digest":
        if (this.dailyDigestHandler) this.dailyDigestHandler();
        else console.error(`${DIM}daily-digest not available (no TUI)${RESET}`);
        break;

      case "/parse-goal": {
        const pgArg = line.slice("/parse-goal".length).trim();
        if (!pgArg) { console.error(`${DIM}usage: /parse-goal <freeform text>${RESET}`); break; }
        if (this.goalParserHandler) this.goalParserHandler(pgArg);
        else console.error(`${DIM}parse-goal not available (no TUI)${RESET}`);
        break;
      }

      case "/hot-swap": {
        const hsArg = line.slice("/hot-swap".length).trim();
        if (this.hotSwapHandler) this.hotSwapHandler(hsArg);
        else console.error(`${DIM}hot-swap not available (no TUI)${RESET}`);
        break;
      }

      case "/webhook-preview": {
        const wpArg = line.slice("/webhook-preview".length).trim() || "slack";
        if (this.webhookPreviewHandler) this.webhookPreviewHandler(wpArg);
        else console.error(`${DIM}webhook-preview not available (no TUI)${RESET}`);
        break;
      }

      case "/structured-log":
        if (this.structuredLogHandler) this.structuredLogHandler();
        else console.error(`${DIM}structured-log not available (no TUI)${RESET}`);
        break;

      case "/state-export":
        if (this.stateExportHandler) this.stateExportHandler();
        else console.error(`${DIM}state-export not available (no TUI)${RESET}`);
        break;

      case "/output-dedup": {
        const odArg = line.slice("/output-dedup".length).trim();
        if (!odArg) { console.error(`${DIM}usage: /output-dedup <session>${RESET}`); break; }
        if (this.outputDedupHandler) this.outputDedupHandler(odArg);
        else console.error(`${DIM}output-dedup not available (no TUI)${RESET}`);
        break;
      }

      case "/config-migrate":
        if (this.configMigrateHandler) this.configMigrateHandler();
        else console.error(`${DIM}config-migrate not available (no TUI)${RESET}`);
        break;

      case "/progress-predict":
        if (this.progressPredictHandler) this.progressPredictHandler();
        else console.error(`${DIM}progress-predict not available (no TUI)${RESET}`);
        break;

      case "/ops-dashboard":
        if (this.opsDashboardHandler) this.opsDashboardHandler();
        else console.error(`${DIM}ops-dashboard not available (no TUI)${RESET}`);
        break;

      case "/dep-repair":
        if (this.depRepairHandler) this.depRepairHandler();
        else console.error(`${DIM}dep-repair not available (no TUI)${RESET}`);
        break;

      case "/pattern-evolution":
        if (this.patternEvolutionHandler) this.patternEvolutionHandler();
        else console.error(`${DIM}pattern-evolution not available (no TUI)${RESET}`);
        break;

      case "/alert-dashboard": {
        const adArg = line.slice("/alert-dashboard".length).trim();
        if (this.alertDashboardHandler) this.alertDashboardHandler(adArg);
        else console.error(`${DIM}alert-dashboard not available (no TUI)${RESET}`);
        break;
      }

      case "/lang-detect":
        if (this.langDetectHandler) this.langDetectHandler();
        else console.error(`${DIM}lang-detect not available (no TUI)${RESET}`);
        break;

      case "/goal-sla": {
        const gsArg = line.slice("/goal-sla".length).trim();
        if (this.goalSlaHandler) this.goalSlaHandler(gsArg);
        else console.error(`${DIM}goal-sla not available (no TUI)${RESET}`);
        break;
      }

      case "/auto-scaler":
        if (this.autoScalerHandler) this.autoScalerHandler();
        else console.error(`${DIM}auto-scaler not available (no TUI)${RESET}`);
        break;

      case "/gamification":
        if (this.gamificationHandler) this.gamificationHandler();
        else console.error(`${DIM}gamification not available (no TUI)${RESET}`);
        break;

      case "/audit-report":
        if (this.auditReportHandler) this.auditReportHandler();
        else console.error(`${DIM}audit-report not available (no TUI)${RESET}`);
        break;

      case "/startup-profile":
        if (this.startupProfileHandler) this.startupProfileHandler();
        else console.error(`${DIM}startup-profile not available (no TUI)${RESET}`);
        break;

      case "/affinity-groups":
        if (this.affinityGroupsHandler) this.affinityGroupsHandler();
        else console.error(`${DIM}affinity-groups not available (no TUI)${RESET}`);
        break;

      case "/clipboard": {
        const cbArg = line.slice("/clipboard".length).trim();
        if (!cbArg) { console.error(`${DIM}usage: /clipboard <session>${RESET}`); break; }
        if (this.clipboardHandler) this.clipboardHandler(cbArg);
        else console.error(`${DIM}clipboard not available (no TUI)${RESET}`);
        break;
      }

      case "/shutdown-status":
        if (this.gracefulShutdownHandler) this.gracefulShutdownHandler();
        else console.error(`${DIM}shutdown-status not available (no TUI)${RESET}`);
        break;

      case "/dep-impact": {
        const diArg = line.slice("/dep-impact".length).trim();
        if (!diArg) { console.error(`${DIM}usage: /dep-impact <session>${RESET}`); break; }
        if (this.depImpactHandler) this.depImpactHandler(diArg);
        else console.error(`${DIM}dep-impact not available (no TUI)${RESET}`);
        break;
      }

      case "/runbook": {
        const rbArg = line.slice("/runbook".length).trim();
        if (this.runbookLibraryHandler) this.runbookLibraryHandler(rbArg);
        else console.error(`${DIM}runbook not available (no TUI)${RESET}`);
        break;
      }

      case "/dep-graph-export": {
        const dgeArg = line.slice("/dep-graph-export".length).trim() || "dot";
        if (this.depGraphExportHandler) this.depGraphExportHandler(dgeArg);
        else console.error(`${DIM}dep-graph-export not available (no TUI)${RESET}`);
        break;
      }

      case "/perf-regression":
        if (this.perfRegressionHandler) this.perfRegressionHandler();
        else console.error(`${DIM}perf-regression not available (no TUI)${RESET}`);
        break;

      case "/compliance-report":
        if (this.complianceReportHandler2) this.complianceReportHandler2();
        else console.error(`${DIM}compliance-report not available (no TUI)${RESET}`);
        break;

      case "/clear":
        process.stderr.write("\x1b[2J\x1b[H");
        break;

      default:
        console.error(`${DIM}unknown command: ${cmd} (try /help — or in drill-down use :<goal>)${RESET}`);
        break;
    }
  }
}
