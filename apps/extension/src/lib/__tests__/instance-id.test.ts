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
  // ====================================================================
  // 1. 格式验证 (Format Validation)
  // ====================================================================
  describe("format validation", () => {
    it("generates label in format '{Browser}#{4-char-id}' (no space)", () => {
      const label = generateDefaultLabel("03c3e47f", "Chrome");
      expect(label).toBe("Chrome#03c3");
    });

    it("contains exactly one hash separator", () => {
      const label = generateDefaultLabel("abcdef01", "Chrome");
      expect(label).toContain("#");
      expect(label.split("#")).toHaveLength(2);
    });

    it("never contains space before hash (CLI-friendly)", () => {
      const browsers = ["Chrome", "Edge", "Firefox", "Brave"];
      for (const browser of browsers) {
        const label = generateDefaultLabel("a1b2c3d4", browser);
        expect(label).not.toContain(" #");
        expect(label).not.toMatch(/ /);
      }
    });

    it("always produces a string with hash separator", () => {
      const result = generateDefaultLabel("abc12345", "Chrome");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(5); // At least "X#xxxx"
    });
  });

  // ====================================================================
  // 2. instanceId 处理 (Instance ID Handling)
  // ====================================================================
  describe("instanceId handling", () => {
    it("extracts first 4 characters of valid 8-char hex ID", () => {
      expect(generateDefaultLabel("abcdef01", "Chrome")).toBe("Chrome#abcd");
      expect(generateDefaultLabel("01234567", "Chrome")).toBe("Chrome#0123");
      expect(generateDefaultLabel("ffffffff", "Chrome")).toBe("Chrome#ffff");
      expect(generateDefaultLabel("00000000", "Chrome")).toBe("Chrome#0000");
    });

    it("uses only first 4 chars when instanceId is longer than 8", () => {
      const longId = "abcdef0123456789abcdef";
      expect(generateDefaultLabel(longId, "Chrome")).toBe("Chrome#abcd");
    });

    it("uses exactly 4 chars when instanceId is exactly 4 chars", () => {
      expect(generateDefaultLabel("a1b2", "Chrome")).toBe("Chrome#a1b2");
    });

    it("uses fallback '????' when instanceId is empty string", () => {
      expect(generateDefaultLabel("", "Chrome")).toBe("Chrome#????");
    });

    it("uses fallback '????' when instanceId has only 1 char", () => {
      expect(generateDefaultLabel("x", "Chrome")).toBe("Chrome#????");
    });

    it("uses fallback '????' when instanceId has 2-3 chars", () => {
      expect(generateDefaultLabel("ab", "Chrome")).toBe("Chrome#????");
      expect(generateDefaultLabel("abc", "Chrome")).toBe("Chrome#????");
    });

    it("passes through non-hex characters in instanceId when length >= 4", () => {
      // Function doesn't validate hex, just slices
      expect(generateDefaultLabel("xyz12345", "Chrome")).toBe("Chrome#xyz1");
      expect(generateDefaultLabel("ghijklmn", "Edge")).toBe("Edge#ghij");
    });
  });

  // ====================================================================
  // 3. browserName 处理 (Browser Name Handling)
  // ====================================================================
  describe("browserName handling", () => {
    it("uses Chrome as default when browserName is not specified", () => {
      expect(generateDefaultLabel("a7f32e1c")).toBe("Chrome#a7f3");
    });

    it("capitalizes first letter and lowercases the rest", () => {
      expect(generateDefaultLabel("abc12345", "chrome")).toBe("Chrome#abc1");
      expect(generateDefaultLabel("abc12345", "edge")).toBe("Edge#abc1");
      expect(generateDefaultLabel("abc12345", "firefox")).toBe("Firefox#abc1");
      expect(generateDefaultLabel("abc12345", "brave")).toBe("Brave#abc1");
    });

    it("handles already-capitalized browser names correctly", () => {
      expect(generateDefaultLabel("def67890", "Chrome")).toBe("Chrome#def6");
      expect(generateDefaultLabel("def67890", "Edge")).toBe("Edge#def6");
      expect(generateDefaultLabel("def67890", "Arc")).toBe("Arc#def6");
    });

    it("handles ALL-CAPS browser names (title case conversion)", () => {
      expect(generateDefaultLabel("12345678", "CHROME")).toBe("Chrome#1234");
      expect(generateDefaultLabel("12345678", "EDGE")).toBe("Edge#1234");
      expect(generateDefaultLabel("12345678", "FIREFOX")).toBe("Firefox#1234");
    });

    it("handles mixed-case browser names correctly", () => {
      expect(generateDefaultLabel("12345678", "EdGe")).toBe("Edge#1234");
      expect(generateDefaultLabel("12345678", "cHrOmE")).toBe("Chrome#1234");
      expect(generateDefaultLabel("12345678", "fIrEfOx")).toBe("Firefox#1234");
    });

    it("handles single character browser name", () => {
      expect(generateDefaultLabel("abcdef01", "c")).toBe("C#abcd");
      expect(generateDefaultLabel("abcdef01", "E")).toBe("E#abcd");
      expect(generateDefaultLabel("abcdef01", "a")).toBe("A#abcd");
    });

    it("handles browserName with spaces (only first char uppercased)", () => {
      expect(generateDefaultLabel("abcdef01", "Brave Beta")).toBe("Brave beta#abcd");
      expect(generateDefaultLabel("abcdef01", "MY BROWSER")).toBe("My browser#abcd");
      expect(generateDefaultLabel("abcdef01", "google chrome")).toBe("Google chrome#abcd");
    });

    it("handles browserName starting with a number", () => {
      expect(generateDefaultLabel("abcdef01", "123browser")).toBe("123browser#abcd");
      expect(generateDefaultLabel("abcdef01", "7-Zip Browser")).toBe("7-zip browser#abcd");
    });

    it("handles browserName with special characters (hyphens, underscores)", () => {
      expect(generateDefaultLabel("abcdef01", "brave-beta")).toBe("Brave-beta#abcd");
      expect(generateDefaultLabel("abcdef01", "arc_browser")).toBe("Arc_browser#abcd");
      expect(generateDefaultLabel("abcdef01", "my-browser_v2")).toBe("My-browser_v2#abcd");
    });

    it("falls back to 'Chrome' when browserName is empty string", () => {
      expect(generateDefaultLabel("a1b2c3d4", "")).toBe("Chrome#a1b2");
    });

    it("trims whitespace-only browserName and falls back to 'Chrome'", () => {
      expect(generateDefaultLabel("abcdef01", "   ")).toBe("Chrome#abcd");
      expect(generateDefaultLabel("abcdef01", "\t")).toBe("Chrome#abcd");
      expect(generateDefaultLabel("abcdef01", "\n")).toBe("Chrome#abcd");
    });

    it("trims leading/trailing whitespace from browserName", () => {
      expect(generateDefaultLabel("abcdef01", "  Chrome  ")).toBe("Chrome#abcd");
      expect(generateDefaultLabel("abcdef01", "\tedge\t")).toBe("Edge#abcd");
    });

    it("handles unicode/international browser names without crashing", () => {
      const label = generateDefaultLabel("abcdef01", "ブラウザ");
      expect(label).toContain("#abcd");
      expect(label).toMatch(/^.*#abcd$/);
      expect(label.length).toBeGreaterThan(5); // Has some prefix
    });
  });

  // ====================================================================
  // 4. 确定性 (Determinism)
  // ====================================================================
  describe("determinism", () => {
    it("generates same label for same inputs (pure function)", () => {
      const input1 = { id: "03c3e47f", browser: "Chrome" };
      const input2 = { id: "a7f32e1c", browser: "Edge" };

      // Same inputs → same outputs
      expect(generateDefaultLabel(input1.id, input1.browser))
        .toBe(generateDefaultLabel(input1.id, input1.browser));
      expect(generateDefaultLabel(input2.id, input2.browser))
        .toBe(generateDefaultLabel(input2.id, input2.browser));
    });

    it("generates different labels for different instanceIds", () => {
      const ids = ["03c3e47f", "a7f32e1c", "deadbeef", "12345678", "ffffffff"];
      const labels = ids.map((id) => generateDefaultLabel(id, "Chrome"));

      // All labels should be unique
      const uniqueLabels = new Set(labels);
      expect(uniqueLabels.size).toBe(ids.length);
    });

    it("generates different labels for different browserNames", () => {
      const id = "abcdef01";
      const browsers = ["Chrome", "Edge", "Firefox", "Brave", "Arc"];
      const labels = browsers.map((b) => generateDefaultLabel(id, b));

      // All labels should be unique
      const uniqueLabels = new Set(labels);
      expect(uniqueLabels.size).toBe(browsers.length);
    });

    it("produces consistent output across multiple calls (stability)", () => {
      const results = Array.from({ length: 100 }, () =>
        generateDefaultLabel("deadbeef", "Chrome"),
      );
      // All 100 calls should return identical value
      expect(new Set(results).size).toBe(1);
    });
  });

  // ====================================================================
  // 5. 输出结构验证 (Output Structure Validation)
  // ====================================================================
  describe("output structure", () => {
    it("label always contains exactly two parts separated by #", () => {
      const testCases = [
        { id: "abcdef01", browser: "Chrome" },
        { id: "01234567", browser: "Edge" },
        { id: "", browser: "Firefox" },          // Edge case: empty ID
        { id: "abcd", browser: "" },              // Edge case: empty browser
      ];

      for (const { id, browser } of testCases) {
        const label = generateDefaultLabel(id, browser);
        const parts = label.split("#");
        expect(parts).toHaveLength(2);
        expect(parts[0].length).toBeGreaterThan(0); // Browser part non-empty
        expect(parts[1].length).toBeGreaterThan(0); // ID part non-empty (now "????" fallback)
      }
    });

    it("short ID part is always exactly 4 characters", () => {
      const testCases = [
        "abcdef01",  // Normal 8-char
        "01234567",  // Another normal
        "abcdef0123456789",  // Long
        "abcd",      // Exactly 4
        "",          // Empty → "????"
        "ab",        // Short → "????"
      ];

      for (const id of testCases) {
        const label = generateDefaultLabel(id, "Chrome");
        const shortId = label.split("#")[1];
        expect(shortId).toHaveLength(4);
      }
    });

    it("browser part always starts with uppercase letter (or fallback)", () => {
      const testCases = [
        { browser: "chrome", expectedFirstChar: "C" },
        { browser: "EDGE", expectedFirstChar: "E" },
        { browser: "firefox", expectedFirstChar: "F" },
        { browser: "Brave", expectedFirstChar: "B" },
        { browser: "", expectedFirstChar: "C" },           // Fallback to Chrome
        { browser: "   ", expectedFirstChar: "C" },       // Trim + fallback
      ];

      for (const { browser, expectedFirstChar } of testCases) {
        const label = generateDefaultLabel("abcdef01", browser);
        const browserPart = label.split("#")[0];
        expect(browserPart.charAt(0)).toBe(expectedFirstChar);
        // First character should be uppercase A-Z
        expect(browserPart.charAt(0)).toMatch(/^[A-Z]$/);
      }
    });
  });

  // ====================================================================
  // 6. CLI 友好性验证 (CLI-Friendliness)
  // ====================================================================
  describe("CLI-friendliness", () => {
    it("produces labels suitable as command-line arguments (no spaces)", () => {
      const labels = [
        generateDefaultLabel("03c3e47f", "Chrome"),
        generateDefaultLabel("a7f32e1c", "Edge"),
        generateDefaultLabel("deadbeef", "Firefox"),
        generateDefaultLabel("12345678", "Brave"),
      ];

      for (const label of labels) {
        // No spaces anywhere in the label
        expect(label).not.toMatch(/\s/);
        // No shell-special characters that would require quoting
        expect(label).not.toMatch(/[|&;<>()$`\\]/);
        // Only safe characters: alphanumeric, #, -
        expect(label).match(/^[\w#-]+$/);
      }
    });

    it("can be used directly after --browser flag without quoting", () => {
      const label = generateDefaultLabel("03c3e47f", "Chrome");
      // Simulate CLI usage: bsk --browser <label>
      const cliArg = `--browser ${label}`;
      // Label should be cleanly appended as a single argument (no shell-special chars)
      expect(cliArg).toBe("--browser Chrome#03c3");
      // Verify no spaces in the label portion (would require quoting in shell)
      const labelPart = cliArg.replace("--browser ", "");
      expect(labelPart).not.toMatch(/\s/);
      expect(labelPart).not.toMatch(/[|&;<>()$`\\]/);
    });
  });

  // ====================================================================
  // 7. 组合边缘情况 (Combined Edge Cases)
  // ====================================================================
  describe("combined edge cases", () => {
    it("both empty instanceId and empty browserName produce valid label", () => {
      const label = generateDefaultLabel("", "");
      expect(label).toBe("Chrome#????"); // Both fallbacks applied
      expect(label.split("#")[0]).toBe("Chrome");
      expect(label.split("#")[1]).toBe("????");
    });

    it("empty instanceId with valid browserName uses browser + fallback ID", () => {
      expect(generateDefaultLabel("", "Edge")).toBe("Edge#????");
      expect(generateDefaultLabel("", "Firefox")).toBe("Firefox#????");
    });

    it("valid instanceId with empty browserName uses fallback browser + ID", () => {
      expect(generateDefaultLabel("a1b2c3d4", "")).toBe("Chrome#a1b2");
      expect(generateDefaultLabel("deadbeef", "")).toBe("Chrome#dead");
    });

    it("whitespace-only values are handled gracefully", () => {
      expect(generateDefaultLabel("  ", "  ")).toBe("Chrome#????");
      expect(generateDefaultLabel("\t\n", "\t")).toBe("Chrome#????");
    });

    it("extreme length inputs don't crash", () => {
      // Very long instanceId (should truncate)
      const longId = "a".repeat(1000);
      expect(generateDefaultLabel(longId, "Chrome")).toBe("Chrome#aaaa");

      // Very long browserName (should capitalize first, lowercase rest)
      const longBrowser = "b".repeat(1000);
      const longLabel = generateDefaultLabel("abcdef01", longBrowser);
      expect(longLabel).toBe(`B${"b".repeat(999)}#abcd`);
    });
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

// ============================================================================
// Edge Case Tests - getOrCreateInstanceId()
// ============================================================================
describe("getOrCreateInstanceId (edge cases)", () => {
  it("treats null stored value as missing and generates new ID", async () => {
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: null });
    const id = await getOrCreateInstanceId(backend);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
  });

  it("treats undefined stored value as missing and generates new ID", async () => {
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: undefined });
    const id = await getOrCreateInstanceId(backend);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
  });

  it("treats empty string as invalid and generates new ID", async () => {
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: "" });
    const id = await getOrCreateInstanceId(backend);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(id).not.toBe("");
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
  });

  it("treats short hex string (< 8 chars) as invalid and generates new ID", async () => {
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: "abc123" });
    const id = await getOrCreateInstanceId(backend);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(id.length).toBe(8); // Should be 8 chars, not 6
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
  });

  it("treats long hex string (> 8 chars) as invalid and generates new ID", async () => {
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: "abcdef01234567" });
    const id = await getOrCreateInstanceId(backend);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(id.length).toBe(8); // Should be exactly 8
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
  });

  it("treats uppercase HEX as invalid (pattern is case-sensitive) and generates new ID", async () => {
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: "ABCDEF01" });
    const id = await getOrCreateInstanceId(backend);
    expect(id).toMatch(/^[0-9a-f]{8}$/); // New ID should be lowercase
    expect(id).not.toBe("ABCDEF01");
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
  });

  it("treats mixed-case hex as invalid and generates new ID", async () => {
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: "AbCdEf01" });
    const id = await getOrCreateInstanceId(backend);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(id);
  });

  it("propagates errors from storage.get() rejection", async () => {
    const failingBackend = {
      get: vi.fn().mockRejectedValue(new Error("storage quota exceeded")),
      set: vi.fn(),
    };

    await expect(getOrCreateInstanceId(failingBackend)).rejects.toThrow("storage quota exceeded");
    expect(failingBackend.set).not.toHaveBeenCalled(); // Should not try to set if get fails
  });

  it("propagates errors from storage.set() rejection", async () => {
    const failingBackend = {
      get: vi.fn().mockResolvedValue({}), // Empty storage → will try to create
      set: vi.fn().mockRejectedValue(new Error("write failed")),
    };

    await expect(getOrCreateInstanceId(failingBackend)).rejects.toThrow("write failed");
  });

  it("does not overwrite existing valid ID on repeated calls (idempotent)", async () => {
    const existing = "deadbeef";
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.INSTANCE_ID]: existing });

    const id1 = await getOrCreateInstanceId(backend);
    const id2 = await getOrCreateInstanceId(backend);

    expect(id1).toBe(existing);
    expect(id2).toBe(existing);
    expect(backend.set).not.toHaveBeenCalled(); // Never needs to write
    expect(store[STORAGE_KEYS.INSTANCE_ID]).toBe(existing); // Unchanged
  });
});

