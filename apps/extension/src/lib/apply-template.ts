//! Template apply executor: writes template data (cookies, storage, UA)
//! into the current browser profile via chrome.cookies / chrome.storage APIs.
//!
//! This module runs in the extension background service worker context
//! and is called by the popup-bridge handler after the daemon returns
//! template data.

import type { CookieEntry, ProfileTemplate, TemplateScope } from "@/transport/types";

/** Result of applying a single category of template data. */
export interface ApplyCategoryResult {
  total: number;
  applied: number;
  failed: number;
  errors: string[];
}

/** Full result of applying a template. */
export interface ApplyTemplateResult {
  cookies: ApplyCategoryResult;
  storage: ApplyCategoryResult;
  userAgent: boolean; // true if UA was set (or attempted)
}

/**
 * Apply a template to the current browser profile.
 *
 * @param template - The full template data returned from daemon
 * @param scope - Which categories to apply ("all" applies everything)
 * @returns Detailed result with per-category success/failure counts
 */
export async function applyTemplate(
  template: ProfileTemplate,
  scope: TemplateScope = "all",
): Promise<ApplyTemplateResult> {
  const shouldCookies = scope === "all" || scope === "cookies";
  const shouldStorage = scope === "all" || scope === "storage";
  const shouldUA = scope === "all" || scope === "user_agent";

  const [cookies, storage, userAgent] = await Promise.all([
    shouldCookies ? applyCookies(template.cookies) : emptyCategory(),
    shouldStorage ? applyStorage(template.storage) : emptyCategory(),
    shouldUA ? applyUserAgent(template.user_agent) : Promise.resolve(false),
  ]);

  return { cookies, storage, userAgent };
}

// ── Cookie application ─────────────────────────────────

async function applyCookies(cookies: CookieEntry[]): Promise<ApplyCategoryResult> {
  if (!cookies || cookies.length === 0) {
    return { total: 0, applied: 0, failed: 0, errors: [] };
  }

  let applied = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process sequentially to avoid rate-limiting issues with cookies API
  for (const cookie of cookies) {
    try {
      await setCookie(cookie);
      applied++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`cookie "${cookie.name}"@${cookie.domain}: ${msg}`);
    }
  }

  return { total: cookies.length, applied, failed, errors };
}

/**
 * Set a single cookie via chrome.cookies API.
 * Constructs the URL from domain + path for the API requirement.
 */
function setCookie(cookie: CookieEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    // chrome.cookies.set requires a url parameter to determine the context.
    // We construct it from the cookie's domain.
    const scheme = cookie.secure !== false ? "https" : "http";
    // Strip leading dot from domain if present (chrome.cookies API handles this)
    const domain = cookie.domain?.replace(/^\./, "") ?? "";
    const path = cookie.path ?? "/";
    const url = `${scheme}://${domain}${path}`;

    chrome.cookies.set(
      {
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.http_only ?? false,
        // Don't set expiration explicitly — use session cookie behavior
        // so templates are convenient for "session restore" use cases.
        // Callers who want persistence can add expiration to CookieEntry later.
      },
      (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (result === null) {
          reject(new Error(`failed to set cookie "${cookie.name}" (null result)`));
        } else {
          resolve();
        }
      },
    );
  });
}

// ── Storage application ────────────────────────────────

async function applyStorage(
  storage: Record<string, { value: string }>,
): Promise<ApplyCategoryResult> {
  if (!storage || Object.keys(storage).length === 0) {
    return { total: 0, applied: 0, failed: 0, errors: [] };
  }

  const entries = Object.entries(storage);
  let applied = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    // Batch all storage entries into a single set() call
    const data: Record<string, string> = {};
    for (const [key, entry] of entries) {
      data[key] = entry.value;
    }

    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });

    applied = entries.length;
  } catch (err) {
    failed = entries.length;
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`storage: ${msg}`);
  }

  return { total: entries.length, applied, failed, errors };
}

// ── User-Agent application ────────────────────────────

/**
 * Apply User-Agent string.
 *
 * Note: In MV3 extensions, we cannot directly modify `navigator.userAgent`.
 * The UA value from the template is stored in chrome.storage.local under a
 * well-known key. A content script or declarativeNetRequest rule can then
 * read and apply it if needed.
 *
 * Returns `true` if the value was stored (even if it was null/empty).
 */
async function applyUserAgent(ua: string | undefined): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.set({ __bsk_template_user_agent: ua ?? "" }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
    return true;
  } catch {
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────

function emptyCategory(): Promise<ApplyCategoryResult> {
  return Promise.resolve({ total: 0, applied: 0, failed: 0, errors: [] });
}
