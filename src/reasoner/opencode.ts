import type { AoaoeConfig, Reasoner, Observation, ReasonerResult } from "../types.js";
import { exec, sleep } from "../shell.js";
import { buildSystemPrompt, formatObservation } from "./prompt.js";
import { parseReasonerResponse, validateResult } from "./parse.js";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const OPENCODE_PID_FILE = join(homedir(), ".aoaoe", "opencode-server.pid");

// OpenCode backend: uses `opencode serve` + SDK for long-running sessions.
// Falls back to `opencode run` if SDK is not available.
export class OpencodeReasoner implements Reasoner {
  private config: AoaoeConfig;
  private systemPrompt: string;
  private serverProcess: ReturnType<typeof import("node:child_process").spawn> | null = null;
  private client: OpencodeClient | null = null;
  private sessionId: string | null = null;

  constructor(config: AoaoeConfig, globalContext?: string) {
    this.config = config;
    this.systemPrompt = buildSystemPrompt(globalContext);
  }

  async init(): Promise<void> {
    // try to connect to existing opencode server first, then start one
    const port = this.config.opencode.port;

    if (await this.tryConnect(port)) {
      this.log("connected to existing opencode server");
      return;
    }

    this.log(`starting opencode serve on port ${port}...`);
    await this.startServer(port);

    // wait for server to be ready
    for (let i = 0; i < 30; i++) {
      if (await this.tryConnect(port)) {
        this.log("opencode server ready");
        return;
      }
      await sleep(1000);
    }

    // kill orphaned server process before throwing
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
    }
    try { unlinkSync(OPENCODE_PID_FILE); } catch {}
    throw new Error("opencode server failed to start within 30s");
  }

  async decide(observation: Observation, signal?: AbortSignal): Promise<ReasonerResult> {
    const prompt = formatObservation(observation);

    // prefer SDK if connected
    if (this.client) {
      return this.decideViaSDK(prompt, signal);
    }

    // fallback: opencode run
    return this.decideViaCli(prompt, signal);
  }

  async shutdown(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
    }
    // clean up PID file
    try { unlinkSync(OPENCODE_PID_FILE); } catch {}
  }

  private async decideViaSDK(prompt: string, signal?: AbortSignal): Promise<ReasonerResult> {
    const client = this.client!;

    // create session on first call (or recreate if previous session went stale)
    if (!this.sessionId) {
      const session = await client.createSession("aoaoe-supervisor");
      this.sessionId = session.id;

      // inject system prompt (with global context) as context
      await client.sendMessage(this.sessionId, this.systemPrompt, true);
    }

    try {
      const response = await client.sendMessage(this.sessionId, prompt, false, signal);
      if (signal?.aborted) return { actions: [{ action: "wait", reason: "aborted" }] };
      return parseReasonerResponse(response);
    } catch (err) {
      if (signal?.aborted) return { actions: [{ action: "wait", reason: "aborted" }] };
      // session may be stale (server restarted, session expired, etc.)
      // reset sessionId so the next call creates a fresh one
      this.log(`SDK request failed (resetting session): ${err}`);
      this.sessionId = null;

      // retry once with a fresh session
      try {
        const session = await client.createSession("aoaoe-supervisor");
        this.sessionId = session.id;
        await client.sendMessage(this.sessionId, this.systemPrompt, true, signal);
        if (signal?.aborted) return { actions: [{ action: "wait", reason: "aborted" }] };
        const response = await client.sendMessage(this.sessionId, prompt, false, signal);
        if (signal?.aborted) return { actions: [{ action: "wait", reason: "aborted" }] };
        return parseReasonerResponse(response);
      } catch (retryErr) {
        this.log(`SDK retry also failed: ${retryErr}`);
        this.sessionId = null;
        return { actions: [{ action: "wait", reason: "SDK session error" }] };
      }
    }
  }

  private async decideViaCli(prompt: string, signal?: AbortSignal): Promise<ReasonerResult> {
    // opencode run with system prompt prepended
    const fullPrompt = `${this.systemPrompt}\n\n${prompt}`;
    const args = ["run", "--format", "json"];
    if (this.config.opencode.model) {
      args.push("--model", this.config.opencode.model);
    }
    args.push(fullPrompt);

    const result = await exec("opencode", args, 120_000, signal);
    if (result.exitCode !== 0) {
      this.log(`opencode run failed: ${result.stderr}`);
      return { actions: [{ action: "wait", reason: "reasoner error" }] };
    }

    return parseReasonerResponse(result.stdout);
  }

  private async startServer(port: number): Promise<void> {
    // kill any orphaned server from a previous run
    this.killOrphanedServer();

    const { spawn } = await import("node:child_process");
    this.serverProcess = spawn("opencode", ["serve", "--port", String(port)], {
      stdio: "ignore",
      detached: true,
    });
    this.serverProcess.unref();

    // write PID file so orphans can be found/killed later
    if (this.serverProcess.pid) {
      try {
        mkdirSync(join(homedir(), ".aoaoe"), { recursive: true });
        writeFileSync(OPENCODE_PID_FILE, String(this.serverProcess.pid));
      } catch {
        // best-effort
      }
    }
  }

  // kill a previously-spawned opencode server that may still be running
  private killOrphanedServer(): void {
    try {
      const pid = parseInt(readFileSync(OPENCODE_PID_FILE, "utf-8").trim(), 10);
      if (isNaN(pid)) return;
      process.kill(pid, "SIGTERM");
      this.log(`killed orphaned opencode server (pid ${pid})`);
    } catch {
      // file doesn't exist or process already gone -- expected
    }
    try {
      unlinkSync(OPENCODE_PID_FILE);
    } catch {
      // ENOENT is fine
    }
  }

  private async tryConnect(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/global/health`);
      if (res.ok) {
        this.client = new OpencodeClient(`http://127.0.0.1:${port}`);
        return true;
      }
    } catch {
      // not running yet
    }
    return false;
  }

  private log(msg: string) {
    console.error(`[reasoner:opencode] ${msg}`);
  }
}

// minimal OpenCode HTTP client -- avoids hard dep on @opencode-ai/sdk at runtime
// so aoaoe works even if the SDK isn't installed (uses fetch directly)
class OpencodeClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async createSession(title: string): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(`create session failed: ${res.status}`);
    return (await res.json()) as { id: string };
  }

  async sendMessage(sessionId: string, text: string, noReply: boolean, signal?: AbortSignal): Promise<string> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        noReply,
        parts: [{ type: "text", text }],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`send message failed: ${res.status}`);
    if (noReply) return "";

    const data = (await res.json()) as { parts?: Array<{ type: string; text?: string }> };
    // extract text from assistant response parts
    const textParts = (data.parts ?? [])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!);
    return textParts.join("\n");
  }
}

// re-export from shared parse module for backward compat (tests import from here)
export { parseReasonerResponse, validateResult } from "./parse.js";
