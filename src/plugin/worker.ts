// AoE plugin worker entry point (spawned by the aoe daemon per
// aoe-plugin.toml [runtime]). Speaks newline-delimited JSON-RPC 2.0 on stdio:
// host RPC calls go out on stdout, responses and host-initiated command
// invocations come in on stdin. stderr lands in the host's per-plugin worker
// log, so plain console.error is the logging channel.
//
// This is the plugin deployment mode of the same engine the standalone
// `aoaoe` CLI runs: tick() from loop.ts with a plugin-API poller/executor.

import process from "node:process";
import { tick, type TickResult } from "../loop.js";
import type { SessionPolicyState } from "../reasoner/prompt.js";
import { createReasoner } from "../reasoner/index.js";
import { DEFAULTS } from "../config.js";
import type { AoaoeConfig, Reasoner } from "../types.js";
import { RpcConnection } from "./protocol.js";
import { HostClient } from "./host.js";
import { loadSettings, inQuietHours, SETTING_DEFAULTS, type PluginSettings } from "./settings.js";
import { rankSessions, historyToJson, historyFromJson, formatDuration, type QueueRow, type StatusHistoryEntry } from "./attention.js";
import { PluginPoller } from "./plugin-poller.js";
import { PluginExecutor, type CooldownState } from "./plugin-executor.js";
import { RulesReasoner } from "./rules-reasoner.js";
import { spawnFromIssues, type SpawnReport } from "./spawn.js";
import {
  queueCardPayload, queuePagePayload, statusBarPayload, attentionBadgePayload, attentionColumnPayload,
  attentionSortPayload, sessionPanePayload, type WorkerStatusSummary,
} from "./ui.js";

export const PLUGIN_ID = "dev.talador12.aoaoe";

const STORAGE_KEYS = {
  workerState: "worker_state", // { paused }
  history: "status_history",
  owned: "owned_sessions", // string[]
  cooldowns: "cooldowns",
} as const;

const URGENT_SCORE = 60;
const BADGE_SCORE = 40;
const RENOTIFY_MS = 30 * 60_000;

export class OrchestratorWorker {
  private readonly host: HostClient;
  private readonly poller: PluginPoller;
  private readonly executor: PluginExecutor;
  private settings: PluginSettings = SETTING_DEFAULTS;
  private paused = false;
  private history = new Map<string, StatusHistoryEntry>();
  private ownedSessionIds = new Set<string>();
  private cooldowns: CooldownState = {};
  private policyStates = new Map<string, SessionPolicyState>();
  private reasoner: Reasoner | null = null;
  private reasonerBackend = "";
  private pollCount = 0;
  private lastTickAt = 0;
  private lastTickSummary = "";
  private lastSpawnReport: SpawnReport | null = null;
  private lastNotifiedAt = new Map<string, number>();
  private badgedSessions = new Set<string>();
  private panedSessions = new Set<string>();
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;

  constructor(private readonly rpc: RpcConnection) {
    this.host = new HostClient(rpc);
    this.poller = new PluginPoller(this.host);
    this.executor = new PluginExecutor(this.host, () => this.settings, this.ownedSessionIds, this.cooldowns);
    rpc.onIncoming((method, params, respond) => {
      this.dispatch(method, params)
        .then((result) => respond?.(result))
        .catch((err) => respond?.({ ok: false, error: String(err) }));
    });
  }

  async start(): Promise<void> {
    await this.restoreState();
    this.settings = await loadSettings(this.host);
    await this.host.uiStateSet("sort-key", "attention_sort", attentionSortPayload()).catch(() => {});
    await this.runTick("startup");
    this.schedule();
  }

