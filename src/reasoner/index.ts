import type { AoaoeConfig, Reasoner } from "../types.js";
import { OpencodeReasoner } from "./opencode.js";
import { ClaudeCodeReasoner } from "./claude-code.js";

export function createReasoner(config: AoaoeConfig, globalContext?: string): Reasoner {
  switch (config.reasoner) {
    case "opencode":
      return new OpencodeReasoner(config, globalContext);
    case "claude-code":
      return new ClaudeCodeReasoner(config, globalContext);
    default:
      throw new Error(`unknown reasoner backend: ${config.reasoner}`);
  }
}

export { OpencodeReasoner } from "./opencode.js";
export { ClaudeCodeReasoner } from "./claude-code.js";
