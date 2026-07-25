import { test } from "node:test";
import assert from "node:assert/strict";
import { PluginExecutor } from "./plugin-executor.js";
import { SETTING_DEFAULTS, type PluginSettings } from "./settings.js";
import type { HostClient } from "./host.js";
import type { Action, SessionSnapshot } from "../types.js";

function snapshot(id: string, title: string): SessionSnapshot {
  return {
    session: { id, title, path: "/p", tool: "claude", status: "waiting", tmux_name: "" },
    output: "",
    outputHash: "",
    capturedAt: 0,
  };
}

interface HostLog {
  turns: Array<{ sessionId: string; text: string }>;
  creates: Array<Record<string, unknown>>;
}

function fakeHost(log: HostLog, failCreate = false): HostClient {
  return {
    turnSend: async (sessionId: string, text: string) => {
      log.turns.push({ sessionId, text });
    },
    sessionsCreate: async (params: Record<string, unknown>) => {
      if (failCreate) throw new Error("rate limited");
      log.creates.push(params);
      return { session_id: `created-${log.creates.length}`, created: true };
    },
  } as unknown as HostClient;
}

function settings(overrides: Partial<PluginSettings>): PluginSettings {
  return { ...SETTING_DEFAULTS, ...overrides };
}

const nudge: Action = { action: "send_input", session: "owned", text: "continue" };

test("send_input is blocked when allow_nudge is off", async () => {
  const log: HostLog = { turns: [], creates: [] };
  const exec = new PluginExecutor(fakeHost(log), () => settings({}), new Set(["owned"]));
  const [res] = await exec.execute([nudge], [snapshot("owned", "mine")]);
  assert.equal(res.success, false);
  assert.match(res.detail, /allow_nudge/);
  assert.equal(log.turns.length, 0);
});

test("send_input is blocked for sessions the plugin did not create", async () => {
  const log: HostLog = { turns: [], creates: [] };
  const exec = new PluginExecutor(fakeHost(log), () => settings({ allowNudge: true }), new Set());
  const [res] = await exec.execute([{ ...nudge, session: "foreign" }], [snapshot("foreign", "theirs")]);
  assert.equal(res.success, false);
  assert.match(res.detail, /not created by the orchestrator/);
});

test("send_input reaches owned sessions when allowed, resolving by title too", async () => {
  const log: HostLog = { turns: [], creates: [] };
  const exec = new PluginExecutor(fakeHost(log), () => settings({ allowNudge: true, actionCooldownSecs: 0 }), new Set(["owned"]));
  const [byId] = await exec.execute([nudge], [snapshot("owned", "mine")]);
  const [byTitle] = await exec.execute([{ ...nudge, session: "mine" }], [snapshot("owned", "mine")]);
  assert.equal(byId.success, true);
  assert.equal(byTitle.success, true);
  assert.deepEqual(log.turns.map((t) => t.sessionId), ["owned", "owned"]);
});

test("cooldown updates within a batch: second nudge in one tick is blocked", async () => {
  const log: HostLog = { turns: [], creates: [] };
  const exec = new PluginExecutor(fakeHost(log), () => settings({ allowNudge: true, actionCooldownSecs: 300 }), new Set(["owned"]));
  const results = await exec.execute([nudge, nudge], [snapshot("owned", "mine")]);
  assert.equal(results[0].success, true);
  assert.equal(results[1].success, false);
  assert.match(results[1].detail, /cooldown/);
  assert.equal(log.turns.length, 1);
});

test("create_agent respects the session pool cap", async () => {
  const log: HostLog = { turns: [], creates: [] };
  const owned = new Set(["a", "b", "c", "d", "e"]);
  const exec = new PluginExecutor(fakeHost(log), () => settings({ spawnAgent: "claude", maxActiveSessions: 5 }), owned);
  const [res] = await exec.execute([{ action: "create_agent", path: "/p", title: "t", tool: "claude" }], []);
  assert.equal(res.success, false);
  assert.match(res.detail, /pool full/);
  assert.equal(log.creates.length, 0);
});

test("create_agent creates via the host and records ownership", async () => {
  const log: HostLog = { turns: [], creates: [] };
  const owned = new Set<string>();
  const exec = new PluginExecutor(fakeHost(log), () => settings({ spawnAgent: "claude", actionCooldownSecs: 0 }), owned);
  const [res] = await exec.execute([{ action: "create_agent", path: "/repo", title: "new one", tool: "claude" }], []);
  assert.equal(res.success, true);
  assert.equal(log.creates[0].agent_id, "claude");
  assert.equal(log.creates[0].project_path, "/repo");
  assert.ok(owned.has("created-1"));
});

test("host errors surface as failed results, not exceptions", async () => {
  const log: HostLog = { turns: [], creates: [] };
  const exec = new PluginExecutor(fakeHost(log, true), () => settings({ spawnAgent: "claude", actionCooldownSecs: 0 }), new Set());
  const [res] = await exec.execute([{ action: "create_agent", path: "/p", title: "t", tool: "claude" }], []);
  assert.equal(res.success, false);
  assert.match(res.detail, /rate limited/);
});

test("lifecycle actions without plugin API primitives are refused visibly", async () => {
  const log: HostLog = { turns: [], creates: [] };
  const exec = new PluginExecutor(fakeHost(log), () => settings({}), new Set());
  const actions: Action[] = [
    { action: "start_session", session: "s" },
    { action: "stop_session", session: "s" },
    { action: "remove_agent", session: "s" },
  ];
  const results = await exec.execute(actions, [snapshot("s", "s")]);
  for (const res of results) {
    assert.equal(res.success, false);
    assert.match(res.detail, /no plugin API primitive/);
  }
});
