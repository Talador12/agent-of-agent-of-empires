// thin wrapper around child_process for aoe/tmux/claude calls
import { execFile as execFileCb, type ChildProcess } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  aborted?: boolean; // true if killed via AbortSignal
}

export async function exec(
  cmd: string,
  args: string[],
  timeoutMs = 30_000,
  signal?: AbortSignal
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child: ChildProcess = execFileCb(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        cleanup();
        if (signal?.aborted) {
          resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 130, aborted: true });
          return;
        }
        if (err) {
          const e = err as { code?: number | string };
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: typeof e.code === "number" ? e.code : 1,
          });
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      }
    );

    // abort handler: kill the child process when signal fires
    const onAbort = () => {
      child.kill("SIGTERM");
      // give it 2s to die, then SIGKILL
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
  });
}

// fire-and-forget for tmux send-keys (doesn't need output)
export async function execQuiet(cmd: string, args: string[]): Promise<boolean> {
  const result = await exec(cmd, args, 5_000);
  return result.exitCode === 0;
}
