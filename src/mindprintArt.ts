import type { MindprintVisuals } from './mindprintSignal'

export function renderMindprintArt(canvas: HTMLCanvasElement, visuals: MindprintVisuals, time: number) {
  const context = canvas.getContext('2d')
  if (!context) return
  const { width, height } = canvas
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.35
  const t = time / 1000
  const hue = visuals.hue
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#070916'
  context.fillRect(0, 0, width, height)
  const glow = context.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.8)
  glow.addColorStop(0, `hsla(${hue}, 75%, 31%, .37)`)
  glow.addColorStop(.52, `hsla(${hue + 55}, 75%, 17%, .2)`)
  glow.addColorStop(1, 'transparent')
  context.fillStyle = glow
  context.fillRect(0, 0, width, height)
  context.globalCompositeOperation = 'screen'
  for (let ring = 0; ring < 100; ring++) {
    const phase = ring * .145 + t * .19
    const base = radius * (.26 + ring / 155)
    const ripple = visuals.ripple
    context.beginPath()
    for (let i = 0; i <= 160; i++) {
      const angle = i * Math.PI * 2 / 160
      const r = base * (1 + ripple * Math.sin(angle * 3 + phase) + (.05 + visuals.texture * .17) * Math.cos(angle * 7 - phase * .8))
      const x = cx + Math.cos(angle + Math.sin(phase) * .12) * r * (1.05 + visuals.activity * .25 + visuals.balance * .2)
      const y = cy + Math.sin(angle) * r * .8
      if (i === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.strokeStyle = `hsla(${hue + ring * .7}, 90%, ${69 + 13 * Math.sin(phase)}%, ${.055 + (ring % 9 === 0 ? .18 : .045)})`
    context.lineWidth = Math.max(.7, width / 1600)
    context.stroke()
  }
  for (let i = 0; i < 110; i++) {
    const a = i * 2.39996 + t * (.02 + visuals.activity * .14)
    const r = radius * (.2 + ((i * 73) % 103) / 100 * (1.1 + visuals.activity * .7))
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r * .72
    const size = Math.max(.7, width / 1500) * (1 + (i % 5 === 0 ? 1.4 : 0))
    context.fillStyle = `hsla(${hue + i}, 95%, 85%, ${.18 + .35 * (1 + Math.sin(t * 1.6 + i)) / 2})`
    context.beginPath()
    context.arc(x, y, size, 0, Math.PI * 2)
    context.fill()
  }
  context.globalCompositeOperation = 'source-over'
}
