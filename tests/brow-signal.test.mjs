import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/browSignal.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const brow = {}
new Function('exports', compiled)(brow)

test('brow score averages usable sides and tolerates one missing or invalid side', () => {
  assert.equal(brow.browDownScore(0.2, 0.4), (0.2 + 0.4) / 2)
  assert.equal(brow.browDownScore(0.3, undefined), 0.3)
  assert.equal(brow.browDownScore(NaN, 0.35), 0.35)
  assert.equal(brow.browDownScore(-1, 2), null)
  assert.equal(brow.browDownScore(undefined, undefined), null)
})
