import type {
  ProfileTemplate,
  TemplateApplyResult,
  TemplateCreateParams,
  TemplateScope,
  TemplateSummary,
  TemplateUpdateParams,
} from "@/transport/types";
import type { SnapshotInfo } from "./connection-controller";

/**
 * Wire protocol for `chrome.runtime.connect({ name: "popup" })`:
 *  - Background pushes `{ kind: "snapshot", data: SnapshotInfo }`.
 *  - Popup sends `{ kind: "set_label" }`, `{ kind: "set_connection_enabled" }`, etc.
 *
 * Daemon port preference is persisted via `chrome.storage.local` instead
 * of this bridge (see `use-daemon-port.ts`).
 */

export const POPUP_PORT_NAME = "popup";

export type PopupOutbound =
  | { kind: "set_label"; requestId: string; value: string }
  | { kind: "set_port"; value: number }
  | { kind: "set_connection_enabled"; value: boolean }
  // ── Template operations ──
  | { kind: "template_list" }
  | { kind: "template_get"; id: string }
  | { kind: "template_create"; params: TemplateCreateParams }
  | { kind: "template_update"; params: TemplateUpdateParams }
  | { kind: "template_delete"; id: string }
  | { kind: "template_apply"; templateId: string; scope?: TemplateScope };

export type PopupInbound =
  | { kind: "snapshot"; data: SnapshotInfo }
  | { kind: "label_update_result"; requestId: string; label?: string; error?: string }
  // ── Template responses ──
  | { kind: "template_list_result"; templates: TemplateSummary[]; error?: string }
  | { kind: "template_get_result"; template?: ProfileTemplate; error?: string }
  | { kind: "template_create_result"; template?: ProfileTemplate; error?: string }
  | { kind: "template_update_result"; template?: ProfileTemplate; error?: string }
  | { kind: "template_delete_result"; deleted: boolean; error?: string }
  | { kind: "template_apply_result"; result?: TemplateApplyResult; error?: string };
