import { useCallback, useEffect, useRef, useState } from 'react'
import { api, settings, socket, type Interpretation, type Reading, type ServerEvent } from './api'
import ScalpMap from './ScalpMap'
import type { useLive } from './useLive'

const REVEAL_MS = 1500           // one chunk every 1.5 s, time-locked for the reaction detector
const SETTLE_MS = 2200           // wait for the last chunk's reaction before finishing

type Chunk = { text: string; planted: string | null; state: 'hidden' | 'shown' | 'flagged' | 'fixed' | 'kept'; original?: string }
type Question = { chunkId: number; reactionId: number; interpretation: Interpretation; reading: Reading }
type Phase = 'idle' | 'drafting' | 'reading' | 'question' | 'rewriting' | 'done'
type Log = { id: number; text: string; kind: 'eeg' | 'sim' | 'ai' }

const EXAMPLES = ['Email my landlord Sarah about the broken heater.', 'Note to my manager Priya about leaving early today.']

export default function Session({ live }: { live: ReturnType<typeof useLive> }) {
  const [request, setRequest] = useState(EXAMPLES[0])
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [shown, setShown] = useState(-1)
  const [phase, setPhase] = useState<Phase>('idle')
  const [question, setQuestion] = useState<Question | null>(null)
  const [log, setLog] = useState<Log[]>([])
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const chunksRef = useRef<Chunk[]>([])
  const queueRef = useRef<Question[]>([])
  const questionRef = useRef<Question | null>(null)
  const requestRef = useRef(request)
  const phaseRef = useRef<Phase>('idle')
  const lastOnsetRef = useRef(0)

  chunksRef.current = chunks
  questionRef.current = question
  phaseRef.current = phase

  const addLog = useCallback((text: string, kind: Log['kind']) => {
    setLog((items) => [{ id: Date.now() + Math.random(), text, kind }, ...items].slice(0, 12))
  }, [])

  const updateChunk = (index: number, patch: Partial<Chunk>) => {
    setChunks((items) => items.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  const ask = useCallback((next: Question) => {
    setQuestion(next)
    setPhase('question')
    updateChunk(next.chunkId, { state: 'flagged' })
    socket.send({ type: 'await_gesture', chunk_id: next.chunkId })
  }, [])

  const resume = useCallback(() => {
    const next = queueRef.current.shift()
    if (next) ask(next)
    else { setQuestion(null); setPhase('reading') }
  }, [ask])

  const decide = useCallback(async (gesture: 'nod' | 'shake', simulated: boolean, origin: string) => {
    const q = questionRef.current
    if (!q) return
    const how = simulated ? '(simulated key)' : origin === 'mock' ? 'by detector on mock signal' : origin === 'lsl' ? 'from live EEG' : `from ${origin}`
    addLog(`${gesture === 'nod' ? 'Nod' : 'Shake'} detected ${how}`, simulated || origin === 'mock' ? 'sim' : 'eeg')
    socket.send({ type: 'cancel_await' })
    try {
      if (gesture === 'shake') {
        await api('/decision', { reaction_id: q.reactionId, decision: 'keep', category: q.interpretation.category })
        updateChunk(q.chunkId, { state: 'kept' })
        resume()
        return
      }
      setPhase('rewriting')
      await api('/decision', { reaction_id: q.reactionId, decision: 'accept', category: q.interpretation.category })
      const texts = chunksRef.current.map((c) => c.text)
      const result = await api<{ text: string; source: string }>('/rewrite', {
        request: requestRef.current, chunks: texts, index: q.chunkId,
        instruction: q.interpretation.request, category: q.interpretation.category,
      })
      addLog(`Rewritten by ${result.source === 'offline' ? 'offline fallback' : result.source.replace('openai:', 'ChatGPT ')}`, 'ai')
      updateChunk(q.chunkId, { state: 'fixed', text: result.text, original: texts[q.chunkId] })
      resume()
    } catch (e) {
      setError((e as Error).message)
      resume()
    }
  }, [addLog, resume])

  // Server events: reactions and gestures.
  useEffect(() => socket.subscribe((event: ServerEvent) => {
    if (event.type === 'reaction') {
      const chunk = chunksRef.current[event.chunk_id]
      if (!chunk || !event.reading.flagged || !event.interpretation) return
      const origin = event.simulated ? ' · simulated key' : event.source === 'mock' ? ' · mock signal' : event.source === 'lsl' ? ' · live EEG' : ''
      addLog(`Reaction ${event.reading.score.toFixed(2)} on “${chunk.text}” (ErrP ${event.reading.errp.toFixed(2)}, frown ${event.reading.frown.toFixed(2)})${origin}`, event.simulated || event.source === 'mock' ? 'sim' : 'eeg')
      const q = { chunkId: event.chunk_id, reactionId: event.reaction_id, interpretation: event.interpretation, reading: event.reading }
      if (questionRef.current || phaseRef.current === 'rewriting') queueRef.current.push(q)
      else ask(q)
    }
    if (event.type === 'gesture' && questionRef.current && phaseRef.current === 'question') {
      void decide(event.gesture, event.simulated, event.source)
    }
  }), [addLog, ask, decide])

  // Reveal loop: pauses while a question is open.
  useEffect(() => {
    if (phase !== 'reading') return
    if (shown < chunks.length - 1) {
      const timer = setTimeout(() => {
        const index = shown + 1
        const chunk = chunksRef.current[index]
        setShown(index)
        updateChunk(index, { state: 'shown' })
        lastOnsetRef.current = performance.now()
        socket.send({
          type: 'onset', chunk_id: index, text: chunk.text, planted: chunk.planted,
          request: requestRef.current, draft: chunksRef.current.map((c) => c.text).join(' '),
        })
      }, shown < 0 ? 400 : REVEAL_MS)
      return () => clearTimeout(timer)
    }
    const wait = Math.max(0, SETTLE_MS - (performance.now() - lastOnsetRef.current))
    const timer = setTimeout(() => { if (!questionRef.current && !queueRef.current.length) setPhase('done') }, wait)
    return () => clearTimeout(timer)
  }, [phase, shown, chunks.length])

  // Keyboard fallbacks (labelled as simulated everywhere they appear).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea')) return
      const key = event.key.toLowerCase()
      if (key === 'y' || key === 'n') socket.send({ type: 'simulate', what: key === 'y' ? 'nod' : 'shake' })
      if (key === 'f' && phaseRef.current === 'reading' && shown >= 0) {
        const chunk = chunksRef.current[shown]
        if (chunk.state === 'shown') socket.send({
          type: 'simulate', what: 'reaction', chunk_id: shown, text: chunk.text,
          request: requestRef.current, draft: chunksRef.current.map((c) => c.text).join(' '),
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown])

  const start = async () => {
    setError('')
    setPhase('drafting')
    setChunks([]); setShown(-1); setQuestion(null); queueRef.current = []
    requestRef.current = request
    try {
      const result = await api<{ chunks: { text: string; planted: string | null }[]; source: string }>('/draft', { request, plant: settings.plant })
      setSource(result.source)
      addLog(`Draft from ${result.source === 'offline' ? 'offline fallback' : result.source.replace('openai:', 'ChatGPT ')}`, 'ai')
      setChunks(result.chunks.map((c) => ({ ...c, state: 'hidden' })))
      setPhase('reading')
    } catch (e) {
      setError((e as Error).message)
      setPhase('idle')
    }
  }

  const current = shown >= 0 ? chunks[shown] : null
  const fixed = chunks.filter((c) => c.state === 'fixed').length
  const kept = chunks.filter((c) => c.state === 'kept').length

  return (
    <div className="grid session">
      <section className="card wide">
        <form className="row" onSubmit={(e) => { e.preventDefault(); void start() }}>
          <input className="grow" value={request} onChange={(e) => setRequest(e.target.value)} disabled={phase !== 'idle' && phase !== 'done'} />
          <button className="primary" disabled={phase !== 'idle' && phase !== 'done'}>Ask ChatGPT</button>
        </form>
        <div className="row small muted">
          {EXAMPLES.map((example) => <button key={example} className="chip" onClick={() => setRequest(example)} disabled={phase !== 'idle' && phase !== 'done'}>{example}</button>)}
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card reader-card">
        <div className="reader" aria-live="polite">
          {phase === 'drafting' && <span className="muted">ChatGPT is drafting…</span>}
          {phase === 'idle' && <span className="muted">Phrases appear here one at a time. Keep your eyes on this line and relax your face.</span>}
          {current && phase !== 'done' && <span key={shown} className={`phrase ${current.state}`}>{current.text}</span>}
          {phase === 'done' && <span className="muted">Done · {fixed} fixed · {kept} kept</span>}
        </div>

        {question && (
          <div className={`question ${phase === 'rewriting' ? 'busy' : ''}`}>
            <p>{phase === 'rewriting' ? 'Rewriting with ChatGPT…' : question.interpretation.question}</p>
            <p className="muted small">On-device {question.interpretation.engine.startsWith('ollama') ? `SLM (${question.interpretation.engine.replace('ollama:', '')})` : 'rules (SLM offline)'} · nod = fix · shake = keep · keys Y / N simulate</p>
          </div>
        )}

        <div className="draft">
          {chunks.map((c, i) => (
            <span key={i} className={`piece ${c.state}`} title={c.original ? `was: ${c.original}` : undefined}>{c.state === 'hidden' ? '' : c.text} </span>
          ))}
        </div>
        {source && <p className="muted small">Draft: {source === 'offline' ? 'offline fallback (no ChatGPT connection)' : source.replace('openai:', 'ChatGPT · ')}{settings.plant ? ' · demo mode plants known errors' : ''}</p>}
      </section>

      <aside className="card side">
        <h3>Live EEG</h3>
        <ScalpMap activity={live.activity} quality={live.quality} size={230} highlight={['Fz', 'F3', 'F4', 'C3', 'C4', 'Pz', 'Fp1', 'Fp2']} />
        <p className="muted small">Outlined: error-response and frown sites. Red ring = flat channel, amber = noisy.</p>
        <h3>Events</h3>
        <ul className="log">
          {log.map((item) => <li key={item.id} className={item.kind}>{item.text}</li>)}
        </ul>
        <p className="muted small">Fallback keys: F flag · Y nod · N shake (all marked simulated)</p>
      </aside>
    </div>
  )
}
