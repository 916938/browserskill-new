import type { SessionContext } from "@/session-manager/manager";
import type { RpcError } from "@/transport/types";
import { type CdpRunner, isRpcError } from "./shared";
import { isAbortError } from "./vom/capture-abort";

export interface InputReadinessDeps {
  cdp: CdpRunner;
  signal?: AbortSignal;
}
function abortError(signal?: AbortSignal): RpcError | null {
  return signal?.aborted
    ? { code: "cancelled", message: "input aborted", data: { effect_state: "none" } }
    : null;
}

/** CDP commands cannot be cancelled; consume late replies without delaying cleanup. */
function waitForInputReply<T>(
  pending: Promise<T>,
  signal?: AbortSignal,
  timeout = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(new DOMException("input aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Renderer did not become ready for input"));
    }, timeout);
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    pending.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** A surface read forces a compositor frame; rAF alone can remain suspended in a hidden window.
 * Discard the low-quality image. No file, tab activation, device metrics or viewport changes. */
export async function flushInputRendering(
  cdp: CdpRunner,
  tabId: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("input aborted", "AbortError");
  // Read the viewport surface without a document-space clip, which can become
  // stale if a previously requested scroll has not yet reached the compositor.
  const shot = await waitForInputReply(
    cdp.send<{ data?: string }>(tabId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 0,
      fromSurface: true,
      captureBeyondViewport: false,
    }),
    signal,
  );
  if (!shot.data) throw new Error("Renderer did not produce an input readiness frame");
}

/** After waking, wait for wheel scrolling to reach the renderer before hiding it again. */
export async function waitForInputPaint(
  cdp: CdpRunner,
  tabId: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("input aborted", "AbortError");
  const reply = await waitForInputReply(
    cdp.send<{ result?: { value?: boolean } }>(tabId, "Runtime.evaluate", {
      expression: `new Promise(resolve => {
        let frame;
        const timer = setTimeout(() => { cancelAnimationFrame(frame); resolve(false); }, 4000);
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
          clearTimeout(timer); resolve(true);
        }); });
      })`,
      awaitPromise: true,
      returnByValue: true,
    }),
    signal,
  );
  if (reply.result?.value !== true) throw new Error("Renderer did not finish painting input");
}

/** Prepare hidden native input without activating the tab or retrying the action. */
export async function withInputReady<T extends object>(
  ctx: SessionContext,
  tabId: number,
  deps: InputReadinessDeps,
  action: (hidden: boolean) => Promise<T | RpcError>,
): Promise<T | RpcError> {
  const aborted = abortError(deps.signal);
  if (aborted) return aborted;
  const documentRevision = ctx.refStore.documentRevision(tabId);
  let restoreFocus = false;
  let attachmentId: string | undefined;
  let actionStarted = false;
  let result: T | RpcError;
  let cleanupError: string | undefined;
  try {
    deps.cdp.trackSessionTab?.(ctx.sessionId, tabId);
    const visibility = await waitForInputReply(
      deps.cdp.send<{ result: { value?: string } }>(tabId, "Runtime.evaluate", {
        expression: "document.visibilityState",
        returnByValue: true,
      }),
      deps.signal,
    );
    const cancelled = abortError(deps.signal);
    if (cancelled) return cancelled;
    if (visibility.result.value === "hidden") {
      attachmentId = deps.cdp.getAttachmentId?.(tabId);
      // Mark ownership before awaiting: a failed reply may still have enabled it.
      restoreFocus = true;
      await waitForInputReply(
        deps.cdp.send(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }),
        deps.signal,
      );
      if (deps.signal?.aborted) throw new DOMException("input aborted", "AbortError");
      await flushInputRendering(deps.cdp, tabId, deps.signal);
    } else if (visibility.result.value !== "visible") {
      throw new Error("Could not determine input target visibility");
    }
    const cancelledAfterEnable = abortError(deps.signal);
    if (cancelledAfterEnable) result = cancelledAfterEnable;
    else {
      if (ctx.refStore.documentRevision(tabId) !== documentRevision) {
        result = {
          code: "not_found",
          message: "Document changed while preparing input; observe again",
          data: { reason: "ref_not_found", effect_state: "none" },
        };
      } else {
        actionStarted = true;
        // Recompute geometry after waking: the background viewport may have changed.
        result = await action(restoreFocus);
      }
    }
  } catch (error) {
    result = {
      code:
        deps.signal?.aborted || isAbortError(error)
          ? "cancelled"
          : error instanceof Error && error.name === "TimeoutError"
            ? "timeout"
            : "cdp_failed",
      message: error instanceof Error ? error.message : String(error),
      data: {
        effect_state: actionStarted ? "unknown" : "none",
        reason: actionStarted ? "input_outcome_unknown" : "input_not_ready",
      },
    };
  } finally {
    // Detaching clears the override. Do not reattach a closed/replaced target to clean up.
    if (
      restoreFocus &&
      (attachmentId === undefined || deps.cdp.getAttachmentId?.(tabId) === attachmentId)
    ) {
      try {
        await waitForInputReply(
          deps.cdp.send(tabId, "Emulation.setFocusEmulationEnabled", { enabled: false }),
          undefined,
          1000,
        );
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (cleanupError) {
    if (!isRpcError(result))
      result = {
        code: "cdp_failed",
        message: "Input completed but temporary focus emulation could not be disabled",
        data: { reason: "input_cleanup_failed", effect_state: "unknown" },
      };
    return { ...result, data: { ...result.data, cleanup_error: cleanupError } };
  }
  return result;
}
