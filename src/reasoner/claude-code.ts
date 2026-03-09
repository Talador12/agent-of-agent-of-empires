import type { AoaoeConfig, Reasoner, Observation, ReasonerResult, Action } from "../types.js";
import { exec } from "../shell.js";
import { buildSystemPrompt, formatObservation } from "./prompt.js";

// Claude Code backend: uses `claude --print` subprocess for each decision.
// Optionally stateful via `--resume`.
export class ClaudeCodeReasoner implements Reasoner {
  private config: AoaoeConfig;
  private systemPrompt: string;
  private sessionId: string | null = null;

  constructor(config: AoaoeConfig, globalContext?: string) {
    this.config = config;
    this.systemPrompt = buildSystemPrompt(globalContext);
  }

  async init(): Promise<void> {
    // verify claude is available
    const result = await exec("claude", ["--version"]);
    if (result.exitCode !== 0) {
      throw new Error("claude CLI not found or not working");
    }
    this.log(`claude available: ${result.stdout.trim()}`);
  }

  async decide(observation: Observation): Promise<ReasonerResult> {
    const prompt = formatObservation(observation);
    const args = this.buildArgs(prompt);

    const result = await exec("claude", args, 120_000);
    if (result.exitCode !== 0) {
      this.log(`claude failed: ${result.stderr}`);
      return { actions: [{ action: "wait", reason: "reasoner error" }] };
    }

    // capture session ID from output for --resume on next call
    if (this.config.claudeCode.resume) {
      this.tryExtractSessionId(result.stderr + result.stdout);
    }

    return this.parseResponse(result.stdout);
  }

  async shutdown(): Promise<void> {
    // stateless subprocess, nothing to clean up
  }

  private buildArgs(prompt: string): string[] {
    const args: string[] = ["--print"];

    // output format
    args.push("--output-format", "text");

    // system prompt injection (includes global context if loaded)
    args.push("--append-system-prompt", this.systemPrompt);

    // model selection
    if (this.config.claudeCode.model) {
      args.push("--model", this.config.claudeCode.model);
    }

    // YOLO mode for unattended operation
    if (this.config.claudeCode.yolo) {
      args.push("--dangerously-skip-permissions");
    }

    // resume previous session for context continuity
    if (this.config.claudeCode.resume && this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    // the actual prompt
    args.push(prompt);

    return args;
  }

  private tryExtractSessionId(output: string) {
    // claude prints session info to stderr, try to capture it
    // format varies by version, look for common patterns
    const match = output.match(/session[_\s]?(?:id)?[:\s]+([a-f0-9-]+)/i);
    if (match) {
      this.sessionId = match[1];
    }
  }

  private parseResponse(raw: string): ReasonerResult {
    const trimmed = raw.trim();

    // try direct JSON parse
    try {
      return this.validateResult(JSON.parse(trimmed));
    } catch {
      // not direct JSON
    }

    // extract from markdown code blocks
    const jsonMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        return this.validateResult(JSON.parse(jsonMatch[1]));
      } catch {
        // fall through
      }
    }

    // find first { ... } block
    const braceMatch = trimmed.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return this.validateResult(JSON.parse(braceMatch[0]));
      } catch {
        // give up
      }
    }

    this.log(`failed to parse: ${trimmed.slice(0, 200)}`);
    return { actions: [{ action: "wait", reason: "failed to parse reasoner response" }] };
  }

  private validateResult(parsed: unknown): ReasonerResult {
    if (typeof parsed !== "object" || parsed === null) {
      return { actions: [{ action: "wait", reason: "invalid response" }] };
    }

    const obj = parsed as Record<string, unknown>;
    const actions = Array.isArray(obj.actions) ? obj.actions : [];

    const validActions: Action[] = actions
      .filter((a: unknown) => typeof a === "object" && a !== null && "action" in (a as Record<string, unknown>))
      .map((a: unknown) => a as Action);

    if (validActions.length === 0) {
      validActions.push({ action: "wait", reason: "no valid actions" });
    }

    return {
      actions: validActions,
      reasoning: typeof obj.reasoning === "string" ? obj.reasoning : undefined,
    };
  }

  private log(msg: string) {
    console.error(`[reasoner:claude-code] ${msg}`);
  }
}
