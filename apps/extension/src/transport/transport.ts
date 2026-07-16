import type { ConnectionState, ProtocolFrame, RequestFrame, ResponseFrame } from "./types";

export interface Disposable {
  dispose(): void;
}

export type FrameHandler = (msg: ProtocolFrame) => void;
export type ConnectionStateHandler = (state: ConnectionState) => void;

/**
 * Abstraction over a bidirectional protocol channel (§4.7).
 *
 * v1 ships a single {@link WSTransport} implementation. Forks that want a
 * different transport (e.g. native messaging, MessageChannel for embedding
 * in a host page) only have to implement this interface and swap the
 * concrete class in `entrypoints/background.ts`.
 */
export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(msg: ProtocolFrame): void;
  /**
   * Send a request frame and resolve with the matching response. Used by
   * the keepalive heartbeat to exchange `system.ping`/`pong`, which resets
   * the MV3 service-worker idle timer so the daemon link survives past the
   * ~30s eviction window (see docs/mv3-keepalive-fix-design.md).
   *
   * Optional: transports that cannot correlate requests/responses may omit
   * it, in which case keepalive falls back to its connect-only behaviour.
   */
  sendAndWait?(msg: RequestFrame, timeout?: number): Promise<ResponseFrame>;
  onMessage(handler: FrameHandler): Disposable;
  onConnectionStateChange(handler: ConnectionStateHandler): Disposable;
  readonly state: ConnectionState;
}
