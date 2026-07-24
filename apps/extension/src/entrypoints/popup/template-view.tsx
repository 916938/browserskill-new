import { useTranslation } from "@browser-skill/i18n/react";
import { Badge, Button, Input, Label } from "@browser-skill/ui";
import {
  RiAddLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiEdit2Line,
  RiFileList3Line,
  RiLoader4Line,
  RiUserLine,
} from "@remixicon/react";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import type { PopupInbound, PopupOutbound } from "@/lib/popup-bridge";
import type {
  ProfileTemplate,
  TemplateCreateParams,
  TemplateScope,
  TemplateSummary,
  TemplateUpdateParams,
} from "@/transport/types";

// ── Types ───────────────────────────────────────────────

type ViewMode = "list" | "create" | "edit";

interface TemplateFormState {
  name: string;
  description: string;
}

// ── Hook: template port communication ───────────────────

function useTemplatePort() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: "popup" });
    portRef.current = port;

    const onMessage = (raw: unknown) => {
      const msg = raw as PopupInbound;
      if (!msg || typeof msg !== "object" || !("kind" in msg)) return;

      switch (msg.kind) {
        case "template_list_result":
          setTemplates(msg.templates ?? []);
          setLoading(false);
          break;
        case "template_create_result":
        case "template_update_result":
        case "template_delete_result":
        case "template_apply_result":
        case "template_get_result":
          // Individual operation results are handled by callers via callbacks
          break;
      }
    };

    port.onMessage.addListener(onMessage);

    // Request initial list
    post(port, { kind: "template_list" });

    return () => {
      port.disconnect();
    };
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    post(portRef.current, { kind: "template_list" });
  }, []);

  return { templates, loading, refresh, port: portRef };
}

function post(port: chrome.runtime.Port | null, msg: PopupOutbound) {
  port?.postMessage(msg);
}

// ── Sub-components ──────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation("extension");
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center" data-slot="tpl-empty">
      <RiFileList3Line className="size-8 text-muted-foreground/50" aria-hidden />
      <p className="text-xs font-medium text-muted-foreground">{t("popup.templates.empty")}</p>
      <p className="max-w-[240px] text-[11px] leading-snug text-muted-foreground/70">
        {t("popup.templates.emptyHint")}
      </p>
      <Button variant="outline" size="sm" className="mt-1 h-7 text-xs" onClick={onCreate}>
        <RiAddLine className="size-3.5" aria-hidden />
        {t("popup.templates.createBtn")}
      </Button>
    </div>
  );
}

