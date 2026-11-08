export type FacialGesture = 'NORMAL_BLINK' | 'LEFT_WINK' | 'RIGHT_WINK'
export type GestureObservation = { leftEar: number; rightEar: number; timestamp: number }
export type GestureState = {
  candidate: 'blink' | 'left-wink' | 'right-wink' | null
  startedAt: number
  lastEventAt: number
}

const blinkCooldownMs = 120
const winkCooldownMs = 420

export const initialGestureState: GestureState = {
  candidate: null,
  startedAt: 0,
  lastEventAt: -Infinity,
}

export function updateFacialGesture(
  state: GestureState,
  observation: GestureObservation,
  sensitivity = 6,
): { state: GestureState; event: FacialGesture | null } {
  const { leftEar, rightEar, timestamp } = observation
  if (![leftEar, rightEar, timestamp, sensitivity].every(Number.isFinite)) {
    return { state: initialGestureState, event: null }
  }
  const clampedSensitivity = Math.max(1, Math.min(10, sensitivity))
  const closedThreshold = 0.16 + clampedSensitivity * 0.004
  const openThreshold = closedThreshold + 0.04
  const leftClosed = leftEar < closedThreshold
  const rightClosed = rightEar < closedThreshold
  const bothOpen = leftEar > openThreshold && rightEar > openThreshold

  if (leftClosed && rightClosed) {
    if (!state.candidate) {
      return { state: { ...state, candidate: 'blink', startedAt: timestamp }, event: null }
    }
    if (state.candidate !== 'blink' && timestamp - state.startedAt <= 120) {
      return { state: { ...state, candidate: 'blink' }, event: null }
    }
    return { state, event: null }
  }

  if (leftClosed !== rightClosed) {
    const candidate = leftClosed ? 'left-wink' : 'right-wink'
    if (!state.candidate) {
      return { state: { ...state, candidate, startedAt: timestamp }, event: null }
    }
    if (state.candidate === 'blink') return { state, event: null }
    if (state.candidate !== candidate) {
      return { state: { ...state, candidate, startedAt: timestamp }, event: null }
    }
    return { state, event: null }
  }

  if (!bothOpen || !state.candidate) return { state, event: null }
  const duration = timestamp - state.startedAt
  let event: FacialGesture | null = null
  const cooldownMs = state.candidate === 'blink' ? blinkCooldownMs : winkCooldownMs
  if (timestamp - state.lastEventAt >= cooldownMs) {
    if (state.candidate === 'blink' && duration >= 25 && duration <= 450) event = 'NORMAL_BLINK'
    if (state.candidate === 'left-wink' && duration >= 120 && duration <= 1500) event = 'LEFT_WINK'
    if (state.candidate === 'right-wink' && duration >= 120 && duration <= 1500) event = 'RIGHT_WINK'
  }
  return {
    state: {
      candidate: null,
      startedAt: 0,
      lastEventAt: event ? timestamp : state.lastEventAt,
    },
    event,
  }
}
