import type { AoaoeConfig, Reasoner, Observation, ReasonerResult } from "../types.js";
import { exec } from "../shell.js";
import { buildSystemPrompt, formatObservation } from "./prompt.js";
import { parseReasonerResponse, validateResult } from "./parse.js";

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

  async decide(observation: Observation, signal?: AbortSignal): Promise<ReasonerResult> {
    const prompt = formatObservation(observation);
    const args = this.buildArgs(prompt);

    const result = await exec("claude", args, 120_000, signal);
    if (result.exitCode !== 0) {
      this.log(`claude failed: ${result.stderr}`);
      return { actions: [{ action: "wait", reason: "reasoner error" }] };
    }

    // capture session ID from output for --resume on next call
    if (this.config.claudeCode.resume) {
      this.tryExtractSessionId(result.stderr + result.stdout);
    }

    return parseReasonerResponse(result.stdout);
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
    } else if (output.length > 0) {
      this.log("could not extract session ID from output (resume will start fresh next call)");
    }
  }

  private log(msg: string) {
    console.error(`[reasoner:claude-code] ${msg}`);
  }
}
