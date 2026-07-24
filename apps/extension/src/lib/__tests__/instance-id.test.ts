import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  defaultStorage,
  generateDefaultLabel,
  getConnectionEnabled,
  getLabel,
  getOrCreateInstanceId,
  STORAGE_KEYS,
  setConnectionEnabled,
  setLabel,
} from "../instance-id";

function fakeStorage(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  return {
    store,
    backend: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) if (k in store) result[k] = store[k];
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
    },
  };
}

describe("instance-id", () => {
  it("generates a new 8-char hex id when storage is empty and persists it", async () => {
    const { store, backend } = fakeStorage();
    const id = await getOrCreateInstanceId(backend);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
    expect(backend.set).toHaveBeenCalledOnce();
  });

  it("returns the persisted short id on subsequent calls", async () => {
    const existing = "a7f32e1c";
    const { backend } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: existing });
    const id = await getOrCreateInstanceId(backend);
    expect(id).toBe(existing);
    expect(backend.set).not.toHaveBeenCalled();
  });

  it("replaces legacy UUID storage with a short id", async () => {
    const legacy = "abcdef01-2345-4678-89ab-cdef01234567";
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: legacy });
    const id = await getOrCreateInstanceId(backend);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(id).not.toBe(legacy);
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
    expect(backend.set).toHaveBeenCalledOnce();
  });

  it("treats non-string stored values as missing", async () => {
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: 42 });
    const id = await getOrCreateInstanceId(backend);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
  });

  it("getLabel returns empty string when label is unset", async () => {
    const { backend } = fakeStorage();
    expect(await getLabel(backend)).toBe("");
  });

  it("setLabel persists the value retrievable by getLabel", async () => {
    const { backend, store } = fakeStorage();
    await setLabel("Personal Chrome", backend);
    expect(store[STORAGE_KEYS.LABEL]).toBe("Personal Chrome");
    expect(await getLabel(backend)).toBe("Personal Chrome");
  });

  it("getConnectionEnabled returns true when storage is empty", async () => {
    const { backend } = fakeStorage();
    expect(await getConnectionEnabled(backend)).toBe(true);
  });

  it("getConnectionEnabled returns persisted boolean values", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.CONNECTION_ENABLED]: false });
    expect(await getConnectionEnabled(backend)).toBe(false);
  });

  it("getConnectionEnabled treats non-boolean stored values as enabled", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.CONNECTION_ENABLED]: "false" });
    expect(await getConnectionEnabled(backend)).toBe(true);
  });

  it("setConnectionEnabled persists the value retrievable by getConnectionEnabled", async () => {
    const { backend, store } = fakeStorage();
    await setConnectionEnabled(false, backend);
    expect(store[STORAGE_KEYS.CONNECTION_ENABLED]).toBe(false);
    expect(await getConnectionEnabled(backend)).toBe(false);
  });
});

describe("generateDefaultLabel", () => {
  it("generates label in format '{Browser}#{4-char-id}' (no space)", () => {
    const label = generateDefaultLabel("03c3e47f", "Chrome");
    expect(label).toBe("Chrome#03c3");
  });

  it("uses Chrome as default browser name when not specified", () => {
    const label = generateDefaultLabel("a7f32e1c");
    expect(label).toBe("Chrome#a7f3");
  });

  it("capitalizes first letter of browser name", () => {
    expect(generateDefaultLabel("abc12345", "chrome")).toBe("Chrome#abc1");
    expect(generateDefaultLabel("abc12345", "edge")).toBe("Edge#abc1");
    expect(generateDefaultLabel("abc12345", "firefox")).toBe("Firefox#abc1");
  });

  it("handles already-capitalized browser names", () => {
    expect(generateDefaultLabel("def67890", "Chrome")).toBe("Chrome#def6");
    expect(generateDefaultLabel("def67890", "Edge")).toBe("Edge#def6");
  });

  it("handles mixed-case browser names", () => {
    expect(generateDefaultLabel("12345678", "CHROME")).toBe("Chrome#1234");
    expect(generateDefaultLabel("12345678", "EdGe")).toBe("Edge#1234");
  });

  it("extracts first 4 characters of instanceId", () => {
    expect(generateDefaultLabel("abcdef01", "Chrome")).toBe("Chrome#abcd");
    expect(generateDefaultLabel("01234567", "Chrome")).toBe("Chrome#0123");
    expect(generateDefaultLabel("ffffffff", "Chrome")).toBe("Chrome#ffff");
  });

  it("generates unique labels for different instanceIds", () => {
    const label1 = generateDefaultLabel("03c3e47f", "Chrome");
    const label2 = generateDefaultLabel("a7f32e1c", "Chrome");
    expect(label1).not.toBe(label2);
  });

  it("generates same label for same inputs (deterministic)", () => {
    const label1 = generateDefaultLabel("03c3e47f", "Chrome");
    const label2 = generateDefaultLabel("03c3e47f", "Chrome");
    expect(label1).toBe(label2);
  });

  it("contains hash separator without leading space for CLI-friendliness", () => {
    const label = generateDefaultLabel("03c3e47f", "Chrome");
    // Format: {Name}#{id} — no space before #
    expect(label).toContain("#");
    expect(label).not.toContain(" #"); // no space-hash
    const parts = label.split("#");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0); // Browser name
    expect(parts[1]).toHaveLength(4); // 4-char short ID
  });
});

