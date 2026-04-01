// thin wrapper around child_process for aoe/tmux/claude calls
import { execFile as execFileCb, type ChildProcess } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string; // set when process was killed by signal (e.g. SIGTERM)
  aborted?: boolean; // true if killed via AbortSignal
}

export async function exec(
  cmd: string,
  args: string[],
  timeoutMs = 30_000,
  signal?: AbortSignal,
  cwd?: string
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child: ChildProcess = execFileCb(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, cwd },
      (err, stdout, stderr) => {
        cleanup();
        if (signal?.aborted) {
          resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 130, signal: "SIGTERM", aborted: true });
          return;
        }
        if (err) {
          // execFile error: code is exit code (number) or error string (e.g. 'ENOENT')
          // signal is set when the process was killed (e.g. 'SIGTERM' from timeout)
          const e = err as { code?: number | string; signal?: string; killed?: boolean };
          const exitCode = typeof e.code === "number" ? e.code : 1;
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode,
            signal: e.signal ?? undefined,
          });
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      }
    );

    // abort handler: kill the child process when signal fires
    let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      child.kill("SIGTERM");
      // give it 2s to die, then SIGKILL — clear timer in cleanup to avoid leak
      sigkillTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      if (sigkillTimer !== undefined) clearTimeout(sigkillTimer);
    };
  });
}

// fire-and-forget for tmux send-keys (doesn't need output)
export async function execQuiet(cmd: string, args: string[]): Promise<boolean> {
  const result = await exec(cmd, args, 5_000);
  return result.exitCode === 0;
}

// shared async sleep utility — avoids duplicate definitions across modules
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