  // ── incoming methods ──────────────────────────────────────────────────────

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    // settings hot-reload push from the host
    if (method === "plugin.settings.changed") {
      this.settings = await loadSettings(this.host);
      this.schedule(); // interval may have changed
      return { ok: true };
    }
    // palette/CLI command dispatch arrives either as the fixed
    // `plugin.command.invoke { command }` form or namespaced
    // `plugin.<id>.<command>`; pane actions arrive as `aoaoe.<method>`.
    // Dispatching on the trailing segment covers all three.
    let command = method.split(".").pop() ?? method;
    if (method === "plugin.command.invoke") {
      const p = params as Record<string, unknown>;
      command = typeof p?.command === "string" ? (p.command.split(".").pop() ?? p.command) : "";
    }
    switch (command) {
      case "status":
        await this.runTick("status command", { observeOnly: true });
        return { ok: true, queue: this.currentQueue(), paused: this.paused, dry_run: this.settings.dryRun };
      case "tick":
        await this.runTick("manual tick");
        return { ok: true, summary: this.lastTickSummary };
      case "pause":
        this.paused = true;
        await this.persistWorkerState();
        await this.pushUi(this.currentQueue());
        await this.host.notify("info", "Orchestrator paused").catch(() => {});
        return { ok: true };
      case "resume":
        this.paused = false;
        await this.persistWorkerState();
        await this.runTick("resume");
        await this.host.notify("info", "Orchestrator resumed").catch(() => {});
        return { ok: true };
      case "spawn":
        return this.runSpawn();
      default:
        return { ok: false, error: `unknown command "${command}"` };
    }
  }

  // ── tick ──────────────────────────────────────────────────────────────────

  private schedule(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => {
      this.runTick("interval").finally(() => this.schedule());
    }, this.settings.tickIntervalSecs * 1000);
    this.tickTimer.unref?.();
  }

  private async runTick(trigger: string, opts: { observeOnly?: boolean } = {}): Promise<void> {
    if (this.ticking) return; // ticks never overlap; the next interval catches up
    this.ticking = true;
    try {
      const quiet = inQuietHours(this.settings.quietHours, new Date());
      const observeOnly = opts.observeOnly || this.paused || quiet;

      let tickResult: TickResult | null = null;
      if (observeOnly) {
        await this.poller.poll();
      } else {
        const config = this.makeConfig();
        tickResult = await tick({
          config,
          poller: this.poller,
          reasoner: this.getReasoner(config),
          executor: this.executor,
          policyStates: this.policyStates,
          pollCount: this.pollCount,
        });
        this.lastTickAt = Date.now();
        this.lastTickSummary = summarizeTick(tickResult);
      }
      this.pollCount++;

      const rows = this.currentQueue();
      await this.pushUi(rows, quiet);
      await this.notifyUrgent(rows);
      await this.host
        .eventsPublish("queue.updated", {
          at: Date.now(),
          trigger,
          paused: this.paused,
          dry_run: this.settings.dryRun,
          queue: rows,
        })
        .catch(() => {});
      await this.persistState();
    } catch (err) {
      console.error(`[aoaoe] tick failed (${trigger}):`, err);
    } finally {
      this.ticking = false;
    }
  }

  private currentQueue(): QueueRow[] {
    return rankSessions(this.poller.lastSessions, this.history, this.ownedSessionIds, Date.now());
  }

  private makeConfig(): AoaoeConfig {
    const backend = this.settings.reasoner === "opencode" ? "opencode" : "claude-code";
    return {
      ...structuredClone(DEFAULTS),
      reasoner: backend,
      dryRun: this.settings.dryRun,
      pollIntervalMs: this.settings.tickIntervalSecs * 1000,
      reasonIntervalMs: this.settings.tickIntervalSecs * 1000,
      policies: {
        ...structuredClone(DEFAULTS.policies),
        actionCooldownMs: this.settings.actionCooldownSecs * 1000,
        allowDestructive: false, // no destructive primitive exists in plugin mode; belt and suspenders
      },
    };
  }

  private getReasoner(config: AoaoeConfig): Reasoner {
    const wanted = this.settings.reasoner;
    if (this.reasoner && this.reasonerBackend === wanted) return this.reasoner;
    this.reasoner?.shutdown().catch(() => {});
    this.reasoner =
      wanted === "rules"
        ? new RulesReasoner({
            ownedSessionIds: this.ownedSessionIds,
            maxIdleBeforeNudgeMs: config.policies.maxIdleBeforeNudgeMs,
            statusSince: (id) => this.history.get(id)?.since,
          })
        : createReasoner(config);
    this.reasonerBackend = wanted;
    return this.reasoner;
  }

  // ── spawn ─────────────────────────────────────────────────────────────────

  private async runSpawn(): Promise<unknown> {
    const report = await spawnFromIssues(this.host, this.settings, this.ownedSessionIds);
    this.lastSpawnReport = report;
    const created = report.outcomes.filter((o) => o.created).length;
    const planned = report.outcomes.filter((o) => o.planned).length;
    const title = report.error
      ? "Spawn failed"
      : report.live
        ? `Spawn: ${created} session(s) created`
        : `Spawn dry run: ${planned} issue(s) would spawn`;
    await this.host.notify(report.error ? "error" : "info", title, report.error ?? undefined).catch(() => {});
    await this.persistState();
    await this.pushUi(this.currentQueue());
    return { ok: !report.error, report };
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  private async pushUi(rows: QueueRow[], quiet = false): Promise<void> {
    const summary: WorkerStatusSummary = {
      paused: this.paused,
      dryRun: this.settings.dryRun,
      reasoner: this.settings.reasoner,
      lastTickAt: this.lastTickAt || undefined,
      lastTickSummary: this.lastTickSummary || undefined,
      quiet,
    };
    const pushes: Array<Promise<unknown>> = [
      this.host.uiStateSet("card", "queue_card", queueCardPayload(rows, summary)),
      this.host.uiStateSet(
        "settings-page",
        "orchestrator_queue",
        queuePagePayload(rows, summary, this.lastSpawnReport ?? undefined)
      ),
      this.host.uiStateSet("status-bar", "orchestrator_status", statusBarPayload(rows, summary)),
    ];

    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.sessionId);
      pushes.push(this.host.uiStateSet("row-column", "attention_score", attentionColumnPayload(row), row.sessionId));
      pushes.push(this.host.uiStateSet("pane", "orchestrator_pane", sessionPanePayload(row, recommendationFor(row)), row.sessionId));
      this.panedSessions.add(row.sessionId);
      if (row.attentionScore >= BADGE_SCORE) {
        pushes.push(this.host.uiStateSet("row-badge", "attention_badge", attentionBadgePayload(row), row.sessionId));
        this.badgedSessions.add(row.sessionId);
      } else if (this.badgedSessions.has(row.sessionId)) {
        pushes.push(this.host.uiStateSet("row-badge", "attention_badge", { items: [] }, row.sessionId));
        this.badgedSessions.delete(row.sessionId);
      }
    }
    // clear state for sessions that left the queue entirely
    for (const sid of [...this.badgedSessions]) {
      if (!seen.has(sid)) {
        pushes.push(this.host.uiStateRemove("row-badge", "attention_badge", sid).catch(() => {}) as Promise<unknown>);
        this.badgedSessions.delete(sid);
      }
    }
    for (const sid of [...this.panedSessions]) {
      if (!seen.has(sid)) {
        pushes.push(this.host.uiStateRemove("pane", "orchestrator_pane", sid).catch(() => {}) as Promise<unknown>);
        pushes.push(this.host.uiStateRemove("row-column", "attention_score", sid).catch(() => {}) as Promise<unknown>);
        this.panedSessions.delete(sid);
      }
    }
    const results = await Promise.allSettled(pushes);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error(`[aoaoe] ${failed.length}/${results.length} ui pushes failed:`, (failed[0] as PromiseRejectedResult).reason);
    }
  }

  private async notifyUrgent(rows: QueueRow[]): Promise<void> {
    if (this.paused) return;
    const now = Date.now();
    for (const row of rows) {
      if (row.attentionScore < URGENT_SCORE) {
        this.lastNotifiedAt.delete(row.sessionId);
        continue;
      }
      const last = this.lastNotifiedAt.get(row.sessionId);
      if (last !== undefined && now - last < RENOTIFY_MS) continue;
      this.lastNotifiedAt.set(row.sessionId, now);
      await this.host
        .notify(
          row.status === "Error" ? "error" : "warning",
          `${row.title} needs attention`,
          `${row.status} for ${formatDuration(row.inStatusForMs)} (score ${row.attentionScore})`,
          row.sessionId
        )
        .catch(() => {});
    }
  }

  // ── persistence ───────────────────────────────────────────────────────────

  private async restoreState(): Promise<void> {
    try {
      const [state, history, owned, cooldowns] = await Promise.all([
        this.host.storageGet(STORAGE_KEYS.workerState),
        this.host.storageGet(STORAGE_KEYS.history),
        this.host.storageGet(STORAGE_KEYS.owned),
        this.host.storageGet(STORAGE_KEYS.cooldowns),
      ]);
      this.paused = !!(state as Record<string, unknown> | null)?.paused;
      this.history = historyFromJson(history);
      if (Array.isArray(owned)) {
        for (const id of owned) if (typeof id === "string") this.ownedSessionIds.add(id);
      }
      if (cooldowns && typeof cooldowns === "object") {
        for (const [k, v] of Object.entries(cooldowns as Record<string, unknown>)) {
          if (typeof v === "number") this.cooldowns[k] = v;
        }
      }
    } catch (err) {
      console.error("[aoaoe] state restore failed, starting fresh:", err);
    }
  }

  private async persistWorkerState(): Promise<void> {
    await this.host.storageSet(STORAGE_KEYS.workerState, { paused: this.paused }).catch(() => {});
  }

  private async persistState(): Promise<void> {
    // drop owned ids that no longer exist so the pool cap can't wedge shut
    const live = new Set(this.poller.lastSessions.map((s) => s.id));
    for (const id of [...this.ownedSessionIds]) {
      if (!live.has(id)) this.ownedSessionIds.delete(id);
    }
    // prune expired cooldown stamps so the storage value stays bounded
    const cutoff = Date.now() - Math.max(1, this.settings.actionCooldownSecs) * 1000;
    for (const [k, v] of Object.entries(this.cooldowns)) {
      if (v < cutoff) delete this.cooldowns[k];
    }
    await Promise.allSettled([
      this.persistWorkerState(),
      this.host.storageSet(STORAGE_KEYS.history, historyToJson(this.history)),
      this.host.storageSet(STORAGE_KEYS.owned, [...this.ownedSessionIds]),
      this.host.storageSet(STORAGE_KEYS.cooldowns, this.cooldowns),
    ]);
  }
}

