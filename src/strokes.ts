export type StrokePoint = { x: number; y: number; timestamp: number }
export type StrokeSegment = {
  from: StrokePoint
  to: StrokePoint
  brush: string
  color: string
  size: number
}
export type RecordedStroke = { segments: StrokeSegment[] }

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
    })),
  }))
}
