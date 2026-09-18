import { useEffect, useState } from "react";
import {
  getProfileAccountSharing,
  PROFILE_ACCOUNT_SHARING_KEY,
  setProfileAccountSharing,
} from "@/lib/profile-account";

/**
 * Popup-side view of the "share this profile's account id" preference.
 *
 * Defaults to off: the id is only reported once the user opts in. Writes go
 * straight to `chrome.storage.local`; the background reconnects so the next
 * handshake carries (or drops) the value.
 */
export function useProfileAccountSharing(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return undefined;
    let cancelled = false;
    getProfileAccountSharing()
      .then((value) => {
        if (!cancelled) setEnabled(value);
      })
      .catch((err) => {
        console.debug("[browser-skill] profile-account preference read failed", err);
      });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      const change = changes[PROFILE_ACCOUNT_SHARING_KEY];
      if (change) setEnabled(change.newValue === true);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const update = (value: boolean) => {
    setEnabled(value);
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    setProfileAccountSharing(value).catch((err) => {
      console.debug("[browser-skill] profile-account preference write failed", err);
    });
  };

  return [enabled, update];
}
