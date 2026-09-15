import type { RpcError, WaitUntil } from "@/transport/types";
import { cdpError } from "./errors";
import { NavigationDocument } from "./navigation-document";

interface NavigationEvent {
  tabId: number;
  frameId: number;
  documentId?: string;
  error?: string;
  url?: string;
  transitionQualifiers?: string[];
}

interface NavigationEvents {
  addListener(listener: (details: NavigationEvent) => void): void;
  removeListener(listener: (details: NavigationEvent) => void): void;
}

/** Normal browser navigation remains available when chrome.debugger is denied. */
export interface BrowserNavigationApi {
  update(tabId: number, props: { url: string }): Promise<unknown>;
  reload(tabId: number, props: { bypassCache: boolean }): Promise<void>;
  goBack(tabId: number): Promise<void>;
  goForward(tabId: number): Promise<void>;
  getFrame(tabId: number): Promise<{ documentId?: string } | null>;
  onBeforeNavigate: NavigationEvents;
  onCommitted: NavigationEvents;
  onDOMContentLoaded: NavigationEvents;
  onCompleted: NavigationEvents;
  onErrorOccurred: NavigationEvents;
}

export const chromeBrowserNavigationApi: BrowserNavigationApi = {
  update: (tabId, props) => chrome.tabs.update(tabId, props),
  reload: (tabId, props) => chrome.tabs.reload(tabId, props),
  goBack: (tabId) => chrome.tabs.goBack(tabId),
  goForward: (tabId) => chrome.tabs.goForward(tabId),
  getFrame: (tabId) => chrome.webNavigation.getFrame({ tabId, frameId: 0 }),
  get onBeforeNavigate() {
    return chrome.webNavigation.onBeforeNavigate;
  },
  get onCommitted() {
    return chrome.webNavigation.onCommitted;
  },
  get onDOMContentLoaded() {
    return chrome.webNavigation.onDOMContentLoaded;
  },
  get onCompleted() {
    return chrome.webNavigation.onCompleted;
  },
  get onErrorOccurred() {
    return chrome.webNavigation.onErrorOccurred;
  },
};

export type NavigationOutcome =
  | { reached: "match" | "timeout" | "cancelled"; lastLifecycle?: string; url?: string }
  | { reached: "failed"; error: RpcError };

