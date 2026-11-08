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

const meta = { type: 'meta', name: 'ANT EEG', srate: 1000, channels: ['Fp1', 'Fp2', 'Trigger'], channel_types: ['Referential', 'Referential', 'TRG'] }

test('requires usable stream metadata and rejects the bridge simulator', () => {
  assert.deepEqual(signal.parseMindprintMeta(meta), { name: meta.name, srate: 1000, channels: meta.channels, eegIndices: [0, 1] })
  for (const bad of [{ ...meta, name: 'SIMULATED' }, { ...meta, srate: 0 }, { ...meta, channels: [] }, { ...meta, name: 'none' }, { ...meta, channel_types: ['TRG', '', 'TRG'] }, { ...meta, channel_types: ['EEG'] }]) {
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

test('25-channel stream excludes trigger values before computing art features', () => {
  const liveMeta = signal.parseMindprintMeta({
    type: 'meta', name: 'ANT EEG', srate: 1000,
    channels: [...Array.from({ length: 24 }, (_, i) => `E${i + 1}`), 'Trigger'],
    channel_types: [...Array(24).fill('Referential'), 'TRG'],
  })
  assert.ok(liveMeta)
  assert.equal(liveMeta.eegIndices.length, 24)
  const rows = Array.from({ length: 1000 }, (_, i) => [
    ...Array.from({ length: 24 }, (_, c) => 0.00001 * Math.sin(i * 0.08 + c)),
    i % 2 ? 99999 : 0,
  ])
  const selected = signal.selectEegSamples(rows, liveMeta.eegIndices)
  assert.equal(selected[0].length, 24)
  const features = signal.mindprintFeatures(selected, 24)
  const altered = rows.map((row) => [...row.slice(0, 24), 1e9])
  assert.ok(features)
  assert.deepEqual(signal.mindprintFeatures(signal.selectEegSamples(altered, liveMeta.eegIndices), 24), features)
})

test('a localized sustained signal change visibly alters the art and returns on release', () => {
  const rows = (factor) => Array.from({ length: 500 }, (_, i) =>
    Array.from({ length: 24 }, (_, channel) =>
      0.00001 * (channel < 6 ? factor : 1) * Math.sin(i * 0.08 + channel)))
  const neutral = signal.mindprintFeatures(rows(1), 24)
  const changed = signal.mindprintFeatures(rows(3), 24)
  assert.ok(neutral && changed)
  const baseline = signal.createMindprintBaseline(neutral)
  const restingArt = signal.mindprintVisuals(neutral, baseline)
  const changedArt = signal.mindprintVisuals(changed, baseline)
  assert.ok(changedArt.activity - restingArt.activity >= 0.3)
  assert.ok(Math.abs(changedArt.hue - restingArt.hue) >= 50)
  assert.ok(Math.abs(changedArt.ripple - restingArt.ripple) >= 0.12)
  assert.deepEqual(signal.mindprintVisuals(neutral, baseline), restingArt)
})

test('signal changes alter the rendered ring colors and geometry at the same animation time', () => {
  const componentSource = readFileSync(new URL('../src/mindprintArt.ts', import.meta.url), 'utf8')
  const component = ts.transpileModule(componentSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  new Function('exports', component)(exports)
  const draw = (visuals) => {
    const strokes = []
    let points = []
    const context = {
      clearRect() {}, fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }),
      beginPath() { points = [] }, moveTo(x, y) { points.push([x, y]) },
      lineTo(x, y) { points.push([x, y]) },
      stroke() { strokes.push({ color: this.strokeStyle, points: [...points] }) },
      arc() {}, fill() {},
    }
    exports.renderMindprintArt({ width: 1000, height: 800, getContext: () => context }, visuals, 1000)
    return strokes
  }
  const rows = (factor) => Array.from({ length: 500 }, (_, i) =>
    Array.from({ length: 24 }, (_, channel) =>
      0.00001 * (channel < 6 ? factor : 1) * Math.sin(i * 0.08 + channel)))
  const neutral = signal.mindprintFeatures(rows(1), 24)
  const changed = signal.mindprintFeatures(rows(3), 24)
  const baseline = signal.createMindprintBaseline(neutral)
  const first = draw(signal.mindprintVisuals(neutral, baseline))
  const second = draw(signal.mindprintVisuals(changed, baseline))
  assert.equal(first.length, 100)
  assert.notEqual(first[20].color, second[20].color)
  const distances = first[20].points.map(([x, y], i) =>
    Math.hypot(x - second[20].points[i][0], y - second[20].points[i][1]))
  assert.ok(Math.max(...distances) > 20, 'shape changes by at least 20 pixels at 1000x800')
})
