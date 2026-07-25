// Newline-delimited JSON-RPC 2.0 framing for the AoE plugin worker protocol.
//
// The worker is both client and server on one stdio pair:
//   - worker -> host: requests (host RPCs like sessions.list), one per line on stdout
//   - host -> worker: responses to those requests, plus host-initiated traffic:
//     command invocations (`plugin.command.invoke` notifications or namespaced
//     `plugin.<id>.<command>` requests), pane-action notifications, and
//     `plugin.settings.changed` notifications — one per line on stdin.
//
// Transport-agnostic: the worker wires process.stdin/stdout, tests wire
// in-memory streams.

import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

// stable machine keys the host attaches under error.data.kind
export const RPC_ERROR_CODES = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  FORBIDDEN: -32001,
  POLICY_DENIED: -32002,
  CONFLICT: -32003,
  RATE_LIMITED: -32004,
  FAILED_PRECONDITION: -32005,
  SERVICE_UNAVAILABLE: -32006,
} as const;

export class HostRpcError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(`host rpc ${method} failed (${code}): ${message}`);
    this.name = "HostRpcError";
  }
}

export type IncomingHandler = (method: string, params: unknown, respond: ((result: unknown, error?: RpcError) => void) | null) => void;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  method: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Default deadline for a host RPC round-trip. The host answers from local
 * state, so anything slower than this means the pipe is wedged. */
export const HOST_CALL_TIMEOUT_MS = 30_000;

export class RpcConnection {
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private handler: IncomingHandler | null = null;
  private closed = false;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly callTimeoutMs = HOST_CALL_TIMEOUT_MS
  ) {
    createInterface({ input }).on("line", (line) => this.onLine(line));
    input.on("close", () => this.shutdown());
    input.on("end", () => this.shutdown());
  }

  /** Register the handler for host-initiated requests and notifications. */
  onIncoming(handler: IncomingHandler): void {
    this.handler = handler;
  }

  /** Call a host RPC and await its result. Rejects with HostRpcError on a
   * JSON-RPC error response, or a plain Error on timeout / closed pipe. */
  call(method: string, params: unknown = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(`rpc connection closed (calling ${method})`));
    const id = this.nextId++;
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`host rpc ${method} timed out after ${this.callTimeoutMs}ms`));
      }, this.callTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, method, timer });
      this.output.write(line);
    });
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // not ours to answer — host never sends malformed lines; ignore garbage
    }
    // response to one of our calls
    if (("result" in msg || "error" in msg) && typeof msg.id === "number" && this.pending.has(msg.id)) {
      const call = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(call.timer);
      if ("error" in msg && msg.error) {
        const err = msg.error as RpcError;
        call.reject(new HostRpcError(call.method, err.code, err.message ?? "", err.data));
      } else {
        call.resolve(msg.result);
      }
      return;
    }
    // host-initiated request (has id) or notification (no id)
    if (typeof msg.method === "string") {
      const id = msg.id;
      const respond =
        id === undefined || id === null
          ? null
          : (result: unknown, error?: RpcError) => {
              const reply = error
                ? { jsonrpc: "2.0", id, error }
                : { jsonrpc: "2.0", id, result: result ?? {} };
              this.output.write(JSON.stringify(reply) + "\n");
            };
      if (this.handler) {
        try {
          this.handler(msg.method, msg.params ?? {}, respond);
        } catch (err) {
          respond?.(undefined, { code: RPC_ERROR_CODES.INTERNAL, message: String(err) });
        }
      } else {
        respond?.(undefined, { code: RPC_ERROR_CODES.METHOD_NOT_FOUND, message: `no handler for ${msg.method}` });
      }
    }
  }

  private shutdown(): void {
    this.closed = true;
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(new Error(`rpc connection closed (awaiting ${call.method})`));
    }
    this.pending.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
