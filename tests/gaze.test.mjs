import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/gaze.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const gaze = {}
new Function('exports', compiled)(gaze)

function landmarksFor(horizontal, vertical) {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  const eyes = [
    { corners: [33, 133], upper: [159, 160], lower: [145, 144], iris: [468, 469, 470, 471, 472], left: 0.3 },
    { corners: [362, 263], upper: [386, 387], lower: [374, 373], iris: [473, 474, 475, 476, 477], left: 0.6 },
  ]
  for (const { corners, upper, lower, iris, left } of eyes) {
    points[corners[0]] = { x: left, y: 0.4 }
    points[corners[1]] = { x: left + 0.1, y: 0.4 }
    for (const index of upper) points[index] = { x: left + 0.05, y: 0.4 }
    for (const index of lower) points[index] = { x: left + 0.05, y: 0.44 }
    for (const index of iris) points[index] = { x: left + horizontal * 0.1, y: 0.4 + vertical * 0.04 }
  }
  return points
}

test('nine-point affine calibration preserves left/right, up/down, and center', () => {
  const rawFor = ({ x, y }) => ({
    x: 0.4 + 0.25 * x + 0.08 * y,
    y: 0.25 + 0.05 * x + 0.3 * y,
  })
  const samples = gaze.GAZE_CALIBRATION_TARGETS.map((target) => ({ raw: rawFor(target), target }))
  const map = gaze.fitGazeMap(samples)
  assert.ok(map)
  assert.ok(map.rmse < 1e-8)

  const mapped = Object.fromEntries(samples.map(({ raw, target }) => [
    target.label,
    gaze.mapGazeToScreen(raw, map),
  ]))
  for (const { target } of samples) {
    assert.ok(Math.abs(mapped[target.label].x - target.x) < 1e-8, `${target.label} horizontal mapping`)
    assert.ok(Math.abs(mapped[target.label].y - target.y) < 1e-8, `${target.label} vertical mapping`)
  }
  assert.ok(mapped.LEFT.x < mapped.CENTER.x)
  assert.ok(mapped.RIGHT.x > mapped.CENTER.x)
  assert.ok(mapped.TOP.y < mapped.CENTER.y)
  assert.ok(mapped.BOTTOM.y > mapped.CENTER.y)
  assert.ok(Math.abs(mapped.CENTER.x - 0.5) < 1e-8)
  assert.ok(Math.abs(mapped.CENTER.y - 0.5) < 1e-8)
})

test('nine-point gaze calibration handles horizontally reversed camera features without a second inversion', () => {
  const samples = gaze.GAZE_CALIBRATION_TARGETS.map((target) => ({
    raw: { x: 0.75 - 0.25 * target.x, y: 0.2 + 0.3 * target.y },
    target,
  }))
  const map = gaze.fitGazeMap(samples)
  assert.ok(map)
  assert.ok(map.rmse < 1e-8)
  for (const { raw, target } of samples) {
    const mapped = gaze.mapGazeToScreen(raw, map)
    assert.ok(Math.abs(mapped.x - target.x) < 1e-8, `${target.label} horizontal`)
    assert.ok(Math.abs(mapped.y - target.y) < 1e-8, `${target.label} vertical`)
  }
})

test('horizontal gaze correction mirrors calibrated output without changing vertical direction', () => {
  for (const x of [0, 0.1, 0.5, 0.9, 1]) {
    const point = { x, y: 0.3 }
    const corrected = gaze.orientGazeForScreen(point, true)
    assert.ok(Math.abs(corrected.x - (1 - x)) < 1e-10)
    assert.equal(corrected.y, point.y)
    assert.deepEqual(gaze.orientGazeForScreen(point, false), point)
  }
  const map = gaze.fitGazeMap(gaze.GAZE_CALIBRATION_TARGETS.map((target) => ({
    raw: { x: 0.75 - 0.25 * target.x, y: 0.2 + 0.3 * target.y }, target,
  })))
  assert.ok(map)
  const left = gaze.orientGazeForScreen(gaze.mapGazeToScreen({ x: 0.73, y: 0.35 }, map), true)
  const right = gaze.orientGazeForScreen(gaze.mapGazeToScreen({ x: 0.52, y: 0.35 }, map), true)
  assert.ok(left.x > right.x)
  assert.ok(Math.abs(left.y - right.y) < 1e-10)
})

