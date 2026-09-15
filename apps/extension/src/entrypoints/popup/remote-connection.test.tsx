import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteEndpoint } from "@/transport/remote-endpoint";
import { readRemoteConnection } from "@/transport/remote-storage";
import { RemoteConnection } from "./remote-connection";

vi.mock("@/transport/remote-storage", () => ({
  REMOTE_CONNECTION_REVISION: "revision",
  REMOTE_CONNECTION_MODE: "mode",
  readRemoteConnection: vi.fn(),
}));
const endpoint: RemoteEndpoint = {
  url: "wss://browser.example/extension",
  token: "a".repeat(43),
  deviceId: "b".repeat(32),
  expiresAt: "2099-01-01T00:00:00Z",
  renewAfter: "2098-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.mocked(readRemoteConnection).mockReset().mockResolvedValue(null);
  vi.stubGlobal("chrome", {
    storage: { local: {}, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    runtime: { sendMessage: vi.fn(async () => ({ url: null })) },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows an expired grant and asks for a new pairing without deleting it", async () => {
  vi.mocked(readRemoteConnection).mockResolvedValue({
    ...endpoint,
    expiresAt: "2020-01-01T00:00:00Z",
  });
  render(<RemoteConnection />);
  expect(await screen.findByText("授权已过期，请使用新的配对链接重新连接。")).toBeTruthy();
  expect(screen.getByText(/授权到期时间：/)).toBeTruthy();
  expect(screen.getByText("需要关注")).toBeTruthy();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

it("distinguishes a failed renewal from an expired grant", async () => {
  vi.mocked(readRemoteConnection).mockResolvedValue({
    ...endpoint,
    pendingToken: "c".repeat(43),
    renewalFailure: "unavailable",
  });
  render(<RemoteConnection />);
  expect(await screen.findByText(/续期暂未成功/)).toBeTruthy();
  expect(screen.queryByText(/授权已过期/)).toBeNull();
  expect(document.body.textContent).not.toContain(endpoint.token);
});

it("does not declare an unconfirmed rotation invalid based on its old local expiry", async () => {
  vi.mocked(readRemoteConnection).mockResolvedValue({
    ...endpoint,
    expiresAt: "2020-01-01T00:00:00Z",
    pendingToken: "c".repeat(43),
  });
  render(<RemoteConnection />);
  expect(await screen.findByText(/此前续期可能已成功/)).toBeTruthy();
  expect(screen.queryByText("授权已过期，请使用新的配对链接重新连接。")).toBeNull();
});

it("offers explicit local recovery when remote storage cannot be read", async () => {
  vi.mocked(readRemoteConnection).mockRejectedValue(new Error("storage unavailable"));
  const changed = vi.fn();
  render(<RemoteConnection onRemoteChange={changed} />);
  expect((await screen.findByRole("alert")).textContent).toContain("无法读取连接设置");
  expect(changed).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "使用本机服务", hidden: true }));
  await waitFor(() =>
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      kind: "bsk-remote-authorization",
      pairing: null,
    }),
  );
  expect(changed).toHaveBeenLastCalledWith(false);
});
