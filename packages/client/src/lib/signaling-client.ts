import type { ClientMessage, ServerMessage } from "@raddir/shared";

type MessageHandler = (msg: ServerMessage) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;
  private onConnectCallback?: () => void;
  private onDisconnectCallback?: () => void;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.doConnect();
  }

  private doConnect(): void {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("[signaling] Connected");
        this.reconnectDelay = 1000;
        this.onConnectCallback?.();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          this.dispatch(msg);
        } catch (err) {
          console.error("[signaling] Failed to parse message:", err);
        }
      };

      this.ws.onclose = () => {
        console.log("[signaling] Disconnected");
        this.onDisconnectCallback?.();
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error("[signaling] WebSocket error:", err);
      };
    } catch (err) {
      console.error("[signaling] Connection failed:", err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    this.reconnectTimer = setTimeout(() => {
      console.log(`[signaling] Reconnecting in ${this.reconnectDelay}ms...`);
      this.doConnect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn("[signaling] Cannot send, not connected");
    }
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onConnect(callback: () => void): void {
    this.onConnectCallback = callback;
  }

  onDisconnect(callback: () => void): void {
    this.onDisconnectCallback = callback;
  }

  private dispatch(msg: ServerMessage): void {
    const typeHandlers = this.handlers.get(msg.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        handler(msg);
      }
    }

    const allHandlers = this.handlers.get("*");
    if (allHandlers) {
      for (const handler of allHandlers) {
        handler(msg);
      }
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  setUrl(url: string): void {
    this.url = url;
  }
}
