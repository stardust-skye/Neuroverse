export type GazePoint = { x: number; y: number }
export type GazeCalibrationPoint = { raw: GazePoint; target: GazePoint }
export type GazeMap = {
  x: [number, number, number]
  y: [number, number, number]
  rmse: number
  maxError: number
}
export type Landmark = { x: number; y: number }

export const GAZE_CALIBRATION_TARGETS = [
  { x: 0.5, y: 0.5, label: 'CENTER' },
  { x: 0.08, y: 0.08, label: 'TOP LEFT' },
  { x: 0.5, y: 0.08, label: 'TOP' },
  { x: 0.92, y: 0.08, label: 'TOP RIGHT' },
  { x: 0.92, y: 0.5, label: 'RIGHT' },
  { x: 0.92, y: 0.92, label: 'BOTTOM RIGHT' },
  { x: 0.5, y: 0.92, label: 'BOTTOM' },
  { x: 0.08, y: 0.92, label: 'BOTTOM LEFT' },
  { x: 0.08, y: 0.5, label: 'LEFT' },
] as const

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

export function summarizeGazeSamples(samples: GazePoint[]): {
  point: GazePoint
  sampleCount: number
  stability: number
} | null {
  if (samples.length < 24 || samples.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    return null
  }
  const center = {
    x: median(samples.map(({ x }) => x)),
    y: median(samples.map(({ y }) => y)),
  }
  const distances = samples.map(({ x, y }) => Math.hypot(x - center.x, y - center.y))
  const medianDistance = median(distances)
  const distanceMad = median(distances.map((distance) => Math.abs(distance - medianDistance)))
  const outlierLimit = medianDistance + Math.max(0.012, 3 * 1.4826 * distanceMad)
  const stable = samples.filter((_, index) => distances[index] <= outlierLimit)
  if (stable.length < 18) return null

  const x = median(stable.map(({ x: value }) => value))
  const y = median(stable.map(({ y: value }) => value))
  const xMad = median(stable.map(({ x: value }) => Math.abs(value - x))) * 1.4826
  const yMad = median(stable.map(({ y: value }) => Math.abs(value - y))) * 1.4826
  const stability = Math.max(xMad, yMad)
  if (stability > 0.035) return null
  return { point: { x, y }, sampleCount: stable.length, stability }
}

function solveAxis(
  samples: GazeCalibrationPoint[],
  axis: 'x' | 'y',
): [number, number, number] | null {
  const meanX = samples.reduce((sum, item) => sum + item.raw.x, 0) / samples.length
  const meanY = samples.reduce((sum, item) => sum + item.raw.y, 0) / samples.length
  const scaleX = Math.sqrt(samples.reduce((sum, item) => sum + (item.raw.x - meanX) ** 2, 0) / samples.length)
  const scaleY = Math.sqrt(samples.reduce((sum, item) => sum + (item.raw.y - meanY) ** 2, 0) / samples.length)
  if (scaleX < 1e-4 || scaleY < 1e-4) return null

  const matrix = Array.from({ length: 3 }, () => [0, 0, 0, 0])
  for (const sample of samples) {
    const row = [(sample.raw.x - meanX) / scaleX, (sample.raw.y - meanY) / scaleY, 1]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) matrix[i][j] += row[i] * row[j]
      matrix[i][3] += row[i] * sample.target[axis]
    }
  }
  for (let column = 0; column < 3; column++) {
    let pivot = column
    for (let row = column + 1; row < 3; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row
    }
    if (Math.abs(matrix[pivot][column]) < 1e-10) return null
    ;[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]]
    const divisor = matrix[column][column]
    for (let j = column; j < 4; j++) matrix[column][j] /= divisor
    for (let row = 0; row < 3; row++) {
      if (row === column) continue
      const factor = matrix[row][column]
      for (let j = column; j < 4; j++) matrix[row][j] -= factor * matrix[column][j]
    }
  }
  const [scaledX, scaledY, intercept] = matrix.map((row) => row[3])
  const coefficientX = scaledX / scaleX
  const coefficientY = scaledY / scaleY
  return [
    coefficientX,
    coefficientY,
    intercept - coefficientX * meanX - coefficientY * meanY,
  ]
}

