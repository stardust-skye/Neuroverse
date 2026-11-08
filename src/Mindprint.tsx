import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, Sparkles } from 'lucide-react'
import { mindprintFeatures, parseMindprintMeta, parseMindprintSamples } from './mindprintSignal'
import type { MindprintFeatures, MindprintMeta } from './mindprintSignal'

type Props = { onClose: () => void }
type Status = 'connecting' | 'waiting' | 'live' | 'invalid'
const FRESH_MS = 2000

function renderArt(canvas: HTMLCanvasElement, features: MindprintFeatures, time: number) {
  const context = canvas.getContext('2d')
  if (!context) return
  const { width, height } = canvas
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.35
  const t = time / 1000
  const hue = 210 + features.texture * 120 + features.balance * 90
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
    const ripple = .06 + features.variation * .36
    context.beginPath()
    for (let i = 0; i <= 160; i++) {
      const angle = i * Math.PI * 2 / 160
      const r = base * (1 + ripple * Math.sin(angle * 3 + phase) + .09 * Math.cos(angle * 7 - phase * .8))
      const x = cx + Math.cos(angle + Math.sin(phase) * .12) * r * (1.1 + features.balance * .3)
      const y = cy + Math.sin(angle) * r * .8
      if (i === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.strokeStyle = `hsla(${hue + ring * .7}, 90%, ${69 + 13 * Math.sin(phase)}%, ${.055 + (ring % 9 === 0 ? .18 : .045)})`
    context.lineWidth = Math.max(.7, width / 1600)
    context.stroke()
  }
  for (let i = 0; i < 110; i++) {
    const a = i * 2.39996 + t * (.02 + features.texture * .05)
    const r = radius * (.2 + ((i * 73) % 103) / 100 * 1.5)
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

export default function Mindprint({ onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const featuresRef = useRef<MindprintFeatures | null>(null)
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
    const clear = (next: Status) => {
      meta = null
      rows = []
      samplesSinceUpdate = 0
      lastBatchTime = null
      featuresRef.current = null
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
              featuresRef.current = null
              setStatus('invalid')
              return
            }
            lastBatchTime = message.t0
            if (performance.now() - lastSampleRef.current > FRESH_MS) {
              rows = []
              featuresRef.current = null
              setStatus('waiting')
            }
            lastSampleRef.current = performance.now()
            rows.push(...batch)
            const windowSize = Math.round(meta.srate * 2)
            if (rows.length > windowSize) rows = rows.slice(-windowSize)
            samplesSinceUpdate += batch.length
            if (rows.length >= Math.round(meta.srate) && samplesSinceUpdate >= meta.srate / 4) {
              samplesSinceUpdate = 0
              featuresRef.current = mindprintFeatures(rows, meta.channels.length)
              setStatus(featuresRef.current ? 'live' : 'invalid')
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
      if (featuresRef.current && performance.now() - lastSampleRef.current > FRESH_MS) {
        featuresRef.current = null
        rows = []
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
    const render = (time: number) => {
      const canvas = canvasRef.current
      const features = featuresRef.current
      if (canvas && features && performance.now() - lastSampleRef.current <= FRESH_MS) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const width = Math.round(canvas.clientWidth * ratio)
        const height = Math.round(canvas.clientHeight * ratio)
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        renderArt(canvas, features, time)
      }
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
