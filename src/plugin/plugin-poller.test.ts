import { test } from "node:test";
import assert from "node:assert/strict";
import { PluginPoller, mapHostStatus } from "./plugin-poller.js";
import type { HostClient, HostSession } from "./host.js";

function host(rows: HostSession[]): HostClient {
  return { sessionsList: async () => rows } as unknown as HostClient;
}

function row(overrides: Partial<HostSession>): HostSession {
  return { id: "s1", title: "t", project_path: "/p", tool: "claude", status: "Running", archived: false, snoozed: false, ...overrides };
}

test("host statuses map onto the aoaoe vocabulary, unknowns fail safe", () => {
  assert.equal(mapHostStatus("Running"), "running");
  assert.equal(mapHostStatus("Waiting"), "waiting");
  assert.equal(mapHostStatus("Error"), "error");
  assert.equal(mapHostStatus("Starting"), "running");
  assert.equal(mapHostStatus("Deleting"), "stopped");
  assert.equal(mapHostStatus("BrandNew"), "unknown");
});

test("poll produces snapshots with plugin-mode fields", async () => {
  const poller = new PluginPoller(host([row({ id: "a", title: "alpha", status: "Waiting" })]));
  const obs = await poller.poll();
  assert.equal(obs.sessions.length, 1);
  const snap = obs.sessions[0];
  assert.equal(snap.session.id, "a");
  assert.equal(snap.session.status, "waiting");
  assert.equal(snap.session.tmux_name, "");
  assert.equal(snap.output, "");
  assert.equal(obs.changes.length, 0); // first sighting is not a change
});

test("status transitions become changes; steady state does not", async () => {
  const rows = [row({ id: "a", status: "Running" })];
  const poller = new PluginPoller(host(rows));
  await poller.poll();
  rows[0] = row({ id: "a", status: "Waiting" });
  const obs2 = await poller.poll();
  assert.equal(obs2.changes.length, 1);
  assert.match(obs2.changes[0].newLines, /Running -> Waiting/);
  const obs3 = await poller.poll();
  assert.equal(obs3.changes.length, 0);
});

test("archived sessions are dropped; state for vanished sessions is pruned", async () => {
  const rows = [row({ id: "a" }), row({ id: "b", archived: true })];
  const poller = new PluginPoller(host(rows));
  const obs = await poller.poll();
  assert.deepEqual(obs.sessions.map((s) => s.session.id), ["a"]);
  // "a" disappears, then reappears with a different status: no change fires
  // because its transition history was pruned with it
  rows.length = 0;
  await poller.poll();
  rows.push(row({ id: "a", status: "Error" }));
  const obs3 = await poller.poll();
  assert.equal(obs3.changes.length, 0);
});