describe("generateShortInstanceId (fallback path)", () => {
  let originalCrypto: typeof crypto;

  beforeEach(() => {
    originalCrypto = globalThis.crypto;
    // Remove crypto to trigger Math.random fallback path
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      writable: true,
      configurable: true,
    });
  });

  it("uses Math.random fallback when crypto is undefined", async () => {
    // Simulate environment without crypto API
    (globalThis as unknown as { crypto: undefined }).crypto = undefined;

    const { backend, store } = fakeStorage();
    const id = await getOrCreateInstanceId(backend);

    // Should still generate valid 8-char hex ID using Math.random fallback
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
  });

  it("generates valid hex IDs via fallback on repeated calls", async () => {
    (globalThis as unknown as { crypto: undefined }).crypto = undefined;

    // Generate multiple IDs to verify consistency of fallback path
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const { backend } = fakeStorage();
      const id = await getOrCreateInstanceId(backend);
      expect(id).toMatch(/^[0-9a-f]{8}$/);
      ids.add(id);
    }

    // With random generation, we should get mostly unique IDs
    // (allowing for some collision possibility with Math.random)
    expect(ids.size).toBeGreaterThan(5);
  });

  it("fallback produces same length IDs as crypto path", async () => {
    // Test with crypto available
    const { backend: backend1, store: store1 } = fakeStorage();
    const idWithCrypto = await getOrCreateInstanceId(backend1);

    // Test with crypto unavailable (fallback to Math.random)
    (globalThis as unknown as { crypto: undefined }).crypto = undefined;
    const { backend: backend2, store: store2 } = fakeStorage();
    const idWithFallback = await getOrCreateInstanceId(backend2);

    // Both should produce 8-char hex strings
    expect(idWithCrypto.length).toBe(8);
    expect(idWithFallback.length).toBe(8);
    expect(idWithCrypto).toMatch(/^[0-9a-f]{8}$/);
    expect(idWithFallback).toMatch(/^[0-9a-f]{8}$/);
  });

  it("fallback ID can be used by generateDefaultLabel", async () => {
    (globalThis as unknown as { crypto: undefined }).crypto = undefined;

    const { backend } = fakeStorage();
    const id = await getOrCreateInstanceId(backend);

    // The generated ID should work correctly with generateDefaultLabel
    const label = generateDefaultLabel(id, "Chrome");
    expect(label).toMatch(/^Chrome#[0-9a-f]{4}$/); // no space before #

    // Verify the short ID in label matches first 4 chars of instance ID
    const shortId = id.slice(0, 4);
    expect(label).toBe(`Chrome#${shortId}`);
  });
});

