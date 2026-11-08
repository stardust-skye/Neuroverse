import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function load(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  new Function('exports', compiled)(exports)
  return exports
}

const eeg = load('../src/playEeg.ts')
const challenge = load('../src/challenge.ts')
const now = 100_000
const message = { type: 'live_stress', source: 'live', quality: 'good', state: 'stressed', timestamp: now }

test('only fresh quality-checked live predictions are accepted', () => {
  assert.deepEqual(eeg.parseLiveStress(message, now), { state: 'stressed', timestamp: now })
  for (const invalid of [
    { ...message, source: 'replay' },
    { ...message, quality: 'poor' },
    { ...message, timestamp: now - 5001 },
    { ...message, timestamp: now + 1001 },
    { ...message, timestamp: NaN },
    { ...message, state: 'high' },
    { type: 'samples', data: [[1, 2]] },
    null,
  ]) assert.equal(eeg.parseLiveStress(invalid, now), null)
})

test('fresh EEG wins over eyebrow and stale EEG reverts to fallback', () => {
  const stressed = eeg.parseLiveStress(message, now)
  const relaxed = eeg.parseLiveStress({ ...message, state: 'relaxed' }, now)
  assert.equal(eeg.selectPlaySignal(stressed, now, true), 'eeg-stressed')
  assert.equal(eeg.selectPlaySignal(relaxed, now, true), 'eeg-relaxed')
  assert.equal(eeg.selectPlaySignal(stressed, now + 5001, true), 'brow')
  assert.equal(eeg.selectPlaySignal(stressed, now + 5001, false), 'none')
  assert.equal(eeg.selectPlaySignal(null, now, true), 'brow')
})

test('EEG stress gradually grows box and relaxation never overrides normal game shrinking', () => {
  let state = { ...challenge.initialPlayTarget }
  for (let time = 0; time <= 2000; time += 100) state = challenge.updatePlayTarget(state, time, 1)
  assert.ok(state.scale > 0.4)
  const grown = state.scale
  state = challenge.updatePlayTarget(state, 2100, null)
  for (let time = 2200; time <= 4000; time += 100) state = challenge.updatePlayTarget(state, time, 0)
  assert.equal(state.scale, grown)
  assert.ok(challenge.completePlayTarget(state).scale < grown)
})
