import { describe, expect, it, vi } from "vitest";
import { type CdpDebuggee, type CdpDebuggerApi, ChromiumCdp } from "../chromium-cdp";

function fakeChromeEvent<TArgs extends unknown[]>() {
  const listeners = new Set<(...args: TArgs) => void>();
  return {
    listeners,
    addListener: vi.fn((cb: (...args: TArgs) => void) => listeners.add(cb)),
    removeListener: vi.fn((cb: (...args: TArgs) => void) => listeners.delete(cb)),
    fire: (...args: TArgs) => {
      for (const cb of listeners) cb(...args);
    },
  };
}

function fakeApi() {
  const onEvent = fakeChromeEvent<[CdpDebuggee, string, unknown]>();
  const onDetach = fakeChromeEvent<[chrome.debugger.Debuggee, string]>();
  const api: CdpDebuggerApi = {
    attach: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
    sendCommand: vi.fn(async () => ({ ok: true })),
    // biome-ignore lint/suspicious/noExplicitAny: minimal chrome.events.Event shim
    onEvent: onEvent as any,
    // biome-ignore lint/suspicious/noExplicitAny: minimal chrome.events.Event shim
    onDetach: onDetach as any,
  };
  return { api, onEvent };
}

/**
 * `since: "last_action"` — a relative cursor so a caller need not remember a
 * sequence number to ask "what did my click cause?".
 */
describe("buffered reads with relative cursors", () => {
  it("absolute cursors keep working unchanged", () => {
    const { api } = fakeApi();
    const cdp = new ChromiumCdp(api);
    const result = cdp.consoleEntriesSince(4, 2, 50, 1000, false);
    expect(result.tab_id).toBe(4);
    expect(result.entries).toEqual([]);
  });

  it("accepts the last_action marker without throwing", () => {
    const { api } = fakeApi();
    const cdp = new ChromiumCdp(api);
    expect(() => cdp.consoleEntriesSince(4, "last_action", 50, 1000, false)).not.toThrow();
    expect(() => cdp.networkEntriesSince(4, "last_action", 50, 1000)).not.toThrow();
  });

  it("an unknown tab with last_action returns nothing rather than everything", () => {
    const { api } = fakeApi();
    const cdp = new ChromiumCdp(api);
    const result = cdp.consoleEntriesSince(999, "last_action", 50, 1000, false);
    expect(result.entries).toEqual([]);
    expect(result.next_since).toBe(0);
  });

  it("markAction is safe on a tab with no buffers", () => {
    const { api } = fakeApi();
    const cdp = new ChromiumCdp(api);
    expect(() => cdp.markAction(42)).not.toThrow();
  });

  it("last_action never returns more than an unbounded read", () => {
    const { api } = fakeApi();
    const cdp = new ChromiumCdp(api);
    cdp.markAction(7);
    const bounded = cdp.consoleEntriesSince(7, "last_action", 50, 1000, false);
    const fromStart = cdp.consoleEntriesSince(7, undefined, 50, 1000, false);
    expect(bounded.entries.length).toBeLessThanOrEqual(fromStart.entries.length);
  });
});
