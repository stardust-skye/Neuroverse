import { useEffect, useRef, useState } from 'react'
import { Camera, CircleStop, ScanFace } from 'lucide-react'
import type { MovementEvent } from './types'

interface WebcamInputProps {
  onMovement: (event: MovementEvent) => void
  onStatus: (active: boolean) => void
}

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

function eyeAspectRatio(points: { x: number; y: number }[], indices: number[]) {
  const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y)
  return (distance(indices[1], indices[5]) + distance(indices[2], indices[4])) / (2 * distance(indices[0], indices[3]))
}

export default function WebcamInput({ onMovement, onStatus }: WebcamInputProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const landmarkerRef = useRef<{ detectForVideo: (video: HTMLVideoElement, timestamp: number) => { faceLandmarks?: { x: number; y: number }[][] }; close: () => void } | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastTriggerRef = useRef(0)
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState('Camera is off')
  const [error, setError] = useState('')

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    landmarkerRef.current?.close()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    onStatus(false)
  }, [onStatus])

  const stop = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    landmarkerRef.current?.close()
    landmarkerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setActive(false)
    setStatus('Camera is off')
    onStatus(false)
  }

  const start = async () => {
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser or page context.')
      setStatus('Requesting camera permission…')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      streamRef.current = stream
      if (!videoRef.current) throw new Error('Camera preview could not be initialized.')
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setStatus('Loading facial movement model…')
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm')
      const options = {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: 'VIDEO',
        numFaces: 1,
      } as const
      try {
        landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } })
      } catch {
        landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } })
      }
      setActive(true)
      onStatus(true)
      setStatus('Camera active · experimental facial landmarks')
      const detect = () => {
        const video = videoRef.current
        const landmarker = landmarkerRef.current
        if (!video || !landmarker || video.readyState < 2) {
          frameRef.current = requestAnimationFrame(detect)
          return
        }
        const landmarks = landmarker.detectForVideo(video, performance.now()).faceLandmarks?.[0]
        if (landmarks) {
          const left = eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380])
          const right = eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144])
          const now = Date.now()
          let movement: MovementEvent['movement'] | null = null
          if (left < 0.19 && right < 0.19) movement = 'BLINK'
          else if (left < 0.19 && right > 0.23) movement = 'WINK'
          else if (right < 0.19 && left > 0.23) movement = 'WINK'
          else {
            const mouthGap = Math.abs(landmarks[13].y - landmarks[14].y)
            const faceHeight = Math.abs(landmarks[10].y - landmarks[152].y)
            if (faceHeight > 0 && mouthGap / faceHeight > 0.055) movement = 'JAW_CLENCH'
          }
          if (movement && now - lastTriggerRef.current > 900) {
            lastTriggerRef.current = now
            onMovement({ movement, source: 'webcam', timestamp: now, confidence: movement === 'JAW_CLENCH' ? 0.68 : 0.82 })
          }
        }
        frameRef.current = requestAnimationFrame(detect)
      }
      frameRef.current = requestAnimationFrame(detect)
    } catch (reason) {
      stop()
      const message = reason instanceof Error ? reason.message : 'Camera setup failed.'
      setError(message)
      setStatus('Could not start webcam mode')
    }
  }

  return (
    <div className="camera-module">
      <div className="camera-preview">
        <video ref={videoRef} playsInline muted aria-label="Webcam preview" />
        {!active && <div className="camera-empty"><ScanFace size={29} /><span>Camera preview</span></div>}
        {active && <span className="camera-live"><i /> LIVE</span>}
      </div>
      <div className="camera-controls">
        <div><span className="eyebrow">WEBCAM INPUT</span><p>{status}</p></div>
        <button className={active ? 'button button-muted' : 'button button-small'} onClick={active ? stop : start}>
          {active ? <CircleStop size={16} /> : <Camera size={16} />}{active ? 'Stop camera' : 'Enable camera'}
        </button>
      </div>
      <p className="camera-note">Eye closures are experimental. Jaw movement uses a mouth-landmark proxy and cannot reliably detect every clench. Camera frames stay in your browser.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  )
}
