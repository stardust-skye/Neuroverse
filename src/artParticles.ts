import type { GazePoint } from './gaze'

export type ArtParticle = { x: number; y: number; radius: number; alpha: number; phase: number }

export function createBrushParticles(
  from: GazePoint,
  to: GazePoint,
  size: number,
  brush: string,
  random: () => number = Math.random,
): ArtParticle[] {
  if (brush !== 'spray' && brush !== 'particle') return []
  const dx = to.x - from.x
  const dy = to.y - from.y
  const angle = Math.atan2(dy, dx)
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(3, size * (brush === 'spray' ? 0.35 : 0.3))))
  const particles: ArtParticle[] = []
  for (let step = 0; step <= steps; step++) {
    const centerX = from.x + dx * step / steps
    const centerY = from.y + dy * step / steps
    const count = brush === 'spray' ? Math.min(7, Math.max(3, Math.round(size / 2))) : 4
    for (let index = 0; index < count; index++) {
      if (brush === 'spray') {
        const theta = random() * Math.PI * 2
        const distance = Math.sqrt(random()) * size * 1.8
        particles.push({ x: centerX + Math.cos(theta) * distance, y: centerY + Math.sin(theta) * distance, radius: 0.55 + random() * 1.45, alpha: 0.28 + random() * 0.62, phase: random() * Math.PI * 2 })
      } else {
        const side = index % 2 === 0 ? 1 : -1
        const trail = random() * size * 1.15
        const spread = (random() - 0.5) * size * 1.4
        particles.push({ x: centerX - Math.cos(angle) * trail - Math.sin(angle) * spread * side, y: centerY - Math.sin(angle) * trail + Math.cos(angle) * spread * side, radius: Math.max(0.7, size * (0.08 + random() * 0.16)), alpha: 0.48 + random() * 0.48, phase: random() * Math.PI * 2 })
      }
    }
  }
  return particles
}

export function particlePosition(particle: ArtParticle, timestamp: number): GazePoint {
  const drift = timestamp / 460
  const shimmer = timestamp / 320
  return {
    x: particle.x + Math.sin(drift + particle.phase) * 3.8 + Math.sin(shimmer + particle.phase * 2) * 0.8,
    y: particle.y + Math.cos(drift * 0.83 + particle.phase) * 3.8 + Math.cos(shimmer * 0.9 + particle.phase * 2) * 0.8,
  }
}

export function particleGlow(particle: ArtParticle, timestamp: number): { alpha: number; radius: number } {
  const sparkle = (1 + Math.sin(timestamp / 360 + particle.phase * 2)) / 2
  return {
    alpha: particle.alpha * (0.65 + sparkle * 0.35),
    radius: particle.radius * (0.85 + sparkle * 0.4),
  }
}
