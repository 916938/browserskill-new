import { normalizeDaemonPort, resolveDaemonWsUrl } from "@/transport/daemon-endpoint";
import type { RemoteEndpoint } from "@/transport/remote-endpoint";
import {
  initializeRemoteStorage,
  REMOTE_CONNECTION_REVISION,
  readRemoteConnection,
} from "@/transport/remote-storage";
import { STORAGE_KEYS } from "./instance-id";

/** Keep the port and remote credential in one snapshot. Invalid remote state never falls back locally. */
export function watchDaemonConnection(
  onChange: (url: string, remote: RemoteEndpoint | null) => void,
) {
  let disposed = false;
  let revision = 0;
  const read = async () => {
    const current = ++revision;
    await initializeRemoteStorage();
    const [values, remote] = await Promise.all([
      chrome.storage.local.get(STORAGE_KEYS.DAEMON_PORT),
      readRemoteConnection(),
    ]);
    if (disposed || revision !== current) return;
    onChange(
      remote?.url ?? resolveDaemonWsUrl(normalizeDaemonPort(values[STORAGE_KEYS.DAEMON_PORT])),
      remote,
    );
  };
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (
      area === "local" &&
      (changes[STORAGE_KEYS.DAEMON_PORT] || changes[REMOTE_CONNECTION_REVISION])
    ) {
      // Invalid writes are not supported; do not redirect the active connection to localhost.
      void read().catch(() => console.error("[connection] invalid connection preference"));
    }
  };
  chrome.storage.onChanged.addListener(changed);
  return {
    ready: read(),
    dispose: () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(changed);
    },
  };
}