test('gaze estimation follows eye-relative horizontal and vertical directions', () => {
  const left = gaze.estimateGaze(landmarksFor(0.25, 0.5))
  const center = gaze.estimateGaze(landmarksFor(0.5, 0.5))
  const right = gaze.estimateGaze(landmarksFor(0.75, 0.5))
  const top = gaze.estimateGaze(landmarksFor(0.5, 0.25))
  const bottom = gaze.estimateGaze(landmarksFor(0.5, 0.75))
  assert.ok(left && center && right && top && bottom)
  assert.ok(left.x < center.x && center.x < right.x)
  assert.ok(top.y < center.y && center.y < bottom.y)
  assert.equal(gaze.estimateGaze([]), null)
})

test('gaze accepts narrower open eyes and uses a valid eye when the other is closed or invalid', () => {
  const landmarks = landmarksFor(0.35, 0.55)
  assert.ok(gaze.estimateGaze(landmarks, { left: 0.15, right: 0.17 }))
  assert.ok(gaze.estimateGaze(landmarks, { left: 0.05, right: 0.17 }))
  assert.equal(gaze.estimateGaze(landmarks, { left: 0.05, right: 0.05 }), null)
  landmarks[468] = { x: NaN, y: NaN }
  assert.ok(gaze.estimateGaze(landmarks, { left: 0.15, right: 0.17 }))
})

test('calibration accepts lower frame rates and ordinary jitter but reports missing or unstable samples', () => {
  const observations = Array.from({ length: 12 }, (_, i) => ({
    x: 0.4 + (i % 3 - 1) * 0.02,
    y: 0.6 + (i % 3 - 1) * 0.02,
  }))
  assert.equal(gaze.evaluateGazeSamples(observations.slice(0, 11)).status, 'insufficient')
  assert.equal(gaze.evaluateGazeSamples(observations).status, 'ready')
  assert.equal(gaze.evaluateGazeSamples(Array.from({ length: 24 }, (_, i) => ({ x: i / 24, y: 0.5 }))).status, 'unstable')
  const sample = gaze.evaluateGazeSamples([...observations, { x: NaN, y: 0.5 }])
  assert.equal(sample.status, 'ready')
})

test('low frame rate calibration produces a usable gaze map', () => {
  const samples = gaze.GAZE_CALIBRATION_TARGETS.map((target) => {
    const raw = { x: 0.3 + target.x * 0.3, y: 0.2 + target.y * 0.3 }
    const observations = Array.from({ length: 12 }, (_, i) => ({
      x: raw.x + (i % 3 - 1) * 0.003,
      y: raw.y + (i % 3 - 1) * 0.003,
    }))
    const result = gaze.evaluateGazeSamples(observations)
    assert.equal(result.status, 'ready')
    return { raw: result.summary.point, target }
  })
  const map = gaze.fitGazeMap(samples)
  assert.ok(map)
  const point = gaze.mapGazeToScreen({ x: 0.54, y: 0.26 }, map)
  assert.ok(Math.abs(point.x - 0.8) < 0.01)
  assert.ok(Math.abs(point.y - 0.2) < 0.01)
})

test('calibration identifies a mismatched point for retry and rejects indistinguishable positions', () => {
  const samples = gaze.GAZE_CALIBRATION_TARGETS.map((target) => ({
    raw: { x: 0.3 + target.x * 0.3, y: 0.2 + target.y * 0.3 },
    target,
  }))
  assert.equal(gaze.assessGazeCalibration(samples).status, 'ready')
  const distorted = samples.map((sample) => ({ ...sample, raw: { ...sample.raw } }))
  distorted[5].raw = { ...distorted[1].raw }
  const assessment = gaze.assessGazeCalibration(distorted)
  assert.equal(assessment.status, 'mismatch')
  assert.ok([1, 5].includes(assessment.index))
  assert.equal(gaze.assessGazeCalibration(samples.map(({ target }) => ({
    raw: { x: 0.5, y: 0.5 }, target,
  }))).status, 'insufficient-range')
})

