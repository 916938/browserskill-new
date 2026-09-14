import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readRemoteConnection } from "@/transport/remote-storage";
import { watchDaemonConnection } from "../daemon-connection-preference";

vi.mock("@/transport/remote-storage", () => ({
  initializeRemoteStorage: async () => {},
  readRemoteConnection: vi.fn(),
  REMOTE_CONNECTION_REVISION: "revision",
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
  await watch.ready;
  expect(callback).not.toHaveBeenCalled();
});
it("corrupt remote storage fails closed instead of selecting localhost", async () => {
  vi.mocked(readRemoteConnection).mockRejectedValue(new Error("invalid storage"));
  const callback = vi.fn();
  const watch = watchDaemonConnection(callback);
  await expect(watch.ready).rejects.toThrow("invalid storage");
  expect(callback).not.toHaveBeenCalled();
  watch.dispose();
});
