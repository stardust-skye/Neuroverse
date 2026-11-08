import type { ArtParticle } from './artParticles'

export type StrokePoint = { x: number; y: number; timestamp: number }
export type StrokeSegment = {
  from: StrokePoint
  to: StrokePoint
  brush: string
  color: string
  size: number
  particles?: ArtParticle[]
}
export type RecordedStroke = { segments: StrokeSegment[] }

export const PLAY_TRAIL_LIFETIME_MS = 2000

export function playTrailOpacity(timestamp: number, now: number): number {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return 0
  return Math.max(0, 1 - Math.max(0, now - timestamp) / PLAY_TRAIL_LIFETIME_MS)
}

export function appendStrokeSegment(
  strokes: RecordedStroke[],
  segment: StrokeSegment,
  newStroke: boolean,
): RecordedStroke[] {
  const last = strokes[strokes.length - 1]
  if (newStroke || !last) return [...strokes, { segments: [segment] }]
  return [
    ...strokes.slice(0, -1),
    { segments: [...last.segments, segment] },
  ]
}

export function cloneStrokeHistory(strokes: RecordedStroke[]): RecordedStroke[] {
  return strokes.map(({ segments }) => ({
    segments: segments.map((segment) => ({
      ...segment,
      from: { ...segment.from },
      to: { ...segment.to },
      particles: segment.particles?.map((particle) => ({ ...particle })),
    })),
  }))
}