export function fitGazeMap(samples: GazeCalibrationPoint[]): GazeMap | null {
  if (samples.length < GAZE_CALIBRATION_TARGETS.length) return null
  const x = solveAxis(samples, 'x')
  const y = solveAxis(samples, 'y')
  if (!x || !y) return null
  const errors = samples.map(({ raw, target }) => {
    const predictedX = x[0] * raw.x + x[1] * raw.y + x[2]
    const predictedY = y[0] * raw.x + y[1] * raw.y + y[2]
    return Math.hypot(predictedX - target.x, predictedY - target.y)
  })
  return {
    x,
    y,
    rmse: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length),
    maxError: Math.max(...errors),
  }
}

export function mapGazeToScreen(raw: GazePoint, map: GazeMap): GazePoint {
  return {
    x: map.x[0] * raw.x + map.x[1] * raw.y + map.x[2],
    y: map.y[0] * raw.x + map.y[1] * raw.y + map.y[2],
  }
}

export function smoothGazePoint(
  previous: GazePoint | null,
  target: GazePoint,
  deadZonePixels = 1.5,
): GazePoint {
  if (!previous) return target
  const dx = target.x - previous.x
  const dy = target.y - previous.y
  const distance = Math.hypot(dx, dy)
  if (distance <= deadZonePixels) return previous
  const alpha = distance > 48 ? 0.55 : 0.38
  return { x: previous.x + dx * alpha, y: previous.y + dy * alpha }
}

export function isGazeOutlier(
  point: GazePoint,
  previous: GazePoint | null,
  pending: GazePoint | null,
  threshold = 0.18,
  confirmationTolerance = 0.035,
): boolean {
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) <= threshold) {
    return false
  }
  return !pending || Math.hypot(point.x - pending.x, point.y - pending.y) > confirmationTolerance
}

export function estimateGaze(points: Landmark[]): GazePoint | null {
  if (points.length < 478) return null
  const eyes = [
    { corners: [33, 133], upper: [159, 160], lower: [145, 144], iris: [468, 469, 470, 471, 472] },
    { corners: [362, 263], upper: [386, 387], lower: [374, 373], iris: [473, 474, 475, 476, 477] },
  ]
  const normalized = eyes.map(({ corners, upper, lower, iris }) => {
    const average = (indices: number[]) => ({
      x: indices.reduce((sum, index) => sum + points[index].x, 0) / indices.length,
      y: indices.reduce((sum, index) => sum + points[index].y, 0) / indices.length,
    })
    const [leftCorner, rightCorner] = corners
      .map((index) => points[index])
      .sort((a, b) => a.x - b.x)
    const eyeTop = average(upper)
    const eyeBottom = average(lower)
    const irisCenter = average(iris)
    const horizontal = {
      x: rightCorner.x - leftCorner.x,
      y: rightCorner.y - leftCorner.y,
    }
    const horizontalLengthSquared = horizontal.x ** 2 + horizontal.y ** 2
    const horizontalProjection = horizontalLengthSquared > 0
      ? ((irisCenter.x - leftCorner.x) * horizontal.x + (irisCenter.y - leftCorner.y) * horizontal.y) / horizontalLengthSquared
      : Number.NaN
    let vertical = { x: eyeBottom.x - eyeTop.x, y: eyeBottom.y - eyeTop.y }
    const horizontalLength = Math.sqrt(horizontalLengthSquared)
    if (horizontalLength > 0) {
      const alongHorizontal = (vertical.x * horizontal.x + vertical.y * horizontal.y) / horizontalLengthSquared
      vertical = {
        x: vertical.x - alongHorizontal * horizontal.x,
        y: vertical.y - alongHorizontal * horizontal.y,
      }
    }
    const verticalLengthSquared = vertical.x ** 2 + vertical.y ** 2
    const verticalProjection = verticalLengthSquared > 0
      ? ((irisCenter.x - eyeTop.x) * vertical.x + (irisCenter.y - eyeTop.y) * vertical.y) / verticalLengthSquared
      : Number.NaN
    if (horizontalLength < 1e-6 || verticalLengthSquared < 1e-10) return null
    return { x: horizontalProjection, y: verticalProjection }
  })
  if (normalized.some((eye) => eye === null)) return null
  const x = normalized.reduce((sum, eye) => sum + eye!.x, 0) / normalized.length
  const y = normalized.reduce((sum, eye) => sum + eye!.y, 0) / normalized.length
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}
