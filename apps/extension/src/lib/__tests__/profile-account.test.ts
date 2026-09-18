import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProfileAccountId,
  getProfileAccountSharing,
  PROFILE_ACCOUNT_SHARING_KEY,
  setProfileAccountSharing,
} from "../profile-account";

interface Store {
  [key: string]: unknown;
}

function fakeStorage(initial: Store = {}) {
  const store: Store = { ...initial };
  return {
    store,
    get: (keys: string | string[]) =>
      Promise.resolve(
        (Array.isArray(keys) ? keys : [keys]).reduce<Store>((acc, key) => {
          acc[key] = store[key];
          return acc;
        }, {}),
      ),
    set: (items: Store) => {
      Object.assign(store, items);
      return Promise.resolve();
    },
  };
}

function withIdentity(id: string | undefined, email = "user@example.com") {
  vi.stubGlobal("chrome", {
    identity: {
      getProfileUserInfo: () => Promise.resolve({ id, email }),
    },
  });
}

describe("profile-account", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to not sharing", async () => {
    expect(await getProfileAccountSharing(fakeStorage())).toBe(false);
  });

  it("persists the opt-in flag", async () => {
    const backend = fakeStorage();
    await setProfileAccountSharing(true, backend);
    expect(backend.store[PROFILE_ACCOUNT_SHARING_KEY]).toBe(true);
    expect(await getProfileAccountSharing(backend)).toBe(true);
  });

  it("returns an empty id while sharing is off", async () => {
    withIdentity("gaia-123");
    expect(await getProfileAccountId(fakeStorage())).toBe("");
  });

  it("returns only the obfuscated id once enabled", async () => {
    const backend = fakeStorage();
    await setProfileAccountSharing(true, backend);
    withIdentity("gaia-123");
    // The email is deliberately not read: only the opaque id is returned.
    expect(await getProfileAccountId(backend)).toBe("gaia-123");
  });

  it("returns an empty id when the profile is not signed in", async () => {
    const backend = fakeStorage();
    await setProfileAccountSharing(true, backend);
    withIdentity(undefined);
    expect(await getProfileAccountId(backend)).toBe("");
  });

  it("returns an empty id when the identity API is unavailable", async () => {
    const backend = fakeStorage();
    await setProfileAccountSharing(true, backend);
    vi.stubGlobal("chrome", {});
    expect(await getProfileAccountId(backend)).toBe("");
  });

  it("returns an empty id when the identity API throws", async () => {
    const backend = fakeStorage();
    await setProfileAccountSharing(true, backend);
    vi.stubGlobal("chrome", {
      identity: {
        getProfileUserInfo: () => Promise.reject(new Error("denied")),
      },
    });
    expect(await getProfileAccountId(backend)).toBe("");
  });
});
