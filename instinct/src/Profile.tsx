import { useEffect, useState } from 'react'
import { api } from './api'
import Device3D from './SafeDevice'
import type { useLive } from './useLive'

type ProfileData = {
  user: string
  preferences: { category: string; text: string; confirmations: number }[]
  reactions: { id: number; chunk: string; score: number; errp: number; frown: number; flagged: number; decision: string | null; simulated: number }[]
  stats: { chunks_read: number; flagged: number; confirmed: number; overridden: number }
  validation: null | { within_person_balanced_accuracy: number; cross_person_balanced_accuracy: number | null; subjects: number; trials: number; dataset: string; note: string }
}

export default function Profile({ live }: { live: ReturnType<typeof useLive> }) {
  const [data, setData] = useState<ProfileData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const load = () => api<ProfileData>('/profile').then(setData).catch((e: Error) => setError(e.message))
    load()
    const timer = setInterval(load, 4000)
    return () => clearInterval(timer)
  }, [])

  const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`)
  return (
    <div className="grid profile">
      <section className="card device">
        <h2>Your device</h2>
        <Device3D signal={live.activity} height={300} />
        <p className="muted small">Pads glow with the live EEG activity under them. Over-ear form factor: the band covers C3 · Cz · C4, the cushions T7 / T8.</p>
      </section>

      <section className="card">
        <h2>What your reactions taught the AI</h2>
        {!data?.preferences.length && <p className="muted">Nothing learned yet. Run a session and confirm a flagged phrase with a nod.</p>}
        <ul className="prefs">
          {data?.preferences.map((p) => (
            <li key={p.category}><strong>{p.text}</strong><span className="muted small">learned from {p.confirmations} confirmed reaction{p.confirmations === 1 ? '' : 's'}</span></li>
          ))}
        </ul>
        <div className="stats">
          <div><b>{data?.stats.chunks_read ?? 0}</b><span>phrases read</span></div>
          <div><b>{data?.stats.flagged ?? 0}</b><span>reactions</span></div>
          <div><b>{data?.stats.confirmed ?? 0}</b><span>confirmed (nod)</span></div>
          <div><b>{data?.stats.overridden ?? 0}</b><span>overridden (shake)</span></div>
        </div>
      </section>

      <section className="card">
        <h2>Is the signal real?</h2>
        {data?.validation ? (
          <>
            <div className="stats">
              <div><b>{pct(data.validation.within_person_balanced_accuracy)}</b><span>after calibration (same person)</span></div>
              <div><b>{pct(data.validation.cross_person_balanced_accuracy)}</b><span>new person, no calibration</span></div>
              <div><b>50%</b><span>chance</span></div>
            </div>
            <p className="muted small">Our live error-response detector, unchanged, on {data.validation.dataset}: {data.validation.subjects} people, {data.validation.trials} trials, single-trial balanced accuracy. {data.validation.note} That is why every flag asks you to confirm.</p>
          </>
        ) : <p className="muted">Not run yet: <code>python -m ml.instinct.validate_public</code></p>}
      </section>

      <section className="card wide">
        <div className="row between">
          <h2>Neural preference dataset</h2>
          <a className="button" href="/api/dataset.csv">Export CSV</a>
        </div>
        <p className="muted small">What leaves the device: text and reaction scores, never raw EEG. Names masked, user hashed.</p>
        {error && <p className="error">{error}</p>}
        <table>
          <thead><tr><th>Phrase</th><th>Reaction</th><th>ErrP</th><th>Frown</th><th>Human</th><th /></tr></thead>
          <tbody>
            {data?.reactions.filter((r) => r.flagged || r.decision).slice(0, 10).map((r) => (
              <tr key={r.id}>
                <td>{r.chunk}</td><td>{r.score.toFixed(2)}</td><td>{r.errp.toFixed(2)}</td><td>{r.frown.toFixed(2)}</td>
                <td>{r.decision === 'accept' ? 'nod → fixed' : r.decision === 'keep' ? 'shake → kept' : '—'}</td>
                <td>{r.simulated ? <span className="badge warn">simulated</span> : <span className="badge ok">EEG</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
