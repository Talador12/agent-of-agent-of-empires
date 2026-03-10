import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Tests for the AbortSignal integration pattern used by withTimeoutAndInterrupt
// and the reasoner backends. The actual withTimeoutAndInterrupt function is
// private in index.ts — these tests validate the signal-passing contract.

// replicated from index.ts — accepts a factory that receives an AbortSignal,
// races it against a timeout, aborts the signal on timeout or cancellation
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

    factory(ac.signal).then((result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ result, timedOut: false });
    }).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ result: fallback, timedOut: false });
    });
  });
}

describe("AbortSignal — factory receives signal", () => {
  it("passes an AbortSignal to the factory function", async () => {
    let receivedSignal: AbortSignal | null = null;

    await withTimeoutAndAbort(
      async (signal) => {
        receivedSignal = signal;
        return "ok";
      },
      5000,
      "fallback"
    );

    assert.ok(receivedSignal, "factory should receive a signal");
    assert.ok(typeof (receivedSignal as AbortSignal).aborted === "boolean", "should be an AbortSignal");
  });

  it("signal is not aborted when factory resolves before timeout", async () => {
    let signalAborted = false;

    const { result, timedOut } = await withTimeoutAndAbort(
      async (signal) => {
        signal.addEventListener("abort", () => { signalAborted = true; });
        return "fast result";
      },
      5000,
      "fallback"
    );

    assert.equal(result, "fast result");
    assert.equal(timedOut, false);
    assert.equal(signalAborted, false, "signal should not be aborted");
  });

  it("signal is aborted when factory exceeds timeout", async () => {
    let signalAborted = false;

    const { result, timedOut } = await withTimeoutAndAbort(
      async (signal) => {
        signalAborted = signal.aborted; // not yet
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            signalAborted = true;
            // simulate cleanup after abort
            resolve("late result");
          });
        });
      },
      50, // very short timeout
      "timed-out-fallback"
    );

    assert.equal(result, "timed-out-fallback");
    assert.equal(timedOut, true);
    // allow microtask to fire abort listener
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(signalAborted, true, "signal should be aborted after timeout");
  });

  it("returns fallback when factory throws (non-abort error)", async () => {
    const { result, timedOut } = await withTimeoutAndAbort(
      async (_signal) => {
        throw new Error("connection refused");
      },
      5000,
      "error-fallback"
    );

    assert.equal(result, "error-fallback");
    assert.equal(timedOut, false);
  });

  it("handles immediate resolution", async () => {
    const { result, timedOut } = await withTimeoutAndAbort(
      async (_signal) => 42,
      5000,
      -1
    );

    assert.equal(result, 42);
    assert.equal(timedOut, false);
  });

  it("handles zero timeout (instant abort)", async () => {
    const { result, timedOut } = await withTimeoutAndAbort(
      async (signal) => {
        // even though we try to resolve, the 0ms timer fires first
        await new Promise((r) => setTimeout(r, 50));
        return "should-not-get-here";
      },
      0,
      "instant-timeout"
    );

    assert.equal(result, "instant-timeout");
    assert.equal(timedOut, true);
  });
});

describe("AbortSignal — fetch() integration pattern", () => {
  it("signal can be passed to fetch (pattern validation)", async () => {
    // validates that the pattern used in opencode.ts sendMessage works:
    // fetch(url, { signal }) where signal comes from the factory
    let fetchSignal: AbortSignal | undefined;

    const mockFetch = async (_url: string, opts?: { signal?: AbortSignal }) => {
      fetchSignal = opts?.signal;
      return { ok: true, json: async () => ({}) };
    };

    await withTimeoutAndAbort(
      async (signal) => {
        await mockFetch("http://localhost:4097/session/test/message", { signal });
        return "response";
      },
      5000,
      "fallback"
    );

    assert.ok(fetchSignal, "signal should be passed to fetch");
    assert.equal(fetchSignal.aborted, false);
  });

  it("fetch signal is aborted on timeout", async () => {
    let fetchSignal: AbortSignal | undefined;

    const mockFetch = async (_url: string, opts?: { signal?: AbortSignal }) => {
      fetchSignal = opts?.signal;
      // simulate slow response
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true, json: async () => ({}) };
    };

    await withTimeoutAndAbort(
      async (signal) => {
        await mockFetch("http://localhost:4097/session/test/message", { signal });
        return "response";
      },
      50, // short timeout
      "timeout-fallback"
    );

    // allow abort to propagate
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(fetchSignal, "signal should have been passed");
    assert.equal(fetchSignal.aborted, true, "signal should be aborted on timeout");
  });
});

describe("AbortSignal — exec() integration pattern", () => {
  it("signal can be passed to subprocess exec (pattern validation)", async () => {
    // validates the pattern used in claude-code.ts decide():
    // exec("claude", args, timeout, signal) where signal comes from factory
    let execSignal: AbortSignal | undefined;

    const mockExec = async (_cmd: string, _args: string[], _timeout: number, signal?: AbortSignal) => {
      execSignal = signal;
      return { stdout: '{"actions":[{"action":"wait"}]}', stderr: "", exitCode: 0 };
    };

    await withTimeoutAndAbort(
      async (signal) => {
        const result = await mockExec("claude", ["--print", "test"], 120_000, signal);
        return result.stdout;
      },
      5000,
      "fallback"
    );

    assert.ok(execSignal, "signal should be passed to exec");
    assert.equal(execSignal!.aborted, false);
  });
});

describe("AbortSignal — Reasoner.decide() interface contract", () => {
  it("signal parameter is optional (backward compatible)", async () => {
    // The Reasoner interface accepts optional signal — callers can omit it
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
    // Pattern from opencode.ts: check signal.aborted after each await
    const mockDecide = async (_prompt: string, signal?: AbortSignal) => {
      // simulate some work
      await new Promise((r) => setTimeout(r, 10));
      if (signal?.aborted) return { actions: [{ action: "wait" as const, reason: "aborted" }] };

      // simulate more work
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
