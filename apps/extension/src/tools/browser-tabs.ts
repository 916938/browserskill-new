import { OBSERVE_MAX_BYTES, USER_TAB_OBSERVE } from "@/content/user-tab-observe";
import type { SessionManager } from "@/session-manager/manager";

type TopDocument = {
  documentId: string;
  url: string;
  parentFrameId: number;
  documentLifecycle?: string;
  errorOccurred?: boolean;
};
type ObservationApi = {
  getFrame(tabId: number): Promise<TopDocument | null>;
  sendObserve(tabId: number, documentId: string, message: unknown): Promise<unknown>;
  watchTab(tabId: number, changed: () => void): () => void;
};

import type { RpcError } from "@/transport/types";

export interface BrowserTabsApi {
  observation?: ObservationApi;
  query(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  getTab(id: number): Promise<chrome.tabs.Tab>;
  updateTab(id: number, props: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab | undefined>;
  createTab(props: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
  getWindow(id: number): Promise<chrome.windows.Window>;
  getWindows(): Promise<chrome.windows.Window[]>;
  focusWindow(id: number): Promise<chrome.windows.Window>;
  createWindow(props: chrome.windows.CreateData): Promise<chrome.windows.Window | undefined>;
}

const chromeApi: BrowserTabsApi = {
  observation: {
    getFrame: (tabId) => chrome.webNavigation.getFrame({ tabId, frameId: 0 }),
    sendObserve: (tabId, documentId, message) =>
      chrome.tabs.sendMessage(tabId, message, { documentId }),
    watchTab(tabId, changed) {
      const navigation = (event: { tabId: number; frameId: number }) => {
        if (event.tabId === tabId && event.frameId === 0) changed();
      };
      const tabEvent = (id: number) => {
        if (id === tabId) changed();
      };
      const replaced = (added: number, removed: number) => {
        if (added === tabId || removed === tabId) changed();
      };
      const events = [
        chrome.webNavigation.onBeforeNavigate,
        chrome.webNavigation.onCommitted,
        chrome.webNavigation.onHistoryStateUpdated,
        chrome.webNavigation.onReferenceFragmentUpdated,
      ];
      for (const event of events) event.addListener(navigation);
      chrome.tabs.onDetached.addListener(tabEvent);
      chrome.tabs.onRemoved.addListener(tabEvent);
      chrome.tabs.onReplaced.addListener(replaced);
      return () => {
        for (const event of events) event.removeListener(navigation);
        chrome.tabs.onDetached.removeListener(tabEvent);
        chrome.tabs.onRemoved.removeListener(tabEvent);
        chrome.tabs.onReplaced.removeListener(replaced);
      };
    },
  },
  query: (q) => chrome.tabs.query(q),
  getTab: (id) => chrome.tabs.get(id),
  updateTab: (id, props) => chrome.tabs.update(id, props),
  createTab: (props) => chrome.tabs.create(props),
  getWindow: (id) => chrome.windows.get(id),
  getWindows: () => chrome.windows.getAll({ windowTypes: ["normal"] }),
  focusWindow: (id) => chrome.windows.update(id, { focused: true }),
  createWindow: (props) => chrome.windows.create(props),
};

function fail(code: RpcError["code"], message: string): never {
  throw { code, message } satisfies RpcError;
}

function httpUrl(value: unknown, originOnly = false): URL {
  if (
    typeof value !== "string" ||
    !/^https?:\/\//i.test(value) ||
    /[\x00-\x20\x7f\\]/.test(value)
  ) {
    return fail("invalid_params", "an absolute HTTP(S) URL is required");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("invalid_params", "invalid URL");
  }
  if (
    !url.hostname ||
    value
      .slice(value.indexOf("://") + 3)
      .split(/[/?#]/)[0]
      .includes("@") ||
    url.username ||
    url.password ||
    (originOnly && (url.pathname !== "/" || url.search || url.hash))
  ) {
    return fail("invalid_params", "URL credentials or non-origin components are not allowed");
  }
  return url;
}

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) fail("cancelled", "browser tabs request cancelled");
}

function checkWindowOwnership(manager: SessionManager): void {
  // Chrome 可先暴露窗口，再完成 windows.create；未知 ID 期间必须关闭独立通道。
  if (manager.hasUnidentifiedAgentWindow())
    fail("permission_denied", "Agent Window ownership is still being established");
}

function userTab(manager: SessionManager, tab: chrome.tabs.Tab): boolean {
  checkWindowOwnership(manager);
  return (
    Number.isSafeInteger(tab.id) &&
    (tab.id ?? 0) > 0 &&
    Number.isSafeInteger(tab.windowId) &&
    tab.windowId > 0 &&
    !tab.incognito &&
    !manager.isAgentWindow(tab.windowId) &&
    !manager.findBorrowingSession(tab.id!, null) &&
    !manager.list().some((session) => session.agentCreatedTabs.has(tab.id!))
  );
}

function userWindow(manager: SessionManager, win: chrome.windows.Window): boolean {
  checkWindowOwnership(manager);
  return (
    typeof win.id === "number" &&
    win.type === "normal" &&
    !win.incognito &&
    !manager.isAgentWindow(win.id)
  );
}

async function validatedTab(
  manager: SessionManager,
  api: BrowserTabsApi,
  tabId: number,
  expectedOrigin: string | undefined,
  signal?: AbortSignal,
) {
  const initial = await api.getTab(tabId);
  const win = await api.getWindow(initial.windowId);
  // 窗口查询期间可能发生导航或移动，动作前重新获取标签并核对归属。
  const tab = await api.getTab(tabId);
  checkSignal(signal);
  if (
    initial.id !== tabId ||
    tab.id !== tabId ||
    initial.windowId !== tab.windowId ||
    tab.windowId !== win.id ||
    !userWindow(manager, win) ||
    !userTab(manager, tab)
  ) {
    return fail("permission_denied", "tab is not an unclaimed user tab in a normal window");
  }
  if (expectedOrigin) {
    const matches = (value?: string) => {
      try {
        return !!value && httpUrl(value).origin === expectedOrigin;
      } catch {
        return false;
      }
    };
    if (!matches(tab.url) || (tab.pendingUrl && !matches(tab.pendingUrl))) {
      return fail("permission_denied", "tab origin changed before selection");
    }
  }
  return tab;
}

async function observeTab(
  manager: SessionManager,
  api: BrowserTabsApi,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const id = params.tab_id;
  const max = params.max_chars === undefined ? 4000 : params.max_chars;
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof max !== "number" ||
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 8000
  )
    return fail("invalid_params", "invalid tab_id or max_chars");
  const origin = httpUrl(params.expected_origin, true).origin;
  const observation = api.observation;
  if (!observation) return fail("unknown_method", "read-only observation is unavailable");
  const release = manager.reserveUserTabOperation(id);
  if (!release) return fail("permission_denied", "tab is borrowed or busy");
  let changed = false;
  let unwatch: (() => void) | undefined;
  const check = () => {
    checkSignal(signal);
    checkWindowOwnership(manager);
    if (changed) fail("permission_denied", "tab document changed during observation");
  };
  const frame = async () => {
    const value = await observation.getFrame(id);
    check();
    if (
      !value ||
      value.parentFrameId !== -1 ||
      value.errorOccurred ||
      value.documentLifecycle !== "active" ||
      typeof value.documentId !== "string" ||
      !/^[a-zA-Z0-9-]{1,128}$/.test(value.documentId) ||
      httpUrl(value.url).origin !== origin
    )
      return fail("permission_denied", "top document context unavailable or changed");
    return value;
  };
  try {
    // 事件哨兵覆盖导航后恢复同一文档的 A→B→A，不能只比较末次 URL。
    unwatch = observation.watchTab(id, () => {
      changed = true;
    });
    const tab = await validatedTab(manager, api, id, origin, signal);
    check();
    if (tab.pendingUrl) fail("permission_denied", "tab navigation is pending");
    const before = await frame();
    let reply: unknown;
    try {
      reply = await observation.sendObserve(id, before.documentId, {
        type: USER_TAB_OBSERVE,
        expected_origin: origin,
        max_chars: max,
      });
    } catch {
      check();
      return fail(
        "not_found",
        "No read-only content receiver; manually refresh this page, then retry. No automatic injection is performed.",
      );
    }
    check();
    const current = await validatedTab(manager, api, id, origin, signal);
    const after = await frame();
    check();
    if (
      current.windowId !== tab.windowId ||
      current.pendingUrl ||
      before.documentId !== after.documentId ||
      !userTab(manager, current)
    )
      return fail("permission_denied", "tab context changed during observation");
    if (!reply || typeof reply !== "object" || Array.isArray(reply))
      return fail("protocol_error", "invalid read-only content response");
    const result = reply as Record<string, unknown>;
    if (result.code === "permission_denied")
      return fail("permission_denied", "content document origin mismatch");
    if (
      Object.keys(result).length !== 4 ||
      Object.keys(result).some((key) => !["origin", "text", "truncated", "top"].includes(key)) ||
      result.origin !== origin ||
      result.top !== true ||
      typeof result.text !== "string" ||
      result.text.length > max * 2 ||
      Array.from(result.text).length > max ||
      new TextEncoder().encode(result.text).length > OBSERVE_MAX_BYTES ||
      typeof result.truncated !== "boolean"
    )
      return fail("protocol_error", "invalid read-only content response");
    return {
      browser_id: params.browser_id,
      tab_id: id,
      window_id: current.windowId,
      origin,
      document_id: before.documentId,
      text: result.text,
      truncated: result.truncated,
    };
  } finally {
    unwatch?.();
    release();
  }
}

export async function handleBrowserTabs(
  manager: SessionManager,
  method: string,
  raw: unknown,
  api: BrowserTabsApi = chromeApi,
  signal?: AbortSignal,
): Promise<unknown | RpcError> {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      fail("invalid_params", "params required");
    const params = raw as Record<string, unknown>;
    const allowed =
      method === "browser.tabs.list"
        ? ["browser_id", "scope"]
        : method === "browser.tabs.select"
          ? ["browser_id", "tab_id", "expected_origin"]
          : method === "browser.tabs.create"
            ? ["browser_id", "url"]
            : method === "browser.tabs.observe"
              ? ["browser_id", "tab_id", "expected_origin", "max_chars"]
              : [];
    if (!allowed.length) fail("unknown_method", "unknown browser tabs method");
    if (
      typeof params.browser_id !== "string" ||
      !params.browser_id.trim() ||
      Object.keys(params).some((key) => !allowed.includes(key))
    )
      fail("invalid_params", "invalid browser tabs params");
    checkSignal(signal);
    checkWindowOwnership(manager);
    if (method === "browser.tabs.observe") return await observeTab(manager, api, params, signal);
    if (method === "browser.tabs.list") {
      if (params.scope !== "user") fail("invalid_params", "only scope user is allowed");
      const tabs = await api.query({ windowType: "normal" });
      checkSignal(signal);
      return {
        tabs: tabs
          .filter((tab) => userTab(manager, tab))
          .map((tab) => ({
            tab_id: tab.id!,
            window_id: tab.windowId,
            title: tab.title ?? "",
            url: tab.url ?? "",
            active: tab.active,
            scope: "user",
          })),
      };
    }
    if (method === "browser.tabs.select") {
      const id = params.tab_id;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
        fail("invalid_params", "invalid tab_id");
      const expected =
        params.expected_origin === undefined
          ? undefined
          : httpUrl(params.expected_origin, true).origin;
      // 仅互斥借用，不创建 session、不授予页面控制权。
      const release = manager.reserveUserTabOperation(id as number);
      if (!release) fail("permission_denied", "tab is borrowed or busy");
      try {
        const tab = await validatedTab(manager, api, id as number, expected, signal);
        checkSignal(signal);
        checkWindowOwnership(manager);
        await api.updateTab(tab.id!, { active: true });
        const current = await validatedTab(manager, api, tab.id!, expected, signal);
        checkSignal(signal);
        checkWindowOwnership(manager);
        if (current.windowId !== tab.windowId) fail("permission_denied", "tab moved before focus");
        await api.focusWindow(tab.windowId);
        const focused = await validatedTab(manager, api, tab.id!, expected, signal);
        if (focused.windowId !== tab.windowId) fail("permission_denied", "tab moved during focus");
        return { tab_id: tab.id, window_id: tab.windowId };
      } finally {
        release!();
      }
    }
    const url = httpUrl(params.url).href;
    const windows = await api.getWindows();
    checkSignal(signal);
    checkWindowOwnership(manager);
    const candidate = windows
      .filter((win) => userWindow(manager, win))
      .sort((a, b) => Number(b.focused) - Number(a.focused))[0];
    let created: chrome.tabs.Tab | undefined;
    if (candidate?.id !== undefined) {
      const win = await api.getWindow(candidate.id);
      checkSignal(signal);
      if (!userWindow(manager, win))
        fail("permission_denied", "target window is no longer a user window");
      created = await api.createTab({ windowId: win.id, url, active: true });
    } else {
      // 没有用户窗口时直接携带站点 URL 创建，绝不先建空白页。
      const win = await api.createWindow({ url, type: "normal", focused: true, incognito: false });
      created = win?.tabs?.[0];
    }
    checkSignal(signal);
    if (!created?.id) fail("protocol_error", "browser did not return the created tab");
    const release = manager.reserveUserTabOperation(created!.id!);
    if (!release) fail("permission_denied", "created tab is now borrowed or busy");
    try {
      const current = await validatedTab(manager, api, created!.id!, undefined, signal);
      checkSignal(signal);
      checkWindowOwnership(manager);
      await api.focusWindow(current.windowId);
      const focused = await validatedTab(manager, api, created!.id!, undefined, signal);
      if (focused.windowId !== current.windowId)
        fail("permission_denied", "created tab moved during focus");
      return { tab_id: focused.id, window_id: focused.windowId };
    } finally {
      release!();
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) return error as RpcError;
    return {
      code: "not_found",
      message: error instanceof Error ? error.message : "browser tab unavailable",
    };
  }
}
