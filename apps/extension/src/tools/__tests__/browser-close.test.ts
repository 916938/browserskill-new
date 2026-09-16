import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "@/session-manager/manager";
import { type BrowserCloseApi, handleBrowserClose } from "../browser-close";

function fixture(windowIds: number[], options: { failing?: number[] } = {}) {
  const removed: number[] = [];
  let nextWindow = 100;
  const agentWindow = {
    create: vi.fn(async () => nextWindow++),
    remove: vi.fn(async () => {}),
    ensureActiveTab: vi.fn(async () => 1),
  };
  const manager = new SessionManager({ agentWindow });
  const api = {
    getWindows: vi.fn(async () => windowIds.map((id) => ({ id }) as chrome.windows.Window)),
    removeWindow: vi.fn(async (id: number) => {
      if (options.failing?.includes(id)) throw new Error("window already closed");
      removed.push(id);
    }),
  } satisfies BrowserCloseApi;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { manager, agentWindow, api, removed, flush };
}

describe("browser.close", () => {
  it("未确认的关闭请求直接拒绝，不触碰窗口", async () => {
    const f = fixture([1, 2]);
    for (const params of [{ browser_id: "edge" }, { browser_id: "edge", confirm: false }]) {
      expect(await handleBrowserClose(f.manager, params, f.api)).toMatchObject({
        code: "invalid_params",
      });
    }
    expect(f.api.removeWindow).not.toHaveBeenCalled();
  });

  it("停止全部会话并关闭所有窗口，最后一个窗口延后到响应之后", async () => {
    const f = fixture([1, 2, 3]);
    await f.manager.start("s1");
    await f.manager.start("s2");

    const result = await handleBrowserClose(
      f.manager,
      { browser_id: "edge", confirm: true },
      f.api,
    );
    expect(result).toEqual({
      browser_id: "edge",
      closed: true,
      windows_closed: 3,
      sessions_stopped: 2,
      disconnected: false,
    });
    // 会话已全部回收，Agent Window 不会残留。
    expect(f.manager.list()).toHaveLength(0);
    // 最后一个窗口留到响应写回之后再关：它一关浏览器进程就退出。
    expect(f.removed).toEqual([1, 2]);
    await f.flush();
    expect(f.removed).toEqual([1, 2, 3]);
  });

  it("窗口已消失时继续关闭其余窗口", async () => {
    const f = fixture([1, 2, 3], { failing: [2] });
    const result = await handleBrowserClose(
      f.manager,
      { browser_id: "edge", confirm: true },
      f.api,
    );
    expect(result).toMatchObject({ closed: true, windows_closed: 2 });
    await f.flush();
    expect(f.removed).toEqual([1, 3]);
  });

  it("已取消的请求不关闭任何窗口", async () => {
    const f = fixture([1, 2]);
    const controller = new AbortController();
    controller.abort();
    expect(
      await handleBrowserClose(
        f.manager,
        { browser_id: "edge", confirm: true },
        f.api,
        controller.signal,
      ),
    ).toMatchObject({ code: "cancelled" });
    expect(f.api.removeWindow).not.toHaveBeenCalled();
  });
});