test('capture rejects stale samples and an eye movement at the moment of capture', () => {
  const stable = Array.from({ length: 20 }, (_, i) => ({
    timestamp: 1000 + i * 75,
    point: { x: 0.4, y: 0.5 },
  }))
  assert.equal(gaze.evaluateGazeCapture(stable, 2500).status, 'ready')
  assert.equal(gaze.evaluateGazeCapture(stable, 3200).status, 'insufficient')
  const moved = [...stable, ...Array.from({ length: 4 }, (_, i) => ({
    timestamp: 2520 + i * 50,
    point: { x: 0.6, y: 0.5 },
  }))]
  assert.equal(gaze.evaluateGazeCapture(moved, 2700).status, 'unstable')
})

test('capture tolerates slow noisy observations and outliers but waits for a new gaze to settle', () => {
  const slow = Array.from({ length: 15 }, (_, i) => ({
    timestamp: i * 200,
    point: { x: 0.4 + (i % 5 - 2) * 0.008, y: 0.5 + (i % 3 - 1) * 0.009 },
  }))
  slow[4].point = { x: 0.9, y: 0.1 }
  assert.equal(gaze.evaluateGazeCapture(slow, 2900).status, 'ready')
  assert.equal(gaze.evaluateGazeCapture(slow.slice(0, 10), 2900).status, 'insufficient')
  const shifted = Array.from({ length: 15 }, (_, i) => ({
    timestamp: 3000 + i * 200, point: { x: 0.6, y: 0.5 },
  }))
  assert.equal(gaze.evaluateGazeCapture([...slow, ...shifted.slice(0, 3)], 3450).status, 'unstable')
  assert.equal(gaze.evaluateGazeCapture([...slow, ...shifted], 5900).status, 'ready')
  assert.equal(gaze.evaluateGazeCapture(shifted, 7000).status, 'insufficient')
})

test('calibration fits noisy target measurements and predicts unseen gaze positions', () => {
  const rawFor = ({ x, y }) => ({ x: 0.3 + x * 0.25 + y * 0.025, y: 0.2 + x * 0.02 + y * 0.3 })
  const samples = gaze.GAZE_CALIBRATION_TARGETS.map((target, i) => {
    const raw = rawFor(target)
    return { target, raw: { x: raw.x + (i % 3 - 1) * 0.002, y: raw.y + (i % 2 ? 0.002 : -0.002) } }
  })
  const assessment = gaze.assessGazeCalibration(samples)
  assert.equal(assessment.status, 'ready')
  for (const target of [{ x: 0.25, y: 0.3 }, { x: 0.73, y: 0.64 }, { x: 0.48, y: 0.83 }]) {
    const mapped = gaze.mapGazeToScreen(rawFor(target), assessment.map)
    assert.ok(Math.hypot(mapped.x - target.x, mapped.y - target.y) < 0.03)
  }
})

test('sample summary rejects unstable data and resists isolated outliers', () => {
  const samples = Array.from({ length: 50 }, (_, index) => ({
    x: 0.4 + (index % 3 - 1) * 0.001,
    y: 0.6 + (index % 3 - 1) * 0.001,
  }))
  samples[3] = { x: 0.95, y: 0.05 }
  const summary = gaze.summarizeGazeSamples(samples)
  assert.ok(summary)
  assert.ok(Math.abs(summary.point.x - 0.4) < 0.001)
  assert.ok(Math.abs(summary.point.y - 0.6) < 0.001)
  assert.ok(summary.sampleCount < samples.length)
  assert.equal(gaze.summarizeGazeSamples([{ x: 0.5, y: 0.5 }]), null)
  assert.equal(gaze.summarizeGazeSamples(Array.from({ length: 24 }, (_, i) => ({ x: i / 24, y: 0.5 }))), null)
})

test('isolated jumps are rejected, confirmed movement is accepted, and smoothing stays responsive', () => {
  const previous = { x: 50, y: 50 }
  const jump = { x: 80, y: 50 }
  assert.equal(gaze.isGazeOutlier(jump, previous, null), true)
  assert.equal(gaze.isGazeOutlier(jump, previous, jump), false)
  assert.deepEqual(gaze.smoothGazePoint(previous, { x: 50.5, y: 50 }), previous)
  const responsive = gaze.smoothGazePoint(previous, { x: 90, y: 50 })
  assert.ok(responsive.x > 60 && responsive.x < 90)
})
