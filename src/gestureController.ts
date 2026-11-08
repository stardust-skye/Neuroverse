import type { FacialGesture } from './gestures'

export type GestureAction = 'navigate' | 'select'

export function processGesture(gesture: FacialGesture): GestureAction {
  return gesture === 'NORMAL_BLINK' ? 'navigate' : 'select'
}
