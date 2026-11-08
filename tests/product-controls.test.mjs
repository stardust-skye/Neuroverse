import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function loadModule(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  new Function('exports', 'require', compiled)(exports, (name) => {
    if (dependencies[name]) return dependencies[name]
    throw new Error(`Unexpected dependency ${name}`)
  })
  return exports
}

const gestures = loadModule('../src/gestures.ts')
const challenge = loadModule('../src/challenge.ts', { './gaze': {} })
const strokes = loadModule('../src/strokes.ts')
const controls = loadModule('../src/studioControls.ts')

test('facial gestures emit one blink on release and never repeat while eyes stay closed', () => {
  let state = gestures.initialGestureState
  let result = gestures.updateFacialGesture(state, { leftEar: 0.1, rightEar: 0.1, timestamp: 100 })
  state = result.state
  assert.equal(result.event, null)
  result = gestures.updateFacialGesture(state, { leftEar: 0.1, rightEar: 0.1, timestamp: 180 })
  state = result.state
  assert.equal(result.event, null)
  result = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.3, timestamp: 220 })
  state = result.state
  assert.equal(result.event, 'NORMAL_BLINK')
  result = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.3, timestamp: 240 })
  assert.equal(result.event, null)
})

test('a sustained single-eye closure emits one side-specific wink, not a blink', () => {
  let state = gestures.initialGestureState
  let result = gestures.updateFacialGesture(state, { leftEar: 0.1, rightEar: 0.3, timestamp: 100 })
  state = result.state
  assert.equal(result.event, null)
  result = gestures.updateFacialGesture(state, { leftEar: 0.1, rightEar: 0.3, timestamp: 400 })
  state = result.state
  assert.equal(result.event, null)
  result = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.3, timestamp: 430 })
  assert.equal(result.event, null)
  state = gestures.initialGestureState
  result = gestures.updateFacialGesture(state, { leftEar: 0.1, rightEar: 0.3, timestamp: 500 })
  state = result.state
  result = gestures.updateFacialGesture(state, { leftEar: 0.1, rightEar: 0.3, timestamp: 800 })
  state = result.state
  assert.equal(result.event, null)
  result = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.3, timestamp: 900 })
  state = result.state
  assert.equal(result.event, 'LEFT_WINK')
  result = gestures.updateFacialGesture(state, { leftEar: 0.1, rightEar: 0.3, timestamp: 950 })
  state = result.state
  assert.equal(result.event, null)
  result = gestures.updateFacialGesture(state, { leftEar: 0.1, rightEar: 0.3, timestamp: 1250 })
  state = result.state
  assert.equal(result.event, null)
  result = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.3, timestamp: 1300 })
  assert.equal(result.event, null)
})

test('right wink is distinguished and an ordinary short one-eye closure is suppressed', () => {
  let state = gestures.initialGestureState
  let result = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.1, timestamp: 100 })
  state = result.state
  result = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.3, timestamp: 200 })
  assert.equal(result.event, null)

  state = gestures.initialGestureState
  result = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.1, timestamp: 1_000 })
  state = result.state
  result = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.1, timestamp: 1_300 })
  state = result.state
  assert.equal(result.event, null)
  result = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.3, timestamp: 1_400 })
  assert.equal(result.event, 'RIGHT_WINK')
})

test('gesture sensitivity changes eye-closure threshold without changing neutral state', () => {
  const observation = { leftEar: 0.19, rightEar: 0.3, timestamp: 100 }
  const sensitive = gestures.updateFacialGesture(gestures.initialGestureState, observation, 10)
  const lessSensitive = gestures.updateFacialGesture(gestures.initialGestureState, observation, 1)
  assert.equal(sensitive.state.candidate, 'left-wink')
  assert.equal(lessSensitive.state.candidate, null)
  assert.equal(gestures.updateFacialGesture(gestures.initialGestureState, {
    leftEar: 0.3, rightEar: 0.3, timestamp: 100,
  }).event, null)
})