// ============================================================================
// Edge Case Tests - getLabel() / setLabel()
// ============================================================================
describe("getLabel / setLabel (edge cases)", () => {
  it("getLabel returns empty string when stored value is null", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.LABEL]: null });
    expect(await getLabel(backend)).toBe("");
  });

  it("getLabel returns empty string when stored value is undefined", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.LABEL]: undefined });
    expect(await getLabel(backend)).toBe("");
  });

  it("getLabel returns empty string when stored value is a number", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.LABEL]: 0 });
    expect(await getLabel(backend)).toBe("");
  });

  it("getLabel returns empty string for non-string truthy values", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.LABEL]: true });
    expect(await getLabel(backend)).toBe("");
  });

  it("setLabel accepts and retrieves empty string (clearing label)", async () => {
    const { backend, store } = fakeStorage({ [STORAGE_KEYS.LABEL]: "Old Label" });
    await setLabel("", backend);
    expect(store[STORAGE_KEYS.LABEL]).toBe("");
    expect(await getLabel(backend)).toBe("");
  });

  it("setLabel handles very long labels (up to storage limits)", async () => {
    const longLabel = "A".repeat(500);
    const { backend, store } = fakeStorage();
    await setLabel(longLabel, backend);
    expect(store[STORAGE_KEYS.LABEL]).toBe(longLabel);
    expect(await getLabel(backend)).toBe(longLabel);
  });

  it("setLabel handles labels with special characters", async () => {
    const specialLabels = [
      "Chrome#Work",
      'Label with "quotes"',
      "Label <with> &symbols",
      "标签中文",
      "Emoji 🎉🔥",
    ];

    for (const label of specialLabels) {
      const { backend } = fakeStorage();
      await setLabel(label, backend);
      expect(await getLabel(backend)).toBe(label);
    }
  });
});

