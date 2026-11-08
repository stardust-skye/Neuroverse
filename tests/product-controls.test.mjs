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
const gestureController = loadModule('../src/gestureController.ts')
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

test('successive blinks navigate rather than toggle drawing', () => {
  let gestureState = gestures.initialGestureState
  const actions = []
  for (const observation of [
    { leftEar: 0.1, rightEar: 0.1, timestamp: 1_000 },
    { leftEar: 0.3, rightEar: 0.3, timestamp: 1_100 },
    { leftEar: 0.1, rightEar: 0.1, timestamp: 1_300 },
    { leftEar: 0.3, rightEar: 0.3, timestamp: 1_400 },
  ]) {
    const result = gestures.updateFacialGesture(gestureState, observation)
    gestureState = result.state
    if (result.event) {
      actions.push(gestureController.processGesture(result.event))
    }
  }
  assert.deepEqual(actions, ['navigate', 'navigate'])
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
  assert.equal(result.event, 'LEFT_WINK')
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

test('natural wink selects and an asymmetric reopening remains a blink', () => {
  let state = gestures.updateFacialGesture(gestures.initialGestureState, {
    leftEar: 0.1, rightEar: 0.3, timestamp: 100,
  }).state
  const wink = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.3, timestamp: 300 })
  assert.equal(gestureController.processGesture(wink.event), 'select')
  state = gestures.updateFacialGesture(gestures.initialGestureState, {
    leftEar: 0.1, rightEar: 0.1, timestamp: 100,
  }).state
  state = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.1, timestamp: 160 }).state
  const blink = gestures.updateFacialGesture(state, { leftEar: 0.3, rightEar: 0.3, timestamp: 200 })
  assert.equal(blink.event, 'NORMAL_BLINK')
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

test('gaze contact or a crossing segment immediately hits the box', () => {
  const box = { left: 100, top: 100, right: 200, bottom: 200 }
  const touches = challenge.segmentTouchesTarget
  assert.equal(touches({ x: 190, y: 190 }, { x: 190, y: 190 }, box), true)
  assert.equal(touches({ x: 90, y: 150 }, { x: 110, y: 150 }, box), true)
  assert.equal(touches({ x: 50, y: 150 }, { x: 250, y: 150 }, box), true)
  assert.equal(touches({ x: 100, y: 50 }, { x: 100, y: 100 }, box), true)
  assert.equal(touches({ x: 50, y: 99 }, { x: 250, y: 99 }, box), false)
  assert.equal(touches({ x: 50, y: 150 }, { x: 90, y: 150 }, box), false)
  assert.equal(touches({ x: NaN, y: 150 }, { x: 110, y: 150 }, box), false)
})

test('each successful target shrinks within the minimum and spawns away from the cursor', () => {
  const area = { width: 1000, height: 800, top: 100, bottom: 650 }
  const previous = { x: 0.5, y: 0.5 }
  const cursor = { x: 500, y: 375 }
  const next = challenge.completePlayTarget(challenge.initialPlayTarget)
  assert.equal(next.scale, 0.375)
  for (const random of [0, 0.2, 0.5, 0.9, 1]) {
    const position = challenge.nextTargetPosition(area, next.scale, previous, cursor, random)
    const box = challenge.targetRect(area, next.scale, position)
    assert.ok(box.left >= 0 && box.right <= area.width && box.top >= area.top && box.bottom <= area.bottom)
    assert.ok(Math.hypot(position.x - previous.x, position.y - previous.y) >= 0.35)
    assert.equal(challenge.pointInTarget(cursor, box), false)
  }
  assert.equal(challenge.completePlayTarget({ ...next, scale: 0.14 }).scale, 0.14)
})

test('sustained eyebrow scrunch gradually enlarges the target', () => {
  let state = { ...challenge.initialPlayTarget }
  for (let t = 0; t <= 500; t += 100) state = challenge.updatePlayTarget(state, t, 0.8)
  assert.equal(state.scale, 0.4)
  for (let t = 600; t <= 3000; t += 100) state = challenge.updatePlayTarget(state, t, 0.8)
  assert.ok(state.scale > 0.4)
  const scale = state.scale
  state = challenge.updatePlayTarget(state, 4000, 0.8)
  assert.equal(state.scale, scale)
  state = challenge.updatePlayTarget(state, 4100, Number.NaN)
  assert.equal(state.scale, scale)
  let high = { ...challenge.initialPlayTarget, scale: 0.65 }
  for (let t = 0; t < 5000; t += 100) high = challenge.updatePlayTarget(high, t, 0.9)
  assert.equal(high.scale, 0.65)
})

test('moderate sustained brow scores grow noticeably, relaxation stops growth, and threshold is adjustable', () => {
  let state = { ...challenge.initialPlayTarget }
  for (let t = 0; t <= 500; t += 100) state = challenge.updatePlayTarget(state, t, 0.32)
  assert.equal(state.scale, 0.4)
  for (let t = 600; t <= 2000; t += 100) state = challenge.updatePlayTarget(state, t, 0.32)
  assert.ok(state.scale >= 0.52 && state.scale <= 0.54)
  const grown = state.scale
  for (let t = 2100; t <= 4000; t += 100) state = challenge.updatePlayTarget(state, t, 0.1)
  assert.equal(state.scale, grown)
  let lessSensitive = { ...challenge.initialPlayTarget }
  for (let t = 0; t <= 2000; t += 100) lessSensitive = challenge.updatePlayTarget(lessSensitive, t, 0.32, 0.5)
  assert.equal(lessSensitive.scale, 0.4)
  let moreSensitive = { ...challenge.initialPlayTarget }
  for (let t = 0; t <= 2000; t += 100) moreSensitive = challenge.updatePlayTarget(moreSensitive, t, 0.2, 0.15)
  assert.ok(moreSensitive.scale > 0.4)
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

test('play trail fades continuously and expires after two seconds', () => {
  assert.equal(strokes.playTrailOpacity(1000, 1000), 1)
  assert.equal(strokes.playTrailOpacity(1000, 2000), 0.5)
  assert.ok(Math.abs(strokes.playTrailOpacity(1000, 2999) - 0.0005) < 1e-10)
  assert.equal(strokes.playTrailOpacity(1000, 3000), 0)
  assert.equal(strokes.playTrailOpacity(1000, 4000), 0)
  assert.equal(strokes.playTrailOpacity(1000, 999), 1)
})
