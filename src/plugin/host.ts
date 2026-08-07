// Typed client for the AoE plugin host RPCs the orchestrator uses.
// Wire shapes follow the aoe-plugin-api crate (api_version 11); every
// response is validated defensively since the host owns the schema.

import { RpcConnection } from "./protocol.js";
import type { UiSlotPayloads } from "./ui.js";

/** Session row from `sessions.list`. `status` is the host's Debug-formatted
 * Status enum: Running | Waiting | Idle | Unknown | Stopped | Error |
 * Starting | Deleting | Creating. */
export interface HostSession {
  id: string;
  title: string;
  project_path: string;
  tool: string;
  status: string;
  archived: boolean;
  snoozed: boolean;
}

export interface AcpAgent {
  id: string;
  name?: string;
  models?: Array<{ id: string; name?: string }>;
  modes?: Array<{ id: string; name?: string; approval_class?: string }>;
  catalog_status?: string;
}

export interface SessionsCreateParams {
  agent_id: string;
  project_path?: string;
  model_id?: string;
  mode_id?: string;
  title?: string;
  group?: string;
  initial_turn?: { text: string };
  idempotency_key?: string;
}

export type NotifyTone = "info" | "success" | "warning" | "error";

export class HostClient {
  constructor(private readonly rpc: RpcConnection) {}

  async sessionsList(exclude: Array<"archived" | "snoozed" | "trashed"> = []): Promise<HostSession[]> {
    const res = (await this.rpc.call("sessions.list", exclude.length ? { exclude } : {})) as { sessions?: unknown };
    if (!res || !Array.isArray(res.sessions)) return [];
    return res.sessions.filter((s): s is HostSession => {
      const r = s as Record<string, unknown>;
      return !!r && typeof r.id === "string" && typeof r.title === "string" && typeof r.status === "string";
    }).map((s) => ({
      id: s.id,
      title: s.title,
      project_path: typeof s.project_path === "string" ? s.project_path : "",
      tool: typeof s.tool === "string" ? s.tool : "",
      status: s.status,
      archived: s.archived === true,
      snoozed: s.snoozed === true,
    }));
  }

  async acpAgents(): Promise<AcpAgent[]> {
    const res = (await this.rpc.call("acp.capabilities.get", {})) as { agents?: unknown };
    return Array.isArray(res?.agents) ? (res.agents as AcpAgent[]) : [];
  }

  async sessionsCreate(params: SessionsCreateParams): Promise<{ session_id: string; created: boolean }> {
    const res = (await this.rpc.call("sessions.create", params)) as Record<string, unknown>;
    return {
      session_id: typeof res?.session_id === "string" ? res.session_id : "",
      created: res?.created === true,
    };
  }

  async turnSend(sessionId: string, text: string): Promise<void> {
    await this.rpc.call("sessions.turn.send", { session_id: sessionId, text });
  }

  async storageGet(key: string): Promise<unknown> {
    const res = (await this.rpc.call("plugin.storage.get", { key })) as { value?: unknown };
    return res?.value ?? null;
  }

  async storageSet(key: string, value: unknown): Promise<void> {
    await this.rpc.call("plugin.storage.set", { key, value });
  }

  async configGet(key: string): Promise<unknown> {
    const res = (await this.rpc.call("config.get", { key })) as { value?: unknown };
    return res?.value ?? null;
  }

  /** The host validates each entry against the schema for its slot with
   * `deny_unknown_fields`, so the payload type is keyed off the slot name —
   * pushing a pane-shaped payload at the `card` slot is a compile error, not a
   * -32602 once per tick. */
  async uiStateSet<S extends keyof UiSlotPayloads>(
    slot: S,
    id: string,
    payload: UiSlotPayloads[S],
    sessionId?: string
  ): Promise<void> {
    const params: Record<string, unknown> = { slot, id, payload };
    if (sessionId) params.session_id = sessionId;
    await this.rpc.call("ui.state.set", params);
  }

  async uiStateRemove(slot: keyof UiSlotPayloads, id: string, sessionId?: string): Promise<void> {
    const params: Record<string, unknown> = { slot, id };
    if (sessionId) params.session_id = sessionId;
    await this.rpc.call("ui.state.remove", params);
  }

  async notify(tone: NotifyTone, title: string, body?: string, sessionId?: string): Promise<void> {
    const params: Record<string, unknown> = { tone, title };
    if (body) params.body = body;
    if (sessionId) params.session_id = sessionId;
    await this.rpc.call("ui.notify", params);
  }

  async eventsPublish(topic: string, payload: unknown): Promise<void> {
    await this.rpc.call("events.publish", { topic, payload });
  }
}
