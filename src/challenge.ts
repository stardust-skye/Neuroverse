import type { GazePoint } from './gaze'

export type PlayTargetState = {
  scale: number
  lastTime: number | null
  furrowMs: number
  furrowed: boolean
}

export const initialPlayTarget: PlayTargetState = {
  scale: 0.4,
  lastTime: null,
  furrowMs: 0,
  furrowed: false,
}

export const DEFAULT_BROW_THRESHOLD = 0.3

export type PlayArea = { width: number; height: number; top: number; bottom: number }
export type TargetRect = { left: number; top: number; right: number; bottom: number }

export function targetRect(area: PlayArea, scale: number, position: GazePoint): TargetRect {
  const availableHeight = Math.max(0, area.bottom - area.top)
  const side = Math.min(area.width, availableHeight) * scale
  const x = side / 2 + position.x * (area.width - side)
  const y = area.top + side / 2 + position.y * (availableHeight - side)
  return { left: x - side / 2, right: x + side / 2, top: y - side / 2, bottom: y + side / 2 }
}

export function nextTargetPosition(area: PlayArea, scale: number, previous: GazePoint, cursor: GazePoint, random: number): GazePoint {
  const candidates = [0, 0.25, 0.5, 0.75, 1].flatMap((x) =>
    [0, 0.25, 0.5, 0.75, 1].map((y) => ({ x, y })))
  const choices = candidates.filter((position) => {
    const rect = targetRect(area, scale, position)
    return Math.hypot(position.x - previous.x, position.y - previous.y) >= 0.35
      && !pointInTarget(cursor, rect)
  })
  if (!choices.length) {
    return candidates.reduce((best, candidate) =>
      Math.hypot(candidate.x - previous.x, candidate.y - previous.y)
      > Math.hypot(best.x - previous.x, best.y - previous.y) ? candidate : best)
  }
  const index = Math.min(choices.length - 1, Math.max(0, Math.floor(random * choices.length)))
  return choices[index]
}

export function pointInTarget(point: GazePoint, rect: TargetRect): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

export function segmentTouchesTarget(from: GazePoint, to: GazePoint, rect: TargetRect): boolean {
  if (![from.x, from.y, to.x, to.y, rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)
    || rect.left > rect.right || rect.top > rect.bottom) return false
  let start = 0
  let end = 1
  for (const [origin, delta, min, max] of [
    [from.x, to.x - from.x, rect.left, rect.right],
    [from.y, to.y - from.y, rect.top, rect.bottom],
  ]) {
    if (delta === 0) {
      if (origin < min || origin > max) return false
      continue
    }
    const first = (min - origin) / delta
    const second = (max - origin) / delta
    start = Math.max(start, Math.min(first, second))
    end = Math.min(end, Math.max(first, second))
    if (start > end) return false
  }
  return true
}

export function completePlayTarget(state: PlayTargetState): PlayTargetState {
  return { ...state, scale: Math.max(0.14, state.scale - 0.025) }
}

export function updatePlayTarget(
  state: PlayTargetState,
  now: number,
  brow: number | null,
  browThreshold = DEFAULT_BROW_THRESHOLD,
): PlayTargetState {
  if (!Number.isFinite(now) || brow === null || !Number.isFinite(brow) || brow < 0 || brow > 1
    || !Number.isFinite(browThreshold) || browThreshold <= 0 || browThreshold > 1) {
    return { ...state, lastTime: null, furrowMs: 0, furrowed: false }
  }
  const elapsed = state.lastTime === null ? 0 : now - state.lastTime
  if (elapsed < 0 || elapsed > 500) {
    return { ...state, lastTime: now, furrowMs: 0, furrowed: false }
  }
  const dt = Math.min(elapsed, 200)
  const furrowed = brow >= (state.furrowed ? browThreshold * 0.7 : browThreshold)
  const furrowMs = furrowed ? state.furrowMs + dt : 0
  let scale = state.scale
  if (furrowMs >= 600) scale = Math.min(0.65, scale + 0.09 * dt / 1000)
  return { scale, lastTime: now, furrowMs, furrowed }
}
