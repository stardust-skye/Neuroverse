import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, Sparkles } from 'lucide-react'
import { createMindprintBaseline, mindprintFeatures, mindprintVisuals, parseMindprintMeta, parseMindprintSamples, selectEegSamples } from './mindprintSignal'
import type { MindprintBaseline, MindprintMeta, MindprintVisuals } from './mindprintSignal'
import { renderMindprintArt } from './mindprintArt'

type Props = { onClose: () => void }
type Status = 'connecting' | 'waiting' | 'live' | 'invalid'
const FRESH_MS = 2000

export default function Mindprint({ onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const visualsRef = useRef<MindprintVisuals | null>(null)
  const displayedRef = useRef<MindprintVisuals | null>(null)
  const lastSampleRef = useRef(0)
  const [status, setStatus] = useState<Status>('connecting')

  useEffect(() => {
    const previous = document.activeElement
    backRef.current?.focus({ preventScroll: true })
    return () => {
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    let active = true
    let socket: WebSocket | null = null
    let retry: number | undefined
    let meta: MindprintMeta | null = null
    let rows: number[][] = []
    let samplesSinceUpdate = 0
    let lastBatchTime: number | null = null
    let baseline: MindprintBaseline | null = null
    const clear = (next: Status) => {
      meta = null
      rows = []
      samplesSinceUpdate = 0
      lastBatchTime = null
      baseline = null
      visualsRef.current = null
      displayedRef.current = null
      lastSampleRef.current = 0
      setStatus(next)
    }
    const connect = () => {
      try {
        socket = new WebSocket(import.meta.env.VITE_MINDPRINT_EEG_URL || 'ws://localhost:8765')
      } catch (error) {
        console.error('Invalid Mindprint EEG connection URL:', error)
        clear('invalid')
        return
      }
      socket.onmessage = (event) => {
        try {
          const value: unknown = JSON.parse(event.data)
          if (!value || typeof value !== 'object') throw new Error('Expected an EEG message object')
          const message = value as Record<string, unknown>
          if (message.type === 'meta') {
            clear('waiting')
            meta = parseMindprintMeta(value)
            if (!meta) setStatus('invalid')
          } else if (message.type === 'status' && message.state !== 'streaming') {
            clear('waiting')
          } else if (message.type === 'samples' && meta) {
            const batch = parseMindprintSamples(value, meta.channels.length)
            if (!batch || typeof message.t0 !== 'number' || (lastBatchTime !== null && message.t0 <= lastBatchTime)) {
              console.warn('Invalid Mindprint EEG samples')
              rows = []
              baseline = null
              visualsRef.current = null
              displayedRef.current = null
              setStatus('invalid')
              return
            }
            lastBatchTime = message.t0
            if (performance.now() - lastSampleRef.current > FRESH_MS) {
              rows = []
              samplesSinceUpdate = 0
              baseline = null
              visualsRef.current = null
              displayedRef.current = null
              setStatus('waiting')
            }
            lastSampleRef.current = performance.now()
            rows.push(...selectEegSamples(batch, meta.eegIndices))
            const windowSize = Math.round(meta.srate * 2)
            if (rows.length > windowSize) rows = rows.slice(-windowSize)
            samplesSinceUpdate += batch.length
            if (rows.length >= Math.round(meta.srate) && samplesSinceUpdate >= meta.srate / 4) {
              samplesSinceUpdate = 0
              const window = rows.slice(-Math.max(50, Math.round(meta.srate * (baseline ? 0.5 : 1))))
              const features = mindprintFeatures(window, meta.eegIndices.length)
              if (features) {
                baseline ??= createMindprintBaseline(features)
                visualsRef.current = mindprintVisuals(features, baseline)
              } else {
                visualsRef.current = null
                displayedRef.current = null
                baseline = null
              }
              setStatus(features ? 'live' : 'invalid')
            }
          }
        } catch (error) {
          console.warn('Could not decode Mindprint EEG message:', error)
          clear('invalid')
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (!active) return
        clear('connecting')
        retry = window.setTimeout(connect, 2000)
      }
    }
    connect()
    const timer = window.setInterval(() => {
      if (visualsRef.current && performance.now() - lastSampleRef.current > FRESH_MS) {
        visualsRef.current = null
        displayedRef.current = null
        baseline = null
        rows = []
        samplesSinceUpdate = 0
        setStatus('waiting')
      }
    }, 250)
    return () => {
      active = false
      window.clearTimeout(retry)
      window.clearInterval(timer)
      socket?.close()
    }
  }, [])

  useEffect(() => {
    let frame: number
    let lastFrame: number | null = null
    const render = (time: number) => {
      const canvas = canvasRef.current
      const target = visualsRef.current
      if (canvas && target && performance.now() - lastSampleRef.current <= FRESH_MS) {
        const previous = displayedRef.current ?? target
        const alpha = lastFrame === null ? 1 : 1 - Math.exp(-Math.min(time - lastFrame, 100) / 250)
        const blend = (from: number, to: number) => from + (to - from) * alpha
        const displayed = {
          activity: blend(previous.activity, target.activity),
          hue: blend(previous.hue, target.hue),
          ripple: blend(previous.ripple, target.ripple),
          texture: blend(previous.texture, target.texture),
          balance: blend(previous.balance, target.balance),
        }
        displayedRef.current = displayed
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const width = Math.round(canvas.clientWidth * ratio)
        const height = Math.round(canvas.clientHeight * ratio)
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        renderMindprintArt(canvas, displayed, time)
      }
      lastFrame = time
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [])

  const download = () => {
    if (!canvasRef.current || status !== 'live') return
    const link = document.createElement('a')
    link.download = 'mindprint.png'
    link.href = canvasRef.current.toDataURL('image/png')
    link.click()
  }

  return <section className="mindprint" role="dialog" aria-modal="true" aria-labelledby="mindprint-title" onKeyDown={(event) => {
    if (event.key !== 'Tab') return
    const last = status === 'live' ? saveRef.current : backRef.current
    if (event.shiftKey && document.activeElement === backRef.current) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      backRef.current?.focus()
    }
  }}>
    <canvas className={`mindprint-canvas${status === 'live' ? ' is-live' : ''}`} ref={canvasRef} aria-label="Live EEG-generated artwork" />
    <header className="mindprint-header">
      <button ref={backRef} className="mindprint-button" data-gaze-selectable="true" onClick={onClose}><ArrowLeft size={16} /> BACK TO CANVAS</button>
      <div className="mindprint-brand"><Sparkles size={16} /><span>MINDPRINT</span></div>
      <button ref={saveRef} className="mindprint-button" data-gaze-selectable="true" onClick={download} disabled={status !== 'live'}><Download size={15} /> SAVE ART</button>
    </header>
    <div className="mindprint-caption">
      <span className="mindprint-kicker">{status === 'live' ? 'LIVE SIGNAL · LIVING ART' : 'YOUR SIGNAL, YOUR UNIVERSE'}</span>
      <h1 id="mindprint-title">{status === 'live' ? 'A moment, made visible.' : 'Meet your Mindprint.'}</h1>
      <p>{status === 'live' ? 'A unique artwork shaped by your live EEG signal.' : status === 'invalid' ? 'Waiting for usable live EEG data. Check your stream and bridge.' : 'Connect your live EEG stream to bring your artwork to life.'}</p>
    </div>
  </section>
}
