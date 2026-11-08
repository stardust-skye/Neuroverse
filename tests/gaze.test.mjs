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

test('gaze estimation follows eye-relative horizontal and vertical directions', () => {
  const landmarksFor = (horizontal, vertical) => {
    const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
    const eyes = [
      { corners: [33, 133], upper: [159, 160], lower: [145, 144], iris: [468, 469, 470, 471, 472], left: 0.3 },
      { corners: [362, 263], upper: [386, 387], lower: [374, 373], iris: [473, 474, 475, 476, 477], left: 0.6 },
    ]
    for (const eye of eyes) {
      const { corners, upper, lower, iris, left } = eye
      points[corners[0]] = { x: left, y: 0.4 }
      points[corners[1]] = { x: left + 0.1, y: 0.4 }
      for (const index of upper) points[index] = { x: left + 0.05, y: 0.4 }
      for (const index of lower) points[index] = { x: left + 0.05, y: 0.44 }
      for (const index of iris) {
        points[index] = { x: left + horizontal * 0.1, y: 0.4 + vertical * 0.04 }
      }
    }
    return gaze.estimateGaze(points)
  }

  const left = landmarksFor(0.25, 0.5)
  const center = landmarksFor(0.5, 0.5)
  const right = landmarksFor(0.75, 0.5)
  const top = landmarksFor(0.5, 0.25)
  const bottom = landmarksFor(0.5, 0.75)
  assert.ok(left && center && right && top && bottom)
  assert.ok(left.x < center.x && center.x < right.x)
  assert.ok(top.y < center.y && center.y < bottom.y)
  assert.equal(gaze.estimateGaze([]), null)
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
