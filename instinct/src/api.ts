export type Reading = { score: number; errp: number; frown: number; frown_ratio: number; flagged: boolean }
export type Interpretation = { category: string; question: string; request: string; engine: string }
export type Status = {
  source: 'mock' | 'lsl' | 'replay'
  stream_name: string | null
  sfreq: number
  channels: string[]
  baseline: string
  reaction_model: string
  gesture_model: string
  calibration_metrics: Record<string, unknown>
  recording: boolean
  slm: { available: boolean; model: string }
  chatgpt: { connected: boolean; model: string | null }
}
export type ServerEvent =
  | { type: 'status'; status: Status }
  | { type: 'signals'; activity: Record<string, number>; quality: Record<string, 'good' | 'flat' | 'noisy'> }
  | { type: 'reaction'; chunk_id: number; reaction_id: number; reading: Reading; simulated: boolean; source: string; interpretation?: Interpretation }
  | { type: 'gesture'; chunk_id: number; gesture: 'nod' | 'shake'; simulated: boolean; source: string; strength?: number }
  | { type: 'error'; message: string }

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail.detail ?? `${path} failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

type Listener = (event: ServerEvent) => void

class Socket {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private queue: string[] = []
  connected = false

  connect() {
    if (this.ws) return
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.connected = true
      this.queue.splice(0).forEach((m) => ws.send(m))
    }
    ws.onmessage = (message) => {
      const event = JSON.parse(message.data) as ServerEvent
      this.listeners.forEach((listener) => listener(event))
    }
    ws.onclose = () => {
      this.connected = false
      this.ws = null
      this.listeners.forEach((listener) => listener({ type: 'error', message: 'Local service disconnected' }))
      setTimeout(() => this.connect(), 1500)
    }
  }

  send(message: Record<string, unknown>) {
    const text = JSON.stringify(message)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text)
    else this.queue.push(text)
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

export const socket = new Socket()

export const settings = {
  get plant(): boolean {
    try { return localStorage.getItem('instinct.plant') !== 'off' } catch { return true }
  },
  set plant(value: boolean) {
    try { localStorage.setItem('instinct.plant', value ? 'on' : 'off') } catch { /* storage unavailable */ }
  },
}
