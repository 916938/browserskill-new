import { useTranslation } from "@browser-skill/i18n/react";
import { Button, Input, Label } from "@browser-skill/ui";
import { useEffect, useState } from "react";
import { parseRemoteEndpoint, remoteAuthorizationStatus } from "@/transport/remote-endpoint";
import {
  REMOTE_CONNECTION_MODE,
  REMOTE_CONNECTION_REVISION,
  readRemoteConnection,
} from "@/transport/remote-storage";

export function RemoteConnection({
  onRemoteChange,
}: {
  onRemoteChange?: (remote: boolean) => void;
}) {
  const { t } = useTranslation("extension");
  const [draft, setDraft] = useState("");
  const [server, setServer] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"storage" | "pairing" | null>(null);
  const [authorization, setAuthorization] = useState<{
    expiresAt?: string;
    status: ReturnType<typeof remoteAuthorizationStatus>;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      const current = ++revision;
      try {
        const remote = await readRemoteConnection();
        if (!alive || current !== revision) return;
        setServer(remote?.url ?? null);
        setAuthorization(
          remote
            ? { expiresAt: remote.expiresAt, status: remoteAuthorizationStatus(remote) }
            : null,
        );
        setError(null);
        onRemoteChange?.(remote !== null);
        setReady(true);
        clearTimeout(timer);
        if (remote) timer = setTimeout(() => void read(), 30_000);
      } catch {
        if (!alive || current !== revision) return;
        setError("storage");
        // Unknown remote state must not be presented as a healthy local connection.
        onRemoteChange?.(true);
        setReady(true);
        clearTimeout(timer);
        timer = setTimeout(() => void read(), 30_000);
      }
    };
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (
        area === "local" &&
        (changes[REMOTE_CONNECTION_REVISION] || changes[REMOTE_CONNECTION_MODE])
      )
        void read();
    };
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.onChanged.addListener(changed);
    void read();
    return () => {
      alive = false;
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [onRemoteChange]);
  async function save(disconnect = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const reply = (await chrome.runtime.sendMessage({
        kind: "bsk-remote-authorization",
        pairing: disconnect ? null : draft,
      })) as { url: string | null; error?: string };
      if (reply.error) throw new Error(reply.error);
      setServer(reply.url);
      if (!reply.url) setAuthorization(null);
      onRemoteChange?.(reply.url !== null);
      setDraft("");
    } catch {
      setError("pairing");
    } finally {
      setBusy(false);
    }
  }
  let destination = server;
  const statusKey = authorization
    ? (
        {
          active: null,
          renewing: "remoteRenewing",
          unavailable: "remoteRenewalFailed",
          rejected: "remoteRejected",
          expired: "remoteExpired",
          unconfirmed: "remoteUnconfirmed",
        } as const
      )[authorization.status]
    : null;
  const needsAttention =
    error || (authorization && !["active", "renewing"].includes(authorization.status));
  try {
    if (draft.trim()) destination = parseRemoteEndpoint(draft).url;
  } catch {
    /* Invalid drafts cannot be saved. */
  }
  return (
    <details className="rounded-xl border border-border/80 bg-card/60 px-3 py-2.5">
      <summary className="cursor-pointer text-sm font-medium">
        {t("popup.remoteTitle")}
        {needsAttention && (
          <span className="ml-2 text-destructive">{t("popup.remoteNeedsAttention")}</span>
        )}
      </summary>
      <div className="mt-3 space-y-2">
        <p className="break-all text-xs text-muted-foreground">
          {destination ?? t(error === "storage" ? "popup.remoteUnknown" : "popup.remoteLocal")}
        </p>
        {authorization?.expiresAt && (
          <p className="text-xs text-muted-foreground">
            {t("popup.remoteExpires", { date: new Date(authorization.expiresAt).toLocaleString() })}
          </p>
        )}
        {statusKey && (
          <p role="status" className="text-xs text-muted-foreground">
            {t(`popup.${statusKey}`)}
          </p>
        )}
        <Label htmlFor="remote-pairing">{t("popup.remotePairing")}</Label>
        <Input
          id="remote-pairing"
          type="password"
          autoComplete="off"
          value={draft}
          disabled={!ready || busy}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("popup.remoteHint")}</p>
        <div className="flex gap-2">
          <Button size="sm" disabled={!ready || busy || !draft.trim()} onClick={() => void save()}>
            {t("popup.remoteSave")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!ready || busy || (!server && !error)}
            onClick={() => void save(true)}
          >
            {t("popup.remoteLocal")}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {t(error === "storage" ? "popup.remoteStorageError" : "popup.remoteError")}
          </p>
        )}
      </div>
    </details>
  );
}
