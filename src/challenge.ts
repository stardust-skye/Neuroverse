import type { GazePoint } from './gaze'

export type StrainState = 'low' | 'moderate' | 'high' | 'unknown'
export type ChallengeMetrics = {
  coverage: number
  accuracy: number
  elapsedSeconds: number
  misses: number
}
export type ChallengeState = {
  round: number
  targetScale: number
  successfulRounds: number
  lastDifficultyChangeAt: number
  lastMetrics: ChallengeMetrics | null
}

export const initialChallengeState: ChallengeState = {
  round: 1,
  targetScale: 0.4,
  successfulRounds: 0,
  lastDifficultyChangeAt: 0,
  lastMetrics: null,
}

const MIN_CHANGE_INTERVAL_MS = 10_000
const MIN_TARGET_SCALE = 0.14
const MAX_TARGET_SCALE = 0.5

export function adaptChallenge(
  state: ChallengeState,
  metrics: ChallengeMetrics,
  strain: StrainState,
  now: number,
): ChallengeState {
  const valid = [metrics.coverage, metrics.accuracy, metrics.elapsedSeconds, metrics.misses, now]
    .every(Number.isFinite)
  if (!valid) return state
  const successful = metrics.coverage >= 0.7 && metrics.accuracy >= 0.8 && metrics.elapsedSeconds <= 45
  const successfulRounds = strain === 'low' && successful ? state.successfulRounds + 1 : 0
  let targetScale = state.targetScale
  let lastDifficultyChangeAt = state.lastDifficultyChangeAt
  const canChange = now - state.lastDifficultyChangeAt >= MIN_CHANGE_INTERVAL_MS

  if (canChange && strain === 'high') {
    targetScale = Math.min(MAX_TARGET_SCALE, targetScale + 0.04)
    lastDifficultyChangeAt = now
  } else if (canChange && strain === 'low' && successfulRounds >= 2) {
    targetScale = Math.max(MIN_TARGET_SCALE, targetScale - 0.025)
    lastDifficultyChangeAt = now
  }

  return {
    round: state.round + 1,
    targetScale,
    successfulRounds,
    lastDifficultyChangeAt,
    lastMetrics: metrics,
  }
}

export function targetGridCell(
  point: GazePoint,
  bounds: { left: number; top: number; width: number; height: number },
  targetScale: number,
  gridSize = 8,
): number | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || gridSize < 1) return null
  const side = Math.min(bounds.width, bounds.height) * targetScale
  const left = bounds.left + (bounds.width - side) / 2
  const top = bounds.top + (bounds.height - side) / 2
  const x = point.x - left
  const y = point.y - top
  if (x < 0 || y < 0 || x >= side || y >= side) return null
  const column = Math.min(gridSize - 1, Math.floor((x / side) * gridSize))
  const row = Math.min(gridSize - 1, Math.floor((y / side) * gridSize))
  return row * gridSize + column
}