test('hold-to-draw starts once, ignores editable inputs, and stops on release', () => {
  assert.equal(controls.shouldStartSpaceDrawing('Space', false, false), true)
  assert.equal(controls.shouldStartSpaceDrawing('Space', true, false), false)
  assert.equal(controls.shouldStartSpaceDrawing('Space', false, true), false)
  assert.equal(controls.shouldStopSpaceDrawing('Space', true), true)
  assert.equal(controls.shouldStopSpaceDrawing('Space', false), false)
  assert.equal(controls.shouldStopSpaceDrawing('Escape', true), false)
})

test('lost face pauses active camera drawing, but not keyboard-only fallback', () => {
  assert.equal(controls.shouldPauseForLostFace(true, true, false), true)
  assert.equal(controls.shouldPauseForLostFace(true, true, true), false)
  assert.equal(controls.shouldPauseForLostFace(true, false, false), false)
  assert.equal(controls.shouldPauseForLostFace(false, true, false), false)
})

test('unknown or poor-quality workload never increases challenge difficulty', () => {
  const initial = { ...challenge.initialChallengeState, lastDifficultyChangeAt: 1_000 }
  const success = { coverage: 0.9, accuracy: 0.95, elapsedSeconds: 20, misses: 2 }
  let state = challenge.adaptChallenge(initial, success, 'low', 12_000)
  assert.equal(state.targetScale, initial.targetScale)
  state = challenge.adaptChallenge(state, success, 'unknown', 24_000)
  assert.equal(state.targetScale, initial.targetScale)
  state = challenge.adaptChallenge(state, { ...success, accuracy: 0.4 }, 'low', 36_000)
  assert.equal(state.targetScale, initial.targetScale)
  assert.equal(state.successfulRounds, 0)
})

test('poor performance cannot shrink the target and high strain expands it', () => {
  const state = { ...challenge.initialChallengeState, lastDifficultyChangeAt: 1_000 }
  const poor = { coverage: 0.4, accuracy: 0.5, elapsedSeconds: 30, misses: 15 }
  const low = challenge.adaptChallenge(state, poor, 'low', 12_000)
  assert.equal(low.targetScale, state.targetScale)
  const high = challenge.adaptChallenge(state, poor, 'high', 24_000)
  assert.equal(high.targetScale, state.targetScale + 0.04)
})

test('low strain plus repeated successful rounds makes a small, rate-limited change', () => {
  const success = { coverage: 0.9, accuracy: 0.95, elapsedSeconds: 20, misses: 2 }
  const first = challenge.adaptChallenge(
    { ...challenge.initialChallengeState, lastDifficultyChangeAt: 1_000 },
    success,
    'low',
    12_000,
  )
  assert.equal(first.targetScale, challenge.initialChallengeState.targetScale)
  const second = challenge.adaptChallenge(first, success, 'low', 24_000)
  assert.equal(second.targetScale, first.targetScale - 0.025)
  const high = challenge.adaptChallenge(second, success, 'high', 36_000)
  assert.equal(high.targetScale, second.targetScale + 0.04)
})

test('challenge completion requires 70 percent valid coverage', () => {
  assert.equal(controls.canCompleteChallenge(0.69), false)
  assert.equal(controls.canCompleteChallenge(0.7), true)
  assert.equal(controls.canCompleteChallenge(Number.NaN), false)
})

test('challenge target grid accepts points only inside its square', () => {
  const bounds = { left: 0, top: 0, width: 1000, height: 800 }
  assert.equal(challenge.targetGridCell({ x: 500, y: 400 }, bounds, 0.5), 36)
  assert.equal(challenge.targetGridCell({ x: 10, y: 10 }, bounds, 0.5), null)
})

test('stroke records preserve segment order, style, time and clone independently', () => {
  const first = {
    from: { x: 1, y: 2, timestamp: 10 },
    to: { x: 3, y: 4, timestamp: 20 },
    brush: 'normal',
    color: '#ffffff',
    size: 8,
  }
  const second = { ...first, from: first.to, to: { x: 5, y: 6, timestamp: 30 } }
  const history = strokes.appendStrokeSegment([], first, true)
  const continued = strokes.appendStrokeSegment(history, second, false)
  const cloned = strokes.cloneStrokeHistory(continued)
  assert.equal(cloned.length, 1)
  assert.deepEqual(cloned[0].segments.map(({ to }) => to.timestamp), [20, 30])
  cloned[0].segments[0].from.x = 999
  assert.equal(continued[0].segments[0].from.x, 1)
})
