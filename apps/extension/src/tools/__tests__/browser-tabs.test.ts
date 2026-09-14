import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "@/session-manager/manager";
import { type BrowserTabsApi, handleBrowserTabs } from "../browser-tabs";

function fixture() {
  let tab = {
    id: 7,
    windowId: 20,
    title: "AgentRouter",
    url: "https://agentrouter.org/home",
    active: true,
  } as chrome.tabs.Tab;
  const win = { id: 20, type: "normal", focused: true } as chrome.windows.Window;
  const agentWindow = {
    create: vi.fn(async () => 100),
    remove: vi.fn(async () => {}),
    ensureActiveTab: vi.fn(async () => 1),
  };
  const manager = new SessionManager({ agentWindow });
  const api = {
    query: vi.fn(async () => [tab]),
    getTab: vi.fn(async () => ({ ...tab })),
    updateTab: vi.fn(async () => tab),
    createTab: vi.fn(async () => tab),
    getWindow: vi.fn(async () => win),
    getWindows: vi.fn(async () => [win]),
    focusWindow: vi.fn(async () => win),
    createWindow: vi.fn(async () => ({ ...win, tabs: [tab] })),
  } satisfies BrowserTabsApi;
  const call = (action: string, params: Record<string, unknown> = {}, signal?: AbortSignal) =>
    handleBrowserTabs(
      manager,
      `browser.tabs.${action}`,
      { browser_id: "edge-profile", ...params },
      api,
      signal,
    );
  return {
    manager,
    agentWindow,
    api,
    call,
    setTab: (value: Partial<chrome.tabs.Tab>) => {
      tab = { ...tab, ...value };
    },
  };
}

