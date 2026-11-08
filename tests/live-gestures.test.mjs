import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/liveGestures.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const gestures = {}
new Function('exports', compiled)(gestures)
const now = 100_000
const message = { type: 'live_gestures', source: 'live', quality: 'good', timestamp: now, blinkCount: 0, winkCount: 1, jawClenched: false }

test('requires a fresh, quality-checked live prediction with valid gesture counters and jaw state', () => {
  const parsed = gestures.parseLiveGestures(message, now)
  assert.deepEqual(parsed, { timestamp: now, blinkCount: 0, winkCount: 1, jawClenched: false })
  for (const invalid of [
    { ...message, source: 'replay' }, { ...message, quality: 'poor' },
    { ...message, timestamp: now - 1501 }, { ...message, timestamp: now + 1001 },
    { ...message, blinkCount: -1 }, { ...message, winkCount: 0.1 },
    { ...message, jawClenched: 1 }, { type: 'samples', data: [[1]] }, null,
  ]) assert.equal(gestures.parseLiveGestures(invalid, now), null)
  assert.equal(gestures.liveGesturesFresh(parsed, now + 1500), true)
  assert.equal(gestures.liveGesturesFresh(parsed, now + 1501), false)
  assert.equal(gestures.liveGesturesFresh(null, now), false)
})
