// Browser client for ml/live/lsl_ws_bridge.py. Framework-agnostic: works with React, Vue or plain TS.

export type EegMeta = { name: string; srate: number; channels: string[] };
export type EegStatus = 'disconnected' | 'waiting' | 'streaming';

export type EegStreamEvents = {
  onMeta?: (meta: EegMeta) => void;
  onSamples?: (rows: number[][], t0: number) => void; // rows[sample][channel], microvolts as sent by the device
  onStatus?: (status: EegStatus) => void;
};

export class EegStream {
  private ws: WebSocket | null = null;
  private retry: number | undefined;
  private closed = false;
  meta: EegMeta | null = null;

  constructor(private url = 'ws://localhost:8765', private events: EegStreamEvents = {}) {}

  connect() {
    this.closed = false;
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'meta') {
        this.meta = { name: msg.name, srate: msg.srate, channels: msg.channels };
        this.events.onMeta?.(this.meta);
      } else if (msg.type === 'samples') {
        this.events.onSamples?.(msg.data, msg.t0);
      } else if (msg.type === 'status') {
        this.events.onStatus?.(msg.state);
      }
    };
    this.ws.onclose = () => {
      this.events.onStatus?.('disconnected');
      if (!this.closed) this.retry = window.setTimeout(() => this.connect(), 2000); // auto-reconnect
    };
    this.ws.onerror = () => this.ws?.close();
  }

  disconnect() {
    this.closed = true;
    window.clearTimeout(this.retry);
    this.ws?.close();
  }
}

// Fixed-size rolling buffer per channel, handy for live plots and windowed features.
export class RollingBuffer {
  private data: Float32Array[];
  private writes = 0;
  constructor(channels: number, public size: number) {
    this.data = Array.from({ length: channels }, () => new Float32Array(size));
  }
  push(rows: number[][]) {
    for (const row of rows) {
      const i = this.writes % this.size;
      for (let c = 0; c < this.data.length; c++) this.data[c][i] = row[c] ?? 0;
      this.writes++;
    }
  }
  /** Samples for one channel, oldest to newest. */
  channel(c: number): Float32Array {
    const n = Math.min(this.writes, this.size);
    const out = new Float32Array(n);
    const start = this.writes > this.size ? this.writes % this.size : 0;
    for (let i = 0; i < n; i++) out[i] = this.data[c][(start + i) % this.size];
    return out;
  }
}
