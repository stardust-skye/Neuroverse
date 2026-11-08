export function browDownScore(left: number | undefined, right: number | undefined): number | null {
  const scores = [left, right].filter((score): score is number =>
    typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1)
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null
}
