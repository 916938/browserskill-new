//! Tests for apply-template executor.
//!
//! Mocks chrome.cookies and chrome.storage.local APIs to verify
//! cookie, storage, and UA application logic.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CookieEntry, ProfileTemplate } from "@/transport/types";
import { applyTemplate } from "../apply-template";

// ── Mock chrome APIs ──────────────────────────────────

function makeMockCookies() {
  const setMock = vi.fn();
  return {
    cookies: {
      set: setMock,
    },
    runtime: { lastError: undefined as { message: string } | undefined },
    get calls() {
      return setMock.mock.calls;
    },
    setMock,
  };
}

function makeMockStorage() {
  const setMock = vi.fn();
  return {
    storage: {
      local: {
        set: setMock,
      },
    },
    runtime: { lastError: undefined as { message: string } | undefined },
    get calls() {
      return setMock.mock.calls;
    },
    setMock,
  };
}

// ── Fixtures ──────────────────────────────────────────

function makeCookie(overrides?: Partial<CookieEntry>): CookieEntry {
  return {
    name: "session",
    value: "token123",
    domain: ".example.com",
    path: "/",
    secure: true,
    http_only: false,
    ...overrides,
  };
}

function makeTemplate(overrides?: Partial<ProfileTemplate>): ProfileTemplate {
  return {
    id: "tpl-test",
    name: "Test",
    cookies: [],
    storage: {},
    created_at_ms: 1000,
    updated_at_ms: 2000,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────

describe("applyTemplate", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  describe("cookies", () => {
    it("sets each cookie via chrome.cookies.set", async () => {
      const cookie1 = makeCookie({ name: "a", domain: ".a.com" });
      const cookie2 = makeCookie({ name: "b", domain: ".b.com" });
      const template = makeTemplate({ cookies: [cookie1, cookie2] });

      const mock = makeMockCookies();
      vi.stubGlobal("chrome", mock);
      mock.setMock.mockImplementation((_opts, cb) => cb({ name: "ok" }));

      const result = await applyTemplate(template, "all");

      expect(result.cookies.total).toBe(2);
      expect(result.cookies.applied).toBe(2);
      expect(result.cookies.failed).toBe(0);
      expect(mock.setMock).toHaveBeenCalledTimes(2);

      // Verify first call
      const call1 = mock.setMock.mock.calls[0][0];
      expect(call1.name).toBe("a");
      expect(call1.value).toBe("token123");
      expect(call1.url).toContain("a.com");
    });

    it("constructs correct URL from domain and path", async () => {
      const cookie = makeCookie({
        domain: ".sub.example.com",
        path: "/app",
        secure: true,
      });
      const template = makeTemplate({ cookies: [cookie] });

      const mock = makeMockCookies();
      vi.stubGlobal("chrome", mock);
      mock.setMock.mockImplementation((_opts, cb) => cb({ name: "ok" }));

      await applyTemplate(template, "all");

      const call = mock.setMock.mock.calls[0][0];
      expect(call.url).toBe("https://sub.example.com/app");
    });

    it("uses http scheme for insecure cookies", async () => {
      const cookie = makeCookie({ domain: "local.dev", secure: false });
      const template = makeTemplate({ cookies: [cookie] });

      const mock = makeMockCookies();
      vi.stubGlobal("chrome", mock);
      mock.setMock.mockImplementation((_opts, cb) => cb({ name: "ok" }));

      await applyTemplate(template, "all");

      const call = mock.setMock.mock.calls[0][0];
      expect(call.url).toMatch(/^http:\/\//);
    });

    it("reports failure when chrome.cookies.set errors", async () => {
      const template = makeTemplate({ cookies: [makeCookie()] });

      const mock = makeMockCookies();
      vi.stubGlobal("chrome", mock);
      // Simulate lastError on first call
      mock.setMock.mockImplementation((_opts, cb) => {
        chrome.runtime.lastError = { message: "Permission denied" };
        cb(null);
      });

      const result = await applyTemplate(template, "all");

      expect(result.cookies.total).toBe(1);
      expect(result.cookies.applied).toBe(0);
      expect(result.cookies.failed).toBe(1);
      expect(result.cookies.errors[0]).toContain("Permission denied");
    });

    it("continues applying remaining cookies after failure", async () => {
      const template = makeTemplate({
        cookies: [makeCookie({ name: "fail" }), makeCookie({ name: "ok" })],
      });

      const mock = makeMockCookies();
      vi.stubGlobal("chrome", mock);
      let callCount = 0;
      mock.setMock.mockImplementation((_opts, cb) => {
        callCount++;
        if (callCount === 1) {
          chrome.runtime.lastError = { message: "fail" };
          cb(null);
        } else {
          chrome.runtime.lastError = undefined;
          cb({ name: "ok" });
        }
      });

      const result = await applyTemplate(template, "all");

      expect(result.cookies.total).toBe(2);
      expect(result.cookies.applied).toBe(1);
      expect(result.cookies.failed).toBe(1);
    });
  });

  describe("storage", () => {
    it("sets all storage entries in a single call", async () => {
      const template = makeTemplate({
        storage: {
          key1: { value: "val1" },
          key2: { value: "val2" },
        },
      });

      const mock = makeMockStorage();
      vi.stubGlobal("chrome", mock);
      mock.setMock.mockImplementation((_data, cb) => cb());

      const result = await applyTemplate(template, "all");

      expect(result.storage.total).toBe(2);
      expect(result.storage.applied).toBe(2);
      expect(result.storage.failed).toBe(0);

      // Verify storage batch call (call 0) and UA call (call 1)
      expect(mock.setMock).toHaveBeenCalledTimes(2);
      const data = mock.setMock.mock.calls[0][0];
      expect(data.key1).toBe("val1");
      expect(data.key2).toBe("val2");
    });

    it("reports failure when chrome.storage.local.set errors", async () => {
      const template = makeTemplate({
        storage: { k: { value: "v" } },
      });

      const mock = makeMockStorage();
      vi.stubGlobal("chrome", mock);
      mock.setMock.mockImplementation((_data, cb) => {
        chrome.runtime.lastError = { message: "quota exceeded" };
        cb();
      });

      const result = await applyTemplate(template, "all");

      expect(result.storage.total).toBe(1);
      expect(result.storage.applied).toBe(0);
      expect(result.storage.failed).toBe(1);
    });
  });

  describe("user_agent", () => {
    it("stores UA value in chrome.storage.local", async () => {
      const template = makeTemplate({ user_agent: "CustomBot/2.0" });

      const mock = makeMockStorage();
      vi.stubGlobal("chrome", mock);
      mock.setMock.mockImplementation((_data, cb) => cb());

      const result = await applyTemplate(template, "all");

      expect(result.userAgent).toBe(true);
      const data = mock.setMock.mock.calls[0][0];
      expect(data.__bsk_template_user_agent).toBe("CustomBot/2.0");
    });

    it("stores empty string when UA is undefined", async () => {
      const template = makeTemplate({ user_agent: undefined });

      const mock = makeMockStorage();
      vi.stubGlobal("chrome", mock);
      mock.setMock.mockImplementation((_data, cb) => cb());

      const result = await applyTemplate(template, "all");

      expect(result.userAgent).toBe(true);
      const data = mock.setMock.mock.calls[0][0];
      expect(data.__bsk_template_user_agent).toBe("");
    });
  });

  describe("scope filtering", () => {
    const fullTemplate = makeTemplate({
      cookies: [makeCookie()],
      storage: { k: { value: "v" } },
      user_agent: "Bot/1.0",
    });

    it("scope=all applies everything", async () => {
      const cookies = makeMockCookies();
      const storage = makeMockStorage();
      vi.stubGlobal("chrome", {
        ...cookies,
        ...storage,
      });
      cookies.setMock.mockImplementation((_o, cb) => cb({}));
      storage.setMock.mockImplementation((_d, cb) => cb());

      const result = await applyTemplate(fullTemplate, "all");

      expect(result.cookies.total).toBe(1);
      expect(result.storage.total).toBe(1);
      expect(result.userAgent).toBe(true);
    });

    it("scope=cookies skips storage and UA", async () => {
      const cookies = makeMockCookies();
      const storage = makeMockStorage();
      vi.stubGlobal("chrome", {
        ...cookies,
        ...storage,
      });
      cookies.setMock.mockImplementation((_o, cb) => cb({}));
      storage.setMock.mockImplementation((_d, cb) => cb());

      const result = await applyTemplate(fullTemplate, "cookies");

      expect(result.cookies.total).toBe(1);
      expect(result.storage.total).toBe(0);
      expect(result.userAgent).toBe(false);
    });

    it("scope=storage skips cookies and UA", async () => {
      const cookies = makeMockCookies();
      const storage = makeMockStorage();
      vi.stubGlobal("chrome", {
        ...cookies,
        ...storage,
      });
      cookies.setMock.mockImplementation((_o, cb) => cb({}));
      storage.setMock.mockImplementation((_d, cb) => cb());

      const result = await applyTemplate(fullTemplate, "storage");

      expect(result.cookies.total).toBe(0);
      expect(result.storage.total).toBe(1);
      expect(result.userAgent).toBe(false);
    });

    it("scope=user_agent skips cookies and storage", async () => {
      const cookies = makeMockCookies();
      const storage = makeMockStorage();
      vi.stubGlobal("chrome", {
        ...cookies,
        ...storage,
      });
      cookies.setMock.mockImplementation((_o, cb) => cb({}));
      storage.setMock.mockImplementation((_d, cb) => cb());

      const result = await applyTemplate(fullTemplate, "user_agent");

      expect(result.cookies.total).toBe(0);
      expect(result.storage.total).toBe(0);
      expect(result.userAgent).toBe(true);
    });
  });

  describe("empty template", () => {
    it("handles template with no cookies, storage, or UA", async () => {
      const template = makeTemplate({ cookies: [], storage: {} });

      vi.stubGlobal("chrome", {
        cookies: { set: vi.fn((_o, cb) => cb({})) },
        storage: { local: { set: vi.fn((_d, cb) => cb()) } },
        runtime: { lastError: undefined },
      });

      const result = await applyTemplate(template, "all");

      expect(result.cookies.total).toBe(0);
      expect(result.storage.total).toBe(0);
      expect(result.userAgent).toBe(true);
    });
  });
});
