import { useEffect, useRef, useState } from 'react'
import { Camera, CircleStop, ScanFace } from 'lucide-react'
import type { MovementEvent } from './types'
import { estimateGaze } from './gaze'
import type { Landmark } from './gaze'
import { initialGestureState, updateFacialGesture } from './gestures'
import type { FacialGesture } from './gestures'

interface WebcamInputProps {
  onMovement: (event: MovementEvent) => void
  onStatus: (active: boolean) => void
  onGaze?: (point: { x: number; y: number } | null) => void
  onFaceDetected?: (detected: boolean) => void
  onGesture?: (gesture: FacialGesture) => void
  sensitivity?: number
  compact?: boolean
}

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

function eyeAspectRatio(points: Landmark[], indices: number[]) {
  const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y)
  return (distance(indices[1], indices[5]) + distance(indices[2], indices[4])) / (2 * distance(indices[0], indices[3]))
}

export default function WebcamInput({ onMovement, onStatus, onGaze, onFaceDetected, onGesture, sensitivity = 6, compact = false }: WebcamInputProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const landmarkerRef = useRef<{ detectForVideo: (video: HTMLVideoElement, timestamp: number) => { faceLandmarks?: Landmark[][] }; close: () => void } | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastDetectionAtRef = useRef(0)
  const gestureStateRef = useRef(initialGestureState)
  const sensitivityRef = useRef(sensitivity)
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState('Camera is off')
  const [error, setError] = useState('')
  sensitivityRef.current = sensitivity

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    landmarkerRef.current?.close()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    onGaze?.(null)
    onFaceDetected?.(false)
    onStatus(false)
  }, [onFaceDetected, onGaze, onStatus])

  const stop = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    landmarkerRef.current?.close()
    landmarkerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setActive(false)
    setStatus('Camera is off')
    onGaze?.(null)
    onFaceDetected?.(false)
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
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm')
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
        const detectionTime = performance.now()
        if (detectionTime - lastDetectionAtRef.current < 33) {
          frameRef.current = requestAnimationFrame(detect)
          return
        }
        lastDetectionAtRef.current = detectionTime
        const landmarks = landmarker.detectForVideo(video, detectionTime).faceLandmarks?.[0]
        onFaceDetected?.(Boolean(landmarks))
        if (landmarks) {
          onGaze?.(estimateGaze(landmarks))
          const left = eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380])
          const right = eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144])
          const now = Date.now()
          const result = updateFacialGesture(gestureStateRef.current, {
            leftEar: left,
            rightEar: right,
            timestamp: now,
          }, sensitivityRef.current)
          gestureStateRef.current = result.state
          if (result.event) {
            onGesture?.(result.event)
            onMovement({
              movement: result.event === 'NORMAL_BLINK' ? 'BLINK' : 'WINK',
              source: 'webcam',
              timestamp: now,
              confidence: 0.82,
            })
          }
        } else {
          gestureStateRef.current = initialGestureState
          onGaze?.(null)
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

  if (compact) return (
    <div className="gaze-camera">
      <video className="gaze-camera-video is-mirrored" ref={videoRef} playsInline muted aria-label="Mirrored local webcam preview; gaze is calibrated against the screen targets" />
      <span className={active ? 'gaze-camera-status is-active' : 'gaze-camera-status'}>
        <i />{active ? status : error || status}
      </span>
      <button className="gaze-camera-button" onClick={active ? stop : start}>
        {active ? <CircleStop size={13} /> : <Camera size={13} />}{active ? 'CAMERA OFF' : 'ENABLE GAZE'}
      </button>
      {error && <span className="gaze-camera-error" role="alert">{error}</span>}
    </div>
  )

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
      <p className="camera-note">Blink and wink recognition use experimental eye landmarks and adjustable sensitivity. Jaw-clench detection is disabled. Camera frames stay in your browser.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  )
}