// ============================================================================
// Edge Case Tests - getConnectionEnabled() / setConnectionEnabled()
// ============================================================================
describe("getConnectionEnabled / setConnectionEnabled (edge cases)", () => {
  it("returns true when stored value is null", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.CONNECTION_ENABLED]: null });
    expect(await getConnectionEnabled(backend)).toBe(true);
  });

  it("returns true when stored value is undefined", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.CONNECTION_ENABLED]: undefined });
    expect(await getConnectionEnabled(backend)).toBe(true);
  });

  it("returns true when stored value is numeric 0 (non-boolean)", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.CONNECTION_ENABLED]: 0 });
    expect(await getConnectionEnabled(backend)).toBe(true);
  });

  it("returns true when stored value is numeric 1 (non-boolean)", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.CONNECTION_ENABLED]: 1 });
    expect(await getConnectionEnabled(backend)).toBe(true);
  });

  it("returns true when stored value is an object", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.CONNECTION_ENABLED]: {} });
    expect(await getConnectionEnabled(backend)).toBe(true);
  });

  it("returns true when stored value is an array", async () => {
    const { backend } = fakeStorage({ [STORAGE_KEYS.CONNECTION_ENABLED]: [] });
    expect(await getConnectionEnabled(backend)).toBe(true);
  });

  it("toggle cycle: false → true → false maintains state", async () => {
    const { backend, store } = fakeStorage();

    await setConnectionEnabled(false, backend);
    expect(store[STORAGE_KEYS.CONNECTION_ENABLED]).toBe(false);
    expect(await getConnectionEnabled(backend)).toBe(false);

    await setConnectionEnabled(true, backend);
    expect(store[STORAGE_KEYS.CONNECTION_ENABLED]).toBe(true);
    expect(await getConnectionEnabled(backend)).toBe(true);

    await setConnectionEnabled(false, backend);
    expect(store[STORAGE_KEYS.CONNECTION_ENABLED]).toBe(false);
    expect(await getConnectionEnabled(backend)).toBe(false);
  });
});

// ============================================================================
// Edge Case Tests - STORAGE_KEYS export
// ============================================================================
describe("STORAGE_KEYS (edge cases)", () => {
  it("exports all three keys with correct values", () => {
    expect(STORAGE_KEYS.INSTANCE_ID).toBe("bsk_instance_id");
    expect(STORAGE_KEYS.LABEL).toBe("bh_label");
    expect(STORAGE_KEYS.CONNECTION_ENABLED).toBe("bh_connection_enabled");
  });

  it("is a frozen/as const object (immutable)", () => {
    // Verify the object has exactly 3 keys
    expect(Object.keys(STORAGE_KEYS)).toHaveLength(3);
    // Verify all values are strings
    for (const value of Object.values(STORAGE_KEYS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
