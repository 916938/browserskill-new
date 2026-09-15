import { normalizeDaemonPort, resolveDaemonWsUrl } from "@/transport/daemon-endpoint";
import type { RemoteEndpoint } from "@/transport/remote-endpoint";
import {
  REMOTE_CONNECTION_MODE,
  REMOTE_CONNECTION_REVISION,
  readRemoteConnection,
} from "@/transport/remote-storage";
import { STORAGE_KEYS } from "./instance-id";

/** Keep the port and remote credential in one snapshot. Invalid remote state never falls back locally. */
export function watchDaemonConnection(
  onChange: (url: string, remote: RemoteEndpoint | null) => void,
  onError: () => void = () => console.error("[connection] invalid connection preference"),
) {
  let disposed = false;
  let revision = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: () => void;
  // A failed initial read must neither connect to the default local endpoint
  // nor permanently prevent an explicit settings change from recovering startup.
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const read = async () => {
    clearTimeout(retry);
    const current = ++revision;
    try {
      const [values, remote] = await Promise.all([
        chrome.storage.local.get(STORAGE_KEYS.DAEMON_PORT),
        readRemoteConnection(),
      ]);
      if (disposed || revision !== current) return;
      onChange(
        remote?.url ?? resolveDaemonWsUrl(normalizeDaemonPort(values[STORAGE_KEYS.DAEMON_PORT])),
        remote,
      );
      resolveReady();
    } catch {
      if (!disposed && revision === current) {
        onError();
        retry = setTimeout(() => void read(), 30_000);
      }
    }
  };
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (
      area === "local" &&
      (changes[STORAGE_KEYS.DAEMON_PORT] ||
        changes[REMOTE_CONNECTION_REVISION] ||
        changes[REMOTE_CONNECTION_MODE])
    ) {
      // Invalid writes are not supported; do not redirect the active connection to localhost.
      void read();
    }
  };
  chrome.storage.onChanged.addListener(changed);
  void read();
  return {
    ready,
    dispose: () => {
      disposed = true;
      clearTimeout(retry);
      chrome.storage.onChanged.removeListener(changed);
    },
  };
}
