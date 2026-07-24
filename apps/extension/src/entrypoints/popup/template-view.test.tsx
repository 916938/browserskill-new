//! Tests for TemplateView popup component.
//!
//! Mocks chrome.runtime.connect port to verify template list,
//! create, edit, delete, and apply flows.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateSummary } from "@/transport/types";
import { TemplateView } from "./template-view";

// ── Port mock ─────────────────────────────────────────

interface MockPort {
  postMessage: ReturnType<typeof vi.fn>;
  onMessage: {
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
  };
  onDisconnect: {
    addListener: ReturnType<typeof vi.fn>;
  };
  disconnect: ReturnType<typeof vi.fn>;
  /** Simulate the background pushing a message to the popup. */
  _receive: (msg: unknown) => void;
}

function makeMockPort(): MockPort {
  const listeners: Array<(msg: unknown) => void> = [];
  return {
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((cb: (msg: unknown) => void) => {
        listeners.push(cb);
      }),
      removeListener: vi.fn((cb: (msg: unknown) => void) => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      }),
    },
    onDisconnect: {
      addListener: vi.fn(),
    },
    disconnect: vi.fn(),
    _receive: (msg: unknown) => {
      for (const cb of listeners) cb(msg);
    },
  };
}

// ── Fixtures ──────────────────────────────────────────

const sampleTemplates: TemplateSummary[] = [
  {
    id: "tpl-1",
    name: "电商账号 A",
    description: "淘宝主账号",
    cookie_count: 5,
    storage_count: 3,
    has_user_agent: true,
    created_at_ms: 1000,
    updated_at_ms: 2000,
  },
  {
    id: "tpl-2",
    name: "测试账号 B",
    cookie_count: 0,
    storage_count: 1,
    has_user_agent: false,
    created_at_ms: 3000,
    updated_at_ms: 4000,
  },
];

// ── Setup ─────────────────────────────────────────────

let mockPort: MockPort;

