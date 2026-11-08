import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown, ArrowLeft, ArrowRight, AudioLines, BookOpen, Check, Crosshair, FlipHorizontal2,
  Command, Download, Eye, Gamepad2, Heart, Image as ImageIcon, Lightbulb, Menu,
  PawPrint, Pause, Play, Plus, Radio, Redo2, RotateCcw, Save, ScanFace, Settings2, Sparkles, Stars, Sun, Trash2, Undo2, WandSparkles,
  Target, X, Zap,
} from 'lucide-react'
import { story } from './storyData'
import { GAZE_CALIBRATION_TARGETS, assessGazeCalibration, evaluateGazeCapture, isGazeOutlier, mapGazeToScreen, orientGazeForScreen, smoothGazePoint } from './gaze'
import type { GazeCalibrationPoint, GazeMap, GazePoint as StudioPoint, TimedGazeSample } from './gaze'
import type { HeadPose } from './headPose'
import { completePlayTarget, DEFAULT_BROW_THRESHOLD, initialPlayTarget, nextTargetPosition, segmentTouchesTarget, targetRect, updatePlayTarget } from './challenge'
import type { PlayArea } from './challenge'
import { appendStrokeSegment, cloneStrokeHistory, playTrailOpacity } from './strokes'
import type { RecordedStroke, StrokeSegment } from './strokes'
import { createBrushParticles, particleGlow, particlePosition } from './artParticles'
import { parseLiveStress, selectPlaySignal } from './playEeg'
import type { LiveStress, PlaySignal } from './playEeg'
import { liveGesturesFresh, parseLiveGestures } from './liveGestures'
import type { LiveGestures } from './liveGestures'
import type { ArtParticle } from './artParticles'
import type { FacialGesture } from './gestures'
import { shouldStartSpaceDrawing, shouldStopSpaceDrawing } from './studioControls'
import { processGesture } from './gestureController'
import type { GestureAction } from './gestureController'
import { EEG_SERVICE_MESSAGE } from './services/eegService'
import WebcamInput from './WebcamInput'
import Mindprint from './Mindprint'
import { initialWorkloadAdaptation } from './types'
import type { InputSource, Movement, MovementEvent, WorkloadAdaptation, WorkloadPrediction } from './types'

type Page = 'home' | 'explore' | 'calibration' | 'story' | 'pet' | 'create' | 'play' | 'adapt' | 'about'
type Action = 'confirm' | 'switch' | 'special'
type SavedArt = { name: string; image: string; date: string; strokes?: RecordedStroke[] }
type CanvasSnapshot = { image: HTMLCanvasElement; strokes: RecordedStroke[] }
type StudioMode = 'create' | 'play'

const experiences = [
  { id: 'create' as const, number: '01', title: 'LIVING CANVAS', mode: 'CREATE', description: 'Make a quiet space for color, shape, and motion.', icon: WandSparkles, className: 'create-art', tag: 'An immersive neuro-art canvas' },
  { id: 'play' as const, number: '02', title: 'THE QUIET SIGNAL', mode: 'PLAY', description: 'Paint a target and let the pace respond cautiously.', icon: Target, className: 'play-art', tag: 'An adaptive painting challenge' },
]

const defaultMapping: Record<Movement, Action | 'none'> = {
  BLINK: 'confirm', WINK: 'switch', JAW_CLENCH: 'none', REST: 'none', UNKNOWN: 'none',
}
const ART_COLORS = [
  '#ffffff', '#000000', '#ff4057', '#ff8b38', '#ffd447', '#72da69',
  '#39e4d1', '#43a5ff', '#9366ff', '#ff62bd', '#a8f0df', '#c4a0ff',
  '#f3a5a0', '#bad8ff', '#d2f477',
]
const ART_COLOR_NAMES = [
  'White', 'Black', 'Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple',
  'Pink', 'Mint', 'Lavender', 'Coral', 'Ice blue', 'Lime',
]
const BRUSHES = ['normal', 'soft', 'spray', 'neon', 'particle'] as const
type BrushType = typeof BRUSHES[number]
const movementNames: Record<Movement, string> = {
  BLINK: 'Blink', WINK: 'Wink', JAW_CLENCH: 'Jaw clench', REST: 'Rest', UNKNOWN: 'Unknown',
}
const actionNames: Record<Action, string> = { confirm: 'Confirm / interact', switch: 'Switch / change', special: 'Special action' }

function drawBrushSegment(
  context: CanvasRenderingContext2D,
  from: StudioPoint,
  to: StudioPoint,
  color: string,
  size: number,
  brush: BrushType,
  particles: ArtParticle[] = [],
) {
  context.save()
  const initialAlpha = context.globalAlpha
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (brush === 'spray' || brush === 'particle') {
    context.fillStyle = color
    for (const particle of particles) {
      context.globalAlpha = particle.alpha * initialAlpha
      context.beginPath()
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
      context.fill()
    }
  } else {
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.strokeStyle = color
    context.lineWidth = brush === 'soft' ? size * 1.4 : size
    if (brush === 'soft') {
      context.globalAlpha = initialAlpha * 0.68
      context.shadowColor = color
      context.shadowBlur = size * 1.25
    } else if (brush === 'neon') {
      context.shadowColor = color
      context.shadowBlur = size * 2.8
      context.lineWidth = size * 1.55
      context.stroke()
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.strokeStyle = '#ffffff'
      context.lineWidth = Math.max(1, size * 0.22)
      context.shadowBlur = size * 0.75
    }
    context.stroke()
  }
  context.restore()
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) as T : fallback
  } catch {
    return fallback
  }
}

function Brand({ onClick }: { onClick: () => void }) {
  return <button className="brand" onClick={onClick} aria-label="Neuroverse home"><span className="brand-symbol"><i /><i /><i /></span><span>NEURO<span className="brand-light">VERSE</span></span></button>
}

