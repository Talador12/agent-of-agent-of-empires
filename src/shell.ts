// thin wrapper around child_process for aoe/tmux/claude calls
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(cmd: string, args: string[], timeoutMs = 30_000): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB for large tmux captures
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

// fire-and-forget for tmux send-keys (doesn't need output)
export async function execQuiet(cmd: string, args: string[]): Promise<boolean> {
  const result = await exec(cmd, args, 5_000);
  return result.exitCode === 0;
}
