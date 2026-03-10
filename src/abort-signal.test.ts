import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Minimal helper for the fetch-timeout test — mirrors the private
// withTimeoutAndAbort in index.ts (race a factory against a timer).
function withTimeoutAndAbort<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T
): Promise<{ result: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const ac = new AbortController();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ac.abort();
      resolve({ result: fallback, timedOut: true });
    }, ms);

    factory(ac.signal)
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ result, timedOut: false });
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ result: fallback, timedOut: false });
      });
  });
}

describe("AbortSignal — Reasoner.decide() interface contract", () => {
  it("signal parameter is optional (backward compatible)", async () => {
    const mockReasoner = {
      async decide(_obs: unknown, signal?: AbortSignal) {
        return { actions: [{ action: "wait" as const }], signalPresent: signal !== undefined };
      },
    };

    // call without signal (backward compat)
    const r1 = await mockReasoner.decide({});
    assert.deepEqual(r1.actions, [{ action: "wait" }]);
    assert.equal(r1.signalPresent, false);

    // call with signal
    const ac = new AbortController();
    const r2 = await mockReasoner.decide({}, ac.signal);
    assert.equal(r2.signalPresent, true);
  });

  it("early abort returns wait action", async () => {
    const mockDecide = async (_prompt: string, signal?: AbortSignal) => {
      await new Promise((r) => setTimeout(r, 10));
      if (signal?.aborted) return { actions: [{ action: "wait" as const, reason: "aborted" }] };

      await new Promise((r) => setTimeout(r, 10));
      if (signal?.aborted) return { actions: [{ action: "wait" as const, reason: "aborted" }] };

      return { actions: [{ action: "send_input" as const, session: "s1", text: "hello" }] };
    };

    // without abort — returns full result
    const r1 = await mockDecide("test");
    assert.equal(r1.actions[0].action, "send_input");

    // with pre-aborted signal — returns early
    const ac = new AbortController();
    ac.abort();
    const r2 = await mockDecide("test", ac.signal);
    assert.equal(r2.actions[0].action, "wait");
  });
});

describe("AbortSignal — fetch() integration pattern", () => {
  it("fetch signal is aborted on timeout", async () => {
    let fetchSignal: AbortSignal | undefined;

    const mockFetch = async (_url: string, opts?: { signal?: AbortSignal }) => {
      fetchSignal = opts?.signal;
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true, json: async () => ({}) };
    };

    await withTimeoutAndAbort(
      async (signal) => {
        await mockFetch("http://localhost:4097/session/test/message", { signal });
        return "response";
      },
      50,
      "timeout-fallback"
    );

    await new Promise((r) => setTimeout(r, 10));
    assert.ok(fetchSignal, "signal should have been passed");
    assert.equal(fetchSignal.aborted, true, "signal should be aborted on timeout");
  });
});
