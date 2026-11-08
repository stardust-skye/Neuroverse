import { useEffect, useRef, useState } from 'react'
import { ScanFace } from 'lucide-react'
import type { MovementEvent } from './types'
import { estimateGaze } from './gaze'
import type { GazePoint, Landmark } from './gaze'
import { initialGestureState, updateFacialGesture } from './gestures'
import type { FacialGesture } from './gestures'
import { estimateHeadPose } from './headPose'
import type { HeadPose } from './headPose'
import { browDownScore } from './browSignal'

interface WebcamInputProps {
  onMovement: (event: MovementEvent) => void
  onStatus: (active: boolean) => void
  onFaceDetected?: (detected: boolean) => void
  onHeadPose?: (pose: HeadPose | null) => void
  onGaze?: (point: GazePoint | null) => void
  onBrow?: (score: number | null) => void
  onGesture?: (gesture: FacialGesture) => void
  sensitivity?: number
  showPreview?: boolean
  compact?: boolean
}

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

function eyeAspectRatio(points: Landmark[], indices: number[]) {
  const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y)
  return (distance(indices[1], indices[5]) + distance(indices[2], indices[4])) / (2 * distance(indices[0], indices[3]))
}

export default function WebcamInput({ onMovement, onStatus, onFaceDetected, onHeadPose, onGaze, onBrow, onGesture, sensitivity = 6, showPreview = false, compact = false }: WebcamInputProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const landmarkerRef = useRef<{ detectForVideo: (video: HTMLVideoElement, timestamp: number) => { faceLandmarks?: Landmark[][]; faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[] }; close: () => void } | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastDetectionAtRef = useRef(0)
  const lastFaceDetectedRef = useRef<boolean | null>(null)
  const gestureStateRef = useRef(initialGestureState)
  const sensitivityRef = useRef(sensitivity)
  const callbacksRef = useRef({ onMovement, onStatus, onFaceDetected, onHeadPose, onGaze, onBrow, onGesture })
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState('Requesting camera permission…')
  const [error, setError] = useState('')
  sensitivityRef.current = sensitivity
  callbacksRef.current = { onMovement, onStatus, onFaceDetected, onHeadPose, onGaze, onBrow, onGesture }

  useEffect(() => {
    let cancelled = false
    let failed = false
    const releaseMedia = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      landmarkerRef.current?.close()
      landmarkerRef.current = null
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    }
    const reportCameraFailure = (reason: unknown) => {
      if (cancelled || failed) return
      failed = true
      releaseMedia()
      lastFaceDetectedRef.current = false
      gestureStateRef.current = initialGestureState
      setActive(false)
      callbacksRef.current.onFaceDetected?.(false)
      callbacksRef.current.onHeadPose?.(null)
      callbacksRef.current.onGaze?.(null)
      callbacksRef.current.onBrow?.(null)
      callbacksRef.current.onStatus(false)
      setError(reason instanceof Error ? reason.message : 'Camera setup failed.')
      setStatus('Could not start webcam mode')
    }

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser or page context.')
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => reportCameraFailure(new Error('Camera stream ended. Reload the page to reconnect.')), { once: true })
        })
        const video = videoRef.current
        if (!video) throw new Error('Camera preview could not be initialized.')
        video.srcObject = stream
        await video.play()
        if (cancelled || failed) return
        setStatus('Loading facial movement model…')
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
        const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm')
        const options = {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        } as const
        let landmarker
        try {
          landmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } })
        } catch {
          landmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } })
        }
        if (cancelled || failed) {
          landmarker.close()
          return
        }
        landmarkerRef.current = landmarker
        setActive(true)
        callbacksRef.current.onStatus(true)
        setStatus('Camera active · experimental facial landmarks')
        let lastVideoTime = -1
        let lastFrameAt = performance.now()
        const detect = () => {
          if (cancelled) return
          const currentVideo = videoRef.current
          const currentLandmarker = landmarkerRef.current
          if (!currentVideo || !currentLandmarker || currentVideo.readyState < 2) {
            frameRef.current = requestAnimationFrame(detect)
            return
          }
          const detectionTime = performance.now()
          if (currentVideo.currentTime === lastVideoTime) {
            if (detectionTime - lastFrameAt > 1000 && lastFaceDetectedRef.current !== false) {
              lastFaceDetectedRef.current = false
              gestureStateRef.current = initialGestureState
              callbacksRef.current.onFaceDetected?.(false)
              callbacksRef.current.onHeadPose?.(null)
              callbacksRef.current.onGaze?.(null)
              callbacksRef.current.onBrow?.(null)
            }
            frameRef.current = requestAnimationFrame(detect)
            return
          }
          if (detectionTime - lastDetectionAtRef.current < 33) {
            frameRef.current = requestAnimationFrame(detect)
            return
          }
          lastDetectionAtRef.current = detectionTime
          lastVideoTime = currentVideo.currentTime
          lastFrameAt = detectionTime
          let result: ReturnType<NonNullable<typeof landmarkerRef.current>['detectForVideo']>
          try {
            result = currentLandmarker.detectForVideo(currentVideo, detectionTime)
          } catch (reason) {
            reportCameraFailure(reason)
            return
          }
          const landmarks = result.faceLandmarks?.[0]
          const faceDetected = Boolean(landmarks)
          if (lastFaceDetectedRef.current !== faceDetected) {
            lastFaceDetectedRef.current = faceDetected
            callbacksRef.current.onFaceDetected?.(faceDetected)
          }
          if (landmarks) {
            callbacksRef.current.onHeadPose?.(estimateHeadPose(landmarks))
            const left = eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380])
            const right = eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144])
            callbacksRef.current.onGaze?.(estimateGaze(landmarks, { left, right }))
            const categories = result.faceBlendshapes?.[0]?.categories
            const leftBrow = categories?.find((item) => item.categoryName === 'browDownLeft')?.score
            const rightBrow = categories?.find((item) => item.categoryName === 'browDownRight')?.score
            callbacksRef.current.onBrow?.(browDownScore(leftBrow, rightBrow))
            const now = Date.now()
            const gestureResult = updateFacialGesture(gestureStateRef.current, {
              leftEar: left,
              rightEar: right,
              timestamp: now,
            }, sensitivityRef.current)
            gestureStateRef.current = gestureResult.state
            if (gestureResult.event) {
              callbacksRef.current.onGesture?.(gestureResult.event)
              callbacksRef.current.onMovement({
                movement: gestureResult.event === 'NORMAL_BLINK' ? 'BLINK' : 'WINK',
                source: 'webcam',
                timestamp: now,
                confidence: 0.82,
              })
            }
          } else {
            gestureStateRef.current = initialGestureState
            callbacksRef.current.onHeadPose?.(null)
            callbacksRef.current.onGaze?.(null)
            callbacksRef.current.onBrow?.(null)
          }
          frameRef.current = requestAnimationFrame(detect)
        }
        frameRef.current = requestAnimationFrame(detect)
      } catch (reason) {
        reportCameraFailure(reason)
      }
    }

    const startupTimer = window.setTimeout(() => { void start() }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(startupTimer)
      releaseMedia()
      callbacksRef.current.onFaceDetected?.(false)
      callbacksRef.current.onHeadPose?.(null)
      callbacksRef.current.onGaze?.(null)
      callbacksRef.current.onBrow?.(null)
      callbacksRef.current.onStatus(false)
      lastFaceDetectedRef.current = false
    }
  }, [])

  if (compact) return (
    <div className="gaze-camera gaze-camera-hidden">
      <video className={`gaze-camera-video${showPreview ? ' is-preview-visible' : ''}`} ref={videoRef} playsInline muted aria-label="Local webcam diagnostic preview" />
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
        <div><span className="eyebrow">WEBCAM INPUT</span><p role="status" aria-live="polite">{active ? status : error || status}</p></div>
      </div>
      <p className="camera-note">Blink and wink recognition use experimental eye landmarks and adjustable sensitivity. Jaw-clench detection is disabled. Camera frames stay in your browser.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  )
}
