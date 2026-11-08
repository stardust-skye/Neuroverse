import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/mindprintSignal.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const signal = {}
new Function('exports', compiled)(signal)

const meta = { type: 'meta', name: 'ANT EEG', srate: 500, channels: ['A', 'B'] }

test('requires usable stream metadata and rejects the bridge simulator', () => {
  assert.deepEqual(signal.parseMindprintMeta(meta), { name: meta.name, srate: 500, channels: meta.channels })
  for (const bad of [{ ...meta, name: 'SIMULATED' }, { ...meta, srate: 0 }, { ...meta, channels: [] }, { ...meta, name: 'none' }]) {
    assert.equal(signal.parseMindprintMeta(bad), null)
  }
})

test('accepts only complete finite sample batches', () => {
  const good = { type: 'samples', t0: 1, data: [[1, 2], [3, 4]] }
  assert.deepEqual(signal.parseMindprintSamples(good, 2), good.data)
  for (const bad of [{ ...good, t0: NaN }, { ...good, data: [[1]] }, { ...good, data: [[1, NaN]] }, { ...good, data: [] }]) {
    assert.equal(signal.parseMindprintSamples(bad, 2), null)
  }
})

test('signal features vary with actual sample patterns and reject flat data', () => {
  const wave = (rate) => Array.from({ length: 500 }, (_, i) => [Math.sin(i * rate), Math.cos(i * rate * 1.5)])
  const slow = signal.mindprintFeatures(wave(.1), 2)
  const fast = signal.mindprintFeatures(wave(.5), 2)
  assert.ok(slow && fast)
  assert.ok(fast.texture > slow.texture)
  assert.notDeepEqual(fast, slow)
  assert.equal(signal.mindprintFeatures(Array.from({ length: 500 }, () => [3, 3]), 2), null)
  assert.equal(signal.mindprintFeatures(wave(.1).slice(0, 49), 2), null)
})
