import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exec, execQuiet, sleep } from "./shell.js";

describe("exec — basic command execution", () => {
  it("runs a simple command and captures stdout", async () => {
    const result = await exec("echo", ["hello world"]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "hello world");
    assert.equal(result.stderr, "");
  });

  it("captures stderr", async () => {
    // node -e prints to stderr via console.error
    const result = await exec("node", ["-e", "console.error('oops')"]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stderr.includes("oops"));
  });

  it("returns non-zero exit code for failing command", async () => {
    const result = await exec("node", ["-e", "process.exit(42)"]);
    assert.equal(result.exitCode, 42);
  });

  it("returns exit code 1 for command not found", async () => {
    const result = await exec("nonexistent_command_xyz", []);
    assert.ok(result.exitCode !== 0);
  });

  it("handles commands with arguments", async () => {
    const result = await exec("node", ["-e", "console.log(process.argv[1])", "--", "test-arg"]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("test-arg"));
  });

  it("handles large output", async () => {
    // generate ~10KB of output
    const result = await exec("node", ["-e", "for(let i=0;i<200;i++) console.log('x'.repeat(50))"]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.length > 10_000);
  });
});

describe("exec — timeout", () => {
  it("kills process that exceeds timeout", async () => {
    const result = await exec("node", ["-e", "setTimeout(()=>{},30000)"], 200);
    assert.ok(result.exitCode !== 0, "should have non-zero exit code");
    // signal should be set when killed by timeout
    assert.ok(result.signal, "should have signal set");
  });

  it("completes before timeout returns normally", async () => {
    const result = await exec("echo", ["fast"], 5000);
    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, undefined);
  });
});

describe("exec — AbortSignal", () => {
  it("aborts a running process when signal fires", async () => {
    const ac = new AbortController();

    // start a long-running process
    const promise = exec("node", ["-e", "setTimeout(()=>{},30000)"], 30_000, ac.signal);

    // abort after 100ms
    setTimeout(() => ac.abort(), 100);

    const result = await promise;
    assert.equal(result.aborted, true);
    assert.equal(result.exitCode, 130);
  });

  it("does not interfere when signal is not aborted", async () => {
    const ac = new AbortController();
    const result = await exec("echo", ["test"], 5000, ac.signal);
    assert.equal(result.exitCode, 0);
    assert.equal(result.aborted, undefined);
  });

  it("handles pre-aborted signal", async () => {
    const ac = new AbortController();
    ac.abort();

    // short timeout so test doesn't wait 30s if abort doesn't kill fast enough
    const result = await exec("node", ["-e", "setTimeout(()=>{},30000)"], 3_000, ac.signal);
    assert.equal(result.aborted, true);
  });

  it("cleans up SIGKILL timer when process exits before it fires", async () => {
    // the SIGKILL fallback setTimeout used to leak (never cleared) when the
    // child exited before the 2s timer fired. this test verifies the fix by
    // running a fast-exiting process with an abort signal and confirming exec
    // returns promptly (not blocked by a leaked 2s timer).
    const ac = new AbortController();
    const start = Date.now();

    // abort after 50ms — by the time onAbort fires, the child is likely already done
    setTimeout(() => ac.abort(), 50);

    const result = await exec("node", ["-e", "process.exit(0)"], 5_000, ac.signal);
    const elapsed = Date.now() - start;
    // key assertion: exec returns well under 2s. if the SIGKILL timer leaked,
    // it would keep the event loop alive for 2+ seconds after the abort.
    assert.ok(elapsed < 1500, `expected <1500ms, got ${elapsed}ms — SIGKILL timer may have leaked`);
    // exit code may be 0 (exited before abort) or 130 (abort raced ahead) — both are fine
    assert.ok(result.exitCode === 0 || result.exitCode === 130,
      `expected exit code 0 or 130, got ${result.exitCode}`);
  });
});

describe("execQuiet", () => {
  it("returns true for successful command", async () => {
    const ok = await execQuiet("echo", ["hello"]);
    assert.equal(ok, true);
  });

  it("returns false for failing command", async () => {
    const ok = await execQuiet("node", ["-e", "process.exit(1)"]);
    assert.equal(ok, false);
  });

  it("returns false for nonexistent command", async () => {
    const ok = await execQuiet("nonexistent_command_xyz", []);
    assert.equal(ok, false);
  });
});

describe("sleep", () => {
  it("resolves after specified duration", async () => {
    const start = Date.now();
    await sleep(100);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 90, `expected at least 90ms, got ${elapsed}ms`);
    assert.ok(elapsed < 500, `expected less than 500ms, got ${elapsed}ms`);
  });


});