beforeEach(() => {
  mockPort = makeMockPort();
  vi.stubGlobal("chrome", {
    runtime: {
      connect: vi.fn(() => mockPort),
      lastError: undefined,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────

/** Render TemplateView and wait for the port connection effect to complete. */
async function renderTemplateView() {
  let utils: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<TemplateView />);
  });
  return utils!;
}

/** Deliver a message from background to popup, wrapped in act. */
async function receive(msg: unknown) {
  await act(async () => {
    mockPort._receive(msg);
  });
}

// ── Tests ─────────────────────────────────────────────

describe("TemplateView", () => {
  it("shows loading state initially", async () => {
    await renderTemplateView();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows empty state when no templates", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: [] });
    expect(screen.getByText("暂无模板")).toBeTruthy();
    expect(screen.getByText(/创建模板后可在此处管理/)).toBeTruthy();
  });

  it("shows template list after receiving templates", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();
    expect(screen.getByText("测试账号 B")).toBeTruthy();
  });

  it("shows cookie and storage counts on cards", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("5 条 Cookie")).toBeTruthy();
    expect(screen.getByText("3 条存储")).toBeTruthy();
  });

  it("shows UA badge for templates with custom user agent", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("UA")).toBeTruthy();
  });

  it("switches to create form when clicking create button", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();

    fireEvent.click(screen.getByText("新建模板"));
    expect(screen.getByPlaceholderText(/例如：电商账号/)).toBeTruthy();
  });

  it("switches to create form from empty state button", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: [] });
    expect(screen.getByText("暂无模板")).toBeTruthy();

    fireEvent.click(screen.getByText("新建模板"));
    expect(screen.getByPlaceholderText(/例如：电商账号/)).toBeTruthy();
  });

  it("cancel returns to list view", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();

    fireEvent.click(screen.getByText("新建模板"));
    expect(screen.getByPlaceholderText(/例如：电商账号/)).toBeTruthy();

    fireEvent.click(screen.getByText("取消"));
    expect(screen.getByText("电商账号 A")).toBeTruthy();
  });

  it("sends template_create message when saving create form", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: [] });
    expect(screen.getByText("暂无模板")).toBeTruthy();

    fireEvent.click(screen.getByText("新建模板"));
    fireEvent.change(screen.getByPlaceholderText(/例如：电商账号/), {
      target: { value: "New Template" },
    });
    fireEvent.click(screen.getByText("保存"));

    expect(mockPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "template_create",
        params: expect.objectContaining({ name: "New Template" }),
      }),
    );
  });

  it("shows delete confirmation when clicking delete", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();

    const deleteButtons = screen.getAllByTitle("删除");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("确认删除")).toBeTruthy();
    });
    expect(screen.getByText(/确定要删除模板/)).toBeTruthy();
  });

  it("sends template_delete when confirming delete", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();

    const deleteButtons = screen.getAllByTitle("删除");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("确认删除")).toBeTruthy();
    });

    const confirmDeleteBtn = screen.getByRole("button", { name: "删除" });
    fireEvent.click(confirmDeleteBtn);

    expect(mockPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "template_delete",
        id: "tpl-1",
      }),
    );
  });

  it("shows scope selector when clicking apply", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();

    const applyButtons = screen.getAllByTitle("应用");
    fireEvent.click(applyButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("应用范围")).toBeTruthy();
    });
    expect(screen.getByText("全部")).toBeTruthy();
    expect(screen.getByText("仅 Cookie")).toBeTruthy();
    expect(screen.getByText("仅存储")).toBeTruthy();
    expect(screen.getByText("仅 UA")).toBeTruthy();
  });

  it("sends template_apply with selected scope", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();

    const applyButtons = screen.getAllByTitle("应用");
    fireEvent.click(applyButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("应用范围")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("仅 Cookie"));

    const confirmBtn = screen.getByRole("button", { name: /应用/ });
    fireEvent.click(confirmBtn);

    expect(mockPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "template_apply",
        templateId: "tpl-1",
        scope: "cookies",
      }),
    );
  });

  it("shows toast on apply success", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();

    const applyButtons = screen.getAllByTitle("应用");
    fireEvent.click(applyButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("应用范围")).toBeTruthy();
    });

    await receive({
      kind: "template_apply_result",
      result: { applied_cookies: 5, applied_storage: 3, applied_user_agent: true },
    });

    await waitFor(() => {
      expect(screen.getByText(/已应用 5 条 Cookie/)).toBeTruthy();
    });
  });

  it("shows error toast on apply failure", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();

    const applyButtons = screen.getAllByTitle("应用");
    fireEvent.click(applyButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("应用范围")).toBeTruthy();
    });

    await receive({
      kind: "template_apply_result",
      error: "connection lost",
    });

    await waitFor(() => {
      expect(screen.getByText(/应用失败/)).toBeTruthy();
    });
  });

  it("requests template data when clicking edit", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();

    const editButtons = screen.getAllByTitle("编辑");
    fireEvent.click(editButtons[0]);

    expect(mockPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "template_get",
        id: "tpl-1",
      }),
    );
  });

  it("populates edit form after receiving template data", async () => {
    await renderTemplateView();
    await receive({ kind: "template_list_result", templates: sampleTemplates });
    expect(screen.getByText("电商账号 A")).toBeTruthy();

    const editButtons = screen.getAllByTitle("编辑");
    fireEvent.click(editButtons[0]);

    await receive({
      kind: "template_get_result",
      template: {
        id: "tpl-1",
        name: "电商账号 A",
        description: "淘宝主账号",
        cookies: [],
        storage: {},
        created_at_ms: 1000,
        updated_at_ms: 2000,
      },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("电商账号 A")).toBeTruthy();
    });
    expect(screen.getByDisplayValue("淘宝主账号")).toBeTruthy();
  });
});