/** Subscribe before dispatch and ignore the departing document's load events. */
export async function navigateWithBrowserApi(
  api: BrowserNavigationApi,
  tabId: number,
  action: () => Promise<unknown>,
  waitUntil: WaitUntil,
  timeoutMs: number,
  signal?: AbortSignal,
  afterCommit?: (event: NavigationEvent, signal: AbortSignal) => Promise<boolean | void>,
  requestedUrl?: string,
): Promise<NavigationOutcome> {
  if (signal?.aborted) return { reached: "cancelled" };
  if (timeoutMs <= 0) return { reached: "timeout" };
  const controller = new AbortController();
  let started = false;
  const document = new NavigationDocument();
  let handoff = new AbortController();
  let acceptedCommit = false;
  let committedUrl: string | undefined;
  // An explicit navigate identifies its start URL. A committed server redirect
  // still belongs to that navigation; an unfinished source commit does not.
  const expectedUrl = requestedUrl === undefined ? undefined : new URL(requestedUrl).href;
  const matchesStart = (details: NavigationEvent) =>
    expectedUrl === undefined || details.url === expectedUrl;

  let lastLifecycle: string | undefined;
  let prepared = false;
  let actionDone = false;
  let matched = false;
  let settled = false;
  let resolve!: (outcome: NavigationOutcome) => void;
  const outcome = new Promise<NavigationOutcome>((done) => {
    resolve = done;
  });
  const finish = (result: NavigationOutcome) => {
    if (settled) return;
    settled = true;
    controller.abort();
    handoff.abort();
    resolve(result);
  };
  const tryFinish = () => {
    if (!document.pending && prepared && actionDone && matched)
      finish({ reached: "match", lastLifecycle, url: committedUrl });
  };
  const isMainFrame = (details: NavigationEvent) =>
    details.tabId === tabId && details.frameId === 0;
  const isDocument = (details: NavigationEvent) =>
    isMainFrame(details) &&
    !document.pending &&
    !!document.id &&
    details.documentId === document.id;
  const resetReadiness = () => {
    handoff.abort();
    handoff = new AbortController();
    prepared = false;
    matched = false;
    lastLifecycle = undefined;
  };
  const onBeforeNavigate = (details: NavigationEvent) => {
    if (!isMainFrame(details) || settled) return;
    if (!acceptedCommit) {
      if (matchesStart(details)) started = true;
      return;
    }
    document.begin();
    resetReadiness();
  };
  const onCommitted = (details: NavigationEvent) => {
    if (!isMainFrame(details) || settled || document.isRetired(details.documentId)) return;
    if (
      !acceptedCommit &&
      (!started ||
        (!matchesStart(details) && !details.transitionQualifiers?.includes("server_redirect")))
    ) {
      document.retire(details.documentId);
      return;
    }
    if (!document.commit(details.documentId)) return;
    acceptedCommit = true;
    resetReadiness();
    committedUrl = details.url;
    lastLifecycle = "commit";
    matched = waitUntil === "commit" || waitUntil === "networkidle";
    const version = document.version;
    const signal = handoff.signal;
    // A successor invalidates this handoff without ending the operation.
    // Keep native listeners active even during CDP network-idle waiting.
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return afterCommit?.(details, signal);
      })
      .then(
        (ready) => {
          if (settled || !document.isCurrent(version) || ready === false) return;
          prepared = true;
          tryFinish();
        },
        (error) => {
          if (settled || !document.isCurrent(version)) return;
          finish(
            error instanceof Error && error.name === "AbortError"
              ? { reached: "cancelled", lastLifecycle }
              : { reached: "failed", error: cdpError(error) },
          );
        },
      );
  };
  const onDOMContentLoaded = (details: NavigationEvent) => {
    if (!isDocument(details)) return;
    lastLifecycle = "DOMContentLoaded";
    matched ||= waitUntil === "domcontentloaded";
    tryFinish();
  };
  const onCompleted = (details: NavigationEvent) => {
    if (!isDocument(details)) return;
    lastLifecycle = "load";
    matched ||= waitUntil !== "networkidle";
    tryFinish();
  };
  const onError = (details: NavigationEvent) => {
    if (
      !isMainFrame(details) ||
      !started ||
      document.isRetired(details.documentId) ||
      (!!document.id && !!details.documentId && details.documentId !== document.id)
    )
      return;
    finish({ reached: "failed", error: cdpError(details.error ?? "browser navigation failed") });
  };
  const onAbort = () => finish({ reached: "cancelled", lastLifecycle });
  const subscriptions = [
    [api.onBeforeNavigate, onBeforeNavigate],
    [api.onCommitted, onCommitted],
    [api.onDOMContentLoaded, onDOMContentLoaded],
    [api.onCompleted, onCompleted],
    [api.onErrorOccurred, onError],
  ] as const;
  for (const [event, listener] of subscriptions) event.addListener(listener);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => finish({ reached: "timeout", lastLifecycle }), timeoutMs);
  try {
    if (signal?.aborted) return { reached: "cancelled" };
    // The deadline also bounds an unresponsive browser action or handoff.
    void Promise.resolve()
      .then(async () => {
        const departing = await api.getFrame(tabId);
        document.retire(departing?.documentId);
        controller.signal.throwIfAborted();
        return action();
      })
      .then(
        () => {
          actionDone = true;
          tryFinish();
        },
        (error) => {
          finish(
            error instanceof Error && error.name === "AbortError"
              ? { reached: "cancelled", lastLifecycle }
              : { reached: "failed", error: cdpError(error) },
          );
        },
      );
    return await outcome;
  } finally {
    controller.abort();
    handoff.abort();
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    for (const [event, listener] of subscriptions) event.removeListener(listener);
  }
}
