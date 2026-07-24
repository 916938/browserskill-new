//! Tests for template-client RPC layer.
//!
//! Mocks the Transport.sendAndWait() interface to verify correct
//! request formatting and response/error handling.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CookieEntry,
  ProfileTemplate,
  StorageEntry,
  TemplateApplyParams,
  TemplateApplyResult,
  TemplateCreateParams,
  TemplateSummary,
  TemplateUpdateParams,
} from "@/transport/types";
import { initTemplateClient, RpcError, templateClient } from "../template-client";

// ── Fixtures ──────────────────────────────────────────

const sampleSummary: TemplateSummary = {
  id: "tpl-001",
  name: "Test Template",
  description: "A test",
  cookie_count: 2,
  storage_count: 3,
  has_user_agent: true,
  created_at_ms: 1000,
  updated_at_ms: 2000,
};

const sampleCookie: CookieEntry = {
  name: "session",
  value: "abc123",
  domain: ".example.com",
  path: "/",
  secure: true,
  http_only: true,
};

const sampleStorage: Record<string, StorageEntry> = {
  token: { value: "jwt-token" },
  prefs: { value: '{"theme":"dark"}' },
};

const sampleTemplate: ProfileTemplate = {
  id: "tpl-001",
  name: "Test Template",
  description: "A test",
  cookies: [sampleCookie],
  storage: sampleStorage,
  user_agent: "TestBot/1.0",
  created_at_ms: 1000,
  updated_at_ms: 2000,
};

// ── Mock transport factory ────────────────────────────

function makeMockTransport() {
  return {
    sendAndWait: vi.fn(),
  };
}

function makeOkResponse(result: unknown) {
  return { id: "test-1", result };
}

function makeErrResponse(code: string, message: string) {
  return { id: "test-1", error: { code, message } };
}

// ── Tests ─────────────────────────────────────────────

describe("templateClient", () => {
  let transport: ReturnType<typeof makeMockTransport>;

  beforeEach(() => {
    transport = makeMockTransport();
    initTemplateClient(transport);
  });

  describe("list()", () => {
    it("sends template.list and returns templates", async () => {
      transport.sendAndWait.mockResolvedValue(makeOkResponse({ templates: [sampleSummary] }));

      const result = await templateClient.list();

      expect(transport.sendAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "template.list",
          params: {},
        }),
      );
      expect(result).toEqual([sampleSummary]);
    });

    it("returns empty array for empty list", async () => {
      transport.sendAndWait.mockResolvedValue(makeOkResponse({ templates: [] }));
      const result = await templateClient.list();
      expect(result).toEqual([]);
    });

    it("throws RpcError on error response", async () => {
      transport.sendAndWait.mockResolvedValue(makeErrResponse("protocol_error", "internal error"));
      await expect(templateClient.list()).rejects.toThrow(RpcError);
    });
  });

  describe("get()", () => {
    it("sends template.get with id", async () => {
      transport.sendAndWait.mockResolvedValue(makeOkResponse({ template: sampleTemplate }));

      const result = await templateClient.get("tpl-001");

      expect(transport.sendAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "template.get",
          params: { id: "tpl-001" },
        }),
      );
      expect(result).toEqual(sampleTemplate);
    });

    it("throws RpcError when not found", async () => {
      transport.sendAndWait.mockResolvedValue(makeErrResponse("not_found", "template not found"));
      await expect(templateClient.get("bad-id")).rejects.toThrow(RpcError);
    });
  });

  describe("create()", () => {
    it("sends template.create with params", async () => {
      transport.sendAndWait.mockResolvedValue(makeOkResponse({ template: sampleTemplate }));

      const params: TemplateCreateParams = {
        name: "New Template",
        description: "Created via test",
        cookies: [],
        storage: {},
      };
      const result = await templateClient.create(params);

      expect(transport.sendAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "template.create",
          params: expect.objectContaining({ name: "New Template" }),
        }),
      );
      expect(result.id).toBe("tpl-001");
    });
  });

  describe("update()", () => {
    it("sends template.update with partial params", async () => {
      transport.sendAndWait.mockResolvedValue(makeOkResponse({ template: sampleTemplate }));

      const params: TemplateUpdateParams = {
        id: "tpl-001",
        name: "Updated Name",
      };
      const result = await templateClient.update(params);

      expect(transport.sendAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "template.update",
          params: expect.objectContaining({ id: "tpl-001", name: "Updated Name" }),
        }),
      );
      expect(result).not.toBeNull();
    });

    it("returns null when template not found", async () => {
      transport.sendAndWait.mockResolvedValue(makeOkResponse({ template: null }));
      const result = await templateClient.update({ id: "bad-id", name: "x" });
      expect(result).toBeNull();
    });
  });

  describe("delete()", () => {
    it("sends template.delete with id", async () => {
      transport.sendAndWait.mockResolvedValue(makeOkResponse({ deleted: true }));

      const result = await templateClient.delete("tpl-001");

      expect(transport.sendAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "template.delete",
          params: { id: "tpl-001" },
        }),
      );
      expect(result).toBe(true);
    });

    it("returns false when template does not exist", async () => {
      transport.sendAndWait.mockResolvedValue(makeOkResponse({ deleted: false }));
      const result = await templateClient.delete("bad-id");
      expect(result).toBe(false);
    });
  });

  describe("apply()", () => {
    it("sends template.apply with scope", async () => {
      const applyResult: TemplateApplyResult = {
        applied_cookies: 1,
        applied_storage: 2,
        applied_user_agent: true,
        template: sampleTemplate,
      };
      transport.sendAndWait.mockResolvedValue(makeOkResponse(applyResult));

      const params: TemplateApplyParams = {
        template_id: "tpl-001",
        scope: "all",
      };
      const result = await templateClient.apply(params);

      expect(transport.sendAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "template.apply",
          params: expect.objectContaining({ template_id: "tpl-001", scope: "all" }),
        }),
      );
      expect(result.applied_cookies).toBe(1);
      expect(result.applied_storage).toBe(2);
      expect(result.template).toEqual(sampleTemplate);
    });

    it("defaults scope to all when omitted", async () => {
      const applyResult: TemplateApplyResult = {
        applied_cookies: 0,
        applied_storage: 0,
        applied_user_agent: false,
      };
      transport.sendAndWait.mockResolvedValue(makeOkResponse(applyResult));

      await templateClient.apply({ template_id: "tpl-001" });

      expect(transport.sendAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "template.apply",
          params: expect.objectContaining({ template_id: "tpl-001" }),
        }),
      );
    });
  });

  describe("RpcError", () => {
    it("has correct name and message format", () => {
      const err = new RpcError("invalid_params", "missing required field");
      expect(err.name).toBe("RpcError");
      expect(err.code).toBe("invalid_params");
      expect(err.message).toContain("invalid_params");
      expect(err.message).toContain("missing required field");
    });
  });
});
