export type LiveGestures = {
  timestamp: number
  blinkCount: number
  winkCount: number
  jawClenched: boolean
}

export const LIVE_GESTURE_MAX_AGE_MS = 1500

export function parseLiveGestures(value: unknown, now: number): LiveGestures | null {
  if (!value || typeof value !== 'object' || !Number.isFinite(now)) return null
  const data = value as Record<string, unknown>
  if (data.type !== 'live_gestures' || data.source !== 'live' || data.quality !== 'good'
    || typeof data.timestamp !== 'number' || !Number.isFinite(data.timestamp)
    || data.timestamp > now + 1000 || now - data.timestamp > LIVE_GESTURE_MAX_AGE_MS
    || typeof data.blinkCount !== 'number' || !Number.isSafeInteger(data.blinkCount) || data.blinkCount < 0
    || typeof data.winkCount !== 'number' || !Number.isSafeInteger(data.winkCount) || data.winkCount < 0
    || typeof data.jawClenched !== 'boolean') return null
  return {
    timestamp: data.timestamp,
    blinkCount: data.blinkCount,
    winkCount: data.winkCount,
    jawClenched: data.jawClenched,
  }
}

export function liveGesturesFresh(signal: LiveGestures | null, now: number): boolean {
  return signal !== null && now >= signal.timestamp - 1000 && now - signal.timestamp <= LIVE_GESTURE_MAX_AGE_MS
}
