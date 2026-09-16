// @vitest-environment node
// Opt in with BSK_CLICK_CHROME; each test owns its browser, profile and HTTP server.
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { SessionManager } from "@/session-manager/manager";
import { handleClick, handlePress } from "../interaction";
import type { CdpRunner } from "../shared";
import { handleWheel } from "../wheel";

type Send = <T = Record<string, unknown>>(
  method: string,
  params?: object,
  sessionId?: string,
) => Promise<T>;

describe.skipIf(!process.env.BSK_CLICK_CHROME)("real browser click readiness", () => {
  it("delivers hidden native input, rejects disabled controls and restores visibility", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><button id="target">Click</button><a id="link" href="/next">Next</a>
        <form><button id="submit">Save</button></form><div style="height:5000px"></div>
        <script>window.keys=[];window.wheels=[];window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();submits++};document.addEventListener('keydown',e=>keys.push(e.isTrusted));document.addEventListener('wheel',e=>wheels.push(e.isTrusted),{passive:true});window.clicks=[];document.querySelector('#target').onclick=e=>clicks.push(e.isTrusted);</script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const { withChrome } = await import(
        new URL(
          "../../../../../evals/browser/cases/regression/snapshot-coordinates/chrome.mjs",
          import.meta.url,
        ).href
      );
      await withChrome(
        { executable: process.env.BSK_CLICK_CHROME, deviceScale: 1.5, zoom: 1 },
        async (send: Send) => {
          const page = async (background: boolean) => {
            const { targetId } = await send<{ targetId: string }>("Target.createTarget", {
              url,
              background,
            });
            const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", {
              targetId,
              flatten: true,
            });
            await send("Page.enable", {}, sessionId);
            const evaluate = async <T>(expression: string) => {
              const reply = await send<{ result: { value: T }; exceptionDetails?: unknown }>(
                "Runtime.evaluate",
                { expression, returnByValue: true },
                sessionId,
              );
              expect(reply.exceptionDetails).toBeUndefined();
              return reply.result.value;
            };
            for (let i = 0; i < 100; i++) {
              if (await evaluate("Array.isArray(window.clicks)")) break;
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            expect(await evaluate("Array.isArray(window.clicks)")).toBe(true);
            return { targetId, sessionId, evaluate };
          };
          const foreground = await page(false);
          const manager = new SessionManager({
            agentWindow: {
              create: async () => 100,
              remove: async () => {},
              ensureActiveTab: async () => 4,
            },
          });
          const ctx = await manager.start("click-test");
          for (const mode of [
            "selector",
            "ref",
            "selector",
            "ref",
            "navigation",
            "press",
            "wheel",
            "wheel-scrolled",
            "foreground",
            "disabled-native",
            "disabled-fieldset",
            "disabled-aria",
          ] as const) {
            const hidden = mode !== "foreground";
            const target = await page(hidden);
            expect(await target.evaluate("document.visibilityState")).toBe(
              hidden ? "hidden" : "visible",
            );
            const commands: { method: string; params?: object }[] = [];
            const cdp: CdpRunner = {
              send: async (_tabId, method, params) => {
                commands.push({ method, params });
                return (await send(method, params, target.sessionId)) as never;
              },
              getAttachmentId: () => target.sessionId,
            };
            const tab = { id: 4, windowId: 100, active: !hidden } as chrome.tabs.Tab;
            const tabsApi = { get: async () => tab, query: async () => [tab] };
            let action: { ref?: string; selector?: string } = {
              selector: mode === "navigation" ? "#link" : "#target",
            };
            if (mode === "ref") {
              const { root } = await send<{ root: { nodeId: number } }>(
                "DOM.getDocument",
                {},
                target.sessionId,
              );
              const { nodeId } = await send<{ nodeId: number }>(
                "DOM.querySelector",
                { nodeId: root.nodeId, selector: "#target" },
                target.sessionId,
              );
              const { node } = await send<{ node: { backendNodeId: number } }>(
                "DOM.describeNode",
                { nodeId },
                target.sessionId,
              );
              ctx.refStore.set("e1", node.backendNodeId, { tabId: 4 });
              action = { ref: "e1" };
            }
            if (mode === "wheel-scrolled") await target.evaluate("scrollTo(0,1000)");
            if (mode === "disabled-native")
              await target.evaluate("document.querySelector('#target').disabled = true");
            if (mode === "disabled-fieldset")
              await target.evaluate(
                "(() => { const group = document.createElement('fieldset'); group.disabled = true; document.body.prepend(group); group.append(document.querySelector('#target')); })()",
              );
            if (mode === "disabled-aria")
              await target.evaluate(
                "document.querySelector('#target').setAttribute('aria-disabled','true')",
              );
            const result =
              mode === "press"
                ? await handlePress(
                    manager,
                    { session_id: ctx.sessionId, tab_id: 4, selector: "#submit", key: "Enter" },
                    { cdp, tabsApi },
                  )
                : mode === "wheel" || mode === "wheel-scrolled"
                  ? await handleWheel(
                      manager,
                      { session_id: ctx.sessionId, tab_id: 4, delta_y: 300 },
                      { cdp, tabsApi },
                    )
                  : await handleClick(
                      manager,
                      { session_id: ctx.sessionId, tab_id: 4, ...action },
                      { cdp, tabsApi },
                    );
            if (mode.startsWith("disabled-"))
              expect(result).toMatchObject({
                code: "invalid_params",
                data: { reason: "target_disabled" },
              });
            else expect(result, JSON.stringify(result)).not.toHaveProperty("message");
            if (mode === "navigation") {
              for (let i = 0; i < 100; i++) {
                if (
                  await target.evaluate(
                    "location.pathname === '/next' && document.readyState === 'complete'",
                  )
                )
                  break;
                await new Promise((resolve) => setTimeout(resolve, 20));
              }
              expect(await target.evaluate("location.pathname")).toBe("/next");
            } else if (mode === "press") {
              expect(await target.evaluate("window.submits")).toBe(1);
              expect(await target.evaluate("window.keys")).toEqual([true]);
            } else if (mode === "wheel" || mode === "wheel-scrolled") {
              const startY = mode === "wheel-scrolled" ? 1000 : 0;
              for (
                let i = 0;
                i < 100 && !(await target.evaluate<boolean>("scrollY > " + startY));
                i++
              )
                await new Promise((resolve) => setTimeout(resolve, 20));
              expect(await target.evaluate<number>("scrollY")).toBeGreaterThan(startY);
              expect(await target.evaluate("window.wheels")).toEqual([true]);
            } else
              expect(await target.evaluate("window.clicks")).toEqual(
                mode.startsWith("disabled-") ? [] : [true],
              );
            expect(await target.evaluate("document.visibilityState")).toBe(
              hidden ? "hidden" : "visible",
            );
            if (hidden)
              expect(await foreground.evaluate("document.visibilityState")).toBe("visible");
            else
              expect(commands.some((c) => c.method === "Emulation.setFocusEmulationEnabled")).toBe(
                false,
              );
            console.log(
              "CLICK-READINESS",
              JSON.stringify({
                mode,
                result,
                visibility: await target.evaluate("document.visibilityState"),
              }),
            );
            await send("Target.closeTarget", { targetId: target.targetId });
          }
        },
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 90_000);
});
