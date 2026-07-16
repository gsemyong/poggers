const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

export class FakeWebSocket {
  static OPEN = OPEN;
  static CONNECTING = CONNECTING;
  static CLOSING = CLOSING;
  static CLOSED = CLOSED;

  static instances: FakeWebSocket[] = [];

  url: string;
  readyState: number = CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void | Promise<void>) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  private _partner: FakeWebSocket | null = null;
  private _sentMessages: string[] = [];
  private _serverHandler: ((data: string) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  get sentMessages(): string[] {
    return this._sentMessages;
  }

  connect(partner?: FakeWebSocket) {
    this.readyState = OPEN;
    if (partner) this._partner = partner;
    if (this.onopen) this.onopen();
  }

  close(code?: number, reason?: string) {
    this.readyState = CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }

  send(data: string) {
    this._sentMessages.push(data);
    if (this._serverHandler) {
      this._serverHandler(data);
    }
    if (this._partner) {
      this._partner.deliverMessage(data);
    }
  }

  async deliverMessage(data: string): Promise<void> {
    if (this.readyState === OPEN && this.onmessage) {
      await this.onmessage({ data });
    }
  }

  clearSent() {
    this._sentMessages = [];
  }

  setServerHandler(handler: (data: string) => void) {
    this._serverHandler = handler;
  }

  simulateDisconnect() {
    this.readyState = CLOSED;
    if (this.onclose) this.onclose({ code: 1006, reason: "" });
  }

  simulateReconnect() {
    this.readyState = OPEN;
    this._sentMessages = [];
    if (this.onopen) this.onopen();
  }

  static reset() {
    FakeWebSocket.instances.length = 0;
  }
}