function App() {
  const [page, setPage] = useState<Page>('create')
  const [source, setSource] = useState<InputSource>('simulation')
  const [webcamActive, setWebcamActive] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [gestureSensitivity, setGestureSensitivity] = useState(6)
  const [browThreshold, setBrowThreshold] = useState(DEFAULT_BROW_THRESHOLD)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [diagnosticHeadPose, setDiagnosticHeadPose] = useState<HeadPose | null>(null)
  const [diagnosticHeadPoint, setDiagnosticHeadPoint] = useState<{ x: number; y: number } | null>(null)
  const [gestureStatus, setGestureStatus] = useState('NEUTRAL')
  const [workloadAdaptation, setWorkloadAdaptation] = useState<WorkloadAdaptation>(initialWorkloadAdaptation)
  const [events, setEvents] = useState<MovementEvent[]>([])
  const [currentEvent, setCurrentEvent] = useState<MovementEvent | null>(null)
  const [debugOpen, setDebugOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [mapping, setMapping] = useState(() => readStorage('neuroverse.mapping', defaultMapping))
  const cooldownRef = useRef<Record<string, number>>({})
  const studioCommandRef = useRef<((action: GestureAction) => void) | null>(null)
  const studioGazeRef = useRef<((point: StudioPoint | null) => void) | null>(null)
  const studioBrowRef = useRef<((score: number | null) => void) | null>(null)
  const studioFaceStatusRef = useRef<((detected: boolean) => void) | null>(null)
  const diagnosticTimerRef = useRef(0)
  const diagnosticPointTimerRef = useRef(0)
  const gestureStatusTimerRef = useRef<number | null>(null)
  const diagnosticsOpenRef = useRef(false)
  diagnosticsOpenRef.current = diagnosticsOpen

  const emit = useCallback((event: MovementEvent) => {
    if (event.confidence < 0.62) return
    const now = Date.now()
    if (now - (cooldownRef.current[event.movement] ?? 0) < 420) return
    cooldownRef.current[event.movement] = now
    setCurrentEvent(event)
    setEvents((previous) => [event, ...previous].slice(0, 12))
  }, [])

  const handleFaceDetected = useCallback((detected: boolean) => {
    setFaceDetected((current) => current === detected ? current : detected)
    studioFaceStatusRef.current?.(detected)
  }, [])
  const handleHeadPose = useCallback((pose: HeadPose | null) => {
    const now = performance.now()
    if (diagnosticsOpenRef.current && now - diagnosticTimerRef.current > 100) {
      diagnosticTimerRef.current = now
      setDiagnosticHeadPose(pose)
    }
  }, [])
  const handleGaze = useCallback((point: StudioPoint | null) => {
    studioGazeRef.current?.(point)
  }, [])
  const handleBrow = useCallback((score: number | null) => {
    studioBrowRef.current?.(score)
  }, [])
  const handleHeadPoint = useCallback((point: { x: number; y: number } | null) => {
    if (!diagnosticsOpenRef.current) return
    const now = performance.now()
    if (now - diagnosticPointTimerRef.current <= 100) return
    diagnosticPointTimerRef.current = now
    setDiagnosticHeadPoint(point)
  }, [])
  const pageRef = useRef(page)
  pageRef.current = page
  const handleGlobalGesture = useCallback((gesture: FacialGesture) => {
    setGestureStatus(gesture.replaceAll('_', ' '))
    if (gestureStatusTimerRef.current !== null) window.clearTimeout(gestureStatusTimerRef.current)
    gestureStatusTimerRef.current = window.setTimeout(() => setGestureStatus('NEUTRAL'), 1400)
    const currentPage = pageRef.current
    const action = processGesture(gesture)
    if (currentPage === 'create' || currentPage === 'play') {
      studioCommandRef.current?.(action)
      return
    }
    const controls = Array.from(document.querySelectorAll<HTMLElement>(
      'main button:not(:disabled), main a[href], main select:not(:disabled)',
    )).filter((control) => control.getClientRects().length > 0)
    if (!controls.length) return
    const activeIndex = controls.indexOf(document.activeElement as HTMLElement)
    if (action === 'navigate') {
      const next = (activeIndex + 1) % controls.length
      controls[next].focus({ preventScroll: true })
      return
    }
    controls[Math.max(0, activeIndex)].click()
  }, [])
  const registerStudioCommand = useCallback((handler: ((action: GestureAction) => void) | null) => {
    studioCommandRef.current = handler
  }, [])
  const registerStudioGaze = useCallback((handler: ((point: StudioPoint | null) => void) | null) => {
    studioGazeRef.current = handler
  }, [])
  const registerStudioBrow = useCallback((handler: ((score: number | null) => void) | null) => {
    studioBrowRef.current = handler
  }, [])
  const registerStudioFaceStatus = useCallback((handler: ((detected: boolean) => void) | null) => {
    studioFaceStatusRef.current = handler
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setDebugOpen((open) => !open)
        return
      }
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if ((page === 'create' || page === 'play') && event.code === 'Space') return
      const keyMap: Record<string, Movement> = { ' ': 'BLINK', a: 'WINK', r: 'REST' }
      const movement = keyMap[event.key.toLowerCase()]
      if (movement) {
        event.preventDefault()
        emit({ movement, source: 'simulation', timestamp: Date.now(), confidence: 1 })
        if (movement === 'WINK' && (page === 'create' || page === 'play')) handleGlobalGesture('LEFT_WINK')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [emit, handleGlobalGesture, page])

  useEffect(() => {
    localStorage.setItem('neuroverse.mapping', JSON.stringify(mapping))
  }, [mapping])
  useEffect(() => () => {
    if (gestureStatusTimerRef.current !== null) window.clearTimeout(gestureStatusTimerRef.current)
  }, [])

  const navigate = (next: Page) => {
    setPage(next)
    setMobileNav(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const actionFor = useCallback((movement: Movement) => mapping[movement], [mapping])
  const reportWebcamStatus = useCallback((active: boolean) => {
    setWebcamActive(active)
    if (!active) {
      setFaceDetected(false)
      setDiagnosticHeadPose(null)
      setDiagnosticHeadPoint(null)
      studioFaceStatusRef.current?.(false)
      studioGazeRef.current?.(null)
    }
  }, [])

  return (
    <div className={page === 'create' || page === 'play' ? 'app-shell studio-active' : 'app-shell'}>
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <Brand onClick={() => navigate('create')} />
        <button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation">{mobileNav ? <X /> : <Menu />}</button>
        <nav className={mobileNav ? 'main-nav nav-open' : 'main-nav'} aria-label="Main navigation">
          <button className={page === 'create' ? 'nav-active' : ''} onClick={() => navigate('create')}>Canvas</button>
          <button className={page === 'play' ? 'nav-active' : ''} onClick={() => navigate('play')}>Play</button>
          <button className={page === 'adapt' ? 'nav-active' : ''} onClick={() => navigate('adapt')}>Recorded EEG</button>
        </nav>
        <div className="topbar-right">
          <span className="source-status"><span className={webcamActive && faceDetected ? 'status-dot' : 'status-dot muted-dot'} />{!webcamActive ? 'TRACKING PAUSED' : faceDetected ? 'FACE TRACKING' : 'FACE NOT DETECTED'}</span>
          <button className="top-enter" onClick={() => navigate('create')}>OPEN CANVAS <ArrowRight size={14} /></button>
        </div>
      </header>

      <main>
        <AnimatePresence mode="wait">
          <motion.div key={page} className="page-shell" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: 0.22 }}>
            {page === 'home' && <Landing navigate={navigate} onChoose={(experience) => navigate(experience)} />}
            {page === 'explore' && <Explore navigate={navigate} onChoose={(experience) => navigate(experience)} />}
            {page === 'calibration' && <Calibration navigate={navigate} destination="create" source={source} setSource={setSource} onMovement={emit} currentEvent={currentEvent} mapping={mapping} setMapping={setMapping} />}
            {page === 'story' && <StoryMode navigate={navigate} actionFor={actionFor} lastMovement={currentEvent} adaptation={workloadAdaptation} />}
            {page === 'pet' && <PetMode navigate={navigate} actionFor={actionFor} lastMovement={currentEvent} adaptation={workloadAdaptation} />}
            {(page === 'create' || page === 'play') && <CreateMode
              adaptation={workloadAdaptation}
              initialMode={page}
              cameraActive={webcamActive}
              faceDetected={faceDetected}
              diagnosticsOpen={diagnosticsOpen}
              browThreshold={browThreshold}
              reportHeadPoint={handleHeadPoint}
              registerGestureCommand={registerStudioCommand}
              registerGazeHandler={registerStudioGaze}
              registerBrowHandler={registerStudioBrow}
              registerFaceStatusHandler={registerStudioFaceStatus}
            />}
            {page === 'adapt' && <NeuroAdaptDashboard onAdaptation={setWorkloadAdaptation} />}
            {page === 'about' && <About navigate={navigate} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <footer className="footer"><Brand onClick={() => navigate('create')} /><span>© 2026 NEUROVERSE</span><span className="footer-right">A QUIETER CANVAS <span className="footer-star">✳</span></span></footer>

      <div className="global-sensor">
        <WebcamInput
          compact
          showPreview={diagnosticsOpen}
          sensitivity={gestureSensitivity}
          onMovement={emit}
          onStatus={reportWebcamStatus}
          onFaceDetected={handleFaceDetected}
          onHeadPose={handleHeadPose}
          onBrow={handleBrow}
          onGaze={handleGaze}
          onGesture={handleGlobalGesture}
        />
        <button className="diagnostics-toggle" aria-pressed={diagnosticsOpen} onClick={() => setDiagnosticsOpen(!diagnosticsOpen)}>DIAGNOSTICS</button>
        {diagnosticsOpen && <aside className="global-diagnostics">
          <strong>LOCAL SENSOR DIAGNOSTICS</strong>
          <span>Face: {faceDetected ? 'DETECTED' : webcamActive ? 'NOT DETECTED' : 'CAMERA OFF'}</span>
          <span>Head pose: {diagnosticHeadPose ? `yaw ${diagnosticHeadPose.yaw.toFixed(3)} · pitch ${diagnosticHeadPose.pitch.toFixed(3)}` : 'NO TRACKING DATA'}</span>
          <span>Normalized cursor: {diagnosticHeadPoint ? `${diagnosticHeadPoint.x.toFixed(3)}, ${diagnosticHeadPoint.y.toFixed(3)}` : 'NOT CALIBRATED'}</span>
          <span>Gesture: {gestureStatus}</span>
          <label>Gesture sensitivity · {gestureSensitivity}<input type="range" min="1" max="10" value={gestureSensitivity} onChange={(event) => setGestureSensitivity(Number(event.target.value))} /></label>
          <label>Play scowl threshold · {browThreshold.toFixed(2)}<input type="range" min="0.1" max="0.7" step="0.05" value={browThreshold} onChange={(event) => setBrowThreshold(Number(event.target.value))} /><small>Lower responds to gentler scowls; raise it if the box grows while your face is relaxed.</small></label>
          <small>Preview is visible only while diagnostics are open. Camera frames remain local.</small>
        </aside>}
      </div>
      <div className="keyboard-hint"><Command size={13} /><span>SPACE</span> hold to draw <i /> <span>BLINK</span> navigate <i /> <span>WINK</span> select</div>
      <button className="debug-toggle" onClick={() => setDebugOpen(!debugOpen)} aria-label="Toggle developer panel"><Settings2 size={17} /></button>
      <AnimatePresence>{debugOpen && <DeveloperPanel source={source} webcamActive={webcamActive} events={events} currentEvent={currentEvent} onMovement={emit} onReset={() => { setEvents([]); setCurrentEvent(null); cooldownRef.current = {} }} onClose={() => setDebugOpen(false)} />}</AnimatePresence>
    </div>
  )
}

function Landing({ navigate, onChoose }: { navigate: (page: Page) => void; onChoose: (experience: 'create' | 'play') => void }) {
  return <div className="landing">
    <section className="hero">
      <div className="hero-copy">
        <div className="kicker"><span className="kicker-line" /> A NEW KIND OF PLAY <span className="kicker-orbit">✳</span></div>
        <h1>MAKE<br /><span>SPACE</span><br />TO CREATE<span className="period">.</span></h1>
        <p className="hero-subtitle">A quiet canvas, guided by your movement.<br />Your art stays yours.</p>
        <div className="hero-actions"><button className="button button-primary" onClick={() => navigate('create')}>OPEN THE CANVAS <ArrowRight size={17} /></button><button className="text-button" onClick={() => navigate('play')}><Target size={14} /> PLAY CHALLENGE</button></div>
        <div className="hero-index"><span>01</span><i /><small>AN IMMERSIVE NEURO-ART CANVAS</small></div>
      </div>
      <div className="portal-stage" aria-label="Abstract glowing portal illustration">
        <div className="portal-grid" /><div className="portal-orbit orbit-a" /><div className="portal-orbit orbit-b" /><div className="portal-core"><div className="core-glow" /><div className="core-ring" /><span className="core-star">✳</span></div>
        <div className="portal-spark spark-a">✦</div><div className="portal-spark spark-b">·</div><div className="portal-spark spark-c">✧</div>
        <div className="portal-caption"><span>FIG. 01</span><i /><span>THE NEUROVERSE GATE</span></div>
        <div className="portal-label label-left"><span className="label-dot" /> LOCAL DEMO <small>KEYBOARD READY</small></div>
        <div className="portal-label label-right"><small>OPTIONAL WEBCAM</small><span>NO EEG CONNECTED</span></div>
        <div className="hero-floating">MOVE A LITTLE.<br /><span>FEEL A LOT.</span></div>
      </div>
      <div className="hero-scroll"><ArrowDown size={13} /> SCROLL TO EXPLORE <span>01 — 03</span></div>
    </section>
    <section className="experience-strip"><div className="strip-heading"><span className="eyebrow">ONE CANVAS. TWO WAYS TO PLAY.</span><button className="text-button" onClick={() => navigate('explore')}>CHOOSE A MODE <ArrowRight size={14} /></button></div>
      <div className="experience-preview">{experiences.map((item) => <button key={item.id} className={`preview-tile ${item.className}`} onClick={() => onChoose(item.id)}><div className="tile-symbol">{item.id === 'play' ? <Target /> : <WandSparkles />}</div><span>{item.mode}</span><strong>{item.title}</strong><small>{item.tag}</small><ArrowRight className="tile-arrow" size={16} /></button>)}</div>
    </section>
    <HowItWorks navigate={navigate} />
  </div>
}

function HowItWorks({ navigate }: { navigate: (page: Page) => void }) {
  return <section className="how-section" id="how-it-works"><div className="section-lead"><div><span className="eyebrow">SIMPLE BY DESIGN</span><h2>MOVE<br /><span>TO CREATE.</span></h2></div><p>Use your head to guide the brush, facial gestures to navigate, and keyboard or mouse controls whenever you prefer.</p></div>
    <div className="movement-explainer">{[['BLINK', 'Move to the next control.', '◉'], ['WINK', 'Left or right wink selects the highlighted control.', '◒'], ['GAZE + SPACE', 'Calibrate your gaze, then hold Space and look where you want to draw.', '⌁']].map(([name, text, glyph], index) => <div className="movement-step" key={name}><span className="step-num">0{index + 1}</span><span className="movement-glyph">{glyph}</span><strong>{name}</strong><p>{text}</p></div>)}</div>
    <div className="how-bottom"><span>WEBCAM IS OPTIONAL · EEG IS NOT CONNECTED</span><button className="text-button" onClick={() => navigate('create')}>OPEN CANVAS <ArrowRight size={14} /></button></div>
  </section>
}

function Explore({ navigate, onChoose }: { navigate: (page: Page) => void; onChoose: (experience: 'create' | 'play') => void }) {
  return <section className="subpage explore-page"><div className="page-heading"><span className="eyebrow">NEUROVERSE CANVAS</span><h1>CHOOSE YOUR<br /><span>PACE.</span></h1><p>One canvas. Create freely or take on a gentle target challenge.</p></div>
    <div className="universe-grid">{experiences.map((item) => { const Icon = item.icon; return <article className={`universe-card ${item.className}`} key={item.id}><div className="universe-card-visual"><span className="universe-index">{item.number} / 02</span><div className="visual-orb">{item.id === 'play' ? <Target size={43} /> : <div className="mini-art"><i /><i /><i /><i /></div>}</div><span className="universe-badge"><Icon size={14} /> {item.mode}</span></div><div className="universe-card-copy"><div><span className="eyebrow">{item.tag}</span><h2>{item.title}</h2><p>{item.description}</p></div><button className="round-arrow" aria-label={`Open ${item.mode}`} onClick={() => onChoose(item.id)}><ArrowRight size={18} /></button></div></article>})}</div>
    <div className="page-bottom-note"><span className="status-dot" /> CAMERA OPTIONAL · LIVE EEG UNAVAILABLE <button onClick={() => navigate('create')}>OPEN CANVAS <ArrowRight size={14} /></button></div>
  </section>
}

function Calibration({ navigate, destination, source, setSource, onMovement, currentEvent, mapping, setMapping }: { navigate: (page: Page) => void; destination: 'story' | 'pet' | 'create' | 'play'; source: InputSource; setSource: (source: InputSource) => void; onMovement: (event: MovementEvent) => void; currentEvent: MovementEvent | null; mapping: Record<Movement, Action | 'none'>; setMapping: (mapping: Record<Movement, Action | 'none'>) => void }) {
  return <section className="subpage calibration-page"><button className="back-link" onClick={() => navigate('explore')}><ArrowLeft size={15} /> BACK TO WORLDS</button>
    <div className="page-heading calibration-heading"><span className="eyebrow">BEFORE WE BEGIN</span><h1>FIND YOUR<br /><span>RHYTHM.</span></h1><p>Camera access is requested automatically. Keyboard simulation is also available.</p></div>
    <div className="setup-layout"><div className="setup-left"><span className="eyebrow">01 / INPUT SOURCE</span>
      <div className="source-options">
        <button className={source === 'simulation' ? 'source-option selected' : 'source-option'} onClick={() => setSource('simulation')}><div className="source-icon"><Gamepad2 /></div><div><strong>Keyboard simulation</strong><small>Always available · no setup</small></div><span className="radio-dot">{source === 'simulation' && <i />}</span></button>
        <button className={source === 'webcam' ? 'source-option selected' : 'source-option'} onClick={() => setSource('webcam')}><div className="source-icon"><ScanFace /></div><div><strong>Webcam movement</strong><small>Experimental · permission required</small></div><span className="radio-dot">{source === 'webcam' && <i />}</span></button>
        <button className="source-option disabled-option" onClick={() => setSource('eeg')}><div className="source-icon"><AudioLines /></div><div><strong>EEG interface</strong><small>Coming soon · no hardware connected</small></div><span className="coming-label">SOON</span></button>
      </div>
      {source === 'eeg' && <div className="notice-box"><Radio size={17} /><span>{EEG_SERVICE_MESSAGE}</span></div>}
      <div className="mapping-box"><div className="mapping-heading"><span className="eyebrow">02 / MOVEMENT MAPPING</span><span>SAVED ON THIS DEVICE</span></div>{(['BLINK', 'WINK'] as Movement[]).map((movement) => <label className="mapping-row" key={movement}><span>{movementNames[movement]}</span><select value={mapping[movement]} onChange={(event) => setMapping({ ...mapping, [movement]: event.target.value as Action })}><option value="confirm">{actionNames.confirm}</option><option value="switch">{actionNames.switch}</option><option value="special">{actionNames.special}</option></select></label>)}</div>
    </div>
    <div className="setup-right"><div className="setup-card"><div className="setup-card-top"><span className="eyebrow">03 / CALIBRATION</span><span className={source === 'eeg' ? 'ready-chip eeg-chip' : 'ready-chip'}><i />{source === 'simulation' ? 'KEYBOARD READY' : source === 'webcam' ? 'WEBCAM SELECTED' : 'EEG DISCONNECTED'}</span></div><div className="calibration-glyph"><div className="cal-ring ring-one" /><div className="cal-ring ring-two" /><div className="cal-icon"><Eye size={26} /></div><span className="orbit-dot" /></div><h2>Let’s get in sync.</h2><p>Try each movement to see how it feels. Your controls stay available in every world.</p><div className="movement-indicator"><span className="eyebrow">CURRENT MOVEMENT</span><strong>{currentEvent ? movementNames[currentEvent.movement] : 'Waiting for input'}</strong><small>{currentEvent ? `${currentEvent.confidence.toFixed(2)} confidence · ${currentEvent.source}` : 'Try a key or select a test movement'}</small></div><div className="movement-test">{(['BLINK', 'WINK'] as Movement[]).map((movement) => <button key={movement} onClick={() => onMovement({ movement, source: 'simulation', timestamp: Date.now(), confidence: 1 })}><span>{movement === 'BLINK' ? 'SPACE' : 'A'}</span>{movementNames[movement]}</button>)}</div><div className="rest-hint">R <span>REST · RESET TO NEUTRAL</span></div><button className="button button-primary start-button" onClick={() => navigate(destination)}>ENTER EXPERIENCE <ArrowRight size={16} /></button></div><div className="privacy-caption"><Check size={14} /> Camera is opt-in. Video is processed locally and never recorded.</div></div></div>
    <div className="calibration-foot"><span>YOUR PROGRESS SAVES AUTOMATICALLY</span><button onClick={() => navigate(destination)}>SKIP SETUP <ArrowRight size={14} /></button></div>
  </section>
}

function StoryMode({ navigate, actionFor, lastMovement, adaptation }: { navigate: (page: Page) => void; actionFor: (movement: Movement) => Action | 'none'; lastMovement: MovementEvent | null; adaptation: WorkloadAdaptation }) {
  const [beatId, setBeatId] = useState('arrival')
  const [choice, setChoice] = useState(0)
  const beat = story[beatId]
  const [specialMessage, setSpecialMessage] = useState('')
  const [showHint, setShowHint] = useState(false)
  const progressedAt = useRef(lastMovement?.timestamp ?? 0)
  const selectChoice = (next?: string) => {
    if (!next) return
    setBeatId(next)
    setChoice(0)
    setSpecialMessage('')
  }
  useEffect(() => {
    if (!lastMovement || lastMovement.timestamp === progressedAt.current) return
    progressedAt.current = lastMovement.timestamp
    const action = actionFor(lastMovement.movement)
    if (action === 'switch' && beat.choices?.length) setChoice((current) => (current + 1) % beat.choices!.length)
    if (action === 'confirm' && beat.choices?.length) selectChoice(beat.choices[choice].next)
    if (action === 'special' && beat.special) setSpecialMessage('Signal amplified · new details unlocked')
  }, [lastMovement, actionFor, beat, choice])
  const restart = () => { setBeatId('arrival'); setChoice(0) }
  return <section className="experience-page story-page"><div className="experience-toolbar"><button className="back-link" onClick={() => navigate('explore')}><ArrowLeft size={15} /> ALL WORLDS</button><span className="mode-label"><BookOpen size={14} /> STORY MODE</span><button className="toolbar-action" onClick={restart}><RotateCcw size={14} /> RESTART</button></div>
    <div className="story-layout"><div className="story-artwork"><div className="story-stars" /><div className="story-planet" /><div className="story-station"><i /><i /><i /><span /></div><div className="story-signal"><span /><span /><span /><span /><span /></div><div className="story-art-caption"><span>THE ORPHEUS STATION</span><small>DEEP SPACE · 2149</small></div><span className="chapter-chip">{beat.chapter}</span></div>
      <div className="story-content"><div className="story-progress"><span>YOUR JOURNEY</span><div><i style={{ width: `${Math.min(100, 18 + Object.keys(story).indexOf(beatId) * 11)}%` }} /></div><span>{String(Object.keys(story).indexOf(beatId) + 1).padStart(2, '0')} / 08</span></div><AdaptationNotice adaptation={adaptation} world="story" /><AnimatePresence mode="wait"><motion.div key={beatId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}><span className="eyebrow">THE LAST SIGNAL</span><h1>{beat.title}</h1><p className="story-prose">{beat.text}</p>{beat.dialogue && <div className="dialogue"><span />{beat.dialogue}</div>}{specialMessage && <div className="special-message"><Zap size={14} /> {specialMessage}</div>}
        {adaptation.hint_available && !beat.ending && <div className="workload-hint"><div><span className="eyebrow">OPTIONAL STORY HINT · NO TIME PRESSURE</span>{showHint && <p>{beatId === 'arrival' ? 'Trace the transmission to learn more before deciding what to do.' : beatId === 'trace' ? 'The station’s memory may reveal where the voice came from.' : beatId === 'airlock' ? 'The warning and the visitor are both clues; decide which you trust.' : 'Consider how this choice could shape the station’s future.'}</p>}</div><button onClick={() => setShowHint(!showHint)}>{showHint ? 'HIDE HINT' : 'SHOW HINT'}</button></div>}
        {!beat.ending && beat.choices && <div className="story-choices"><span className="eyebrow">WHAT DO YOU DO?</span>{beat.choices.map((item, index) => <button className={choice === index ? 'story-choice choice-active' : 'story-choice'} key={item.label} onClick={() => selectChoice(item.next)}><span className="choice-key">{index === 0 ? '01' : '02'}</span>{item.label}<ArrowRight size={15} /></button>)}</div>}
        {beat.ending && <div className="ending-actions"><span className="ending-badge"><Stars size={15} /> STORY COMPLETE</span><button className="button button-primary" onClick={restart}>PLAY AGAIN <RotateCcw size={14} /></button></div>}</motion.div></AnimatePresence><div className="story-controls"><span><kbd>SPACE</kbd> CHOOSE <kbd>A</kbd> SWITCH{beat.special ? <> <kbd>S</kbd> SPECIAL</> : null}</span><span className="live-feedback"><i /> MOVEMENT INPUT READY</span></div></div></div>
  </section>
}

type PetState = { hunger: number; happiness: number; energy: number; xp: number; level: number; name: string; history: string[]; skin: number }
const initialPet: PetState = { hunger: 72, happiness: 68, energy: 82, xp: 20, level: 1, name: 'MISO', history: ['Miso found a moonberry.', 'A new friend arrived.'], skin: 0 }

function PetMode({ navigate, actionFor, lastMovement, adaptation }: { navigate: (page: Page) => void; actionFor: (movement: Movement) => Action | 'none'; lastMovement: MovementEvent | null; adaptation: WorkloadAdaptation }) {
  const [pet, setPet] = useState(() => readStorage<PetState>('neuroverse.pet', initialPet))
  const [reaction, setReaction] = useState('A little wonder, just for you.')
  const [renaming, setRenaming] = useState(false)
  const [petNameDraft, setPetNameDraft] = useState(pet.name)
  const lastMovementAt = useRef(lastMovement?.timestamp ?? 0)
  const actionCooldownAt = useRef(0)
  useEffect(() => { localStorage.setItem('neuroverse.pet', JSON.stringify(pet)) }, [pet])
  useEffect(() => {
    const timer = window.setInterval(() => setPet((current) => ({ ...current, hunger: Math.max(0, current.hunger - 1), energy: Math.max(0, current.energy - 0.5) })), 60000)
    return () => window.clearInterval(timer)
  }, [])
  const applyAction = useCallback((action: Action) => {
    const now = Date.now()
    if (now - actionCooldownAt.current < 600) return
    actionCooldownAt.current = now
    const notes: Record<Action, string> = { confirm: 'Miso happily gobbles a moonberry.', switch: 'Miso zips after a trail of starlight!', special: 'Miso glows with a little moon magic!' }
    setReaction(notes[action])
    setPet((current) => {
      const xp = current.xp + 10
      const levelUp = xp >= 100
      return {
        ...current,
        hunger: action === 'confirm' ? Math.min(100, current.hunger + 22) : current.hunger,
        happiness: action === 'switch' ? Math.min(100, current.happiness + 18) : action === 'special' ? Math.min(100, current.happiness + 12) : Math.min(100, current.happiness + 5),
        energy: action === 'special' ? Math.max(0, current.energy - 8) : action === 'switch' ? Math.max(0, current.energy - 4) : current.energy,
        xp: levelUp ? xp - 100 : xp,
        level: current.level + (levelUp ? 1 : 0),
        history: [notes[action], ...current.history].slice(0, 5),
        skin: levelUp ? Math.min(2, current.skin + 1) : current.skin,
      }
    })
  }, [])
  useEffect(() => {
    if (!lastMovement || lastMovement.timestamp === lastMovementAt.current) return
    const action = actionFor(lastMovement.movement)
    lastMovementAt.current = lastMovement.timestamp
    if (action !== 'none') applyAction(action)
  }, [lastMovement, actionFor, applyAction])
  const meter = (label: string, value: number, cls: string) => <div className="pet-meter"><div><span>{label}</span><strong>{Math.round(value)}%</strong></div><div className="meter-track"><i className={cls} style={{ width: `${value}%` }} /></div></div>
  return <section className="experience-page pet-page"><div className="experience-toolbar"><button className="back-link" onClick={() => navigate('explore')}><ArrowLeft size={15} /> ALL WORLDS</button><span className="mode-label"><PawPrint size={14} /> PET MODE</span><span className="saved-label"><Check size={13} /> SAVED LOCALLY</span></div>
    <div className="pet-layout"><div className="pet-world"><div className="pet-sky"><span className="sky-moon" /><i className="sky-star star-1" /><i className="sky-star star-2" /><i className="sky-star star-3" /><i className="sky-star star-4" /><div className={`pet-creature skin-${pet.skin}`}><div className="pet-ear ear-left" /><div className="pet-ear ear-right" /><div className="pet-body"><div className="pet-face"><span className="pet-eye eye-left" /><span className="pet-eye eye-right" /><span className="pet-blush blush-left" /><span className="pet-blush blush-right" /><span className="pet-mouth" /></div><span className="pet-belly" /><span className="pet-mark" /></div><div className="pet-feet"><i /><i /></div><span className="pet-tail" /></div><div className="pet-platform" /><div className="pet-nameplate"><span>YOUR COMPANION</span><strong>{pet.name}</strong><small>LEVEL {String(pet.level).padStart(2, '0')} · MOON SPRITE</small></div><div className="pet-speech">{reaction}</div>{renaming ? <form className="rename-form" onSubmit={(event) => { event.preventDefault(); const name = petNameDraft.trim(); if (name) setPet((current) => ({ ...current, name: name.slice(0, 16).toUpperCase() })); setRenaming(false) }}><input aria-label="Pet name" autoFocus maxLength={16} value={petNameDraft} onChange={(event) => setPetNameDraft(event.target.value)} /><button type="submit">SAVE</button><button type="button" onClick={() => setRenaming(false)}>CANCEL</button></form> : <button className="rename-pet" onClick={() => { setPetNameDraft(pet.name); setRenaming(true) }}>RENAME <Plus size={12} /></button>}</div></div>
      <div className="pet-dashboard"><div className="pet-welcome"><span className="eyebrow">YOUR LITTLE UNIVERSE</span><h1>Meet {pet.name.toLowerCase()}.</h1><p>A tiny moon sprite with a big heart. Every little moment together helps {pet.name.toLowerCase()} grow.</p></div><AdaptationNotice adaptation={adaptation} world="pet" /><div className="level-card"><div><span className="eyebrow">GROWING TOGETHER</span><strong>LEVEL {pet.level}</strong></div><div className="xp-track"><i style={{ width: `${pet.xp}%` }} /></div><small>{pet.xp} / 100 XP TO NEXT LEVEL</small></div><div className="pet-meters">{meter('HUNGER', pet.hunger, 'meter-gold')}{meter('HAPPINESS', pet.happiness, 'meter-pink')}{meter('ENERGY', pet.energy, 'meter-cyan')}</div><div className="pet-actions"><span className="eyebrow">SPEND A MOMENT TOGETHER</span><div><button onClick={() => applyAction('confirm')}><span>SPACE</span><Heart size={16} /> Feed</button><button onClick={() => applyAction('switch')}><span>A</span><Sun size={16} /> Play</button><button onClick={() => applyAction('special')}><span>S</span><Sparkles size={16} /> Moonbeam</button></div><p className="pet-adapt-guidance">{adaptation.difficulty === 'challenging' ? 'Optional challenge: try Feed → Play → Moonbeam in a row.' : adaptation.difficulty === 'supportive' ? 'One action at a time is plenty. No timer, no pressure.' : 'Follow Miso’s cues and choose any action when it feels right.'}</p></div><div className="pet-history"><div><span className="eyebrow">LITTLE MOMENTS</span><span>RECENTLY</span></div>{pet.history.slice(0, 3).map((item, index) => <p key={`${item}-${index}`}><i />{item}</p>)}</div></div></div>
  </section>
}

function CreateMode({ adaptation, initialMode = 'create', cameraActive, faceDetected: externalFaceDetected, diagnosticsOpen, browThreshold, reportHeadPoint, registerGestureCommand, registerGazeHandler, registerBrowHandler, registerFaceStatusHandler }: {
  adaptation: WorkloadAdaptation
  initialMode?: StudioMode
  cameraActive: boolean
  faceDetected: boolean
  diagnosticsOpen: boolean
  browThreshold: number
  reportHeadPoint: (point: { x: number; y: number } | null) => void
  registerGestureCommand: (handler: ((action: GestureAction) => void) | null) => void
  registerGazeHandler: (handler: ((point: StudioPoint | null) => void) | null) => void
  registerBrowHandler: (handler: ((score: number | null) => void) | null) => void
  registerFaceStatusHandler: (handler: ((detected: boolean) => void) | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationCanvasRef = useRef<HTMLCanvasElement>(null)
  const playTrailCanvasRef = useRef<HTMLCanvasElement>(null)
  const playTrailRef = useRef<{ from: StudioPoint; to: StudioPoint; brush: BrushType; color: string; size: number; particles: ArtParticle[]; timestamp: number }[]>([])
  const cursorRef = useRef<HTMLDivElement>(null)
  const playTargetElementRef = useRef<HTMLDivElement>(null)
  const undoRef = useRef<CanvasSnapshot[]>([])
  const redoRef = useRef<CanvasSnapshot[]>([])
  const strokeHistoryRef = useRef<RecordedStroke[]>([])
  const strokeOpenRef = useRef(false)
  const lastStrokePointRef = useRef<{ x: number; y: number; timestamp: number } | null>(null)
  const keyboardDrawingRef = useRef(false)
  const eegJawDrawingRef = useRef(false)
  const eegJawArmedRef = useRef(false)
  const liveGesturesRef = useRef<LiveGestures | null>(null)
  const liveGestureHandlerRef = useRef<(sample: LiveGestures | null) => void>(() => {})
  const pointerStartedModeRef = useRef(false)
  const pointerStartedDuringJawRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const previousGazeRef = useRef<StudioPoint | null>(null)
  const pendingGazeRef = useRef<StudioPoint | null>(null)
  const gazeMapRef = useRef<GazeMap | null>(null)
  const calibrationSamplesRef = useRef<TimedGazeSample[]>([])
  const calibrationPointsRef = useRef<GazeCalibrationPoint[]>([])
  const calibrationTargetRef = useRef(0)
  const calibrationCollectingRef = useRef(false)
  const captureCalibrationRef = useRef<() => void>(() => {})
  const previousPointerRef = useRef<StudioPoint | null>(null)
  const previousHeadPointRef = useRef<StudioPoint | null>(null)
  const pointerDrawingRef = useRef(false)
  const calibrationTimerRef = useRef<number | null>(null)
  const smoothedCursorRef = useRef<StudioPoint | null>(null)
  const cameraActiveRef = useRef(cameraActive)
  const drawingRef = useRef(false)
  const brushRef = useRef<BrushType>('spray')
  const colorRef = useRef('#ffffff')
  const sizeRef = useRef(40)
  const faceDetectedRef = useRef(externalFaceDetected)
  const playTargetRef = useRef({ ...initialPlayTarget })
  const liveStressRef = useRef<LiveStress | null>(null)
  const browSampleRef = useRef<{ score: number; timestamp: number } | null>(null)
  const browThresholdRef = useRef(browThreshold)
  const playSignalRef = useRef<PlaySignal>('none')
  const playTargetPendingRef = useRef(false)
  const targetPositionRef = useRef<StudioPoint>({ x: 0.5, y: 0.5 })
  const focusedControlRef = useRef(0)
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const diagnosticsOpenRef = useRef(false)
  const studioModeRef = useRef<StudioMode>(initialMode)
  const [brush, setBrush] = useState<BrushType>('spray')
  const [color, setColor] = useState('#ffffff')
  const [brushSize, setBrushSize] = useState(40)
  const [painting, setPainting] = useState(false)
  const [openPanel, setOpenPanel] = useState<'color' | 'brush' | 'gallery' | null>(null)
  const [customColor, setCustomColor] = useState('#c7a6ff')
  const [name, setName] = useState('')
  const [gallery, setGallery] = useState<SavedArt[]>(() => readStorage('neuroverse.gallery', []))
  const [message, setMessage] = useState('')
  const [studioMode, setStudioMode] = useState<StudioMode>(initialMode)
  const [artAnimating, setArtAnimating] = useState(false)
  const [focusedControl, setFocusedControl] = useState(0)
  const [targetScale, setTargetScale] = useState(initialPlayTarget.scale)
  const [playScore, setPlayScore] = useState(0)
  const [targetPosition, setTargetPosition] = useState<StudioPoint>({ x: 0.5, y: 0.5 })
  const [playArea, setPlayArea] = useState<PlayArea>({ width: window.innerWidth, height: window.innerHeight, top: 100, bottom: Math.max(100, window.innerHeight - 160) })
  const [cursorSource, setCursorSource] = useState<'gaze' | 'pointer' | null>(null)
  const [calibratingGaze, setCalibratingGaze] = useState(false)
  const [calibrationTarget, setCalibrationTarget] = useState(0)
  const [calibrationProgress, setCalibrationProgress] = useState('')
  const [calibrationHint, setCalibrationHint] = useState('')
  const [flipGazeHorizontal, setFlipGazeHorizontal] = useState(() => readStorage('neuroverse.flipGazeHorizontal', true) === true)
  const calibrationOpenRef = useRef(false)
  const [mindprintOpen, setMindprintOpen] = useState(false)
  const mindprintOpenRef = useRef(false)

  drawingRef.current = painting
  brushRef.current = brush
  colorRef.current = color
  sizeRef.current = brushSize
  cameraActiveRef.current = cameraActive
  faceDetectedRef.current = externalFaceDetected
  calibrationOpenRef.current = calibratingGaze
  mindprintOpenRef.current = mindprintOpen
  diagnosticsOpenRef.current = diagnosticsOpen
  browThresholdRef.current = browThreshold
  focusedControlRef.current = focusedControl
  studioModeRef.current = studioMode

  useEffect(() => {
    localStorage.setItem('neuroverse.flipGazeHorizontal', JSON.stringify(flipGazeHorizontal))
  }, [flipGazeHorizontal])

  const cloneCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    copy.getContext('2d')?.drawImage(canvas, 0, 0)
    return copy
  }
  const snapshot = () => {
    const copy = cloneCanvas()
    if (!copy) return
    undoRef.current = [...undoRef.current.slice(-29), {
      image: copy,
      strokes: cloneStrokeHistory(strokeHistoryRef.current),
    }]
    redoRef.current = []
  }
  const restoreCanvas = (snapshot: CanvasSnapshot | undefined) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !snapshot) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(snapshot.image, 0, 0, snapshot.image.width, snapshot.image.height, 0, 0, canvas.clientWidth, canvas.clientHeight)
    strokeHistoryRef.current = cloneStrokeHistory(snapshot.strokes)
  }
  const undo = () => {
    const previous = undoRef.current.pop()
    if (!previous) return
    const current = cloneCanvas()
    if (current) redoRef.current.push({ image: current, strokes: cloneStrokeHistory(strokeHistoryRef.current) })
    restoreCanvas(previous)
  }
  const redo = () => {
    const next = redoRef.current.pop()
    if (!next) return
    const current = cloneCanvas()
    if (current) undoRef.current.push({ image: current, strokes: cloneStrokeHistory(strokeHistoryRef.current) })
    restoreCanvas(next)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const container = canvas?.parentElement
    if (!canvas || !context || !container) return
    const resize = () => {
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const copy = cloneCanvas()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const animationCanvas = animationCanvasRef.current
      if (animationCanvas) {
        animationCanvas.width = canvas.width
        animationCanvas.height = canvas.height
      }
      const trailCanvas = playTrailCanvasRef.current
      if (trailCanvas) {
        trailCanvas.width = canvas.width
        trailCanvas.height = canvas.height
      }
      if (copy && copy.width && copy.height) {
        context.drawImage(copy, 0, 0, copy.width, copy.height, 0, 0, rect.width, rect.height)
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const studio = canvas?.parentElement
    const topbar = studio?.querySelector<HTMLElement>('.studio-topbar')
    const tools = studio?.querySelector<HTMLElement>('.studio-gaze-tools')
    const dock = studio?.querySelector<HTMLElement>('.studio-bottom-dock')
    if (!canvas || !studio || !topbar || !tools || !dock) return
    const measure = () => {
      const rect = canvas.getBoundingClientRect()
      const top = Math.min(rect.height, Math.max(topbar.getBoundingClientRect().bottom, tools.getBoundingClientRect().bottom) - rect.top + 8)
      const bottom = Math.max(top, Math.min(rect.height, dock.getBoundingClientRect().top - rect.top - 8))
      setPlayArea({ width: rect.width, height: rect.height, top, bottom })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(studio)
    observer.observe(topbar)
    observer.observe(tools)
    observer.observe(dock)
    measure()
    return () => observer.disconnect()
  }, [studioMode])

  useLayoutEffect(() => {
    playTargetPendingRef.current = false
  }, [targetPosition])

  useEffect(() => {
    const url = import.meta.env.VITE_PLAY_EEG_SCORE_URL
    if (studioMode !== 'play' || !url) return
    let active = true
    let socket: WebSocket | null = null
    let retry: number | undefined
    const connect = () => {
      try {
        socket = new WebSocket(url)
      } catch (error) {
        console.error('Invalid live EEG score connection URL:', error)
        return
      }
      socket.onmessage = (event) => {
        try {
          const parsed = parseLiveStress(JSON.parse(event.data), Date.now())
          if (!parsed) {
            liveStressRef.current = null
            console.warn('Invalid or stale live EEG score; using facial fallback.')
          } else {
            liveStressRef.current = parsed
          }
        } catch (error) {
          liveStressRef.current = null
          console.warn('Could not decode live EEG score; using facial fallback.', error)
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (!active) return
        liveStressRef.current = null
        retry = window.setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      active = false
      window.clearTimeout(retry)
      liveStressRef.current = null
      socket?.close()
    }
  }, [studioMode])

  useEffect(() => {
    if (studioMode !== 'play') return
    const timer = window.setInterval(() => {
      const now = performance.now()
      const brow = browSampleRef.current
      const available = faceDetectedRef.current && brow !== null && now - brow.timestamp <= 1000
      const signal = calibrationOpenRef.current || mindprintOpenRef.current ? 'none' : selectPlaySignal(liveStressRef.current, Date.now(), available)
      if (signal !== playSignalRef.current) {
        playTargetRef.current = updatePlayTarget(playTargetRef.current, now, null)
        playSignalRef.current = signal
      }
      const score = signal === 'eeg-stressed' ? 1 : signal === 'eeg-relaxed' ? 0
        : signal === 'brow' && brow ? brow.score : null
      const next = updatePlayTarget(playTargetRef.current, now, score, browThresholdRef.current)
      if (next.scale !== playTargetRef.current.scale) setTargetScale(next.scale)
      playTargetRef.current = next
    }, 100)
    return () => {
      window.clearInterval(timer)
      playSignalRef.current = 'none'
      playTargetRef.current = updatePlayTarget(playTargetRef.current, performance.now(), null)
    }
  }, [studioMode])

  useEffect(() => {
    if (studioMode !== 'play') return
    let frame: number
    const renderTrail = (now: number) => {
      const canvas = playTrailCanvasRef.current
      const context = canvas?.getContext('2d')
      if (canvas && context && canvas.clientWidth > 0) {
        const ratio = canvas.width / canvas.clientWidth
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio)
        playTrailRef.current = playTrailRef.current.filter((item) => playTrailOpacity(item.timestamp, now) > 0)
        for (const item of playTrailRef.current) {
          context.globalAlpha = playTrailOpacity(item.timestamp, now)
          drawBrushSegment(context, item.from, item.to, item.color, item.size, item.brush, item.particles)
        }
        context.globalAlpha = 1
      }
      frame = requestAnimationFrame(renderTrail)
    }
    frame = requestAnimationFrame(renderTrail)
    return () => {
      cancelAnimationFrame(frame)
      playTrailRef.current = []
      const canvas = playTrailCanvasRef.current
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [studioMode])

  useEffect(() => {
    if (!artAnimating) {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
      const canvas = animationCanvasRef.current
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    let active = true
    const background = document.createElement('canvas')
    let cachedStrokes: RecordedStroke[] | null = null
    let particles: { particle: ArtParticle; color: string }[] = []
    const renderFrame = (timestamp: number) => {
      const canvas = animationCanvasRef.current
      const base = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!active || !canvas || !base || !context) return
      const ratio = canvas.width / base.clientWidth
      const width = canvas.width / ratio
      const height = canvas.height / ratio
      if (cachedStrokes !== strokeHistoryRef.current || background.width !== canvas.width || background.height !== canvas.height) {
        cachedStrokes = strokeHistoryRef.current
        particles = cachedStrokes.flatMap((stroke) => stroke.segments.flatMap((segment) =>
          (segment.particles ?? []).map((particle) => ({ particle, color: segment.color }))))
        background.width = canvas.width
        background.height = canvas.height
        const backgroundContext = background.getContext('2d')
        if (!backgroundContext) return
        backgroundContext.drawImage(base, 0, 0)
        backgroundContext.setTransform(ratio, 0, 0, ratio, 0, 0)
        backgroundContext.globalCompositeOperation = 'destination-out'
        for (const { particle } of particles) {
          backgroundContext.beginPath()
          backgroundContext.arc(particle.x, particle.y, particle.radius + 0.6, 0, Math.PI * 2)
          backgroundContext.fill()
        }
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.drawImage(background, 0, 0, width, height)
      context.save()
      context.shadowBlur = 0
      context.lineWidth = 0
      for (const { particle, color } of particles) {
        const point = particlePosition(particle, timestamp)
        const glow = particleGlow(particle, timestamp)
        const previous = particlePosition(particle, timestamp - 130)
        context.globalAlpha = glow.alpha * 0.32
        context.strokeStyle = color
        context.lineWidth = Math.max(0.7, glow.radius * 1.2)
        context.lineCap = 'round'
        context.beginPath()
        context.moveTo(previous.x, previous.y)
        context.lineTo(point.x, point.y)
        context.stroke()
        context.globalAlpha = glow.alpha * 0.2
        context.fillStyle = color
        context.beginPath()
        context.arc(point.x, point.y, glow.radius * 3, 0, Math.PI * 2)
        context.fill()
        context.globalAlpha = glow.alpha
        context.fillStyle = color
        context.beginPath()
        context.arc(point.x, point.y, glow.radius, 0, Math.PI * 2)
        context.fill()
      }
      context.restore()
      animationFrameRef.current = requestAnimationFrame(renderFrame)
    }
    animationFrameRef.current = requestAnimationFrame(renderFrame)
    return () => {
      active = false
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [artAnimating])

  useEffect(() => {
    const colorControl = document.querySelector<HTMLButtonElement>('.studio-color-control')
    if (!colorControl) return
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement>('.gaze-studio [data-gaze-selectable="true"]'))
      .filter((button) => !button.disabled && button.getClientRects().length > 0)
    const index = controls.indexOf(colorControl)
    if (index >= 0) {
      focusedControlRef.current = index
      setFocusedControl(index)
      colorControl.focus({ preventScroll: true })
    }
  }, [studioMode])

  useEffect(() => {
    if (openPanel || mindprintOpen) return
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement>('.gaze-studio [data-gaze-selectable="true"]'))
      .filter((button) => !button.disabled && button.getClientRects().length > 0)
    const index = controls.indexOf(document.activeElement as HTMLButtonElement)
    if (index >= 0) {
      focusedControlRef.current = index
      setFocusedControl(index)
    }
  }, [openPanel, mindprintOpen])
  useEffect(() => {
    const selector = mindprintOpen ? '.mindprint [data-gaze-selectable="true"]' : openPanel === 'gallery'
      ? '.studio-gallery-popover [data-gaze-selectable="true"]'
      : openPanel
        ? '.studio-popover [data-gaze-selectable="true"]'
        : '.gaze-studio [data-gaze-selectable="true"]'
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
      .filter((button) => !button.disabled && button.getClientRects().length > 0)
    document.querySelectorAll<HTMLElement>('.gaze-studio .is-gaze-highlighted').forEach((button) => {
      button.classList.remove('is-gaze-highlighted')
      button.removeAttribute('aria-current')
    })
    controls.forEach((button, index) => {
      button.classList.toggle('is-gaze-highlighted', index === focusedControl)
      button.setAttribute('aria-current', index === focusedControl ? 'true' : 'false')
    })
  }, [focusedControl, openPanel, studioMode, mindprintOpen])
  useEffect(() => {
    if (!openPanel) return
    const selector = openPanel === 'gallery'
      ? '.studio-gallery-popover [data-gaze-selectable="true"]'
      : '.studio-popover [data-gaze-selectable="true"]'
    const first = document.querySelector<HTMLButtonElement>(selector)
    focusedControlRef.current = 0
    setFocusedControl(0)
    first?.focus({ preventScroll: true })
  }, [openPanel])

  useEffect(() => {
    const cursor = cursorRef.current
    if (!cursor) return
    cursor.style.setProperty('--brush-color', color)
    cursor.style.setProperty('--brush-diameter', `${Math.max(8, Math.min(42, brushSize))}px`)
  }, [color, brushSize])

  const showCursor = (point: StudioPoint, source: 'gaze' | 'pointer') => {
    const cursor = cursorRef.current
    if (cursor) {
      cursor.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%)`
      cursor.style.setProperty('--brush-color', colorRef.current)
      cursor.style.setProperty('--brush-diameter', `${Math.max(8, Math.min(42, sizeRef.current))}px`)
      cursor.classList.toggle('cursor-gaze', source === 'gaze')
      cursor.classList.toggle('cursor-pointer', source === 'pointer')
      cursor.classList.add('is-visible')
    }
    setCursorSource(source)
  }
  const recordStrokeSegment = (from: StudioPoint, to: StudioPoint) => {
    const now = performance.now()
    if (studioModeRef.current === 'play') {
      playTrailRef.current.push({
        from, to, brush: brushRef.current, color: colorRef.current, size: sizeRef.current,
        particles: createBrushParticles(from, to, sizeRef.current, brushRef.current), timestamp: now,
      })
      return
    }
    const recordedFrom = strokeOpenRef.current && lastStrokePointRef.current
      ? lastStrokePointRef.current
      : { ...from, timestamp: now }
    const segment: StrokeSegment = {
      from: recordedFrom,
      to: { ...to, timestamp: now },
      brush: brushRef.current,
      color: colorRef.current,
      size: sizeRef.current,
      particles: createBrushParticles(from, to, sizeRef.current, brushRef.current),
    }
    const context = canvasRef.current?.getContext('2d')
    if (context) drawBrushSegment(context, from, to, segment.color, segment.size, brushRef.current, segment.particles)
    strokeHistoryRef.current = appendStrokeSegment(
      strokeHistoryRef.current,
      segment,
      !strokeOpenRef.current,
    )
    strokeOpenRef.current = true
    lastStrokePointRef.current = segment.to
  }
  useEffect(() => () => {
    if (calibrationTimerRef.current !== null) window.clearTimeout(calibrationTimerRef.current)
  }, [])

  const setDrawMode = (enabled: boolean) => {
    if (enabled && (calibrationOpenRef.current || mindprintOpenRef.current)) return
    if (enabled === drawingRef.current) return
    if (enabled) {
      if (studioModeRef.current === 'create') snapshot()
      previousGazeRef.current = null
      previousHeadPointRef.current = null
      setMessage(cameraActiveRef.current && gazeMapRef.current
        ? 'Eye-gaze drawing active'
        : 'Drawing active · use mouse or hold Space while moving')
    } else {
      previousGazeRef.current = null
      previousHeadPointRef.current = null
      strokeOpenRef.current = false
      lastStrokePointRef.current = null
      setMessage('Drawing paused')
    }
    drawingRef.current = enabled
    setPainting(enabled)
  }

  const dispatchGestureCommand = (action: GestureAction) => {
    if (calibrationOpenRef.current) return
    const selector = mindprintOpen ? '.mindprint [data-gaze-selectable="true"]' : openPanel === 'gallery'
      ? '.studio-gallery-popover [data-gaze-selectable="true"]'
      : openPanel
        ? '.studio-popover [data-gaze-selectable="true"]'
        : '.gaze-studio [data-gaze-selectable="true"]'
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
      .filter((button) => !button.disabled && button.getClientRects().length > 0)
    if (!controls.length) return
    const activeIndex = controls.indexOf(document.activeElement as HTMLButtonElement)
    if (action === 'navigate') {
      const next = (activeIndex + 1) % controls.length
      focusedControlRef.current = next
      setFocusedControl(next)
      controls[next].focus({ preventScroll: true })
      return
    }
    const selected = controls[activeIndex >= 0 ? activeIndex : focusedControlRef.current % controls.length]
    if (selected) selected.click()
    else controls[focusedControlRef.current % controls.length]?.click()
  }
  useEffect(() => {
    registerGestureCommand((action) => {
      if (studioModeRef.current === 'create' && liveGesturesFresh(liveGesturesRef.current, Date.now())) return
      dispatchGestureCommand(action)
    })
    return () => registerGestureCommand(null)
  })
  liveGestureHandlerRef.current = (sample) => {
    if (!sample) {
      liveGesturesRef.current = null
      eegJawArmedRef.current = false
      if (eegJawDrawingRef.current) {
        eegJawDrawingRef.current = false
        if (!pointerDrawingRef.current && !keyboardDrawingRef.current) setDrawMode(false)
      }
      return
    }
    let previous = liveGesturesRef.current
    if (previous && !liveGesturesFresh(previous, Date.now())) {
      liveGestureHandlerRef.current(null)
      previous = null
    }
    if (previous && (sample.timestamp < previous.timestamp
      || sample.blinkCount < previous.blinkCount || sample.winkCount < previous.winkCount)) {
      console.warn('Out-of-order live EEG gesture prediction')
      liveGestureHandlerRef.current(null)
      return
    }
    liveGesturesRef.current = sample
    if (keyboardDrawingRef.current) {
      keyboardDrawingRef.current = false
      if (!pointerDrawingRef.current) setDrawMode(false)
    }
    if (previous && sample.blinkCount > previous.blinkCount) dispatchGestureCommand('navigate')
    if (previous && sample.winkCount > previous.winkCount) dispatchGestureCommand('select')
    if (!sample.jawClenched) {
      eegJawArmedRef.current = true
      if (eegJawDrawingRef.current) {
        eegJawDrawingRef.current = false
        if (!pointerDrawingRef.current) setDrawMode(false)
      }
    } else if (eegJawArmedRef.current) {
      eegJawArmedRef.current = false
      if (!calibrationOpenRef.current && !mindprintOpenRef.current
        && cameraActiveRef.current && faceDetectedRef.current && gazeMapRef.current) {
        eegJawDrawingRef.current = true
        smoothedCursorRef.current = null
        setDrawMode(true)
      }
    }
  }
  useEffect(() => {
    const url = import.meta.env.VITE_GESTURE_EEG_URL
    if (studioMode !== 'create' || !url) return
    let active = true
    let socket: WebSocket | null = null
    let retry: number | undefined
    const connect = () => {
      try {
        socket = new WebSocket(url)
      } catch (error) {
        console.error('Invalid live EEG gesture connection URL:', error)
        return
      }
      socket.onmessage = (event) => {
        try {
          const sample = parseLiveGestures(JSON.parse(event.data), Date.now())
          if (!sample) console.warn('Invalid live EEG gesture prediction')
          liveGestureHandlerRef.current(sample)
        } catch (error) {
          console.warn('Could not decode live EEG gesture prediction:', error)
          liveGestureHandlerRef.current(null)
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (!active) return
        liveGestureHandlerRef.current(null)
        retry = window.setTimeout(connect, 2000)
      }
    }
    connect()
    const timer = window.setInterval(() => {
      if (liveGesturesRef.current && !liveGesturesFresh(liveGesturesRef.current, Date.now())) {
        liveGestureHandlerRef.current(null)
      }
    }, 100)
    return () => {
      active = false
      window.clearTimeout(retry)
      window.clearInterval(timer)
      liveGestureHandlerRef.current(null)
      socket?.close()
    }
  }, [studioMode])
  const handleGazePoint = (point: StudioPoint | null) => {
    if (mindprintOpenRef.current) return
    if (!point) {
      previousGazeRef.current = null
      pendingGazeRef.current = null
      previousHeadPointRef.current = null
      return
    }
    if (calibrationOpenRef.current) {
      if (calibrationCollectingRef.current) {
        const now = performance.now()
        calibrationSamplesRef.current.push({ point, timestamp: now })
        calibrationSamplesRef.current = calibrationSamplesRef.current.filter((sample) => now - sample.timestamp <= 3000)
      }
      return
    }
    if ((!keyboardDrawingRef.current && !eegJawDrawingRef.current) || !drawingRef.current) return
    if (isGazeOutlier(point, previousGazeRef.current, pendingGazeRef.current)) {
      pendingGazeRef.current = point
      previousHeadPointRef.current = null
      return
    }
    pendingGazeRef.current = null
    previousGazeRef.current = point
    const map = gazeMapRef.current
    const canvas = canvasRef.current
    if (!map || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const mapped = orientGazeForScreen(mapGazeToScreen(point, map), flipGazeHorizontal)
    const target = { x: Math.max(0, Math.min(1, mapped.x)) * rect.width, y: Math.max(0, Math.min(1, mapped.y)) * rect.height }
    const smooth = smoothGazePoint(smoothedCursorRef.current, target)
    smoothedCursorRef.current = smooth
    reportHeadPoint({ x: smooth.x / rect.width, y: smooth.y / rect.height })
    showCursor(smooth, 'gaze')
    if (!drawingRef.current) return
    const screenX = rect.left + smooth.x
    const screenY = rect.top + smooth.y
    const hit = document.elementFromPoint(screenX, screenY)
    const overControls = Boolean(hit?.closest('.studio-topbar, .studio-gaze-tools, .studio-bottom-dock, .studio-message, .studio-gallery-popover, .studio-popover, .gaze-calibration'))
    if (overControls) {
      previousHeadPointRef.current = null
      return
    }
    const prior = previousHeadPointRef.current ?? smooth
    recordStrokeSegment(prior, smooth)
    previousHeadPointRef.current = smooth
    const targetElement = playTargetElementRef.current
    if (studioModeRef.current === 'play' && targetElement && !playTargetPendingRef.current) {
      const box = targetElement.getBoundingClientRect()
      const touched = segmentTouchesTarget(prior, smooth, {
        left: box.left - rect.left, right: box.right - rect.left,
        top: box.top - rect.top, bottom: box.bottom - rect.top,
      })
      if (touched) {
        setPlayScore((score) => score + 1)
        const next = completePlayTarget(playTargetRef.current)
        const position = nextTargetPosition(playArea, next.scale, targetPositionRef.current, smooth, Math.random())
        playTargetPendingRef.current = true
        playTargetRef.current = next
        targetPositionRef.current = position
        setTargetScale(next.scale)
        setTargetPosition(position)
        previousHeadPointRef.current = null
      }
    }
  }
  const handleBrow = (score: number | null) => {
    browSampleRef.current = score !== null && Number.isFinite(score) && score >= 0 && score <= 1
      ? { score, timestamp: performance.now() } : null
  }
  const handleStudioFaceStatus = (detected: boolean) => {
    faceDetectedRef.current = detected
    if (detected) {
      setMessage('')
      return
    }
    previousGazeRef.current = null
    pendingGazeRef.current = null
    previousHeadPointRef.current = null
    previousPointerRef.current = null
    browSampleRef.current = null
    if (calibrationOpenRef.current) calibrationSamplesRef.current = []
    if (cameraActiveRef.current && drawingRef.current) {
      keyboardDrawingRef.current = false
      eegJawDrawingRef.current = false
      eegJawArmedRef.current = false
      setDrawMode(false)
      setMessage('Tracking lost · drawing paused for safety. Reactivate it when ready.')
    }
  }
  useEffect(() => {
    registerGazeHandler(handleGazePoint)
    registerBrowHandler(handleBrow)
    registerFaceStatusHandler(handleStudioFaceStatus)
    return () => {
      registerGazeHandler(null)
      registerBrowHandler(null)
      registerFaceStatusHandler(null)
    }
  })

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && (
      target.isContentEditable
      || ['TEXTAREA', 'SELECT'].includes(target.tagName)
      || target instanceof HTMLInputElement && target.type !== 'range'
    )
    const onKeyDown = (event: KeyboardEvent) => {
      if (mindprintOpenRef.current) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setMindprintOpen(false)
        }
        return
      }
      if (event.code === 'Space' && calibrationOpenRef.current) {
        event.preventDefault()
        if (!event.repeat) captureCalibrationRef.current()
        return
      }
      if (shouldStartSpaceDrawing(event.code, keyboardDrawingRef.current, isEditable(event.target))) {
        event.preventDefault()
        if (event.repeat) return
        if (calibrationOpenRef.current) return
        if (studioModeRef.current === 'create' && liveGesturesFresh(liveGesturesRef.current, Date.now())) return
        if (!cameraActiveRef.current || !faceDetectedRef.current || !gazeMapRef.current) {
          return
        }
        keyboardDrawingRef.current = true
        smoothedCursorRef.current = null
        setDrawMode(true)
        return
      }
      const target = event.target
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || ['TEXTAREA', 'SELECT'].includes(target.tagName)
        || target instanceof HTMLInputElement && target.type !== 'range'
      )) return
      if (event.key.toLowerCase() === 'g') {
        event.preventDefault()
        setDrawMode(!drawingRef.current)
      } else if (event.key === 'Escape' && calibrationOpenRef.current) {
        event.preventDefault()
        cancelCalibration()
      } else if (event.key === 'Escape' && drawingRef.current) {
        event.preventDefault()
        setDrawMode(false)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!shouldStopSpaceDrawing(event.code, keyboardDrawingRef.current)) return
      event.preventDefault()
      keyboardDrawingRef.current = false
      if (!pointerDrawingRef.current) setDrawMode(false)
    }
    const onWindowBlur = () => {
      keyboardDrawingRef.current = false
      pointerDrawingRef.current = false
      eegJawDrawingRef.current = false
      eegJawArmedRef.current = false
      if (drawingRef.current) setDrawMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [])

  const getCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>): StudioPoint => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(event)
    showCursor(point, 'pointer')
    if (event.button !== 0) return
    pointerStartedModeRef.current = !drawingRef.current
    pointerStartedDuringJawRef.current = eegJawDrawingRef.current
    if (pointerStartedModeRef.current) setDrawMode(true)
    else if (studioModeRef.current === 'create') snapshot()
    strokeOpenRef.current = false
    lastStrokePointRef.current = null
    pointerDrawingRef.current = true
    previousPointerRef.current = point
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(event)
    if ((!keyboardDrawingRef.current && !eegJawDrawingRef.current) || pointerDrawingRef.current) showCursor(point, 'pointer')
    if (!pointerDrawingRef.current || !drawingRef.current) return
    const previous = previousPointerRef.current ?? point
    recordStrokeSegment(previous, point)
    previousPointerRef.current = point
  }
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    pointerDrawingRef.current = false
    previousPointerRef.current = null
    strokeOpenRef.current = false
    if ((pointerStartedModeRef.current || pointerStartedDuringJawRef.current)
      && !keyboardDrawingRef.current && !eegJawDrawingRef.current) setDrawMode(false)
    pointerStartedModeRef.current = false
    pointerStartedDuringJawRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const clearCanvas = () => {
    if (!window.confirm('Clear the canvas? This can be undone.')) return
    setDrawMode(false)
    setArtAnimating(false)
    snapshot()
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
    strokeHistoryRef.current = []
    strokeOpenRef.current = false
    setOpenPanel(null)
    setMessage('Canvas cleared · use Undo to restore the previous artwork')
  }
  const downloadImage = (image: string, fileName: string) => {
    const link = document.createElement('a')
    link.href = image
    link.download = fileName
    link.click()
  }
  const saveArt = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    let downloaded = false
    try {
      const image = canvas.toDataURL('image/png')
      const item = {
        name: name.trim() || `Untitled ${gallery.length + 1}`,
        image,
        date: new Date().toLocaleDateString(),
        strokes: cloneStrokeHistory(strokeHistoryRef.current),
      }
      downloadImage(image, `${item.name.replace(/[\\/:*?"<>|]/g, '-')}.png`)
      downloaded = true
      const next = [item, ...gallery].slice(0, 8)
      localStorage.setItem('neuroverse.gallery', JSON.stringify(next))
      setGallery(next)
      setMessage(`Saved “${item.name}” to your gallery and downloads`)
      setOpenPanel(null)
    } catch (reason) {
      const detail = reason instanceof Error ? `: ${reason.message}` : '.'
      setMessage(downloaded ? `PNG downloaded, but gallery save failed${detail}` : `Could not export PNG${detail}`)
    }
  }
  const loadArt = (item: SavedArt) => {
    const image = new Image()
    image.onload = () => {
      snapshot()
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (canvas && context) {
        context.drawImage(image, 0, 0, canvas.clientWidth, canvas.clientHeight)
        strokeHistoryRef.current = cloneStrokeHistory(item.strokes ?? [])
      }
      setName(item.name)
      setOpenPanel(null)
      setMessage(`Loaded “${item.name}” · use Undo to return to the previous canvas`)
    }
    image.onerror = () => setMessage(`Could not load “${item.name}”.`)
    image.src = item.image
  }

  const endCalibration = () => {
    if (calibrationTimerRef.current !== null) window.clearTimeout(calibrationTimerRef.current)
    calibrationTimerRef.current = null
    playTargetRef.current = updatePlayTarget(playTargetRef.current, performance.now(), null)
    calibrationOpenRef.current = false
    calibrationCollectingRef.current = false
    setCalibratingGaze(false)
  }

  const beginCalibration = () => {
    if (!cameraActive) {
      setMessage('Camera access is required for gaze calibration.')
      return
    }
    eegJawDrawingRef.current = false
    eegJawArmedRef.current = false
    keyboardDrawingRef.current = false
    setDrawMode(false)
    previousGazeRef.current = null
    pendingGazeRef.current = null
    smoothedCursorRef.current = null
    previousHeadPointRef.current = null
    reportHeadPoint(null)
    cursorRef.current?.classList.remove('is-visible', 'cursor-gaze')
    setCursorSource(null)
    if (calibrationTimerRef.current !== null) window.clearTimeout(calibrationTimerRef.current)
    calibrationTimerRef.current = null
    calibrationPointsRef.current = []
    calibrationTargetRef.current = 0
    setCalibrationTarget(0)
    calibrationOpenRef.current = true
    setCalibratingGaze(true)
    setCalibrationHint('')
    let mismatchAttempts = 0
    const collectTarget = (notice = '') => {
      calibrationCollectingRef.current = false
      calibrationSamplesRef.current = []
      setCalibrationProgress(notice || 'Press Space or Capture, then look at the target.')
    }
    captureCalibrationRef.current = () => {
      if (calibrationTimerRef.current !== null || calibrationCollectingRef.current) return
      setCalibrationProgress('Look at the target. Capturing shortly…')
      calibrationTimerRef.current = window.setTimeout(() => {
        calibrationTimerRef.current = null
        calibrationSamplesRef.current = []
        calibrationCollectingRef.current = true
        setCalibrationProgress('Keep looking at the target while your eyes are sampled.')
        let attempts = 0
        const checkCapture = () => {
          calibrationTimerRef.current = null
          const result = evaluateGazeCapture(calibrationSamplesRef.current, performance.now())
          if (result.status !== 'ready') {
            attempts++
            if (attempts < 5) {
              setCalibrationProgress('Keep looking at the target while more eye samples are collected.')
              calibrationTimerRef.current = window.setTimeout(checkCapture, 1000)
              return
            }
            calibrationCollectingRef.current = false
            setCalibrationProgress(result.status === 'insufficient'
              ? 'Not enough eye samples. Check that your eyes are visible, then press Space or Capture to retry.'
              : 'Eye samples could not be measured consistently. Check lighting, then press Space or Capture to retry.')
            return
          }
          calibrationCollectingRef.current = false
          const index = calibrationTargetRef.current
          const target = GAZE_CALIBRATION_TARGETS[index]
          calibrationPointsRef.current[index] = { raw: result.summary.point, target: { x: target.x, y: target.y } }
          if (calibrationPointsRef.current.length < GAZE_CALIBRATION_TARGETS.length) {
            calibrationTargetRef.current = index + 1
            setCalibrationTarget(index + 1)
            collectTarget()
            return
          }
          const assessment = assessGazeCalibration(calibrationPointsRef.current)
          if (assessment.status === 'mismatch') {
            mismatchAttempts++
            calibrationTargetRef.current = assessment.index
            setCalibrationTarget(assessment.index)
            collectTarget(mismatchAttempts >= 3
              ? 'Calibration still does not match. Retry this point, or cancel and restart with better lighting.'
              : 'Let’s retry this point. Press Space or Capture, then look at the target.')
            return
          }
          endCalibration()
          if (assessment.status === 'insufficient-range') {
            setCalibrationHint('The camera could not distinguish the eye positions. Check your camera and lighting, then try again.')
            return
          }
          gazeMapRef.current = assessment.map
          setCalibrationHint('')
        }
        calibrationTimerRef.current = window.setTimeout(checkCapture, 1800)
      }, 1000)
    }
    collectTarget()
  }
  const cancelCalibration = () => {
    if (calibrationTimerRef.current !== null) window.clearTimeout(calibrationTimerRef.current)
    calibrationTimerRef.current = null
    endCalibration()
    calibrationSamplesRef.current = []
    setCalibrationHint('Calibration cancelled')
  }

  const enterPlayMode = () => {
    eegJawDrawingRef.current = false
    eegJawArmedRef.current = false
    keyboardDrawingRef.current = false
    setDrawMode(false)
    setArtAnimating(false)
    setOpenPanel(null)
    setStudioMode('play')
    studioModeRef.current = 'play'
    playTargetRef.current = { ...initialPlayTarget }
    playTargetPendingRef.current = false
    targetPositionRef.current = { x: 0.5, y: 0.5 }
    setTargetPosition(targetPositionRef.current)
    setTargetScale(initialPlayTarget.scale)
    setPlayScore(0)
  }
  const enterCreateMode = () => {
    setDrawMode(false)
    setStudioMode('create')
    studioModeRef.current = 'create'
  }
  const selectColor = (next: string) => {
    setColor(next)
    setOpenPanel(null)
    panelTriggerRef.current?.focus({ preventScroll: true })
    setMessage('Brush color updated')
  }

  const playBox = targetRect(playArea, targetScale, targetPosition)
  return <section className="experience-page create-page gaze-studio">
    {studioMode === 'play' && <div
      className="play-target"
      ref={playTargetElementRef}
      style={{ left: `${playBox.left}px`, top: `${playBox.top}px`, width: `${playBox.right - playBox.left}px`, height: `${playBox.bottom - playBox.top}px` }}
      aria-label="Green painting target"
    />}
    <canvas
      className={`studio-paint-canvas${artAnimating ? ' is-animating' : ''}`}
      ref={canvasRef}
      aria-label="Full-screen digital painting canvas"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onPointerLeave={() => {
        if (!pointerDrawingRef.current && cursorSource === 'pointer') {
          cursorRef.current?.classList.remove('is-visible', 'cursor-pointer')
          setCursorSource(null)
        }
      }}
    />
    <canvas className={`studio-animation-canvas${artAnimating ? ' is-active' : ''}`} ref={animationCanvasRef} aria-hidden="true" />
    <canvas className={`studio-play-trail${studioMode === 'play' ? ' is-active' : ''}`} ref={playTrailCanvasRef} aria-hidden="true" />
    <div className="studio-topbar">
      {studioMode === 'play' && <button className="studio-back" data-gaze-selectable="true" onClick={enterCreateMode} aria-label="Back to canvas"><ArrowLeft size={17} /><span>BACK</span></button>}
      <label className="studio-name"><ImageIcon size={14} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name this artwork" maxLength={34} aria-label="Artwork name" /></label>
      <button className="mindprint-launch" data-gaze-selectable="true" disabled={calibratingGaze} onClick={() => {
        keyboardDrawingRef.current = false
        eegJawDrawingRef.current = false
        eegJawArmedRef.current = false
        setDrawMode(false)
        setOpenPanel(null)
        setMindprintOpen(true)
        focusedControlRef.current = 0
        setFocusedControl(0)
      }}><Sparkles size={14} /> MINDPRINT</button>
      <button className={studioMode === 'play' ? 'studio-mode-button selected' : 'studio-mode-button'} data-gaze-selectable="true" onClick={studioMode === 'play' ? enterCreateMode : enterPlayMode} aria-label={studioMode === 'play' ? 'Switch to Create Mode' : 'Enter Play Mode'}>
        {studioMode === 'play' ? <WandSparkles size={14} /> : <Target size={14} />}{studioMode === 'play' ? 'CREATE' : 'PLAY'}
      </button>
    </div>
    <div className="studio-gaze-tools">
      <button className="studio-calibrate" data-gaze-selectable="true" onClick={beginCalibration} disabled={!cameraActive} aria-label={gazeMapRef.current ? 'Recalibrate gaze' : 'Calibrate gaze'} title={gazeMapRef.current ? 'Recalibrate gaze' : 'Calibrate gaze'}><Crosshair size={15} /></button>
      <button className="studio-calibrate" data-gaze-selectable="true" disabled={calibratingGaze} aria-label="Flip horizontal gaze direction" title="Flip horizontal gaze direction" aria-pressed={flipGazeHorizontal} onClick={() => {
        previousHeadPointRef.current = null
        smoothedCursorRef.current = null
        setFlipGazeHorizontal((current) => !current)
      }}><FlipHorizontal2 size={15} /></button>
    </div>
    <div className={`studio-brush-cursor brush-${brush}${painting ? ' is-painting' : ''}${cursorSource ? ' is-visible' : ''}`} ref={cursorRef} aria-hidden="true"><i /></div>
    {mindprintOpen && <Mindprint onClose={() => setMindprintOpen(false)} />}
    <div className="studio-bottom-dock">
      <div className="studio-toolbar" role="toolbar" aria-label="Creative controls">
        <div className="studio-control-wrap">
          <button ref={openPanel === 'color' ? panelTriggerRef : undefined} className={openPanel === 'color' ? 'studio-control studio-color-control is-open' : 'studio-control studio-color-control'} data-gaze-selectable="true" onClick={(event) => { if (openPanel === 'color') { setOpenPanel(null); panelTriggerRef.current?.focus({ preventScroll: true }) } else { panelTriggerRef.current = event.currentTarget; setOpenPanel('color') } }} aria-expanded={openPanel === 'color'}>
            <i className="active-color" style={{ backgroundColor: color }} /><span>COLOR</span><small>{color.toUpperCase()}</small>
          </button>
          {openPanel === 'color' && <div className="studio-popover color-popover">
            <div className="popover-heading"><span>PALETTE</span><small>CHOOSE A COLOR</small></div>
            <button className="studio-menu-back" data-gaze-selectable="true" onClick={() => { setOpenPanel(null); panelTriggerRef.current?.focus({ preventScroll: true }) }}><ArrowLeft size={13} /> BACK</button>
            <div className="color-grid">{ART_COLORS.map((item, index) => <button key={item} data-gaze-selectable="true" className={color.toLowerCase() === item.toLowerCase() ? 'color-swatch is-selected' : 'color-swatch'} style={{ backgroundColor: item }} onClick={() => selectColor(item)} aria-label={`Choose ${ART_COLOR_NAMES[index]}`} title={ART_COLOR_NAMES[index]} />)}</div>
            <label className="custom-color"><span>CUSTOM</span><input type="color" value={customColor} onChange={(event) => { setCustomColor(event.target.value); selectColor(event.target.value) }} /></label>
          </div>}
        </div>
        <div className="studio-control-wrap">
          <button ref={openPanel === 'brush' ? panelTriggerRef : undefined} className={openPanel === 'brush' ? 'studio-control is-open' : 'studio-control'} data-gaze-selectable="true" onClick={(event) => { if (openPanel === 'brush') { setOpenPanel(null); panelTriggerRef.current?.focus({ preventScroll: true }) } else { panelTriggerRef.current = event.currentTarget; setOpenPanel('brush') } }} aria-expanded={openPanel === 'brush'}>
            <span className={`brush-preview brush-${brush}`}><i /></span><span>BRUSH</span><small>{brush.toUpperCase()}</small>
          </button>
          {openPanel === 'brush' && <div className="studio-popover brush-popover">
            <div className="popover-heading"><span>BRUSH</span><small>FIVE DISTINCT TOOLS</small></div>
            <button className="studio-menu-back" data-gaze-selectable="true" onClick={() => { setOpenPanel(null); panelTriggerRef.current?.focus({ preventScroll: true }) }}><ArrowLeft size={13} /> BACK</button>
            {BRUSHES.map((item) => <button key={item} data-gaze-selectable="true" className={brush === item ? 'brush-option is-selected' : 'brush-option'} onClick={() => { setBrush(item); setOpenPanel(null); panelTriggerRef.current?.focus({ preventScroll: true }); setMessage(`${item.toUpperCase()} brush selected`) }}>
              <span className={`brush-preview brush-${item}`}><i /></span><span><strong>{item[0].toUpperCase() + item.slice(1)}</strong><small>{item === 'normal' ? 'Smooth solid line' : item === 'soft' ? 'Blurred feathered edge' : item === 'spray' ? 'Randomized paint particles' : item === 'neon' ? 'Bright layered glow' : 'Trailing particle flecks'}</small></span>
            </button>)}
          </div>}
        </div>
        <label className="studio-size"><span>SIZE <b>{brushSize}</b></span><input type="range" min="2" max="40" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} aria-label="Brush size" /></label>
        <button className={painting ? 'studio-control draw-control is-drawing' : 'studio-control draw-control'} data-gaze-selectable="true" onClick={() => setDrawMode(!painting)} aria-pressed={painting} title="Hold Space or mouse to paint; G toggles paint">
          {painting ? <Pause size={17} /> : <Play size={17} />}<span>{painting ? 'PAUSE' : 'DRAW'}</span><small>{cameraActive && gazeMapRef.current ? painting ? 'GAZE DRAW' : 'GAZE READY' : painting ? 'DRAW ACTIVE' : 'MOUSE READY'}</small>
        </button>
        {studioMode === 'create' ? <>
        <button className="studio-control" data-gaze-selectable="true" onClick={() => setArtAnimating(!artAnimating)} title="Play or stop the living-art animation">
          {artAnimating ? <Pause size={17} /> : <Play size={17} />}<span>{artAnimating ? 'STOP ART' : 'PLAY ART'}</span>
        </button>
        <button className="studio-control" data-gaze-selectable="true" onClick={undo} title="Undo"><Undo2 size={17} /><span>UNDO</span></button>
        <button className="studio-control" data-gaze-selectable="true" onClick={redo} title="Redo"><Redo2 size={17} /><span>REDO</span></button>
        <button className="studio-control" data-gaze-selectable="true" onClick={clearCanvas} title="Clear canvas"><Trash2 size={17} /><span>CLEAR</span></button>
        <button className="studio-control" data-gaze-selectable="true" onClick={() => setOpenPanel(openPanel === 'gallery' ? null : 'gallery')} title="Open saved gallery"><ImageIcon size={17} /><span>GALLERY</span></button>
        <button className="studio-control save-control" data-gaze-selectable="true" onClick={saveArt} title="Save PNG and add artwork and stroke history to gallery"><Save size={17} /><span>SAVE</span></button>
        </> : <div className="studio-play-score" aria-label={`Score: ${playScore}`}><span>SCORE</span><strong>{playScore}</strong></div>}
      </div>
      <div className="studio-adapt-note"><Sparkles size={12} /> {studioMode === 'play' ? 'HOLD SPACE · PAINT IN THE BOX' : `NEURO-ADAPT ${adaptation.difficulty.toUpperCase()} · ${adaptation.difficulty === 'supportive' ? 'Try one brush at a time' : adaptation.difficulty === 'challenging' ? 'Try a new brush and color' : 'Your tools stay yours'}`} <span>SPACE · HOLD TO DRAW&nbsp;&nbsp; BLINK · NAVIGATE&nbsp;&nbsp; WINK · SELECT</span></div>
    </div>
    {message && <div className="studio-message" role="status">{message}</div>}
    {openPanel === 'gallery' && <div className="studio-gallery-popover">
      <div className="popover-heading"><span>YOUR GALLERY</span><button data-gaze-selectable="true" onClick={() => setOpenPanel(null)} aria-label="Close gallery"><X size={14} /></button></div>
      {gallery.length === 0 ? <p>No saved artwork yet.</p> : gallery.map((item, index) => <button key={`${item.name}-${index}`} data-gaze-selectable="true" className="gallery-saved-item" onClick={() => loadArt(item)}><img src={item.image} alt="" /><span><strong>{item.name}</strong><small>{item.date}</small></span><Download size={14} onClick={(event) => { event.stopPropagation(); downloadImage(item.image, `${item.name}.png`) }} /></button>)}
    </div>}
    {calibratingGaze && <div className="gaze-calibration" role="status">
      <div className="gaze-calibration-instructions">{calibrationProgress}<br />{calibrationTarget + 1} / {GAZE_CALIBRATION_TARGETS.length}<button onClick={() => captureCalibrationRef.current()}>CAPTURE</button><button onClick={cancelCalibration}>CANCEL</button></div>
      <div className="gaze-calibration-target" style={{ left: `${GAZE_CALIBRATION_TARGETS[calibrationTarget].x * 100}%`, top: `${GAZE_CALIBRATION_TARGETS[calibrationTarget].y * 100}%` }}><Crosshair size={24} /></div>
    </div>}
    {!calibratingGaze && calibrationHint && <div className="head-calibration-hint" role="status">{calibrationHint}</div>}
  </section>
}

type RecordedSession = { subject: string; test: number; recorded_condition: 'low' | 'moderate' | 'high'; windows: number }
type ModelStatus = { model_available: boolean; model_loaded: boolean; model_name: string | null; dataset_windows_available: boolean; evaluation: Record<string, { f1_macro: number }> | null }
type ReplayResponse = { source: string; is_live: boolean; participant: string; test: number; recorded_condition: string; model_name: string; timeline: WorkloadPrediction[] }
const ADAPT_API = 'http://127.0.0.1:8000'

async function requestApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    let message = `NEURO-ADAPT service returned ${response.status}.`
    try {
      const body = await response.json() as { detail?: string }
      if (body.detail) message = body.detail
    } catch {
      // Keep the useful HTTP status when the server does not return JSON.
    }
    throw new Error(message)
  }
  return await response.json() as T
}

function AdaptationNotice({ adaptation, world }: { adaptation: WorkloadAdaptation; world: 'story' | 'pet' | 'create' }) {
  const tips = {
    story: adaptation.difficulty === 'supportive' ? 'Optional hints are available. Take your time; the story will not skip ahead.' : adaptation.difficulty === 'challenging' ? 'Optional challenge: explore a different path on another run.' : 'Choices stay in your hands; the story keeps its original pace.',
    pet: adaptation.difficulty === 'supportive' ? 'One small interaction is enough. There is no timer.' : adaptation.difficulty === 'challenging' ? 'Optional challenge: try a new interaction combination.' : 'Follow your companion’s cues at your own pace.',
    create: adaptation.difficulty === 'supportive' ? 'Try one palette or pattern at a time; all creative controls remain available.' : adaptation.difficulty === 'challenging' ? 'Optional idea: combine a new palette, form, and burst.' : 'Your palette and pattern controls are always yours.',
  }
  return <div className={`adapt-notice adapt-${adaptation.difficulty}`}><div><span className="eyebrow">NEURO-ADAPT · {adaptation.difficulty.toUpperCase()}</span><p>{tips[world]}</p></div><span>{adaptation.accepted_class ? `${adaptation.accepted_class.toUpperCase()} WORKLOAD` : 'RECORDED DEMO NOT RUN'}</span></div>
}

function NeuroAdaptDashboard({ onAdaptation }: { onAdaptation: (adaptation: WorkloadAdaptation) => void }) {
  const [status, setStatus] = useState<ModelStatus | null>(null)
  const [sessions, setSessions] = useState<RecordedSession[]>([])
  const [selection, setSelection] = useState('')
  const [timeline, setTimeline] = useState<WorkloadPrediction[]>([])
  const [replayInfo, setReplayInfo] = useState<ReplayResponse | null>(null)
  const [playIndex, setPlayIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [serviceReady, setServiceReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadStatus = async () => {
      try {
        const model = await requestApi<ModelStatus>(`${ADAPT_API}/api/model/status`)
        if (cancelled) return
        setStatus(model)
        setServiceReady(true)
        if (model.dataset_windows_available) {
          const result = await requestApi<{ sessions: RecordedSession[] }>(`${ADAPT_API}/api/workload/sessions`)
          if (cancelled) return
          setSessions(result.sessions)
          if (result.sessions.length) {
            const first = result.sessions[0]
            setSelection(`${first.subject}|${first.test}`)
          }
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not connect to the local workload service.')
      }
    }
    void loadStatus()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!playing || !timeline.length) return
    const timer = window.setTimeout(() => {
      if (playIndex + 1 >= timeline.length) setPlaying(false)
      else setPlayIndex(playIndex + 1)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [playing, playIndex, timeline.length])

  useEffect(() => {
    const current = timeline[playIndex]
    if (current) onAdaptation(current.adaptation)
  }, [timeline, playIndex, onAdaptation])

  const replay = async () => {
    const [subject, test] = selection.split('|')
    if (!subject || !test) return
    setLoading(true)
    setError('')
    setPlaying(false)
    setTimeline([])
    try {
      const result = await requestApi<ReplayResponse>(`${ADAPT_API}/api/workload/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, test: Number(test) }),
      })
      if (result.is_live || result.source !== 'recorded_eeg_demo') {
        throw new Error('The service returned an unexpected input source; recorded replay was stopped.')
      }
      setReplayInfo(result)
      setTimeline(result.timeline)
      setPlayIndex(0)
      setPlaying(result.timeline.length > 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Recorded EEG replay failed.')
    } finally {
      setLoading(false)
    }
  }

  const current = timeline[playIndex]
  const selectedModelF1 = status?.model_name && status.evaluation?.[status.model_name]
    ? status.evaluation[status.model_name].f1_macro
    : null
  const selectedSession = sessions.find((session) => `${session.subject}|${session.test}` === selection)

  return <section className="subpage adapt-page">
    <div className="page-heading adapt-heading"><span className="eyebrow">NEURO-ADAPT / RECORDED EEG DEMO</span><h1>MAKE ROOM<br /><span>TO THINK.</span></h1><p>Explore how a workload model can tune the experience—using recorded EEG task windows, never a live reading of you.</p></div>
    <div className="recorded-warning"><Radio size={17} /><div><strong>RECORDED DATA · NOT LIVE EEG</strong><p>Predictions replay a participant’s archived N-back session. They are not measurements of the current user, and the task-condition labels are not a diagnosis or direct readout of mental state.</p></div><span>NO HEADSET CONNECTED</span></div>
    <div className="adapt-status-grid">
      <div className="adapt-status-card"><span className="eyebrow">MODEL STATUS</span><strong className={status?.model_available ? 'status-ready' : ''}><i />{status?.model_available ? status.model_name?.replaceAll('_', ' ') : 'Model not trained'}</strong><small>{selectedModelF1 === null ? 'Participant-grouped evaluation unavailable' : `5-fold participant-held-out macro F1 · ${(selectedModelF1 * 100).toFixed(1)}%`}</small></div>
      <div className="adapt-status-card"><span className="eyebrow">CURRENT PREDICTION</span><strong className={current ? `workload-${current.workload_class}` : ''}>{current ? current.workload_class.toUpperCase() : '—'}</strong><small>{current ? `${(current.model_score * 100).toFixed(1)}% uncalibrated model score · ${current.window_start}` : 'Start a recorded session to see model output'}</small></div>
      <div className="adapt-status-card"><span className="eyebrow">EXPERIENCE PACE</span><strong className={`difficulty-${current?.adaptation.difficulty ?? 'balanced'}`}>{current?.adaptation.difficulty ?? 'balanced'}</strong><small>{current?.adaptation.last_adaptation ?? 'Waiting for consistent predictions'}</small></div>
    </div>
    <div className="replay-workspace">
      <div className="replay-panel">
        <div className="panel-title"><span className="eyebrow">01 / CHOOSE A RECORDING</span><span>{serviceReady ? 'LOCAL MODEL SERVICE READY' : 'LOCAL MODEL SERVICE OFFLINE'}</span></div>
        <div className="replay-controls"><label>PARTICIPANT & TASK<select value={selection} onChange={(event) => setSelection(event.target.value)} disabled={!sessions.length}><option value="">Select a recorded session</option>{sessions.map((item) => <option key={`${item.subject}-${item.test}`} value={`${item.subject}|${item.test}`}>{item.subject} · Task {item.test} · {item.recorded_condition} · {item.windows} windows</option>)}</select></label><button className="button button-primary" onClick={replay} disabled={loading || !status?.model_available || !selectedSession}>{loading ? 'LOADING MODEL…' : <><Play size={14} /> PLAY RECORDED EEG</>}</button></div>
        {!serviceReady && <p className="backend-help">Start the local backend with <code>python -m uvicorn ml.api:app --reload --port 8000</code>. No prediction is shown until the service and trained model are available.</p>}
        {error && <p className="backend-error" role="alert">{error}</p>}
        <div className="timeline-heading"><span className="eyebrow">02 / PREDICTED WORKLOAD TIMELINE</span><span>{timeline.length ? `${playIndex + 1} / ${timeline.length} · 10-SECOND WINDOWS` : 'NO REPLAY LOADED'}</span></div>
        <div className="workload-chart" aria-label="Recorded workload prediction timeline">{timeline.map((item, index) => <span key={`${item.window_start}-${index}`} className={`chart-bar workload-${item.workload_class} ${index === playIndex ? 'chart-current' : ''}`} style={{ height: `${Math.max(14, Math.round(item.model_score * 84))}px` }} title={`${item.window_start} · ${item.workload_class} · ${(item.model_score * 100).toFixed(1)}% model score`} />)}</div>
        <div className="chart-legend"><span><i className="workload-low" />LOW</span><span><i className="workload-moderate" />MODERATE</span><span><i className="workload-high" />HIGH</span>{timeline.length > 0 && <button onClick={() => setPlaying(!playing)}>{playing ? 'PAUSE REPLAY' : playIndex >= timeline.length - 1 ? 'REPLAY AGAIN' : 'RESUME'}</button>}</div>
        {timeline.length > 0 && !playing && playIndex >= timeline.length - 1 && <div className="replay-complete"><Check size={14} /> Replay complete. The model processed {timeline.length} recorded windows from {replayInfo?.participant}, task {replayInfo?.test} ({replayInfo?.recorded_condition} task condition).</div>}
      </div>
      <aside className="adaptation-panel"><span className="eyebrow">03 / NEURO-ADAPT RESPONSE</span><div className="adaptation-orb"><Sparkles size={23} /></div><h2>{current?.adaptation.difficulty ?? 'balanced'} pace</h2><p>{current?.adaptation.last_adaptation ?? 'The experience stays balanced until the model produces several repeated scores above the experimental threshold.'}</p><div className="consistency-row"><span>CONSISTENT MODEL SCORES</span><strong>{Math.min(3, current?.adaptation.consistent_predictions ?? 0)} / 3</strong></div><div className="consistency-track"><i style={{ width: `${Math.min(100, (current?.adaptation.consistent_predictions ?? 0) / 3 * 100)}%` }} /></div><div className="adaptation-detail"><span>Hints</span><strong>{current?.adaptation.hint_available ? 'Available' : 'Optional'}</strong></div><div className="adaptation-detail"><span>Time pressure</span><strong>{current?.adaptation.time_pressure === 'reduced' ? 'Reduced' : 'Unchanged'}</strong></div><small>Changes are gradual and suggestions only. Your choices and creative controls remain available.</small></aside>
    </div>
    {current && <div className="probability-row"><span className="eyebrow">UNCALIBRATED MODEL PROBABILITIES · {current.workload_class.toUpperCase()} PREDICTED</span>{(['low', 'moderate', 'high'] as const).map((label) => <div key={label}><span>{label}</span><div><i className={`workload-${label}`} style={{ width: `${current.probabilities[label] * 100}%` }} /></div><strong>{(current.probabilities[label] * 100).toFixed(0)}%</strong></div>)}</div>}
    <p className="adapt-footnote">Classes are experimental N-back task conditions: position 1-back (low), arithmetic 1-back (moderate), and dual arithmetic 2-back (high). Probabilities are uncalibrated model outputs, not measures of mental state. The model is trained on Emotiv EPOC X features and is not validated for ANT Neuro hardware.</p>
  </section>
}

function About({ navigate }: { navigate: (page: Page) => void }) {
  return <section className="subpage about-page"><div className="page-heading"><span className="eyebrow">A DIFFERENT KIND OF INTERFACE</span><h1>PLAY, WITHOUT<br /><span>THE CONTROLLER.</span></h1><p>Neuroverse is an exploration of a more personal kind of entertainment—where tiny movements can shape entire worlds.</p></div><div className="about-grid"><div><Lightbulb /><span className="eyebrow">THE IDEA</span><h2>Technology that gets out of the way.</h2><p>Our first demo uses keyboard simulation and webcam-based facial landmarks. Each input source is separate from the experiences, so future signal processing can plug in without rebuilding the worlds.</p></div><div><Radio /><span className="eyebrow">THE FUTURE</span><h2>Built to grow with the signal.</h2><p>The EEG adapter is intentionally a placeholder. A future ANT Neuro → LSL → Python → WebSocket pipeline can send movement events to the shared input engine. No EEG hardware is connected or simulated today.</p></div></div><div className="about-cta"><p>Curious what it feels like?</p><button className="button button-primary" onClick={() => navigate('explore')}>STEP INTO A WORLD <ArrowRight size={15} /></button></div></section>
}

function DeveloperPanel({ source, webcamActive, events, currentEvent, onMovement, onReset, onClose }: { source: InputSource; webcamActive: boolean; events: MovementEvent[]; currentEvent: MovementEvent | null; onMovement: (event: MovementEvent) => void; onReset: () => void; onClose: () => void }) {
  return <motion.aside className="developer-panel" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }}><div className="dev-heading"><div><span className="eyebrow">NEUROVERSE / DEV</span><strong>Signal monitor</strong></div><button onClick={onClose} aria-label="Close developer panel"><X size={16} /></button></div><div className="dev-status"><span className="eyebrow">INPUT SOURCE</span><strong><i className={source === 'eeg' ? 'muted-dot' : ''} />{source === 'simulation' ? 'Keyboard simulation' : source === 'webcam' ? 'Webcam selected' : 'EEG · disconnected'}</strong></div><div className="dev-current"><span className="eyebrow">LATEST MOVEMENT</span><strong>{currentEvent ? movementNames[currentEvent.movement] : '—'}</strong><small>{currentEvent ? `${currentEvent.confidence.toFixed(2)} confidence · ${currentEvent.source}` : 'Waiting for input'}{currentEvent ? ` · ${new Date(currentEvent.timestamp).toLocaleTimeString()}` : ''}</small></div><div className="dev-test"><span className="eyebrow">TEST MOVEMENT</span><div>{(['BLINK', 'WINK', 'JAW_CLENCH'] as Movement[]).map((movement) => <button key={movement} onClick={() => onMovement({ movement, source: 'simulation', timestamp: Date.now(), confidence: 1 })}>{movementNames[movement]}</button>)}</div></div><div className="dev-history"><div><span className="eyebrow">EVENT HISTORY</span><button onClick={onReset}>RESET</button></div>{events.length === 0 ? <p>No events yet.</p> : events.slice(0, 6).map((event, index) => <div className="dev-event" key={`${event.timestamp}-${index}`}><span className="event-source">{event.source === 'simulation' ? 'KEY' : event.source.toUpperCase()}</span><strong>{movementNames[event.movement]}</strong><small>{event.confidence.toFixed(2)}</small></div>)}</div><div className="dev-footer"><span>WEBCAM · {webcamActive ? 'CONNECTED' : source === 'webcam' ? 'SELECTED / OFF' : 'OFF'}</span><span>EEG · NOT CONNECTED</span><small>CTRL + SHIFT + D TO TOGGLE</small></div></motion.aside>
}

export default App
