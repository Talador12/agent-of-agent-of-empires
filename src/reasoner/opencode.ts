import type { AoaoeConfig, Reasoner, Observation, ReasonerResult, Action } from "../types.js";
import { exec } from "../shell.js";
import { buildSystemPrompt, formatObservation } from "./prompt.js";

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

    throw new Error("opencode server failed to start within 30s");
  }

  async decide(observation: Observation): Promise<ReasonerResult> {
    const prompt = formatObservation(observation);

    // prefer SDK if connected
    if (this.client) {
      return this.decideViaSDK(prompt);
    }

    // fallback: opencode run
    return this.decideViaCli(prompt);
  }

  async shutdown(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
    }
  }

  private async decideViaSDK(prompt: string): Promise<ReasonerResult> {
    const client = this.client!;

    // create session on first call
    if (!this.sessionId) {
      const session = await client.createSession("aoaoe-supervisor");
      this.sessionId = session.id;

      // inject system prompt (with global context) as context
      await client.sendMessage(this.sessionId, this.systemPrompt, true);
    }

    const response = await client.sendMessage(this.sessionId, prompt, false);
    return parseReasonerResponse(response);
  }

  private async decideViaCli(prompt: string): Promise<ReasonerResult> {
    // opencode run with system prompt prepended
    const fullPrompt = `${this.systemPrompt}\n\n${prompt}`;
    const args = ["run", "--format", "json"];
    if (this.config.opencode.model) {
      args.push("--model", this.config.opencode.model);
    }
    args.push(fullPrompt);

    const result = await exec("opencode", args, 120_000);
    if (result.exitCode !== 0) {
      this.log(`opencode run failed: ${result.stderr}`);
      return { actions: [{ action: "wait", reason: "reasoner error" }] };
    }

    return parseReasonerResponse(result.stdout);
  }

  private async startServer(port: number): Promise<void> {
    const { spawn } = await import("node:child_process");
    this.serverProcess = spawn("opencode", ["serve", "--port", String(port)], {
      stdio: "ignore",
      detached: true,
    });
    this.serverProcess.unref();
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

  async sendMessage(sessionId: string, text: string, noReply: boolean): Promise<string> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        noReply,
        parts: [{ type: "text", text }],
      }),
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

// exported for testing
export function parseReasonerResponse(raw: string): ReasonerResult {
  const trimmed = raw.trim();

  // try direct JSON parse
  try {
    const parsed = JSON.parse(trimmed);
    return validateResult(parsed);
  } catch {
    // might have markdown fences or other wrapping
  }

  // extract JSON from markdown code blocks
  const jsonMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return validateResult(parsed);
    } catch {
      // fall through
    }
  }

  // last resort: find first { ... } block
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      return validateResult(parsed);
    } catch {
      // give up
    }
  }

  console.error(`[reasoner:opencode] failed to parse response: ${trimmed.slice(0, 200)}`);
  return { actions: [{ action: "wait", reason: "failed to parse reasoner response" }] };
}

export function validateResult(parsed: unknown): ReasonerResult {
  if (typeof parsed !== "object" || parsed === null) {
    return { actions: [{ action: "wait", reason: "invalid response shape" }] };
  }

  const obj = parsed as Record<string, unknown>;
  const actions = Array.isArray(obj.actions) ? obj.actions : [];

  // validate each action has at minimum an "action" field
  const validActions: Action[] = actions
    .filter((a: unknown) => typeof a === "object" && a !== null && "action" in (a as Record<string, unknown>))
    .map((a: unknown) => a as Action);

  if (validActions.length === 0) {
    validActions.push({ action: "wait", reason: "no valid actions in response" });
  }

  return {
    actions: validActions,
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
