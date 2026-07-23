//! Template API client: calls daemon-side `template.*` RPC methods over WS.
//!
//! Usage:
//! ```ts
//! import { templateClient } from "@/lib/template-client";
//! const list = await templateClient.list();
//! const created = await templateClient.create({ name: "My Template" });
//! ```

import type { Transport } from "@/transport/transport";
import type {
  ErrorCode,
  ProfileTemplate,
  TemplateApplyParams,
  TemplateApplyResult,
  TemplateCreateParams,
  TemplateSummary,
  TemplateUpdateParams,
} from "@/transport/types";

type RpcTransport = { sendAndWait: NonNullable<Transport["sendAndWait"]> };

let transportRef: RpcTransport | null = null;

/**
 * Inject the transport handle. Called once by background.ts after
 * the WSTransport is constructed.
 */
export function initTemplateClient(transport: RpcTransport): void {
  transportRef = transport;
}

function getTransport(): RpcTransport {
  if (!transportRef?.sendAndWait)
    throw new Error("[template-client] not initialised; call initTemplateClient first");
  return transportRef;
}

/** Generate a short unique RPC id. */
function rpcId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const templateClient = {
  /** List all templates (summaries only). */
  async list(): Promise<TemplateSummary[]> {
    const resp = await getTransport().sendAndWait({
      id: rpcId(),
      method: "template.list",
      params: {},
    });
    if ("error" in resp) throw new RpcError(resp.error.code, resp.error.message);
    return (resp.result as { templates: TemplateSummary[] }).templates;
  },

  /** Get a single full template by id. */
  async get(id: string): Promise<ProfileTemplate> {
    const resp = await getTransport().sendAndWait({
      id: rpcId(),
      method: "template.get",
      params: { id },
    });
    if ("error" in resp) throw new RpcError(resp.error.code, resp.error.message);
    return (resp.result as { template: ProfileTemplate }).template;
  },

  /** Create a new template. */
  async create(params: TemplateCreateParams): Promise<ProfileTemplate> {
    const resp = await getTransport().sendAndWait({
      id: rpcId(),
      method: "template.create",
      params,
    });
    if ("error" in resp) throw new RpcError(resp.error.code, resp.error.message);
    return (resp.result as { template: ProfileTemplate }).template;
  },

  /** Update an existing template. Only supplied fields are changed. */
  async update(params: TemplateUpdateParams): Promise<ProfileTemplate | null> {
    const resp = await getTransport().sendAndWait({
      id: rpcId(),
      method: "template.update",
      params,
    });
    if ("error" in resp) throw new RpcError(resp.error.code, resp.error.message);
    const result = resp.result as { template: ProfileTemplate };
    return result.template ?? null;
  },

  /** Delete a template by id. Returns true if it existed. */
  async delete(id: string): Promise<boolean> {
    const resp = await getTransport().sendAndWait({
      id: rpcId(),
      method: "template.delete",
      params: { id },
    });
    if ("error" in resp) throw new RpcError(resp.error.code, resp.error.message);
    return (resp.result as { deleted: boolean }).deleted;
  },

  /**
   * Apply a template to the current browser profile.
   * Returns the full template data + counts; the caller is responsible
   * for the actual chrome.cookies.set / chrome.storage.local.set calls.
   */
  async apply(params: TemplateApplyParams): Promise<TemplateApplyResult> {
    const resp = await getTransport().sendAndWait({
      id: rpcId(),
      method: "template.apply",
      params,
    });
    if ("error" in resp) throw new RpcError(resp.error.code, resp.error.message);
    return resp.result as TemplateApplyResult;
  },
};

export class RpcError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(`[template RPC] ${code}: ${message}`);
    this.name = "RpcError";
    this.code = code;
  }
}
