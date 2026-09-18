import { defaultStorage, type StorageBackend } from "./instance-id";

export const PROFILE_ACCOUNT_SHARING_KEY = "bsk_profile_account_sharing";

interface ProfileUserInfo {
  id?: string;
}

interface IdentityApi {
  getProfileUserInfo?: () => Promise<ProfileUserInfo>;
}

/**
 * Opt-in flag for reporting the signed-in browser profile's account id.
 *
 * Off by default: while it is off the extension never touches
 * `chrome.identity` and never sends an account id to the daemon.
 */
export async function getProfileAccountSharing(
  storage: StorageBackend = defaultStorage(),
): Promise<boolean> {
  const items = await storage.get(PROFILE_ACCOUNT_SHARING_KEY);
  return items[PROFILE_ACCOUNT_SHARING_KEY] === true;
}

export async function setProfileAccountSharing(
  enabled: boolean,
  storage: StorageBackend = defaultStorage(),
): Promise<void> {
  await storage.set({ [PROFILE_ACCOUNT_SHARING_KEY]: enabled });
}

/**
 * Obfuscated account id of the signed-in browser profile, or `""`.
 *
 * Only the opaque id is returned — never an email and never any other
 * credential. Returns `""` when the user has not opted in, when the
 * `identity` API is unavailable, or when the profile is not signed in.
 */
export async function getProfileAccountId(
  storage: StorageBackend = defaultStorage(),
): Promise<string> {
  // A missing or unreadable preference must disable sharing, never fail the handshake.
  const sharing = await getProfileAccountSharing(storage).catch(() => false);
  if (!sharing) return "";
  const info = await readProfileUserInfo();
  return typeof info?.id === "string" && info.id.length > 0 ? info.id : "";
}

async function readProfileUserInfo(): Promise<ProfileUserInfo | null> {
  if (typeof chrome === "undefined") return null;
  const identity = (chrome as unknown as { identity?: IdentityApi }).identity;
  if (!identity?.getProfileUserInfo) return null;
  try {
    return (await identity.getProfileUserInfo()) ?? null;
  } catch {
    return null;
  }
}
