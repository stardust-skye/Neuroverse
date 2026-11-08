import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const headPoseModuleSource = readFileSync(new URL('../src/headPose.ts', import.meta.url), 'utf8')
const compiledHeadPose = ts.transpileModule(headPoseModuleSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const headPoseModule = {}
new Function('exports', compiledHeadPose)(headPoseModule)

test('neutral pose requires enough stable frames and rejects unstable captures', () => {
  const stable = Array.from({ length: 20 }, (_, index) => ({
    yaw: 0.1 + (index % 3 - 1) * 0.001,
    pitch: -0.05 + (index % 3 - 1) * 0.001,
  }))
  const neutral = headPoseModule.averageHeadPose(stable)
  assert.ok(neutral)
  assert.ok(Math.abs(neutral.yaw - 0.1) < 0.001)
  assert.ok(Math.abs(neutral.pitch + 0.05) < 0.001)
  assert.equal(headPoseModule.averageHeadPose(stable.slice(0, 9)), null)
  assert.equal(headPoseModule.averageHeadPose(Array.from({ length: 20 }, (_, index) => ({
    yaw: index * 0.04,
    pitch: 0,
  }))), null)
})

test('head-pose mapping converts camera-space horizontal movement to screen direction once', () => {
  const neutral = { yaw: 0, pitch: 0 }
  const left = headPoseModule.mapHeadPoseToPoint({ yaw: 0.03, pitch: 0 }, neutral, 5)
  const center = headPoseModule.mapHeadPoseToPoint(neutral, neutral, 5)
  const right = headPoseModule.mapHeadPoseToPoint({ yaw: -0.03, pitch: 0 }, neutral, 5)
  const up = headPoseModule.mapHeadPoseToPoint({ yaw: 0, pitch: -0.03 }, neutral, 5)
  const down = headPoseModule.mapHeadPoseToPoint({ yaw: 0, pitch: 0.03 }, neutral, 5)
  assert.ok(left.x < center.x && center.x < right.x)
  assert.ok(up.y < center.y && center.y < down.y)
  assert.deepEqual(center, { x: 0.5, y: 0.5 })
  assert.ok(Math.abs(left.x - 0.248) < 1e-12)
  assert.ok(Math.abs(right.x - 0.752) < 1e-12)
  assert.ok(Math.abs(up.y - 0.248) < 1e-12)
  assert.ok(Math.abs(down.y - 0.752) < 1e-12)
  assert.equal(headPoseModule.isHeadPoseOutlier({ yaw: 0.2, pitch: 0 }, neutral, null), true)
  assert.equal(headPoseModule.isHeadPoseOutlier({ yaw: 0.2, pitch: 0 }, neutral, { yaw: 0.2, pitch: 0 }), false)
})

test('neutral-calibrated head pose maps all nine directional positions without changing vertical mapping', () => {
  const samples = Array.from({ length: 20 }, () => ({ yaw: 0.07, pitch: 0.12 }))
  const neutral = headPoseModule.averageHeadPose(samples)
  assert.ok(neutral)
  for (const [label, yawOffset, pitchOffset, expectedX, expectedY] of [
    ['top-left', 0.03, -0.03, 0.248, 0.248],
    ['top', 0, -0.03, 0.5, 0.248],
    ['top-right', -0.03, -0.03, 0.752, 0.248],
    ['left', 0.03, 0, 0.248, 0.5],
    ['center', 0, 0, 0.5, 0.5],
    ['right', -0.03, 0, 0.752, 0.5],
    ['bottom-left', 0.03, 0.03, 0.248, 0.752],
    ['bottom', 0, 0.03, 0.5, 0.752],
    ['bottom-right', -0.03, 0.03, 0.752, 0.752],
  ]) {
    const point = headPoseModule.mapHeadPoseToPoint({
      yaw: neutral.yaw + yawOffset,
      pitch: neutral.pitch + pitchOffset,
    }, neutral, 5)
    assert.ok(Math.abs(point.x - expectedX) < 1e-12, `${label} horizontal`)
    assert.ok(Math.abs(point.y - expectedY) < 1e-12, `${label} vertical`)
  }
})

test('landmark pose estimates reject incomplete faces and preserve relative feature axes', () => {
  const landmarks = Array.from({ length: 363 }, () => ({ x: 0.5, y: 0.5 }))
  landmarks[1] = { x: 0.5, y: 0.54 }
  landmarks[33] = { x: 0.3, y: 0.4 }
  landmarks[133] = { x: 0.4, y: 0.4 }
  landmarks[263] = { x: 0.7, y: 0.4 }
  landmarks[362] = { x: 0.6, y: 0.4 }
  landmarks[152] = { x: 0.5, y: 0.75 }
  const neutral = headPoseModule.estimateHeadPose(landmarks)
  assert.ok(neutral)
  assert.equal(headPoseModule.estimateHeadPose([]), null)
  landmarks[1] = { x: 0.55, y: 0.54 }
  assert.ok(headPoseModule.estimateHeadPose(landmarks).yaw > neutral.yaw)
  landmarks[1] = { x: 0.5, y: 0.59 }
  assert.ok(headPoseModule.estimateHeadPose(landmarks).pitch > neutral.pitch)
})

test('camera-space landmark movement maps monotonically to mirrored canvas positions', () => {
  const landmarks = Array.from({ length: 363 }, () => ({ x: 0.5, y: 0.5 }))
  landmarks[33] = { x: 0.3, y: 0.4 }
  landmarks[133] = { x: 0.4, y: 0.4 }
  landmarks[263] = { x: 0.7, y: 0.4 }
  landmarks[362] = { x: 0.6, y: 0.4 }
  landmarks[152] = { x: 0.5, y: 0.75 }
  const poseAt = (x) => {
    landmarks[1] = { x, y: 0.54 }
    return headPoseModule.estimateHeadPose(landmarks)
  }
  const neutral = poseAt(0.5)
  const left = headPoseModule.mapHeadPoseToPoint(poseAt(0.512), neutral)
  const center = headPoseModule.mapHeadPoseToPoint(neutral, neutral)
  const right = headPoseModule.mapHeadPoseToPoint(poseAt(0.488), neutral)
  assert.ok(left.x < center.x && center.x < right.x)
  assert.equal(left.y, center.y)
  assert.equal(right.y, center.y)
  assert.ok(Math.abs((1 - left.x) - right.x) < 1e-12)
})

test('head cursor smoothing is responsive while filtering small fluctuations', () => {
  const previous = { x: 100, y: 100 }
  assert.deepEqual(headPoseModule.smoothHeadPoint(previous, { x: 101, y: 100 }), { x: 100.24, y: 100 })
  const moved = headPoseModule.smoothHeadPoint(previous, { x: 180, y: 100 })
  assert.ok(moved.x > 100 && moved.x < 180)
})