describe("defaultStorage", () => {
  /** Create a mock chrome.storage.local with controllable behavior */
  function createMockStorage(options: {
    store?: Record<string, unknown>;
    getError?: string | null;
    setError?: string | null;
    throwOnGet?: Error;
    throwOnSet?: Error;
  }) {
    const store = { ...(options.store ?? {}) };
    return {
      store,
      storage: {
        local: {
          get: options.throwOnGet
            ? vi.fn(() => {
                throw options.throwOnGet;
              })
            : vi.fn((keys: string | string[], callback: (items: Record<string, unknown>) => void) => {
              // Simulate chrome behavior: set lastError before calling callback
              if (options.getError) {
                (globalThis as unknown as { chrome: { runtime: { lastError: string } } }).chrome.runtime.lastError = { message: options.getError } as unknown as string;
              }
              const result: Record<string, unknown> = {};
              const list = Array.isArray(keys) ? keys : [keys];
              for (const k of list) if (k in store) result[k] = store[k];
              callback(result);
            }),
          set: options.throwOnSet
            ? vi.fn(() => {
                throw options.throwOnSet;
              })
            : vi.fn((items: Record<string, unknown>, callback?: () => void) => {
              // Simulate chrome behavior: set lastError before calling callback
              if (options.setError) {
                (globalThis as unknown as { chrome: { runtime: { lastError: string } } }).chrome.runtime.lastError = { message: options.setError } as unknown as string;
              }
              Object.assign(store, items);
              callback?.();
            }),
        },
      },
      runtime: {
        lastError: options.getError ?? options.setError ?? null,
      },
    };
  }

  let originalChrome: typeof chrome;

  beforeEach(() => {
    originalChrome = globalThis.chrome as unknown as typeof chrome;
  });

  afterEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it("returns a StorageBackend with get and set methods", () => {
    const mockChrome = createMockStorage({});
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();
    expect(storage).toHaveProperty("get");
    expect(storage).toHaveProperty("set");
    expect(typeof storage.get).toBe("function");
    expect(typeof storage.set).toBe("function");
  });

  it("get() resolves with stored values from chrome.storage.local", async () => {
    const mockData = { key1: "value1", key2: 42 };
    const mockChrome = createMockStorage({ store: mockData });
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();
    const result = await storage.get(["key1", "key2"]);

    expect(result).toEqual(mockData);
    expect(mockChrome.storage.local.get).toHaveBeenCalledWith(["key1", "key2"], expect.any(Function));
  });

  it("get() resolves with empty object when key does not exist in storage", async () => {
    const mockChrome = createMockStorage({});
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();
    const result = await storage.get("nonexistent");

    expect(result).toEqual({});
  });

  it("get() rejects when chrome.runtime.lastError is set", async () => {
    const mockChrome = createMockStorage({ getError: "Permission denied" });
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();

    await expect(storage.get("key")).rejects.toThrow("Permission denied");
  });

  it("get() rejects with wrapped error when chrome.storage throws", async () => {
    const mockChrome = createMockStorage({ throwOnGet: new Error("storage unavailable") });
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();

    await expect(storage.get("key")).rejects.toThrow("storage unavailable");
  });

  it("set() calls chrome.storage.local.set and resolves on success", async () => {
    const mockChrome = createMockStorage({});
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();
    await storage.set({ newKey: "newValue" });

    expect(mockChrome.storage.local.set).toHaveBeenCalledWith(
      { newKey: "newValue" },
      expect.any(Function),
    );
    expect(mockChrome.store.newKey).toBe("newValue");
  });

  it("set() persists multiple items at once", async () => {
    const mockChrome = createMockStorage({});
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();
    await storage.set({ key1: "val1", key2: "val2" });

    expect(mockChrome.store.key1).toBe("val1");
    expect(mockChrome.store.key2).toBe("val2");
  });

  it("set() rejects when chrome.runtime.lastError is set", async () => {
    const mockChrome = createMockStorage({ setError: "Quota exceeded" });
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();

    await expect(storage.set({ key: "value" })).rejects.toThrow("Quota exceeded");
  });

  it("set() rejects with wrapped error when chrome.storage throws", async () => {
    const mockChrome = createMockStorage({ throwOnSet: new Error("storage crashed") });
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();

    await expect(storage.set({ key: "value" })).rejects.toThrow("storage crashed");
  });

  it("wraps non-Error thrown values into Error objects for get()", async () => {
    const mockChrome = createMockStorage({ throwOnGet: "string error" });
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();

    await expect(storage.get("key")).rejects.toThrow(Error);
    try {
      await storage.get("key");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("string error");
    }
  });

  it("wraps non-Error thrown values into Error objects for set()", async () => {
    const mockChrome = createMockStorage({ throwOnSet: 42 });
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();

    await expect(storage.set({ key: "value" })).rejects.toThrow(Error);
    try {
      await storage.set({ key: "value" });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("42");
    }
  });

  it("handles single string key in get()", async () => {
    const mockChrome = createMockStorage({ store: { myKey: "myValue" } });
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();
    const result = await storage.get("myKey");

    expect(result).toEqual({ myKey: "myValue" });
    expect(mockChrome.storage.local.get).toHaveBeenCalledWith("myKey", expect.any(Function));
  });

  it("handles array of keys in get()", async () => {
    const mockChrome = createMockStorage({ store: { a: 1, b: 2, c: 3 } });
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    const storage = defaultStorage();
    const result = await storage.get(["a", "b"]);

    expect(result).toEqual({ a: 1, b: 2 });
    expect(mockChrome.storage.local.get).toHaveBeenCalledWith(["a", "b"], expect.any(Function));
  });
});
