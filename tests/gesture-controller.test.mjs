import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/gestureController.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const controller = {}
new Function('exports', compiled)(controller)

test('a single blink navigates menu controls and a wink selects', () => {
  assert.equal(controller.processGesture('NORMAL_BLINK'), 'navigate')
  assert.equal(controller.processGesture('LEFT_WINK'), 'select')
  assert.equal(controller.processGesture('RIGHT_WINK'), 'select')
})
