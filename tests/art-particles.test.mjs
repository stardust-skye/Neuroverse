import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function loadModule(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  new Function('exports', compiled)(exports)
  return exports
}

const particles = loadModule('../src/artParticles.ts')
const strokes = loadModule('../src/strokes.ts')

test('spray and particle marks have stable, bounded animated positions', () => {
  for (const brush of ['spray', 'particle']) {
    const marks = particles.createBrushParticles({ x: 10, y: 20 }, { x: 20, y: 30 }, 8, brush, () => 0.5)
    assert.ok(marks.length > 0)
    for (const mark of marks) {
      const first = particles.particlePosition(mark, 0)
      const second = particles.particlePosition(mark, 800)
      assert.notDeepEqual(first, second)
      for (const point of [first, second]) {
        assert.ok(Math.abs(point.x - mark.x) <= 4.6)
        assert.ok(Math.abs(point.y - mark.y) <= 4.6)
      }
      const glow = particles.particleGlow(mark, 800)
      assert.ok(glow.alpha >= mark.alpha * 0.65 && glow.alpha <= mark.alpha)
      assert.ok(glow.radius >= mark.radius * 0.85 && glow.radius <= mark.radius * 1.25)
    }
  }
  assert.deepEqual(particles.createBrushParticles({ x: 0, y: 0 }, { x: 1, y: 1 }, 8, 'normal'), [])
})

test('particle movement is visible within a short interval and remains anchored', () => {
  const mark = { x: 100, y: 120, radius: 2, alpha: 0.8, phase: 0 }
  const start = particles.particlePosition(mark, 0)
  const moved = particles.particlePosition(mark, 400)
  assert.ok(Math.hypot(moved.x - start.x, moved.y - start.y) > 2)
  assert.notDeepEqual(particles.particleGlow(mark, 0), particles.particleGlow(mark, 400))
  assert.deepEqual(mark, { x: 100, y: 120, radius: 2, alpha: 0.8, phase: 0 })
})

test('stroke snapshots clone particle marks without changing the original', () => {
  const original = [{ segments: [{
    from: { x: 1, y: 2, timestamp: 0 },
    to: { x: 3, y: 4, timestamp: 1 },
    brush: 'spray', color: '#ffffff', size: 8,
    particles: [{ x: 2, y: 3, radius: 1, alpha: 0.5, phase: 0 }],
  }] }]
  const copy = strokes.cloneStrokeHistory(original)
  copy[0].segments[0].particles[0].x = 99
  assert.equal(original[0].segments[0].particles[0].x, 2)
})
