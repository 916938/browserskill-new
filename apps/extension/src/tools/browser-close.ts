import type { SessionManager } from "@/session-manager/manager";
import type { RpcError } from "@/transport/types";

/** Minimal window surface so the handler stays testable. */
export interface BrowserCloseApi {
  getWindows(): Promise<chrome.windows.Window[]>;
  removeWindow(id: number): Promise<void>;
}

export interface BrowserCloseParams {
  browser_id: string;
  confirm: boolean;
}

export interface BrowserCloseResult {
  browser_id: string;
  closed: boolean;
  windows_closed: number;
  sessions_stopped: number;
  disconnected: boolean;
}

export const chromeBrowserCloseApi: BrowserCloseApi = {
  getWindows: () => chrome.windows.getAll({ windowTypes: ["normal"] }),
  removeWindow: async (id) => {
    await chrome.windows.remove(id);
  },
};

/**
 * Quit a browser: stop every live session (closing its Agent Window) and
 * then close all remaining windows, which makes the browser process exit.
 *
 * The **last** window is closed on a `setTimeout(0)` instead of inline:
 * once it goes away the extension's service worker dies with the browser
 * and the RPC reply may never reach the socket. Deferring one macrotask
 * lets the dispatcher flush the response first. The daemon treats a
 * dropped connection as "closed" anyway, so the outcome is the same even
 * if the flush loses the race.
 */
export async function handleBrowserClose(
  manager: SessionManager,
  raw: unknown,
  api: BrowserCloseApi = chromeBrowserCloseApi,
  signal?: AbortSignal,
): Promise<BrowserCloseResult | RpcError> {
  if (signal?.aborted) return { code: "cancelled", message: "browser close cancelled" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { code: "invalid_params", message: "params required" };
  const params = raw as Record<string, unknown>;
  if (typeof params.browser_id !== "string" || !params.browser_id.trim())
    return { code: "invalid_params", message: "browser_id is required" };
  if (params.confirm !== true)
    return { code: "invalid_params", message: "browser.close requires confirm=true" };
  if (signal?.aborted) return { code: "cancelled", message: "browser close cancelled" };

  const stopped = await manager.stopAll();
  const windows = await api.getWindows();
  const ids = windows
    .map((w) => w.id)
    .filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id));

  let windowsClosed = 0;
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (id === undefined) continue;
    if (index === ids.length - 1) {
      setTimeout(() => {
        void api.removeWindow(id).catch(() => undefined);
      }, 0);
      windowsClosed += 1;
      continue;
    }
    try {
      await api.removeWindow(id);
      windowsClosed += 1;
    } catch {
      // Window already gone (closed by the user mid-flight). Keep going
      // so one stale id cannot leave the browser running.
    }
  }

  return {
    browser_id: params.browser_id,
    closed: true,
    windows_closed: windowsClosed,
    sessions_stopped: stopped.length,
    disconnected: false,
  };
}