function summarizeTick(result: TickResult): string {
  if (result.skippedReason) return `skipped: ${result.skippedReason}`;
  if (result.dryRunActions?.length) {
    return `dry run: would ${result.dryRunActions.map((a) => a.action).join(", ")}`;
  }
  if (result.executed.length > 0) {
    const okCount = result.executed.filter((e) => e.success).length;
    return `executed ${okCount}/${result.executed.length} action(s)`;
  }
  return "no action needed";
}

function recommendationFor(row: QueueRow): string | undefined {
  if (row.status === "Error") return "Session errored — open it and check the last output. The orchestrator cannot restart sessions through the plugin API.";
  if (row.status === "Waiting" && row.attentionScore >= URGENT_SCORE) {
    return row.pluginOwned
      ? "Waiting on input — the orchestrator will nudge it if allow_nudge is enabled."
      : "Waiting on input — likely a question or permission prompt.";
  }
  if (row.status === "Idle" && row.attentionScore >= BADGE_SCORE) return "Idle for a while — done, or stalled?";
  return undefined;
}

// ── entry ───────────────────────────────────────────────────────────────────

const isMain = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href || process.argv[1]?.endsWith("plugin/worker.js");
  } catch {
    return false;
  }
})();

if (isMain) {
  const rpc = new RpcConnection(process.stdin, process.stdout);
  const worker = new OrchestratorWorker(rpc);
  // the host closes stdin to stop the worker; exit cleanly when it does
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));
  worker.start().catch((err) => {
    console.error("[aoaoe] worker failed to start:", err);
    process.exit(1);
  });
}