describe("无会话用户标签", () => {
  it("AgentWindow ID 尚未返回时所有无会话请求均关闭，失败后解除阻塞", async () => {
    const f = fixture();
    let rejectCreate!: (error: Error) => void;
    f.agentWindow.create.mockImplementation(
      () =>
        new Promise<number>((_, reject) => {
          rejectCreate = reject;
        }),
    );
    const starting = f.manager.start("other").catch((error) => error);
    expect(f.manager.hasUnidentifiedAgentWindow()).toBe(true);
    for (const [action, params] of [
      ["list", { scope: "user" }],
      ["select", { tab_id: 7 }],
      ["create", { url: "https://agentrouter.org" }],
    ] as const) {
      expect(await f.call(action, params)).toMatchObject({ code: "permission_denied" });
    }
    expect(f.api.query).not.toHaveBeenCalled();
    expect(f.api.updateTab).not.toHaveBeenCalled();
    expect(f.api.createTab).not.toHaveBeenCalled();
    expect(f.api.createWindow).not.toHaveBeenCalled();
    rejectCreate(new Error("allocation failed"));
    await starting;
    expect(f.manager.hasUnidentifiedAgentWindow()).toBe(false);
    expect(await f.call("list", { scope: "user" })).toHaveProperty("tabs");
  });

  it("AgentWindow 启动及清理均失败后仍排除遗留窗口", async () => {
    const f = fixture();
    f.agentWindow.ensureActiveTab.mockRejectedValue(new Error("startup failed"));
    f.agentWindow.remove.mockRejectedValue(new Error("cleanup failed"));
    await expect(f.manager.start("other")).rejects.toThrow();
    f.setTab({ windowId: 100 });
    expect(f.manager.list()).toEqual([]);
    expect(f.manager.isAgentWindow(100)).toBe(true);
    expect(await f.call("list", { scope: "user" })).toEqual({ tabs: [] });
  });

  it("查询中出现未识别 AgentWindow 时不泄露查询结果", async () => {
    const f = fixture();
    let finish!: (id: number) => void;
    f.agentWindow.create.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    let starting!: ReturnType<SessionManager["start"]>;
    f.api.query.mockImplementation(async () => {
      starting = f.manager.start("other");
      return [{ id: 7, windowId: 100 } as chrome.tabs.Tab];
    });
    expect(await f.call("list", { scope: "user" })).toMatchObject({ code: "permission_denied" });
    finish(100);
    await starting;
  });

  it("启动中的 AgentWindow 在注册 session 前也不可见", async () => {
    const f = fixture();
    let finish!: (tabId: number) => void;
    f.agentWindow.ensureActiveTab.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const starting = f.manager.start("other");
    await vi.waitFor(() => expect(f.agentWindow.ensureActiveTab).toHaveBeenCalled());
    f.setTab({ windowId: 100 });
    expect(f.manager.isAgentWindow(100)).toBe(true);
    expect(await f.call("list", { scope: "user" })).toEqual({ tabs: [] });
    finish(1);
    await starting;
    expect(f.manager.isAgentWindow(100)).toBe(true);
  });

  it("list 只查询 normal 窗口，不启动会话或创建窗口", async () => {
    const f = fixture();
    expect(await f.call("list", { scope: "user" })).toEqual({
      tabs: [
        {
          tab_id: 7,
          window_id: 20,
          title: "AgentRouter",
          url: "https://agentrouter.org/home",
          active: true,
          scope: "user",
        },
      ],
    });
    expect(f.api.query).toHaveBeenCalledWith({ windowType: "normal" });
    expect(f.agentWindow.create).not.toHaveBeenCalled();
    expect(f.api.createWindow).not.toHaveBeenCalled();
    expect(f.manager.list()).toEqual([]);
  });

  it("排除全部 AgentWindow、借用、借用预留和移动到用户窗口的 agent 标签", async () => {
    const f = fixture();
    const session = await f.manager.start("other");
    session.agentCreatedTabs.add(8);
    session.borrowedTabs.set(9, { tabId: 9, originalWindowId: 20, originalIndex: 0 });
    f.manager.tryReserveBorrow(10, "other");
    f.api.query.mockResolvedValue([
      { id: 7, windowId: 20, active: true },
      { id: 8, windowId: 20 },
      { id: 9, windowId: 20 },
      { id: 10, windowId: 20 },
      { id: 11, windowId: 100 },
      { id: 12, windowId: 20, incognito: true },
    ] as unknown as chrome.tabs.Tab[]);
    expect(await f.call("list", { scope: "user" })).toEqual({
      tabs: [{ tab_id: 7, window_id: 20, title: "", url: "", active: true, scope: "user" }],
    });
  });

  it("select 仅激活并聚焦原窗口，不借用、移动或授权页面输入", async () => {
    const f = fixture();
    expect(
      await f.call("select", { tab_id: 7, expected_origin: "https://agentrouter.org" }),
    ).toEqual({ tab_id: 7, window_id: 20 });
    expect(f.api.updateTab).toHaveBeenCalledExactlyOnceWith(7, { active: true });
    expect(f.api.focusWindow).toHaveBeenCalledExactlyOnceWith(20);
    expect(f.api.createTab).not.toHaveBeenCalled();
    expect(f.agentWindow.create).not.toHaveBeenCalled();
    expect(f.manager.findBorrowingSession(7, null)).toBeNull();
    expect(f.manager.list()).toEqual([]);
  });

  it.each([
    "https://evil.test",
    "chrome://settings",
    "about:blank",
  ])("列出后导航到 %s 则拒绝 select", async (url) => {
    const f = fixture();
    await f.call("list", { scope: "user" });
    f.setTab({ url });
    expect(
      await f.call("select", { tab_id: 7, expected_origin: "https://agentrouter.org" }),
    ).toMatchObject({ code: "permission_denied" });
    expect(f.api.updateTab).not.toHaveBeenCalled();
    expect(f.api.focusWindow).not.toHaveBeenCalled();
  });

  it("窗口检查期间导航或出现待提交跨站导航也拒绝", async () => {
    const f = fixture();
    f.api.getWindow.mockImplementation(async () => {
      f.setTab({ pendingUrl: "https://other.test" });
      return { id: 20, type: "normal" } as chrome.windows.Window;
    });
    expect(
      await f.call("select", { tab_id: 7, expected_origin: "https://agentrouter.org" }),
    ).toMatchObject({ code: "permission_denied" });
    expect(f.api.updateTab).not.toHaveBeenCalled();
  });

  it.each([
    "agent-window",
    "borrowed",
    "reservation",
    "agent-created",
  ])("select 拒绝其他 session 的 %s", async (kind) => {
    const f = fixture();
    const ctx = await f.manager.start("other");
    if (kind === "agent-window") f.setTab({ windowId: 100 });
    if (kind === "borrowed")
      ctx.borrowedTabs.set(7, { tabId: 7, originalWindowId: 20, originalIndex: 0 });
    if (kind === "reservation") f.manager.tryReserveBorrow(7, "other");
    if (kind === "agent-created") ctx.agentCreatedTabs.add(7);
    expect(await f.call("select", { tab_id: 7 })).toMatchObject({ code: "permission_denied" });
    expect(f.api.updateTab).not.toHaveBeenCalled();
  });

  it.each(["activate", "focus"])("%s 后跨站导航必须报错并释放互斥", async (stage) => {
    const f = fixture();
    if (stage === "activate") {
      f.api.updateTab.mockImplementation(async () => {
        f.setTab({ url: "https://other.test" });
        return f.api.getTab();
      });
    } else {
      f.api.focusWindow.mockImplementation(async () => {
        f.setTab({ pendingUrl: "https://other.test" });
        return { id: 20, type: "normal" } as chrome.windows.Window;
      });
    }
    expect(
      await f.call("select", { tab_id: 7, expected_origin: "https://agentrouter.org" }),
    ).toMatchObject({ code: "permission_denied" });
    if (stage === "activate") expect(f.api.focusWindow).not.toHaveBeenCalled();
    const release = f.manager.reserveUserTabOperation(7);
    expect(release).not.toBeNull();
    release?.();
  });

  it("激活期间移动到另一个用户窗口时不聚焦任何窗口", async () => {
    const f = fixture();
    f.api.updateTab.mockImplementation(async () => {
      f.setTab({ windowId: 21 });
      return f.api.getTab();
    });
    f.api.getWindow
      .mockResolvedValueOnce({ id: 20, type: "normal" } as chrome.windows.Window)
      .mockResolvedValue({ id: 21, type: "normal" } as chrome.windows.Window);
    expect(await f.call("select", { tab_id: 7 })).toMatchObject({ code: "permission_denied" });
    expect(f.api.focusWindow).not.toHaveBeenCalled();
  });

  it.each([
    "select",
    "create",
  ])("%s 聚焦过程中移动标签必须报错，不返回过期窗口ID", async (action) => {
    const f = fixture();
    f.api.focusWindow.mockImplementation(async () => {
      f.setTab({ windowId: 21 });
      f.api.getWindow.mockResolvedValue({ id: 21, type: "normal" } as chrome.windows.Window);
      return { id: 20, type: "normal" } as chrome.windows.Window;
    });
    expect(
      await f.call(
        action,
        action === "select" ? { tab_id: 7 } : { url: "https://agentrouter.org" },
      ),
    ).toMatchObject({ code: "permission_denied" });
    expect(f.api.focusWindow).toHaveBeenCalledExactlyOnceWith(20);
    expect(f.manager.list()).toEqual([]);
  });

  it("取消激活后的请求不会继续聚焦", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.api.updateTab.mockImplementation(async () => {
      controller.abort();
      return f.api.getTab();
    });
    expect(await f.call("select", { tab_id: 7 }, controller.signal)).toMatchObject({
      code: "cancelled",
    });
    expect(f.api.focusWindow).not.toHaveBeenCalled();
  });

  it("select 拒绝无痕标签，即使它仍处于普通窗口", async () => {
    const f = fixture();
    f.setTab({ incognito: true });
    expect(await f.call("select", { tab_id: 7 })).toMatchObject({ code: "permission_denied" });
    expect(f.api.updateTab).not.toHaveBeenCalled();
  });

  it("select 执行期间拒绝借用，结束后释放互斥但不自动授权", async () => {
    const f = fixture();
    f.api.updateTab.mockImplementation(async () => {
      expect(f.manager.tryReserveBorrow(7, "other")).toEqual({ borrowedBy: "user-tab-operation" });
      return undefined as unknown as chrome.tabs.Tab;
    });
    await f.call("select", { tab_id: 7 });
    const reservation = f.manager.tryReserveBorrow(7, "other");
    expect(reservation).toHaveProperty("release");
    if ("release" in reservation) reservation.release();
  });

  it("create 直接向已有用户窗口创建站点标签", async () => {
    const f = fixture();
    expect(await f.call("create", { url: "https://agentrouter.org" })).toEqual({
      tab_id: 7,
      window_id: 20,
    });
    expect(f.api.createTab).toHaveBeenCalledExactlyOnceWith({
      windowId: 20,
      url: "https://agentrouter.org/",
      active: true,
    });
    expect(f.api.createWindow).not.toHaveBeenCalled();
    expect(f.agentWindow.create).not.toHaveBeenCalled();
  });

  it("仅有 AgentWindow 时直接创建带 URL 的用户窗口", async () => {
    const f = fixture();
    await f.manager.start("other");
    f.api.getWindows.mockResolvedValue([
      { id: 100, type: "normal", focused: true } as chrome.windows.Window,
    ]);
    expect(await f.call("create", { url: "https://agentrouter.org" })).toEqual({
      tab_id: 7,
      window_id: 20,
    });
    expect(f.api.createWindow).toHaveBeenCalledExactlyOnceWith({
      url: "https://agentrouter.org/",
      type: "normal",
      focused: true,
      incognito: false,
    });
    expect(f.api.createTab).not.toHaveBeenCalled();
  });

  it("重新检查目标窗口范围，拒绝 popup", async () => {
    const f = fixture();
    f.api.getWindow.mockResolvedValue({ id: 20, type: "popup" } as chrome.windows.Window);
    expect(await f.call("create", { url: "https://agentrouter.org" })).toMatchObject({
      code: "permission_denied",
    });
    expect(f.api.createTab).not.toHaveBeenCalled();
    expect(f.api.createWindow).not.toHaveBeenCalled();
  });

  it.each([
    "javascript:alert(1)",
    "file:///a",
    "about:blank",
    "https://",
    "https://u:p@site.test",
    "https:site.test",
    "https://site.test\n",
  ])("拒绝非法 create URL %s", async (url) => {
    const f = fixture();
    expect(await f.call("create", { url })).toMatchObject({ code: "invalid_params" });
    expect(f.api.getWindows).not.toHaveBeenCalled();
    expect(f.api.createTab).not.toHaveBeenCalled();
    expect(f.api.createWindow).not.toHaveBeenCalled();
  });

  it.each([
    "file:///a",
    "https://site.test/path",
    "https://site.test?q=1",
    "https://site.test#part",
  ])("拒绝非法 origin %s", async (expected_origin) => {
    const f = fixture();
    expect(await f.call("select", { tab_id: 7, expected_origin })).toMatchObject({
      code: "invalid_params",
    });
    expect(f.api.getTab).not.toHaveBeenCalled();
  });

  it("拒绝非 user scope、空 ID、session 注入及取消", async () => {
    const f = fixture();
    for (const params of [
      { scope: "all" },
      { scope: "user", browser_id: " " },
      { scope: "user", session_id: "other" },
    ]) {
      expect(await f.call("list", params)).toMatchObject({ code: "invalid_params" });
    }
    const controller = new AbortController();
    controller.abort();
    expect(await f.call("create", { url: "https://site.test" }, controller.signal)).toMatchObject({
      code: "cancelled",
    });
    expect(f.api.query).not.toHaveBeenCalled();
    expect(f.api.createTab).not.toHaveBeenCalled();
  });
});
