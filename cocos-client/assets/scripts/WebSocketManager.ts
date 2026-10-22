import type { WsMessage } from './types';

type Handler = (msg: WsMessage) => void;

class WebSocketManagerImpl {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Handler[]> = new Map();
  private seq: number = 0;
  private serverUrl: string = '';
  private pendingReconnect: boolean = false;

  connect(token: string, serverUrl?: string): Promise<void> {
    this.serverUrl = serverUrl || this.getDefaultServerUrl();
    const url = `${this.serverUrl}?token=${encodeURIComponent(token)}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }

      this.ws.onopen = () => {
        this.pendingReconnect = false;
        resolve();
      };

      this.ws.onerror = () => {
        reject(new Error('WebSocket连接失败'));
      };

      this.ws.onclose = () => {
        if (this.pendingReconnect) return;
        this.emit('_disconnected', { type: '_disconnected', data: {}, seq: 0 });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          this.emit(msg.type, msg);
        } catch (e) {
          console.error('解析消息失败:', e);
        }
      };
    });
  }

  private getDefaultServerUrl(): string {
    // 构建时可配置，默认连接同域 ws
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
  }

  disconnect(): void {
    this.pendingReconnect = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(type: string, data: any = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket未连接');
      return;
    }
    this.seq++;
    const msg = JSON.stringify({ type, data, seq: this.seq });
    this.ws.send(msg);
  }

  on(type: string, handler: Handler): void {
    const list = this.handlers.get(type) || [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  off(type: string): void {
    this.handlers.delete(type);
  }

  private emit(type: string, msg: WsMessage): void {
    const list = this.handlers.get(type);
    if (list) {
      for (const h of list) {
        try { h(msg); } catch (e) { console.error(`处理${type}失败:`, e); }
      }
    }
  }
}

export const wsManager = new WebSocketManagerImpl();
