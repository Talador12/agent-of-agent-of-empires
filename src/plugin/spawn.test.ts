import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnFromIssues, issueGoal, issueSessionTitle, type GithubIssue } from "./spawn.js";
import { SETTING_DEFAULTS, type PluginSettings } from "./settings.js";
import type { HostClient } from "./host.js";

function issue(n: number, title = `issue ${n}`): GithubIssue {
  return { number: n, title, body: `body of ${n}`, url: `https://github.com/o/r/issues/${n}` };
}

function settings(overrides: Partial<PluginSettings>): PluginSettings {
  return { ...SETTING_DEFAULTS, spawnRepo: "o/r", spawnAgent: "claude", ...overrides };
}

function fakeHost(creates: Array<Record<string, unknown>>, existing = new Set<string>()): Pick<HostClient, "sessionsCreate"> {
  return {
    sessionsCreate: async (params) => {
      creates.push(params as unknown as Record<string, unknown>);
      const key = String((params as { idempotency_key?: string }).idempotency_key);
      if (existing.has(key)) return { session_id: `dup-${key}`, created: false };
      return { session_id: `sess-${creates.length}`, created: true };
    },
  };
}

test("dry run (default) plans but never calls sessions.create", async () => {
  const creates: Array<Record<string, unknown>> = [];
  const report = await spawnFromIssues(fakeHost(creates), settings({}), new Set(), async () => [issue(1), issue(2)]);
  assert.equal(report.live, false);
  assert.equal(report.error, undefined);
  assert.deepEqual(report.outcomes.map((o) => o.planned), [true, true]);
  assert.equal(creates.length, 0);
});

test("live mode creates sessions with issue-scoped idempotency keys and goals", async () => {
  const creates: Array<Record<string, unknown>> = [];
  const owned = new Set<string>();
  const report = await spawnFromIssues(fakeHost(creates), settings({ spawnLive: true, spawnModel: "sonnet", spawnProjectPath: "/repo" }), owned, async () => [issue(42, "Fix the thing")]);
  assert.equal(report.outcomes[0].created, true);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].idempotency_key, "issue:o/r#42");
  assert.equal(creates[0].project_path, "/repo");
  assert.equal(creates[0].model_id, "sonnet");
  const turn = creates[0].initial_turn as { text: string };
  assert.match(turn.text, /issue #42 of o\/r: Fix the thing/);
  assert.ok(owned.has("sess-1"));
});

test("already-spawned issues come back created=false and are reported as skipped", async () => {
  const creates: Array<Record<string, unknown>> = [];
  const report = await spawnFromIssues(
    fakeHost(creates, new Set(["issue:o/r#7"])),
    settings({ spawnLive: true }),
    new Set(),
    async () => [issue(7)]
  );
  assert.equal(report.outcomes[0].created, false);
  assert.match(report.outcomes[0].skippedReason ?? "", /already spawned/);
});

test("pool capacity caps a run; excess issues are skipped with the reason", async () => {
  const creates: Array<Record<string, unknown>> = [];
  const owned = new Set(["x", "y", "z", "w"]); // 4 of 5 slots used
  const report = await spawnFromIssues(fakeHost(creates), settings({ spawnLive: true }), owned, async () => [issue(1), issue(2)]);
  assert.equal(report.outcomes[0].created, true);
  assert.match(report.outcomes[1].skippedReason ?? "", /pool full/);
  assert.equal(creates.length, 1);
});

test("one refused create does not abandon the rest of the run", async () => {
  let calls = 0;
  const host: Pick<HostClient, "sessionsCreate"> = {
    sessionsCreate: async () => {
      calls++;
      if (calls === 1) throw new Error("rate_limited");
      return { session_id: `s${calls}`, created: true };
    },
  };
  const report = await spawnFromIssues(host, settings({ spawnLive: true }), new Set(), async () => [issue(1), issue(2)]);
  assert.match(report.outcomes[0].skippedReason ?? "", /rate_limited/);
  assert.equal(report.outcomes[1].created, true);
});

test("misconfiguration is an error report, not a throw", async () => {
  const noRepo = await spawnFromIssues(fakeHost([]), settings({ spawnRepo: "" }), new Set(), async () => []);
  assert.match(noRepo.error ?? "", /spawn_repo is not configured/);
  const badRepo = await spawnFromIssues(fakeHost([]), settings({ spawnRepo: "not a repo" }), new Set(), async () => []);
  assert.match(badRepo.error ?? "", /not owner\/repo/);
  const noAgent = await spawnFromIssues(fakeHost([]), settings({ spawnAgent: "" }), new Set(), async () => []);
  assert.match(noAgent.error ?? "", /spawn_agent is not configured/);
  const ghDown = await spawnFromIssues(fakeHost([]), settings({}), new Set(), async () => {
    throw new Error("gh: not logged in");
  });
  assert.match(ghDown.error ?? "", /not logged in/);
});

test("issue goal truncates huge bodies and always references the issue", () => {
  const big = issue(9);
  big.body = "x".repeat(10_000);
  const goal = issueGoal("o/r", big);
  assert.ok(goal.length < 5_000);
  assert.match(goal, /\[truncated\]/);
  assert.match(goal, /#9/);
});

test("session titles stay short", () => {
  const long = issue(3, "a".repeat(100));
  assert.ok(issueSessionTitle(long).length < 60);
  assert.match(issueSessionTitle(issue(5, "short")), /^issue-5: short$/);
});
