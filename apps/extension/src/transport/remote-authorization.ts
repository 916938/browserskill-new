import { parseRemoteEndpoint, type RemoteEndpoint, readRemoteEndpoint } from "./remote-endpoint";
import {
  initializeRemoteStorage,
  readRemoteConnection,
  writeRemoteConnection,
} from "./remote-storage";

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function authorize(
  endpoint: RemoteEndpoint,
  action: "pair" | "renew",
  nextToken: string,
): Promise<RemoteEndpoint> {
  const url = new URL(endpoint.url);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/$/, "") + "/authorize";
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    headers: { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, next_token: nextToken, label: "Chrome · BrowserSkill" }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Browser authorization failed; reconnect or pair again");
  const data = (await response.json()) as {
    device_id: string;
    service_name?: string;
    expires_at: string;
    renew_after: string;
  };
  if (
    typeof data.device_id !== "string" ||
    !data.device_id ||
    !Number.isFinite(Date.parse(data.expires_at)) ||
    !Number.isFinite(Date.parse(data.renew_after))
  ) {
    throw new Error("Invalid browser authorization response");
  }
  const updated = readRemoteEndpoint({
    url: endpoint.url,
    token: nextToken,
    deviceId: data.device_id,
    serviceName:
      typeof data.service_name === "string" ? data.service_name.slice(0, 48) : endpoint.serviceName,
    expiresAt: data.expires_at,
    renewAfter: data.renew_after,
  });
  if (!updated || (action === "renew" && updated.deviceId !== endpoint.deviceId)) {
    throw new Error("Authorization device changed");
  }
  return updated;
}

export async function activateRemoteEndpoint(endpoint: RemoteEndpoint): Promise<RemoteEndpoint> {
  return authorize(endpoint, "pair", newToken());
}

let writes: Promise<unknown> = Promise.resolve();
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const result = writes.then(action, action);
  writes = result.catch(() => undefined);
  return result;
}
export function updateRemoteConnection(pairing: string | null): Promise<string | null> {
  return serialized(async () => {
    await initializeRemoteStorage();
    const endpoint =
      pairing === null ? null : await activateRemoteEndpoint(parseRemoteEndpoint(pairing));
    await writeRemoteConnection(endpoint);
    return endpoint?.url ?? null;
  });
}
let renewing = false;
/** Persist the candidate before rotating. A lost HTTP response can be retried
 * using the same old/new pair after service-worker or server restart. */
export async function renewRemoteAuthorization(): Promise<void> {
  if (renewing) return;
  renewing = true;
  try {
    await serialized(renewRemote);
  } finally {
    renewing = false;
  }
}
async function renewRemote(): Promise<void> {
  {
    await initializeRemoteStorage();
    const endpoint = await readRemoteConnection();
    if (
      !endpoint?.deviceId ||
      !endpoint.renewAfter ||
      (!endpoint.pendingToken && Date.now() < Date.parse(endpoint.renewAfter))
    )
      return;
    const nextToken = endpoint.pendingToken ?? newToken();
    const pending = { ...endpoint, pendingToken: nextToken };
    await writeRemoteConnection(pending);
    const updated = await authorize(endpoint, "renew", nextToken);
    const latest = await readRemoteConnection();
    // A settings change during the request must not resurrect an old connection.
    if (
      latest?.url === endpoint.url &&
      latest.token === endpoint.token &&
      latest.deviceId === endpoint.deviceId &&
      latest.pendingToken === nextToken
    ) {
      await writeRemoteConnection(updated);
    }
  }
}

export function watchRemoteAuthorization() {
  const ready = initializeRemoteStorage();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.kind !== "bsk-remote-authorization") return false;
    if (
      sender.url !== chrome.runtime.getURL("popup.html") ||
      sender.id !== chrome.runtime.id ||
      (message.pairing !== null && typeof message.pairing !== "string")
    ) {
      reply({ error: "Invalid authorization request" });
      return false;
    }
    void updateRemoteConnection(message.pairing).then(
      (url) => reply({ url }),
      () => reply({ error: "Unable to pair; copy a new pairing link and try again" }),
    );
    return true;
  });
  const run = () => {
    void renewRemoteAuthorization().catch(() => {
      /* Retry the same candidate on the next alarm; never log credentials. */
    });
  };
  const listener = (alarm: chrome.alarms.Alarm) => {
    if (alarm.name === "bsk-remote-authorization") run();
  };
  chrome.alarms.onAlarm.addListener(listener);
  void chrome.alarms.create("bsk-remote-authorization", { periodInMinutes: 1 });
  run();
  return { ready, changed: run, dispose: () => chrome.alarms.onAlarm.removeListener(listener) };
}
