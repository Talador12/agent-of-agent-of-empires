import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { RpcConnection, HostRpcError, RPC_ERROR_CODES } from "./protocol.js";
import { sleep } from "../shell.js";

function makePair(callTimeoutMs?: number): { rpc: RpcConnection; toWorker: PassThrough; fromWorker: PassThrough; lines: string[] } {
  const toWorker = new PassThrough();
  const fromWorker = new PassThrough();
  const lines: string[] = [];
  fromWorker.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) lines.push(line);
    }
  });
  const rpc = new RpcConnection(toWorker, fromWorker, callTimeoutMs);
  return { rpc, toWorker, fromWorker, lines };
}

test("call writes a JSON-RPC request and resolves on the matching response", async () => {
  const { rpc, toWorker, lines } = makePair();
  const promise = rpc.call("sessions.list", { exclude: ["trashed"] });
  await sleep(10);
  assert.equal(lines.length, 1);
  const req = JSON.parse(lines[0]);
  assert.equal(req.jsonrpc, "2.0");
  assert.equal(req.method, "sessions.list");
  assert.deepEqual(req.params, { exclude: ["trashed"] });
  toWorker.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { sessions: [] } }) + "\n");
  assert.deepEqual(await promise, { sessions: [] });
});

test("call rejects with HostRpcError carrying the host error code", async () => {
  const { rpc, toWorker, lines } = makePair();
  const promise = rpc.call("sessions.create", {});
  await sleep(10);
  const req = JSON.parse(lines[0]);
  toWorker.write(
    JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: RPC_ERROR_CODES.RATE_LIMITED, message: "rate limited", data: { kind: "rate_limited" } } }) + "\n"
  );
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof HostRpcError);
    assert.equal(err.code, RPC_ERROR_CODES.RATE_LIMITED);
    assert.equal(err.method, "sessions.create");
    return true;
  });
});

test("interleaved responses resolve the right callers", async () => {
  const { rpc, toWorker, lines } = makePair();
  const a = rpc.call("a");
  const b = rpc.call("b");
  await sleep(10);
  const [reqA, reqB] = lines.map((l) => JSON.parse(l));
  // answer out of order
  toWorker.write(JSON.stringify({ jsonrpc: "2.0", id: reqB.id, result: "B" }) + "\n");
  toWorker.write(JSON.stringify({ jsonrpc: "2.0", id: reqA.id, result: "A" }) + "\n");
  assert.equal(await a, "A");
  assert.equal(await b, "B");
});

test("incoming host request is dispatched and answered", async () => {
  const { rpc, toWorker, lines } = makePair();
  rpc.onIncoming((method, params, respond) => {
    assert.equal(method, "plugin.dev.talador12.aoaoe.status");
    respond?.({ ok: true, echo: params });
  });
  toWorker.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "plugin.dev.talador12.aoaoe.status", params: { x: 1 } }) + "\n");
  await sleep(10);
  assert.equal(lines.length, 1);
  const reply = JSON.parse(lines[0]);
  assert.equal(reply.id, 7);
  assert.deepEqual(reply.result, { ok: true, echo: { x: 1 } });
});

test("incoming notification (no id) gets no reply", async () => {
  const { rpc, toWorker, lines } = makePair();
  let seen = "";
  rpc.onIncoming((method, _params, respond) => {
    seen = method;
    assert.equal(respond, null);
  });
  toWorker.write(JSON.stringify({ jsonrpc: "2.0", method: "plugin.command.invoke", params: { command: "tick" } }) + "\n");
  await sleep(10);
  assert.equal(seen, "plugin.command.invoke");
  assert.equal(lines.length, 0);
});

test("garbage lines are ignored without breaking the connection", async () => {
  const { rpc, toWorker, lines } = makePair();
  toWorker.write("not json at all\n\n{broken\n");
  const promise = rpc.call("ping");
  await sleep(10);
  const req = JSON.parse(lines[0]);
  toWorker.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: "pong" }) + "\n");
  assert.equal(await promise, "pong");
});

test("call times out when the host never answers", async () => {
  // the timeout timer is unref'd (the worker must not hold the process open),
  // so hold the event loop with sleep() while waiting for it to fire
  const { rpc } = makePair(50);
  const outcome = rpc.call("never").then(
    () => "resolved",
    (err: Error) => err.message
  );
  await sleep(100);
  assert.match(await outcome, /timed out after 50ms/);
});

test("pending calls reject when the input stream closes", async () => {
  const { rpc, toWorker } = makePair();
  const outcome = rpc.call("doomed").then(
    () => "resolved",
    (err: Error) => err.message
  );
  await sleep(10);
  toWorker.end();
  await sleep(10);
  assert.match(await outcome, /connection closed/);
  assert.equal(rpc.isClosed, true);
  await assert.rejects(rpc.call("after-close"), /connection closed/);
});
