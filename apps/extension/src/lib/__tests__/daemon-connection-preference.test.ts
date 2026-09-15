import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readRemoteConnection } from "@/transport/remote-storage";
import { watchDaemonConnection } from "../daemon-connection-preference";

vi.mock("@/transport/remote-storage", () => ({
  initializeRemoteStorage: async () => {},
  readRemoteConnection: vi.fn(),
  REMOTE_CONNECTION_REVISION: "revision",
  REMOTE_CONNECTION_MODE: "mode",
}));
let changed: (values: unknown, area: string) => void;
beforeEach(() => {
  vi.mocked(readRemoteConnection).mockReset();
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: async () => ({ bsk_daemon_port: 1234 }) },
      onChanged: {
        addListener: (fn: typeof changed) => {
          changed = fn;
        },
        removeListener: vi.fn(),
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("a late startup read cannot overwrite newer credentials", async () => {
  let finish!: (value: null) => void;
  vi.mocked(readRemoteConnection).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const callback = vi.fn();
  const watch = watchDaemonConnection(callback);
  await vi.waitFor(() => expect(readRemoteConnection).toHaveBeenCalledOnce());
  const remote = { url: "wss://example.com/bsk", token: "a".repeat(43) };
  vi.mocked(readRemoteConnection).mockResolvedValueOnce(remote);
  changed({ revision: {} }, "local");
  await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(remote.url, remote));
  finish(null);
  await watch.ready;
  expect(callback).toHaveBeenCalledTimes(1);
  watch.dispose();
});
it("disposal prevents pending reads from configuring a connection", async () => {
  vi.mocked(readRemoteConnection).mockResolvedValue(null);
  const callback = vi.fn();
  const watch = watchDaemonConnection(callback);
  watch.dispose();
  await Promise.resolve();
  expect(callback).not.toHaveBeenCalled();
});
it("corrupt remote storage fails closed instead of selecting localhost", async () => {
  vi.mocked(readRemoteConnection).mockRejectedValue(new Error("invalid storage"));
  const callback = vi.fn();
  const error = vi.fn();
  const watch = watchDaemonConnection(callback, error);
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(callback).not.toHaveBeenCalled();
  watch.dispose();
});
it("an explicit local selection can recover startup after a failed remote read", async () => {
  vi.mocked(readRemoteConnection).mockRejectedValueOnce(new Error("invalid storage"));
  const callback = vi.fn();
  const error = vi.fn();
  const watch = watchDaemonConnection(callback, error);
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(callback).not.toHaveBeenCalled();
  vi.mocked(readRemoteConnection).mockResolvedValue(null);
  changed({ mode: {} }, "local");
  await watch.ready;
  expect(callback).toHaveBeenCalledWith("ws://127.0.0.1:1234", null);
  watch.dispose();
});
