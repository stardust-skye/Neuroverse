// Live 24-channel scalp map: measured EEG activity (1-40 Hz power vs. the wearer's running baseline).
const POSITIONS: Record<string, [number, number]> = {
  Fp1: [-0.3, -0.88], Fp2: [0.3, -0.88], F9: [-0.86, -0.42], F7: [-0.64, -0.54], F3: [-0.34, -0.46],
  Fz: [0, -0.44], F4: [0.34, -0.46], F8: [0.64, -0.54], F10: [0.86, -0.42], T9: [-1.0, 0],
  T7: [-0.78, 0], C3: [-0.4, 0], C4: [0.4, 0], T8: [0.78, 0], T10: [1.0, 0], P9: [-0.86, 0.42],
  P7: [-0.64, 0.54], P3: [-0.34, 0.46], Pz: [0, 0.44], P4: [0.34, 0.46], P8: [0.64, 0.54],
  P10: [0.86, 0.42], O1: [-0.3, 0.88], O2: [0.3, 0.88],
}

function color(value: number) {
  const v = Math.max(0, Math.min(1, value))
  const from = [20, 184, 166]
  const to = [245, 158, 11]
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * v))
  return `rgb(${c.join(',')})`
}

export default function ScalpMap({ activity, quality, size = 220, highlight = [] }: {
  activity: Record<string, number>
  quality: Record<string, string>
  size?: number
  highlight?: string[]
}) {
  return (
    <svg viewBox="-1.25 -1.2 2.5 2.4" width={size} height={size * 0.96} role="img" aria-label="Live EEG scalp map">
      <circle cx="0" cy="0" r="1.08" fill="var(--surface-2)" stroke="var(--line)" strokeWidth="0.02" />
      <path d="M -0.12 -1.07 L 0 -1.2 L 0.12 -1.07" fill="none" stroke="var(--line)" strokeWidth="0.02" />
      {Object.entries(POSITIONS).map(([name, [x, y]]) => {
        const q = quality[name]
        const value = activity[name]
        return (
          <g key={name}>
            <circle cx={x} cy={y} r={0.12} fill={value === undefined ? 'var(--muted-2)' : color(value)}
              opacity={value === undefined ? 0.5 : 0.35 + 0.65 * value}
              stroke={q === 'flat' ? '#dc2626' : q === 'noisy' ? '#f59e0b' : highlight.includes(name) ? 'var(--text)' : 'transparent'}
              strokeWidth="0.03" />
            <text x={x} y={y + 0.035} fontSize="0.085" textAnchor="middle" fill="var(--text)">{name}</text>
          </g>
        )
      })}
    </svg>
  )
}