function TemplateCard({
  template,
  onApply,
  onEdit,
  onDelete,
  applyingId,
}: {
  template: TemplateSummary;
  onApply: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  applyingId: string | null;
}) {
  const { t } = useTranslation("extension");
  const isApplying = applyingId === template.id;

  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border border-border/80 bg-card/60 px-3 py-2"
      data-slot="tpl-card"
      data-tpl-id={template.id}
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{template.name}</span>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5">
            <RiFileList3Line className="size-3" aria-hidden />
            {t("popup.templates.cookieCount", { count: template.cookie_count })}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <RiDownloadLine className="size-3" aria-hidden />
            {t("popup.templates.storageCount", { count: template.storage_count })}
          </span>
          {template.has_user_agent && (
            <Badge variant="outline" className="px-1 py-0 text-[9px]">
              UA
            </Badge>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-md"
          disabled={isApplying}
          onClick={() => onApply(template.id)}
          title={t("popup.templates.applyBtn")}
          data-slot="tpl-apply-btn"
        >
          {isApplying ? (
            <RiLoader4Line className="size-3 animate-spin" aria-hidden />
          ) : (
            <RiDownloadLine className="size-3" aria-hidden />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-md"
          onClick={() => onEdit(template.id)}
          title={t("popup.templates.editBtn")}
          data-slot="tpl-edit-btn"
        >
          <RiEdit2Line className="size-3" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-md text-destructive hover:text-destructive"
          onClick={() => onDelete(template.id)}
          title={t("popup.templates.deleteBtn")}
          data-slot="tpl-delete-btn"
        >
          <RiDeleteBinLine className="size-3" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function CreateEditForm({
  mode,
  initialName,
  initialDesc,
  onSave,
  onCancel,
  saving,
}: {
  mode: "create" | "edit";
  initialName?: string;
  initialDesc?: string;
  onSave: (name: string, description: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation("extension");
  const [name, setName] = useState(initialName ?? "");
  const [desc, setDesc] = useState(initialDesc ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus name input when form mounts
    inputRef.current?.focus();
  }, []);

  const isValid = name.trim().length > 0;

  return (
    <div className="space-y-2.5" data-slot={`tpl-form-${mode}`}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-name" className="text-xs text-muted-foreground">
          {t("popup.templates.nameLabel")}
        </Label>
        <Input
          ref={inputRef}
          id="tpl-name"
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder={t("popup.templates.namePlaceholder")}
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && isValid) onSave(name.trim(), desc.trim());
            if (e.key === "Escape") onCancel();
          }}
          disabled={saving}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-desc" className="text-xs text-muted-foreground">
          {t("popup.templates.descLabel")}
        </Label>
        <Input
          id="tpl-desc"
          value={desc}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDesc(e.target.value)}
          placeholder={t("popup.templates.descPlaceholder")}
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          disabled={saving}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onCancel}
          disabled={saving}
        >
          {t("popup.templates.cancelBtn")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={!isValid || saving}
          onClick={() => onSave(name.trim(), desc.trim())}
        >
          {saving ? <RiLoader4Line className="size-3 animate-spin mr-1" aria-hidden /> : null}
          {t("popup.templates.saveBtn")}
        </Button>
      </div>
    </div>
  );
}

function DeleteConfirm({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("extension");
  return (
    <div
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
      data-slot="tpl-delete-confirm"
    >
      <p className="text-xs font-medium text-destructive">
        {t("popup.templates.confirmDeleteTitle")}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        {t("popup.templates.confirmDeleteBody", { name })}
      </p>
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          {t("popup.templates.cancelBtn")}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="h-7 px-3 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={onConfirm}
        >
          {t("popup.templates.deleteBtn")}
        </Button>
      </div>
    </div>
  );
}

function ApplyScopeSelect({
  scope,
  onScopeChange,
  onConfirm,
  onCancel,
}: {
  scope: TemplateScope;
  onScopeChange: (s: TemplateScope) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("extension");
  const scopes: {
    value: TemplateScope;
    labelKey:
      | "popup.templates.scopeAll"
      | "popup.templates.scopeCookies"
      | "popup.templates.scopeStorage"
      | "popup.templates.scopeUserAgent";
    icon: React.ReactNode;
  }[] = [
    {
      value: "all",
      labelKey: "popup.templates.scopeAll",
      icon: <RiFileList3Line className="size-3" />,
    },
    {
      value: "cookies",
      labelKey: "popup.templates.scopeCookies",
      icon: <RiFileList3Line className="size-3" />,
    },
    {
      value: "storage",
      labelKey: "popup.templates.scopeStorage",
      icon: <RiDownloadLine className="size-3" />,
    },
    {
      value: "user_agent",
      labelKey: "popup.templates.scopeUserAgent",
      icon: <RiUserLine className="size-3" />,
    },
  ];

  return (
    <div className="space-y-2" data-slot="tpl-apply-scope">
      <p className="text-xs font-medium text-muted-foreground">{t("popup.templates.scopeLabel")}</p>
      <div className="grid grid-cols-2 gap-1.5">
        {scopes.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`
              flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors
              ${
                scope === s.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/80 bg-card/60 text-muted-foreground hover:bg-card/80"
              }
            `}
            onClick={() => onScopeChange(s.value)}
          >
            {s.icon}
            {t(s.labelKey)}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          {t("popup.templates.cancelBtn")}
        </Button>
        <Button variant="secondary" size="sm" className="h-7 px-3 text-xs" onClick={onConfirm}>
          <RiCheckLine className="size-3 mr-1" aria-hidden />
          {t("popup.templates.applyBtn")}
        </Button>
      </div>
    </div>
  );
}

// ── Toast ───────────────────────────────────────────────

function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <div
      role="status"
      className={`
        flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-medium shadow-md backdrop-blur-sm
        ${
          type === "success"
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "bg-destructive/15 text-destructive"
        }
      `}
      data-slot="tpl-toast"
    >
      {type === "success" ? (
        <RiCheckLine className="size-3" aria-hidden />
      ) : (
        <RiCloseLine className="size-3" aria-hidden />
      )}
      {message}
    </div>
  );
}

// ── Main view component ─────────────────────────────────

export function TemplateView() {
  const { t } = useTranslation("extension");
  const { templates, loading, refresh, port } = useTemplatePort();

  // View mode state
  const [mode, setMode] = useState<ViewMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyScope, setApplyScope] = useState<TemplateScope>("all");

  // Form draft state
  const [formDraft, setFormDraft] = useState<TemplateFormState>({ name: "", description: "" });

  // Async operation state
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Auto-hide toast
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Listen for individual operation results
  useEffect(() => {
    const p = port.current;
    if (!p) return;

    const handler = (raw: unknown) => {
      const msg = raw as PopupInbound;
      if (!msg || typeof msg !== "object" || !("kind" in msg)) return;

      if (msg.kind === "template_apply_result") {
        setApplyingId(null);
        setMode("list");
        if (msg.error) {
          setToast({
            message: t("popup.templates.applyFailed", { error: msg.error }),
            type: "error",
          });
        } else if (msg.result) {
          setToast({
            message: t("popup.templates.applySuccess", {
              count: msg.result.applied_cookies,
              storageCount: msg.result.applied_storage,
            }),
            type: "success",
          });
        }
      }

      if (msg.kind === "template_delete_result") {
        setDeletingId(null);
        setMode("list");
        refresh();
        if (msg.error) {
          setToast({ message: msg.error, type: "error" });
        } else {
          setToast({ message: t("popup.templates.deleteSuccess"), type: "success" });
        }
      }

      if (msg.kind === "template_create_result") {
        setSaving(false);
        if (msg.error) {
          setToast({ message: msg.error, type: "error" });
        } else {
          setToast({
            message: t("popup.templates.createSuccess", { name: formDraft.name }),
            type: "success",
          });
          setFormDraft({ name: "", description: "" });
          setMode("list");
          refresh();
        }
      }

      if (msg.kind === "template_get_result") {
        setSaving(false);
        if (msg.template && !msg.error) {
          setFormDraft({ name: msg.template.name, description: msg.template.description ?? "" });
          setMode("edit");
        } else {
          setToast({ message: msg.error ?? "Template not found", type: "error" });
          setMode("list");
          setEditingId(null);
        }
      }

      if (msg.kind === "template_update_result") {
        setSaving(false);
        if (msg.error) {
          setToast({ message: msg.error, type: "error" });
        } else {
          setToast({
            message: t("popup.templates.updateSuccess", { name: formDraft.name }),
            type: "success",
          });
          setFormDraft({ name: "", description: "" });
          setMode("list");
          setEditingId(null);
          refresh();
        }
      }
    };

    p.onMessage.addListener(handler);
    return () => p.onMessage.removeListener(handler);
  }, [toast, formDraft.name, refresh, t]);

  // ── Handlers ──

  const handleCreate = () => {
    setFormDraft({ name: "", description: "" });
    setMode("create");
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setSaving(true);
    // Fetch full template data for editing
    post(port.current, { kind: "template_get", id });
  };

  const handleSaveCreate = (name: string, description: string) => {
    setSaving(true);
    const params: TemplateCreateParams = {
      name,
      description: description || undefined,
      cookies: [],
      storage: {},
    };
    post(port.current, { kind: "template_create", params });
  };

  const handleSaveEdit = (name: string, description: string) => {
    if (!editingId) return;
    setSaving(true);
    const params: TemplateUpdateParams = {
      id: editingId,
      name: name || undefined,
      description: description || undefined,
    };
    post(port.current, { kind: "template_update", params });
  };

  const handleDeleteClick = (id: string) => {
    setDeletingId(id);
    setMode("edit");
  };

  const handleDeleteConfirm = () => {
    if (!deletingId) return;
    post(port.current, { kind: "template_delete", id: deletingId });
  };

  const handleApply = (id: string) => {
    setApplyingId(id);
    setApplyScope("all");
    setMode("edit"); // Reuse edit mode slot for scope selection
  };

  const handleApplyConfirm = () => {
    if (!applyingId) return;
    post(port.current, { kind: "template_apply", templateId: applyingId, scope: applyScope });
  };

  const handleCancel = () => {
    setMode("list");
    setEditingId(null);
    setDeletingId(null);
    setApplyingId(null);
    setFormDraft({ name: "", description: "" });
  };

  // ── Render ──

  return (
    <section className="relative space-y-2.5" data-slot="popup-templates-body">
      {/* Toast overlay */}
      {toast && (
        <div className="absolute top-0 right-0 z-10">
          <Toast message={toast.message} type={toast.type} />
        </div>
      )}

      {/* List view */}
      {mode === "list" && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-8" data-slot="tpl-loading">
              <RiLoader4Line className="size-5 animate-spin text-muted-foreground" aria-hidden />
              <span className="ml-2 text-xs text-muted-foreground">Loading…</span>
            </div>
          ) : templates.length === 0 ? (
            <EmptyState onCreate={handleCreate} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {templates.length} {t("popup.templates.sectionTitle").toLowerCase()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={handleCreate}
                  data-slot="tpl-create-btn"
                >
                  <RiAddLine className="size-3" aria-hidden />
                  {t("popup.templates.createBtn")}
                </Button>
              </div>
              <div className="space-y-1.5" data-slot="tpl-list">
                {templates.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    onApply={handleApply}
                    onEdit={handleEdit}
                    onDelete={handleDeleteClick}
                    applyingId={applyingId}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Create form */}
      {mode === "create" && (
        <CreateEditForm
          mode="create"
          onSave={handleSaveCreate}
          onCancel={handleCancel}
          saving={saving}
        />
      )}

      {/* Edit / Scope-select view */}
      {mode === "edit" && (
        <>
          {deletingId ? (
            <DeleteConfirm
              name={templates.find((t) => t.id === deletingId)?.name ?? ""}
              onConfirm={handleDeleteConfirm}
              onCancel={handleCancel}
            />
          ) : applyingId ? (
            <ApplyScopeSelect
              scope={applyScope}
              onScopeChange={setApplyScope}
              onConfirm={handleApplyConfirm}
              onCancel={handleCancel}
            />
          ) : (
            <CreateEditForm
              mode="edit"
              initialName={formDraft.name}
              initialDesc={formDraft.description}
              onSave={handleSaveEdit}
              onCancel={handleCancel}
              saving={saving}
            />
          )}
        </>
      )}
    </section>
  );
}
