import { Fragment, useEffect, useRef, useState } from 'react'
import { api, socket } from './api'

type Step = { kind: 'rest'; seconds: number } | { kind: 'trials'; count: number } | { kind: 'cue'; cue: 'frown' | 'nod' | 'shake'; count: number }
const FULL: Step[] = [{ kind: 'rest', seconds: 30 }, { kind: 'trials', count: 40 }, { kind: 'cue', cue: 'frown', count: 8 }, { kind: 'cue', cue: 'nod', count: 6 }, { kind: 'cue', cue: 'shake', count: 6 }]
const QUICK: Step[] = [{ kind: 'rest', seconds: 12 }, { kind: 'trials', count: 24 }, { kind: 'cue', cue: 'frown', count: 4 }, { kind: 'cue', cue: 'nod', count: 3 }, { kind: 'cue', cue: 'shake', count: 3 }]
const CUE_TEXT = { frown: 'Frown', nod: 'Nod yes', shake: 'Shake no' }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const mark = (kind: string, label = 0) => socket.send({ type: 'cal_marker', kind, label })

export default function Calibration({ onClose }: { onClose: () => void }) {
  const [running, setRunning] = useState(false)
  const [instruction, setInstruction] = useState('Sit still, relax your face, and keep your eyes on the centre.')
  const [cursor, setCursor] = useState<{ target: -1 | 1; pos: number } | null>(null)
  const [cue, setCue] = useState('')
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  const run = async (steps: Step[]) => {
    setRunning(true); setError(''); setResult(null); cancelled.current = false
    await api('/calibrate/start', {})
    for (const step of steps) {
      if (cancelled.current) return
      if (step.kind === 'rest') {
        setInstruction('Rest. Look at the dot, relax your face, don’t move.')
        mark('rest_start')
        for (let s = step.seconds; s > 0 && !cancelled.current; s--) { setProgress(`${s}s`); await sleep(1000) }
        mark('rest_end')
      }
      if (step.kind === 'trials') {
        setInstruction('Watch the cursor. It should move towards the green target — notice when it doesn’t.')
        const wrong = Array.from({ length: step.count }, (_, i) => i < Math.round(step.count / 4)).sort(() => Math.random() - 0.5)
        for (let i = 0; i < step.count && !cancelled.current; i++) {
          const target = Math.random() < 0.5 ? -1 : 1
          setCursor({ target, pos: 0 }); setProgress(`${i + 1}/${step.count}`)
          await sleep(700 + Math.random() * 400)
          setCursor({ target, pos: wrong[i] ? -target : target })
          mark('trial', wrong[i] ? 1 : 0)
          await sleep(1500)
        }
        setCursor(null)
      }
      if (step.kind === 'cue') {
        setInstruction(`When the box lights up: ${CUE_TEXT[step.cue].toLowerCase()} once, then relax.`)
        for (let i = 0; i < step.count && !cancelled.current; i++) {
          setProgress(`${i + 1}/${step.count}`)
          await sleep(1200 + Math.random() * 600)
          setCue(CUE_TEXT[step.cue]); mark(step.cue)
          await sleep(1800); setCue('')
          await sleep(600)
        }
      }
    }
    try {
      const response = await api<{ metrics: Record<string, unknown> }>('/calibrate/finish', {})
      setResult(response.metrics)
      setInstruction('Calibration saved.')
    } catch (e) { setError((e as Error).message) }
    setProgress(''); setRunning(false)
  }

  return (
    <div className="overlay">
      <div className="card calibration">
        <div className="row between"><h2>Calibration</h2><button className="link" onClick={() => { cancelled.current = true; onClose() }}>Close</button></div>
        <p>{instruction}</p>
        <div className="stage">
          {cursor ? (
            <div className="track">
              <span className={`target ${cursor.target < 0 ? 'left' : 'right'}`} />
              <span className="cursor" style={{ transform: `translateX(${cursor.pos * 120}px)` }} />
            </div>
          ) : cue ? <div className="cue">{cue}</div> : <span className="fixation" />}
        </div>
        <p className="muted small">{progress}</p>
        {error && <p className="error">{error}</p>}
        {result && <dl className="facts">{Object.entries(result).map(([k, v]) => <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{String(v)}</dd></Fragment>)}</dl>}
        {!running && <div className="row"><button className="primary" onClick={() => void run(FULL)}>Start (3 min)</button><button onClick={() => void run(QUICK)}>Quick rehearsal (1.5 min)</button></div>}
      </div>
    </div>
  )
}
