export type LiveStress = { state: 'stressed' | 'relaxed'; timestamp: number }
export type PlaySignal = 'eeg-stressed' | 'eeg-relaxed' | 'brow' | 'none'

export const LIVE_STRESS_MAX_AGE_MS = 5000

export function parseLiveStress(value: unknown, now: number): LiveStress | null {
  if (!value || typeof value !== 'object' || !Number.isFinite(now)) return null
  const data = value as Record<string, unknown>
  if (data.type !== 'live_stress' || data.source !== 'live' || data.quality !== 'good'
    || (data.state !== 'stressed' && data.state !== 'relaxed')
    || typeof data.timestamp !== 'number' || !Number.isFinite(data.timestamp)
    || data.timestamp > now + 1000 || now - data.timestamp > LIVE_STRESS_MAX_AGE_MS) return null
  return { state: data.state, timestamp: data.timestamp }
}

export function selectPlaySignal(eeg: LiveStress | null, now: number, browAvailable: boolean): PlaySignal {
  if (eeg && now >= eeg.timestamp - 1000 && now - eeg.timestamp <= LIVE_STRESS_MAX_AGE_MS) {
    return eeg.state === 'stressed' ? 'eeg-stressed' : 'eeg-relaxed'
  }
  return browAvailable ? 'brow' : 'none'
}
