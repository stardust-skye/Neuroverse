import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown, ArrowLeft, ArrowRight, AudioLines, BookOpen, Check, Crosshair,
  Command, Download, Eye, Gamepad2, Heart, Image as ImageIcon, Images, Lightbulb, Menu,
  PawPrint, Pause, Play, Plus, Radio, Redo2, RotateCcw, Save, ScanFace, Settings2, Sparkles, Stars, Sun, Trash2, Undo2, WandSparkles,
  Target, X, Zap,
} from 'lucide-react'
import { story } from './storyData'
import {
  fitGazeMap,
  GAZE_CALIBRATION_TARGETS,
  isGazeOutlier,
  mapGazeToScreen,
  smoothGazePoint,
  summarizeGazeSamples,
} from './gaze'
import type { GazeCalibrationPoint, GazeMap, GazePoint as StudioPoint } from './gaze'
import { adaptChallenge, initialChallengeState, targetGridCell } from './challenge'
import type { ChallengeMetrics, ChallengeState, StrainState } from './challenge'
import { appendStrokeSegment, cloneStrokeHistory } from './strokes'
import type { RecordedStroke, StrokeSegment } from './strokes'
import type { FacialGesture } from './gestures'
import { canCompleteChallenge, shouldPauseForLostFace, shouldStartSpaceDrawing, shouldStopSpaceDrawing } from './studioControls'
import { EEG_SERVICE_MESSAGE } from './services/eegService'
import WebcamInput from './WebcamInput'
import { initialWorkloadAdaptation } from './types'
import type { InputSource, Movement, MovementEvent, WorkloadAdaptation, WorkloadPrediction } from './types'

type Page = 'home' | 'explore' | 'calibration' | 'story' | 'pet' | 'create' | 'play' | 'adapt' | 'about'
type Action = 'confirm' | 'switch' | 'special'
type SavedArt = { name: string; image: string; date: string; strokes?: RecordedStroke[] }
type CanvasSnapshot = { image: HTMLCanvasElement; strokes: RecordedStroke[] }
type StudioMode = 'create' | 'play'

const experiences = [
  { id: 'story' as const, number: '01', title: 'THE LAST SIGNAL', mode: 'STORY MODE', description: 'Your movements. Your choices. Your story.', icon: BookOpen, className: 'story-art', tag: 'A branching cinematic' },
  { id: 'pet' as const, number: '02', title: 'A LITTLE MAGIC', mode: 'PET MODE', description: 'Meet a creature that grows with every interaction.', icon: PawPrint, className: 'pet-art', tag: 'A tiny life, yours to shape' },
  { id: 'create' as const, number: '03', title: 'LIVING COLOR', mode: 'CREATE MODE', description: 'Turn your movements into living digital art.', icon: WandSparkles, className: 'create-art', tag: 'Your hands-free art studio' },
  { id: 'play' as const, number: '04', title: 'THE QUIET SIGNAL', mode: 'PLAY MODE', description: 'Paint a target and let difficulty respond cautiously to performance and signal status.', icon: Target, className: 'play-art', tag: 'A paced precision challenge' },
]

const defaultMapping: Record<Movement, Action | 'none'> = {
  BLINK: 'confirm', WINK: 'switch', JAW_CLENCH: 'special', REST: 'none', UNKNOWN: 'none',
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
) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (brush === 'spray') {
    const steps = Math.max(1, Math.ceil(distance / Math.max(3, size * 0.35)))
    for (let step = 0; step <= steps; step++) {
      const progress = step / steps
      const centerX = from.x + dx * progress
      const centerY = from.y + dy * progress
      const count = Math.min(7, Math.max(3, Math.round(size / 2)))
      for (let particle = 0; particle < count; particle++) {
        const theta = Math.random() * Math.PI * 2
        const radius = Math.sqrt(Math.random()) * size * 1.8
        context.globalAlpha = 0.28 + Math.random() * 0.62
        context.fillStyle = color
        context.beginPath()
        context.arc(centerX + Math.cos(theta) * radius, centerY + Math.sin(theta) * radius, 0.55 + Math.random() * 1.45, 0, Math.PI * 2)
        context.fill()
      }
    }
  } else if (brush === 'particle') {
    const steps = Math.max(1, Math.ceil(distance / Math.max(3, size * 0.3)))
    for (let step = 0; step <= steps; step++) {
      const progress = step / steps
      const centerX = from.x + dx * progress
      const centerY = from.y + dy * progress
      for (let particle = 0; particle < 4; particle++) {
        const side = particle % 2 === 0 ? 1 : -1
        const trail = Math.random() * size * 1.15
        const spread = (Math.random() - 0.5) * size * 1.4
        context.globalAlpha = 0.48 + Math.random() * 0.48
        context.fillStyle = color
        context.beginPath()
        context.arc(
          centerX - Math.cos(angle) * trail - Math.sin(angle) * spread * side,
          centerY - Math.sin(angle) * trail + Math.cos(angle) * spread * side,
          Math.max(0.7, size * (0.08 + Math.random() * 0.16)),
          0,
          Math.PI * 2,
        )
        context.fill()
      }
    }
  } else {
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.strokeStyle = color
    context.lineWidth = brush === 'soft' ? size * 1.4 : size
    if (brush === 'soft') {
      context.globalAlpha = 0.68
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
  const [page, setPage] = useState<Page>('home')
  const [pendingExperience, setPendingExperience] = useState<'story' | 'pet' | 'create' | 'play'>('story')
  const [source, setSource] = useState<InputSource>('simulation')
  const [webcamActive, setWebcamActive] = useState(false)
  const [workloadAdaptation, setWorkloadAdaptation] = useState<WorkloadAdaptation>(initialWorkloadAdaptation)
  const [events, setEvents] = useState<MovementEvent[]>([])
  const [currentEvent, setCurrentEvent] = useState<MovementEvent | null>(null)
  const [debugOpen, setDebugOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [mapping, setMapping] = useState(() => readStorage('neuroverse.mapping', defaultMapping))
  const cooldownRef = useRef<Record<string, number>>({})

  const emit = useCallback((event: MovementEvent) => {
    if (event.confidence < 0.62) return
    const now = Date.now()
    if (now - (cooldownRef.current[event.movement] ?? 0) < 420) return
    cooldownRef.current[event.movement] = now
    setCurrentEvent(event)
    setEvents((previous) => [event, ...previous].slice(0, 12))
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
      const keyMap: Record<string, Movement> = { ' ': 'BLINK', a: 'WINK', s: 'JAW_CLENCH', r: 'REST' }
      const movement = keyMap[event.key.toLowerCase()]
      if (movement) {
        event.preventDefault()
        emit({ movement, source: 'simulation', timestamp: Date.now(), confidence: 1 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [emit, page])

  useEffect(() => {
    localStorage.setItem('neuroverse.mapping', JSON.stringify(mapping))
  }, [mapping])

  const navigate = (next: Page) => {
    setPage(next)
    setMobileNav(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const actionFor = useCallback((movement: Movement) => mapping[movement], [mapping])
  const reportWebcamStatus = useCallback((active: boolean) => setWebcamActive(active), [])

  return (
    <div className={page === 'create' || page === 'play' ? 'app-shell studio-active' : 'app-shell'}>
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <Brand onClick={() => navigate('home')} />
        <button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation">{mobileNav ? <X /> : <Menu />}</button>
        <nav className={mobileNav ? 'main-nav nav-open' : 'main-nav'} aria-label="Main navigation">
          <button className={page === 'home' ? 'nav-active' : ''} onClick={() => navigate('home')}>Home</button>
          <button className={page === 'explore' ? 'nav-active' : ''} onClick={() => navigate('explore')}>Explore</button>
          <button onClick={() => { if (page === 'home') document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' }); else { navigate('home'); window.setTimeout(() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' }), 300) } }}>How it works</button>
          <button className={page === 'adapt' ? 'nav-active' : ''} onClick={() => navigate('adapt')}>NEURO-ADAPT</button>
          <button className={page === 'about' ? 'nav-active' : ''} onClick={() => navigate('about')}>About</button>
        </nav>
        <div className="topbar-right">
          <span className="source-status"><span className={source === 'eeg' ? 'status-dot muted-dot' : 'status-dot'} />{source === 'simulation' ? 'SIMULATION READY' : source === 'webcam' ? 'WEBCAM SELECTED' : 'EEG · COMING SOON'}</span>
          <button className="top-enter" onClick={() => navigate('explore')}>ENTER UNIVERSE <ArrowRight size={14} /></button>
        </div>
      </header>

      <main>
        <AnimatePresence mode="wait">
          <motion.div key={page} className="page-shell" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: 0.22 }}>
            {page === 'home' && <Landing navigate={navigate} onChoose={(experience) => { setPendingExperience(experience); navigate('calibration') }} />}
            {page === 'explore' && <Explore navigate={navigate} onChoose={(experience) => { setPendingExperience(experience); navigate('calibration') }} />}
            {page === 'calibration' && <Calibration navigate={navigate} destination={pendingExperience} source={source} setSource={setSource} onMovement={emit} onWebcamStatus={reportWebcamStatus} currentEvent={currentEvent} mapping={mapping} setMapping={setMapping} />}
            {page === 'story' && <StoryMode navigate={navigate} actionFor={actionFor} lastMovement={currentEvent} adaptation={workloadAdaptation} />}
            {page === 'pet' && <PetMode navigate={navigate} actionFor={actionFor} lastMovement={currentEvent} adaptation={workloadAdaptation} />}
            {(page === 'create' || page === 'play') && <CreateMode navigate={navigate} actionFor={actionFor} lastMovement={currentEvent} onMovement={emit} adaptation={workloadAdaptation} onWebcamStatus={reportWebcamStatus} initialMode={page} />}
            {page === 'adapt' && <NeuroAdaptDashboard onAdaptation={setWorkloadAdaptation} />}
            {page === 'about' && <About navigate={navigate} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <footer className="footer"><Brand onClick={() => navigate('home')} /><span>© 2026 NEUROVERSE STUDIO</span><span className="footer-right">A NEW WAY TO FEEL THE STORY <span className="footer-star">✳</span></span></footer>

      <div className="keyboard-hint"><Command size={13} /><span>SPACE</span> interact <i /> <span>A</span> switch <i /> <span>S</span> special</div>
      <button className="debug-toggle" onClick={() => setDebugOpen(!debugOpen)} aria-label="Toggle developer panel"><Settings2 size={17} /></button>
      <AnimatePresence>{debugOpen && <DeveloperPanel source={source} webcamActive={webcamActive} events={events} currentEvent={currentEvent} onMovement={emit} onReset={() => { setEvents([]); setCurrentEvent(null); cooldownRef.current = {} }} onClose={() => setDebugOpen(false)} />}</AnimatePresence>
    </div>
  )
}

function Landing({ navigate, onChoose }: { navigate: (page: Page) => void; onChoose: (experience: 'story' | 'pet' | 'create' | 'play') => void }) {
  return <div className="landing">
    <section className="hero">
      <div className="hero-copy">
        <div className="kicker"><span className="kicker-line" /> A NEW KIND OF PLAY <span className="kicker-orbit">✳</span></div>
        <h1>ENTER A<br /><span>DIFFERENT</span><br />REALITY<span className="period">.</span></h1>
        <p className="hero-subtitle">Your movements. Your imagination.<br />Your universe.</p>
        <div className="hero-actions"><button className="button button-primary" onClick={() => navigate('explore')}>ENTER THE UNIVERSE <ArrowRight size={17} /></button><button className="text-button" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}><Play size={14} /> HOW IT WORKS</button></div>
        <div className="hero-index"><span>01</span><i /><small>INTERACTIVE ENTERTAINMENT, REIMAGINED</small></div>
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
    <section className="experience-strip"><div className="strip-heading"><span className="eyebrow">FOUR WORLDS. ONE YOU.</span><button className="text-button" onClick={() => navigate('explore')}>EXPLORE ALL <ArrowRight size={14} /></button></div>
      <div className="experience-preview">{experiences.map((item) => <button key={item.id} className={`preview-tile ${item.className}`} onClick={() => onChoose(item.id)}><div className="tile-symbol">{item.id === 'story' ? <BookOpen /> : item.id === 'pet' ? <PawPrint /> : item.id === 'play' ? <Target /> : <WandSparkles />}</div><span>{item.mode}</span><strong>{item.title}</strong><small>{item.tag}</small><ArrowRight className="tile-arrow" size={16} /></button>)}</div>
    </section>
    <HowItWorks navigate={navigate} />
  </div>
}

function HowItWorks({ navigate }: { navigate: (page: Page) => void }) {
  return <section className="how-section" id="how-it-works"><div className="section-lead"><div><span className="eyebrow">SIMPLE BY DESIGN</span><h2>YOU’RE THE<br /><span>CONTROLLER.</span></h2></div><p>No headset. No learning curve. Just small, natural movements that turn a story into something that feels like yours.</p></div>
    <div className="movement-explainer">{[['BLINK', 'A recognized blink advances the highlighted control.', '◉'], ['WINK', 'A sustained left or right wink selects that control.', '◒'], ['HOLD TO DRAW', 'Hold Space or the mouse button; webcam jaw clench is not inferred.', '⌁']].map(([name, text, glyph], index) => <div className="movement-step" key={name}><span className="step-num">0{index + 1}</span><span className="movement-glyph">{glyph}</span><strong>{name}</strong><p>{text}</p></div>)}</div>
    <div className="how-bottom"><span>START WITH KEYBOARD OR WEBCAM. EEG IS COMING SOON.</span><button className="text-button" onClick={() => navigate('calibration')}>SET UP YOUR INPUT <ArrowRight size={14} /></button></div>
  </section>
}

function Explore({ navigate, onChoose }: { navigate: (page: Page) => void; onChoose: (experience: 'story' | 'pet' | 'create' | 'play') => void }) {
  return <section className="subpage explore-page"><div className="page-heading"><span className="eyebrow">YOUR UNIVERSE AWAITS</span><h1>CHOOSE YOUR<br /><span>ADVENTURE.</span></h1><p>Four ways to step out of the ordinary. Pick a world to make your own.</p></div>
    <div className="universe-grid">{experiences.map((item) => { const Icon = item.icon; return <article className={`universe-card ${item.className}`} key={item.id}><div className="universe-card-visual"><span className="universe-index">{item.number} / 04</span><div className="visual-orb">{item.id === 'story' ? <div className="orb-station"><span /><i /><b /></div> : item.id === 'pet' ? <div className="creature-mini"><i /><b /><span /></div> : item.id === 'play' ? <Target size={43} /> : <div className="mini-art"><i /><i /><i /><i /></div>}</div><span className="universe-badge"><Icon size={14} /> {item.mode}</span></div><div className="universe-card-copy"><div><span className="eyebrow">{item.tag}</span><h2>{item.title}</h2><p>{item.description}</p></div><button className="round-arrow" aria-label={`Enter ${item.mode}`} onClick={() => onChoose(item.id)}><ArrowRight size={18} /></button></div></article>})}</div>
    <div className="page-bottom-note"><span className="status-dot" /> YOUR INPUT CAN BE CHANGED ANYTIME <button onClick={() => navigate('calibration')}>SET UP INPUT <ArrowRight size={14} /></button></div>
  </section>
}

function Calibration({ navigate, destination, source, setSource, onMovement, onWebcamStatus, currentEvent, mapping, setMapping }: { navigate: (page: Page) => void; destination: 'story' | 'pet' | 'create' | 'play'; source: InputSource; setSource: (source: InputSource) => void; onMovement: (event: MovementEvent) => void; onWebcamStatus: (active: boolean) => void; currentEvent: MovementEvent | null; mapping: Record<Movement, Action | 'none'>; setMapping: (mapping: Record<Movement, Action | 'none'>) => void }) {
  return <section className="subpage calibration-page"><button className="back-link" onClick={() => navigate('explore')}><ArrowLeft size={15} /> BACK TO WORLDS</button>
    <div className="page-heading calibration-heading"><span className="eyebrow">BEFORE WE BEGIN</span><h1>FIND YOUR<br /><span>RHYTHM.</span></h1><p>Choose how you’d like to move through the universe. Keyboard simulation is ready now; webcam is optional.</p></div>
    <div className="setup-layout"><div className="setup-left"><span className="eyebrow">01 / INPUT SOURCE</span>
      <div className="source-options">
        <button className={source === 'simulation' ? 'source-option selected' : 'source-option'} onClick={() => setSource('simulation')}><div className="source-icon"><Gamepad2 /></div><div><strong>Keyboard simulation</strong><small>Always available · no setup</small></div><span className="radio-dot">{source === 'simulation' && <i />}</span></button>
        <button className={source === 'webcam' ? 'source-option selected' : 'source-option'} onClick={() => setSource('webcam')}><div className="source-icon"><ScanFace /></div><div><strong>Webcam movement</strong><small>Experimental · permission required</small></div><span className="radio-dot">{source === 'webcam' && <i />}</span></button>
        <button className="source-option disabled-option" onClick={() => setSource('eeg')}><div className="source-icon"><AudioLines /></div><div><strong>EEG interface</strong><small>Coming soon · no hardware connected</small></div><span className="coming-label">SOON</span></button>
      </div>
      {source === 'webcam' && <WebcamInput onMovement={onMovement} onStatus={onWebcamStatus} />}
      {source === 'eeg' && <div className="notice-box"><Radio size={17} /><span>{EEG_SERVICE_MESSAGE}</span></div>}
      <div className="mapping-box"><div className="mapping-heading"><span className="eyebrow">02 / MOVEMENT MAPPING</span><span>SAVED ON THIS DEVICE</span></div>{(['BLINK', 'WINK', 'JAW_CLENCH'] as Movement[]).map((movement) => <label className="mapping-row" key={movement}><span>{movementNames[movement]}</span><select value={mapping[movement]} onChange={(event) => setMapping({ ...mapping, [movement]: event.target.value as Action })}><option value="confirm">{actionNames.confirm}</option><option value="switch">{actionNames.switch}</option><option value="special">{actionNames.special}</option></select></label>)}</div>
    </div>
    <div className="setup-right"><div className="setup-card"><div className="setup-card-top"><span className="eyebrow">03 / CALIBRATION</span><span className={source === 'eeg' ? 'ready-chip eeg-chip' : 'ready-chip'}><i />{source === 'simulation' ? 'KEYBOARD READY' : source === 'webcam' ? 'WEBCAM SELECTED' : 'EEG DISCONNECTED'}</span></div><div className="calibration-glyph"><div className="cal-ring ring-one" /><div className="cal-ring ring-two" /><div className="cal-icon"><Eye size={26} /></div><span className="orbit-dot" /></div><h2>Let’s get in sync.</h2><p>Try each movement to see how it feels. Your controls stay available in every world.</p><div className="movement-indicator"><span className="eyebrow">CURRENT MOVEMENT</span><strong>{currentEvent ? movementNames[currentEvent.movement] : 'Waiting for input'}</strong><small>{currentEvent ? `${currentEvent.confidence.toFixed(2)} confidence · ${currentEvent.source}` : 'Try a key or select a test movement'}</small></div><div className="movement-test">{(['BLINK', 'WINK', 'JAW_CLENCH'] as Movement[]).map((movement) => <button key={movement} onClick={() => onMovement({ movement, source: 'simulation', timestamp: Date.now(), confidence: 1 })}><span>{movement === 'BLINK' ? 'SPACE' : movement === 'WINK' ? 'A' : 'S'}</span>{movementNames[movement]}</button>)}</div><div className="rest-hint">R <span>REST · RESET TO NEUTRAL</span></div><button className="button button-primary start-button" onClick={() => navigate(destination)}>ENTER EXPERIENCE <ArrowRight size={16} /></button></div><div className="privacy-caption"><Check size={14} /> Camera is opt-in. Video is processed locally and never recorded.</div></div></div>
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

function CreateMode({ navigate, actionFor, lastMovement, onMovement, adaptation, onWebcamStatus, initialMode = 'create' }: { navigate: (page: Page) => void; actionFor: (movement: Movement) => Action | 'none'; lastMovement: MovementEvent | null; onMovement: (event: MovementEvent) => void; adaptation: WorkloadAdaptation; onWebcamStatus: (active: boolean) => void; initialMode?: StudioMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationCanvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const undoRef = useRef<CanvasSnapshot[]>([])
  const redoRef = useRef<CanvasSnapshot[]>([])
  const strokeHistoryRef = useRef<RecordedStroke[]>([])
  const strokeOpenRef = useRef(false)
  const lastStrokePointRef = useRef<{ x: number; y: number; timestamp: number } | null>(null)
  const keyboardDrawingRef = useRef(false)
  const pointerStartedModeRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const previousGazeRef = useRef<StudioPoint | null>(null)
  const pendingGazeOutlierRef = useRef<StudioPoint | null>(null)
  const lastRawGazeRef = useRef<StudioPoint | null>(null)
  const previousPointerRef = useRef<StudioPoint | null>(null)
  const pointerDrawingRef = useRef(false)
  const gazeMapRef = useRef<GazeMap | null>(null)
  const captureRef = useRef(false)
  const gazeSamplesRef = useRef<StudioPoint[]>([])
  const calibrationDataRef = useRef<GazeCalibrationPoint[]>([])
  const calibrationTimerRef = useRef<number | null>(null)
  const pulseTimerRef = useRef<number | null>(null)
  const gestureStatusTimerRef = useRef<number | null>(null)
  const lastPulseAtRef = useRef(0)
  const smoothedCursorRef = useRef<StudioPoint | null>(null)
  const cameraActiveRef = useRef(false)
  const drawingRef = useRef(false)
  const brushRef = useRef<BrushType>('normal')
  const colorRef = useRef('#ffffff')
  const sizeRef = useRef(8)
  const lastMovementAt = useRef(lastMovement?.timestamp ?? 0)
  const faceDetectedRef = useRef(false)
  const challengeStateRef = useRef<ChallengeState>({
    ...initialChallengeState,
    lastDifficultyChangeAt: initialMode === 'play' ? Date.now() : 0,
  })
  const challengeCellsRef = useRef(new Set<number>())
  const challengeHitsRef = useRef(0)
  const challengeMissesRef = useRef(0)
  const challengeStartedAtRef = useRef(Date.now())
  const challengeStrainRef = useRef<StrainState>('unknown')
  const challengeSimulationRef = useRef(false)
  const challengeRoundDoneRef = useRef(false)
  const finishChallengeRef = useRef<() => void>(() => {})
  const focusedControlRef = useRef(0)
  const lastDiagnosticsUpdateRef = useRef(0)
  const diagnosticsOpenRef = useRef(false)
  const studioModeRef = useRef<StudioMode>(initialMode)
  const [brush, setBrush] = useState<BrushType>('normal')
  const [color, setColor] = useState('#ffffff')
  const [brushSize, setBrushSize] = useState(8)
  const [painting, setPainting] = useState(false)
  const [openPanel, setOpenPanel] = useState<'color' | 'brush' | 'gallery' | null>(null)
  const [customColor, setCustomColor] = useState('#c7a6ff')
  const [name, setName] = useState('')
  const [gallery, setGallery] = useState<SavedArt[]>(() => readStorage('neuroverse.gallery', []))
  const [message, setMessage] = useState('')
  const [studioMode, setStudioMode] = useState<StudioMode>(initialMode)
  const [artAnimating, setArtAnimating] = useState(false)
  const [gestureStatus, setGestureStatus] = useState('NEUTRAL')
  const [focusedControl, setFocusedControl] = useState(0)
  const [strainState, setStrainState] = useState<StrainState>('unknown')
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [challengeState, setChallengeState] = useState<ChallengeState>(() => ({
    ...initialChallengeState,
    lastDifficultyChangeAt: initialMode === 'play' ? Date.now() : 0,
  }))
  const [challengeCells, setChallengeCells] = useState(0)
  const [challengeHits, setChallengeHits] = useState(0)
  const [challengeMisses, setChallengeMisses] = useState(0)
  const [challengeElapsed, setChallengeElapsed] = useState(0)
  const [challengeRoundDone, setChallengeRoundDone] = useState(false)
  const [lastChallengeMetrics, setLastChallengeMetrics] = useState<ChallengeMetrics | null>(null)
  const [challengeSimulation, setChallengeSimulation] = useState(false)
  const [gazeMap, setGazeMap] = useState<GazeMap | null>(null)
  const [cursorSource, setCursorSource] = useState<'gaze' | 'pointer' | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [gestureSensitivity, setGestureSensitivity] = useState(6)
  const [diagnosticGaze, setDiagnosticGaze] = useState<StudioPoint | null>(null)
  const [diagnosticCursor, setDiagnosticCursor] = useState<StudioPoint | null>(null)
  const [calibrationIndex, setCalibrationIndex] = useState<number | null>(null)
  const [calibrationCapture, setCalibrationCapture] = useState(false)
  const [calibrationHint, setCalibrationHint] = useState('')
  const calibrationOpenRef = useRef(false)

  gazeMapRef.current = gazeMap
  drawingRef.current = painting
  brushRef.current = brush
  colorRef.current = color
  sizeRef.current = brushSize
  cameraActiveRef.current = cameraActive
  calibrationOpenRef.current = calibrationIndex !== null
  diagnosticsOpenRef.current = diagnosticsOpen
  focusedControlRef.current = focusedControl
  challengeStrainRef.current = strainState
  challengeRoundDoneRef.current = challengeRoundDone
  studioModeRef.current = studioMode
  challengeStateRef.current = challengeState

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
      setViewport({ width: rect.width, height: rect.height })
      if (copy && copy.width && copy.height) {
        context.drawImage(copy, 0, 0, copy.width, copy.height, 0, 0, rect.width, rect.height)
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!artAnimating) {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
      const canvas = animationCanvasRef.current
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    let active = true
    const renderFrame = (timestamp: number) => {
      const canvas = animationCanvasRef.current
      const base = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!active || !canvas || !base || !context) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = canvas.width / ratio
      const height = canvas.height / ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.save()
      context.globalAlpha = 0.13 + (Math.sin(timestamp / 850) + 1) * 0.035
      context.shadowBlur = 7
      for (const stroke of strokeHistoryRef.current) {
        for (const segment of stroke.segments) {
          const drift = Math.sin(timestamp / 1150 + segment.to.timestamp / 900) * 1.4
          context.beginPath()
          context.moveTo(segment.from.x + drift, segment.from.y)
          context.lineTo(segment.to.x + drift, segment.to.y)
          context.strokeStyle = segment.color
          context.lineWidth = Math.max(1, segment.size * 0.72)
          context.lineCap = 'round'
          context.shadowColor = segment.color
          context.stroke()
        }
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
    const tick = () => {
      if (studioModeRef.current !== 'play' || challengeRoundDoneRef.current) return
      const elapsed = Math.floor((Date.now() - challengeStartedAtRef.current) / 1000)
      setChallengeElapsed(elapsed)
      if (elapsed >= 45) finishChallengeRef.current()
    }
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [studioMode])

  useEffect(() => {
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement>('.gaze-studio [data-gaze-selectable="true"]'))
      .filter((button) => !button.disabled)
    controls.forEach((button, index) => {
      button.classList.toggle('is-gaze-highlighted', index === focusedControl)
      button.setAttribute('aria-current', index === focusedControl ? 'true' : 'false')
    })
  }, [focusedControl, openPanel, studioMode])

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
    const recordedFrom = strokeOpenRef.current && lastStrokePointRef.current
      ? lastStrokePointRef.current
      : { ...from, timestamp: now }
    const segment: StrokeSegment = {
      from: recordedFrom,
      to: { ...to, timestamp: now },
      brush: brushRef.current,
      color: colorRef.current,
      size: sizeRef.current,
    }
    strokeHistoryRef.current = appendStrokeSegment(
      strokeHistoryRef.current,
      segment,
      !strokeOpenRef.current,
    )
    strokeOpenRef.current = true
    lastStrokePointRef.current = segment.to
    if (studioModeRef.current !== 'play' || challengeRoundDoneRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = { left: 0, top: 0, width: canvas.clientWidth, height: canvas.clientHeight }
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    const steps = Math.max(1, Math.ceil(distance / 6))
    let hits = 0
    let misses = 0
    for (let index = 0; index <= steps; index++) {
      const progress = index / steps
      const point = {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      }
      const cell = targetGridCell(point, bounds, challengeStateRef.current.targetScale)
      if (cell === null) misses++
      else {
        hits++
        challengeCellsRef.current.add(cell)
      }
    }
    challengeHitsRef.current += hits
    challengeMissesRef.current += misses
    setChallengeCells(challengeCellsRef.current.size)
    setChallengeHits(challengeHitsRef.current)
    setChallengeMisses(challengeMissesRef.current)
  }
  const focusGestureControl = (gesture: FacialGesture) => {
    setGestureStatus(gesture.replaceAll('_', ' '))
    if (gestureStatusTimerRef.current !== null) window.clearTimeout(gestureStatusTimerRef.current)
    gestureStatusTimerRef.current = window.setTimeout(() => setGestureStatus('NEUTRAL'), 1400)
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement>('.gaze-studio [data-gaze-selectable="true"]'))
      .filter((button) => !button.disabled)
    if (!controls.length) return
    if (gesture === 'NORMAL_BLINK') {
      const next = (focusedControlRef.current + 1) % controls.length
      focusedControlRef.current = next
      setFocusedControl(next)
      controls[next].focus({ preventScroll: true })
      return
    }
    controls[focusedControlRef.current % controls.length]?.click()
  }
  const handleGaze = useCallback((raw: StudioPoint | null) => {
    if (!raw) {
      setDiagnosticGaze(null)
      setDiagnosticCursor(null)
      previousGazeRef.current = null
      pendingGazeOutlierRef.current = null
      lastRawGazeRef.current = null
      smoothedCursorRef.current = null
      const wasDrawing = shouldPauseForLostFace(drawingRef.current, cameraActiveRef.current, false)
      if (wasDrawing) {
        drawingRef.current = false
        keyboardDrawingRef.current = false
        strokeOpenRef.current = false
        lastStrokePointRef.current = null
        setPainting(false)
        setMessage('Gaze lost · painting paused for safety')
      }
      if (wasDrawing) setMessage('Gaze lost · painting paused for safety')
      cursorRef.current?.classList.remove('is-visible', 'cursor-gaze')
      setCursorSource(null)
      return
    }
    if (isGazeOutlier(raw, lastRawGazeRef.current, pendingGazeOutlierRef.current)) {
      pendingGazeOutlierRef.current = raw
      return
    }
    lastRawGazeRef.current = raw
    pendingGazeOutlierRef.current = null
    if (captureRef.current) gazeSamplesRef.current.push(raw)
    if (diagnosticsOpenRef.current && performance.now() - lastDiagnosticsUpdateRef.current >= 120) {
      lastDiagnosticsUpdateRef.current = performance.now()
      setDiagnosticGaze(raw)
    }
    const map = gazeMapRef.current
    const canvas = canvasRef.current
    if (!map || !canvas) return
    const mapped = mapGazeToScreen(raw, map)
    const screenX = Math.max(0, Math.min(window.innerWidth, mapped.x * window.innerWidth))
    const screenY = Math.max(0, Math.min(window.innerHeight, mapped.y * window.innerHeight))
    const rect = canvas.getBoundingClientRect()
    const target = {
      x: Math.max(0, Math.min(rect.width, screenX - rect.left)),
      y: Math.max(0, Math.min(rect.height, screenY - rect.top)),
    }
    const smooth = smoothGazePoint(smoothedCursorRef.current, target)
    smoothedCursorRef.current = smooth
    if (diagnosticsOpenRef.current && performance.now() - lastDiagnosticsUpdateRef.current >= 120) {
      lastDiagnosticsUpdateRef.current = performance.now()
      setDiagnosticCursor(smooth)
    }
    showCursor(smooth, 'gaze')
    const inside = screenX >= rect.left && screenX <= rect.right && screenY >= rect.top && screenY <= rect.bottom
    const hit = inside ? document.elementFromPoint(screenX, screenY) : null
    const overControls = Boolean(hit?.closest('.studio-topbar, .studio-gaze-tools, .studio-bottom-dock, .studio-message, .studio-gallery-popover, .studio-popover, .gaze-calibration'))
    if (drawingRef.current && inside && !overControls) {
      const from = previousGazeRef.current ?? smooth
      const context = canvas.getContext('2d')
      if (context) drawBrushSegment(context, from, smooth, colorRef.current, sizeRef.current, brushRef.current)
      recordStrokeSegment(from, smooth)
      const now = performance.now()
      if (now - lastPulseAtRef.current > 500 && cursorRef.current) {
        lastPulseAtRef.current = now
        cursorRef.current.classList.remove('stroke-pulse')
        cursorRef.current.classList.add('stroke-pulse')
        if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
        pulseTimerRef.current = window.setTimeout(() => cursorRef.current?.classList.remove('stroke-pulse'), 280)
      }
      previousGazeRef.current = smooth
    } else previousGazeRef.current = null
  }, [])
  const handleFaceDetected = useCallback((detected: boolean) => {
    if (faceDetectedRef.current === detected) return
    faceDetectedRef.current = detected
    setFaceDetected(detected)
    if (detected) {
      setMessage('')
    } else if (drawingRef.current) {
      setDrawMode(false)
      setMessage('Face lost · painting paused for safety')
    } else if (cameraActiveRef.current) {
      setMessage('Face not detected · adjust your position or lighting')
    }
  }, [])
  const handleCameraStatus = useCallback((active: boolean) => {
    setCameraActive(active)
    cameraActiveRef.current = active
    if (!active && drawingRef.current) setDrawMode(false)
    onWebcamStatus(active)
  }, [onWebcamStatus])

  useEffect(() => () => {
    if (calibrationTimerRef.current !== null) window.clearTimeout(calibrationTimerRef.current)
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
  }, [])

  const setDrawMode = (enabled: boolean) => {
    if (enabled && calibrationOpenRef.current) return
    if (enabled === drawingRef.current) return
    if (enabled) {
      snapshot()
      previousGazeRef.current = null
      setMessage(cameraActiveRef.current && gazeMapRef.current
        ? 'GAZE PAINT active · press G, Escape, or PAUSE to stop'
        : 'Mouse paint active · press G, Escape, or PAUSE to stop')
    } else {
      previousGazeRef.current = null
      strokeOpenRef.current = false
      lastStrokePointRef.current = null
      setMessage(cameraActiveRef.current && gazeMapRef.current ? 'Gaze cursor only · drawing paused' : 'Mouse paint paused')
    }
    drawingRef.current = enabled
    setPainting(enabled)
  }

  useEffect(() => {
    if (!lastMovement || lastMovement.timestamp === lastMovementAt.current) return
    lastMovementAt.current = lastMovement.timestamp
    const action = actionFor(lastMovement.movement)
    if (lastMovement.source === 'simulation' && lastMovement.movement === 'WINK' && action === 'switch') {
      focusGestureControl('LEFT_WINK')
      return
    }
    if (lastMovement.source === 'simulation' && lastMovement.movement === 'JAW_CLENCH' && action === 'special') {
      const next = BRUSHES[(BRUSHES.indexOf(brushRef.current) + 1) % BRUSHES.length]
      setBrush(next)
      setMessage(`Keyboard simulation selected ${next.toUpperCase()} brush · webcam jaw detection is disabled`)
    }
  }, [lastMovement, actionFor])

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && (
      target.isContentEditable
      || ['TEXTAREA', 'SELECT'].includes(target.tagName)
      || target instanceof HTMLInputElement && target.type !== 'range'
    )
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldStartSpaceDrawing(event.code, keyboardDrawingRef.current, isEditable(event.target))) {
        event.preventDefault()
        keyboardDrawingRef.current = true
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
        captureRef.current = false
        if (calibrationTimerRef.current !== null) window.clearTimeout(calibrationTimerRef.current)
        setCalibrationIndex(null)
        setCalibrationCapture(false)
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
    if (pointerStartedModeRef.current) setDrawMode(true)
    else snapshot()
    strokeOpenRef.current = false
    lastStrokePointRef.current = null
    pointerDrawingRef.current = true
    previousPointerRef.current = point
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(event)
    if (!cameraActiveRef.current || cursorSource !== 'gaze') showCursor(point, 'pointer')
    if ((!pointerDrawingRef.current && !keyboardDrawingRef.current) || !drawingRef.current) return
    const previous = previousPointerRef.current ?? point
    const context = canvasRef.current?.getContext('2d')
    if (context) drawBrushSegment(context, previous, point, colorRef.current, sizeRef.current, brushRef.current)
    recordStrokeSegment(previous, point)
    previousPointerRef.current = point
  }
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    pointerDrawingRef.current = false
    previousPointerRef.current = null
    strokeOpenRef.current = false
    if (pointerStartedModeRef.current && !keyboardDrawingRef.current) setDrawMode(false)
    pointerStartedModeRef.current = false
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

  const beginCalibration = () => {
    if (!cameraActive) {
      setMessage('Enable the webcam before starting gaze calibration')
      return
    }
    setDrawMode(false)
    setGazeMap(null)
    gazeMapRef.current = null
    lastRawGazeRef.current = null
    pendingGazeOutlierRef.current = null
    smoothedCursorRef.current = null
    previousGazeRef.current = null
    cursorRef.current?.classList.remove('is-visible', 'cursor-gaze')
    setCursorSource(null)
    calibrationDataRef.current = []
    setCalibrationHint('Look steadily at each target; capture collects multiple samples')
    setCalibrationCapture(false)
    setCalibrationIndex(0)
  }
  const captureTarget = () => {
    if (calibrationIndex === null || !cameraActiveRef.current) return
    if (calibrationTimerRef.current !== null) window.clearTimeout(calibrationTimerRef.current)
    captureRef.current = true
    gazeSamplesRef.current = []
    setCalibrationCapture(true)
    setCalibrationHint('Hold your gaze steady while multiple samples are collected…')
    calibrationTimerRef.current = window.setTimeout(() => {
      captureRef.current = false
      setCalibrationCapture(false)
      const summary = summarizeGazeSamples(gazeSamplesRef.current)
      if (!summary) {
        setCalibrationHint('Samples were missing or unstable. Hold the target steadily and recapture this point.')
        return
      }
      const target = GAZE_CALIBRATION_TARGETS[calibrationIndex]
      calibrationDataRef.current = [...calibrationDataRef.current, { raw: summary.point, target }]
      const nextIndex = calibrationIndex + 1
      if (nextIndex < GAZE_CALIBRATION_TARGETS.length) {
        setCalibrationIndex(nextIndex)
        setCalibrationHint(
          `${summary.sampleCount} stable samples · continue to the next target`,
        )
        return
      }
      const fitted = fitGazeMap(calibrationDataRef.current)
      if (!fitted || fitted.rmse > 0.1 || fitted.maxError > 0.2) {
        setCalibrationIndex(null)
        setCalibrationHint('')
        setMessage(fitted
          ? `Calibration fit residual too high (${Math.round(fitted.rmse * 100)}% RMS, max ${Math.round(fitted.maxError * 100)}%). Recalibrate.`
          : 'Gaze calibration could not estimate a stable screen mapping')
        return
      }
      setGazeMap(fitted)
      gazeMapRef.current = fitted
      setCalibrationIndex(null)
      setCalibrationHint('')
      setMessage(`Calibration fit ${Math.round(fitted.rmse * 100)}% RMS · approximate cursor-only mode`)
    }, 2200)
  }

  const finishChallengeRound = () => {
    if (challengeRoundDoneRef.current) return
    setDrawMode(false)
    const total = challengeHitsRef.current + challengeMissesRef.current
    const metrics: ChallengeMetrics = {
      coverage: challengeCellsRef.current.size / 64,
      accuracy: total ? challengeHitsRef.current / total : 0,
      elapsedSeconds: Math.min(45, Math.floor((Date.now() - challengeStartedAtRef.current) / 1000)),
      misses: challengeMissesRef.current,
    }
    const next = adaptChallenge(
      challengeStateRef.current,
      metrics,
      challengeStrainRef.current,
      Date.now(),
    )
    challengeStateRef.current = next
    setChallengeState(next)
    setLastChallengeMetrics(metrics)
    setChallengeRoundDone(true)
    challengeRoundDoneRef.current = true
    setMessage(metrics.coverage >= 0.7
      ? 'Round complete · difficulty changes only when performance and signal status justify it'
      : 'Round ended · keep the target or take a break; no penalty')
  }
  finishChallengeRef.current = finishChallengeRound

  const resetChallengeRound = () => {
    challengeCellsRef.current = new Set()
    challengeHitsRef.current = 0
    challengeMissesRef.current = 0
    setChallengeCells(0)
    setChallengeHits(0)
    setChallengeMisses(0)
    setChallengeElapsed(0)
    setChallengeRoundDone(false)
    challengeRoundDoneRef.current = false
    challengeStartedAtRef.current = Date.now()
    strokeOpenRef.current = false
    previousGazeRef.current = null
    previousPointerRef.current = null
  }
  const resetChallenge = () => {
    const next = { ...initialChallengeState, lastDifficultyChangeAt: Date.now() }
    challengeStateRef.current = next
    setChallengeState(next)
    setLastChallengeMetrics(null)
    resetChallengeRound()
    setMessage('Challenge reset · start again from round one')
  }
  const enterPlayMode = () => {
    setDrawMode(false)
    setArtAnimating(false)
    setStudioMode('play')
    studioModeRef.current = 'play'
    challengeSimulationRef.current = false
    setChallengeSimulation(false)
    challengeStrainRef.current = 'unknown'
    setStrainState('unknown')
    const next = { ...initialChallengeState, lastDifficultyChangeAt: Date.now() }
    challengeStateRef.current = next
    setChallengeState(next)
    setLastChallengeMetrics(null)
    resetChallengeRound()
  }
  const enterCreateMode = () => {
    setDrawMode(false)
    setStudioMode('create')
    studioModeRef.current = 'create'
  }
  const setChallengeStrain = (value: string) => {
    if (value === 'unknown') {
      setChallengeSimulation(false)
      challengeSimulationRef.current = false
      challengeStrainRef.current = 'unknown'
      setStrainState('unknown')
      return
    }
    const next = value.replace('demo_', '') as StrainState
    setChallengeSimulation(true)
    challengeSimulationRef.current = true
    challengeStrainRef.current = next
    setStrainState(next)
  }

  const selectColor = (next: string) => {
    setColor(next)
    setOpenPanel(null)
    setMessage('Brush color updated')
  }

  return <section className="experience-page create-page gaze-studio">
    {studioMode === 'play' && <div className="play-challenge-panel">
      <div className="play-challenge-heading"><span><Target size={14} /> PLAY · ROUND {challengeState.round}</span><button data-gaze-selectable="true" onClick={enterCreateMode}>EXIT PLAY</button></div>
      <label className="strain-selector">SIGNAL / CHALLENGE INPUT
        <select value={challengeSimulation ? `demo_${strainState}` : 'unknown'} onChange={(event) => setChallengeStrain(event.target.value)}>
          <option value="unknown">Unavailable · difficulty holds</option>
          <option value="demo_low">DEMO SIMULATION · low (manual)</option>
          <option value="demo_moderate">DEMO SIMULATION · moderate (manual)</option>
          <option value="demo_high">DEMO SIMULATION · high (manual)</option>
        </select>
      </label>
      <div className="play-sensor-status"><i />{challengeSimulation ? `DEMO SIMULATION · USER-SET ${strainState.toUpperCase()}` : 'EEG UNAVAILABLE · NO LIVE HEADSET'}</div>
      <div className="play-metrics"><span>Coverage <b>{Math.round(challengeCells / 64 * 100)}%</b></span><span>Accuracy <b>{challengeHits + challengeMisses ? Math.round(challengeHits / (challengeHits + challengeMisses) * 100) : 0}%</b></span><span>Misses <b>{challengeMisses}</b></span><span>Time <b>{Math.max(0, 45 - challengeElapsed)}s</b></span></div>
      <div className="play-progress"><i style={{ width: `${Math.min(100, challengeCells / 64 * 100)}%` }} /></div>
      {lastChallengeMetrics && <p className="play-last-round">Last round · {Math.round(lastChallengeMetrics.coverage * 100)}% coverage · {Math.round(lastChallengeMetrics.accuracy * 100)}% accuracy</p>}
      <div className="play-round-actions">
        {challengeRoundDone
          ? <button className="play-round-button" onClick={resetChallengeRound}>START ROUND {challengeState.round}</button>
          : <button className="play-round-button" disabled={!canCompleteChallenge(challengeCells / 64)} onClick={finishChallengeRound}>COMPLETE ROUND · 70% COVERAGE</button>}
        <button className="play-reset-button" onClick={resetChallenge}>RESET CHALLENGE</button>
      </div>
      <small className="play-difficulty-note">
        Target {Math.round(challengeState.targetScale * 100)}% of the shorter canvas side · {challengeSimulation
          ? strainState === 'low' ? 'DEMO low shrinks only after repeated successful rounds.'
            : strainState === 'high' ? 'DEMO high grows the target gradually.'
              : 'DEMO moderate holds difficulty.'
          : 'EEG unavailable; unknown signal holds difficulty.'}
      </small>
    </div>}
    {studioMode === 'play' && !challengeRoundDone && <div
      className="play-target"
      style={{ width: `${Math.min(viewport.width, viewport.height) * challengeState.targetScale}px`, height: `${Math.min(viewport.width, viewport.height) * challengeState.targetScale}px` }}
      aria-label="Green painting target"
    ><span>{Math.round(challengeCells / 64 * 100)}%</span></div>}
    <canvas
      className="studio-paint-canvas"
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
    <div className="studio-topbar">
      <button className="studio-back" data-gaze-selectable="true" onClick={() => navigate('explore')} aria-label="Back to worlds"><ArrowLeft size={17} /><span>WORLDS</span></button>
      <label className="studio-name"><ImageIcon size={14} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name this artwork" maxLength={34} aria-label="Artwork name" /></label>
      <span className={cameraActive ? 'studio-signal signal-active' : 'studio-signal'}><i />{cameraActive ? faceDetected ? gazeMap ? `GAZE FIT · ${Math.round(gazeMap.rmse * 100)}%` : 'FACE DETECTED · CALIBRATE' : 'CAMERA ON · FINDING FACE' : 'CAMERA OFF'}</span>
      <button className={studioMode === 'play' ? 'studio-mode-button selected' : 'studio-mode-button'} data-gaze-selectable="true" onClick={studioMode === 'play' ? enterCreateMode : enterPlayMode} aria-label={studioMode === 'play' ? 'Switch to Create Mode' : 'Enter Play Mode'}>
        {studioMode === 'play' ? <WandSparkles size={14} /> : <Target size={14} />}{studioMode === 'play' ? 'CREATE' : 'PLAY'}
      </button>
      <button className="studio-icon-button" data-gaze-selectable="true" onClick={redo} aria-label="Redo" title="Redo"><Redo2 size={16} /></button>
      <button className={openPanel === 'gallery' ? 'studio-icon-button selected' : 'studio-icon-button'} data-gaze-selectable="true" onClick={() => setOpenPanel(openPanel === 'gallery' ? null : 'gallery')} aria-label="Open saved gallery" title="Gallery"><Images size={16} /></button>
    </div>
    <div className="studio-gaze-tools">
      <WebcamInput onMovement={onMovement} onStatus={handleCameraStatus} onGaze={handleGaze} onFaceDetected={handleFaceDetected} onGesture={focusGestureControl} sensitivity={gestureSensitivity} compact />
      <button className="studio-calibrate" data-gaze-selectable="true" onClick={beginCalibration} disabled={!cameraActive}><Crosshair size={15} /> CALIBRATE</button>
      <button className="studio-calibrate diagnostics-toggle" aria-pressed={diagnosticsOpen} onClick={() => setDiagnosticsOpen(!diagnosticsOpen)}>DIAGNOSTICS</button>
    </div>
    <div className="studio-onboarding"><strong>FIRST TIME?</strong> Enable camera · calibrate all 9 targets · draw with gaze, mouse, or hold Space. Blink moves focus; hold a wink to select.</div>
    {diagnosticsOpen && <aside className="gaze-diagnostics" aria-live="polite">
      <strong>GAZE DIAGNOSTICS · LOCAL ONLY</strong>
      <span>Face: {faceDetected ? 'DETECTED' : cameraActive ? 'NOT DETECTED' : 'CAMERA OFF'}</span>
      <span>Gaze features: {diagnosticGaze ? `${diagnosticGaze.x.toFixed(3)}, ${diagnosticGaze.y.toFixed(3)}` : '—'}</span>
      <span>Screen mapping: {diagnosticGaze && gazeMap ? (() => { const point = mapGazeToScreen(diagnosticGaze, gazeMap); return `${point.x.toFixed(3)}, ${point.y.toFixed(3)}` })() : 'NOT CALIBRATED'}</span>
      <span>Calibration: {gazeMap ? `FIT · RMS ${(gazeMap.rmse * 100).toFixed(1)}%` : calibrationIndex !== null ? `${calibrationIndex + 1} / 9` : 'NOT CALIBRATED'}</span>
      <span>Canvas cursor: {diagnosticCursor ? `${Math.round(diagnosticCursor.x)}px, ${Math.round(diagnosticCursor.y)}px` : '—'}</span>
      <span>Gesture: {faceDetected ? gestureStatus : 'NO FACE / NEUTRAL'}</span>
      <label>Gesture sensitivity · {gestureSensitivity}<input aria-label="Gesture sensitivity" type="range" min="1" max="10" value={gestureSensitivity} onChange={(event) => setGestureSensitivity(Number(event.target.value))} /></label>
      <small>Preview is mirrored for comfort; landmark coordinates are not mirrored. Recalibrate if the preview and cursor disagree.</small>
    </aside>}
    <div className="gesture-readout" aria-live="polite"><i /> FACIAL GESTURE · {gestureStatus}</div>
    <div className={`studio-brush-cursor brush-${brush}${painting ? ' is-painting' : ''}${cursorSource ? ' is-visible' : ''}`} ref={cursorRef} aria-hidden="true"><i /></div>
    <div className="studio-bottom-dock">
      <div className="studio-toolbar" role="toolbar" aria-label="Creative controls">
        <div className="studio-control-wrap">
          <button className={openPanel === 'color' ? 'studio-control is-open' : 'studio-control'} data-gaze-selectable="true" onClick={() => setOpenPanel(openPanel === 'color' ? null : 'color')} aria-expanded={openPanel === 'color'}>
            <i className="active-color" style={{ backgroundColor: color }} /><span>COLOR</span><small>{color.toUpperCase()}</small>
          </button>
          {openPanel === 'color' && <div className="studio-popover color-popover">
            <div className="popover-heading"><span>PALETTE</span><small>CHOOSE A COLOR</small></div>
            <div className="color-grid">{ART_COLORS.map((item, index) => <button key={item} className={color.toLowerCase() === item.toLowerCase() ? 'color-swatch is-selected' : 'color-swatch'} style={{ backgroundColor: item }} onClick={() => selectColor(item)} aria-label={`Choose ${ART_COLOR_NAMES[index]}`} title={ART_COLOR_NAMES[index]} />)}</div>
            <label className="custom-color"><span>CUSTOM</span><input type="color" value={customColor} onChange={(event) => { setCustomColor(event.target.value); selectColor(event.target.value) }} /></label>
          </div>}
        </div>
        <div className="studio-control-wrap">
          <button className={openPanel === 'brush' ? 'studio-control is-open' : 'studio-control'} data-gaze-selectable="true" onClick={() => setOpenPanel(openPanel === 'brush' ? null : 'brush')} aria-expanded={openPanel === 'brush'}>
            <span className={`brush-preview brush-${brush}`}><i /></span><span>BRUSH</span><small>{brush.toUpperCase()}</small>
          </button>
          {openPanel === 'brush' && <div className="studio-popover brush-popover">
            <div className="popover-heading"><span>BRUSH</span><small>FIVE DISTINCT TOOLS</small></div>
            {BRUSHES.map((item) => <button key={item} className={brush === item ? 'brush-option is-selected' : 'brush-option'} onClick={() => { setBrush(item); setOpenPanel(null); setMessage(`${item.toUpperCase()} brush selected`) }}>
              <span className={`brush-preview brush-${item}`}><i /></span><span><strong>{item[0].toUpperCase() + item.slice(1)}</strong><small>{item === 'normal' ? 'Smooth solid line' : item === 'soft' ? 'Blurred feathered edge' : item === 'spray' ? 'Randomized paint particles' : item === 'neon' ? 'Bright layered glow' : 'Trailing particle flecks'}</small></span>
            </button>)}
          </div>}
        </div>
        <label className="studio-size"><span>SIZE <b>{brushSize}</b></span><input type="range" min="2" max="40" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} aria-label="Brush size" /></label>
        <button className={painting ? 'studio-control draw-control is-drawing' : 'studio-control draw-control'} data-gaze-selectable="true" onClick={() => setDrawMode(!painting)} aria-pressed={painting} title="Hold Space or mouse to paint; G toggles paint">
          {painting ? <Pause size={17} /> : <Play size={17} />}<span>{painting ? 'PAUSE' : 'DRAW'}</span><small>{cameraActive && gazeMap ? painting ? 'GAZE PAINT' : 'GAZE CURSOR' : painting ? 'MOUSE PAINT' : 'MOUSE READY'}</small>
        </button>
        <button className="studio-control" data-gaze-selectable="true" onClick={() => setArtAnimating(!artAnimating)} title="Play or stop the living-art animation">
          {artAnimating ? <Pause size={17} /> : <Play size={17} />}<span>{artAnimating ? 'STOP ART' : 'PLAY ART'}</span>
        </button>
        <button className="studio-control" data-gaze-selectable="true" onClick={undo} title="Undo"><Undo2 size={17} /><span>UNDO</span></button>
        <button className="studio-control" data-gaze-selectable="true" onClick={redo} title="Redo"><Redo2 size={17} /><span>REDO</span></button>
        <button className="studio-control" data-gaze-selectable="true" onClick={clearCanvas} title="Clear canvas"><Trash2 size={17} /><span>CLEAR</span></button>
        <button className="studio-control save-control" data-gaze-selectable="true" onClick={saveArt} title="Save PNG and add artwork and stroke history to gallery"><Save size={17} /><span>SAVE</span></button>
      </div>
      <div className="studio-adapt-note"><Sparkles size={12} /> {studioMode === 'play' ? `ROUND ${challengeState.round} · ${challengeSimulation ? `DEMO ${strainState.toUpperCase()}` : 'STRAIN UNKNOWN'}` : `NEURO-ADAPT ${adaptation.difficulty.toUpperCase()} · ${adaptation.difficulty === 'supportive' ? 'Try one brush at a time' : adaptation.difficulty === 'challenging' ? 'Try a new brush and color' : 'Your tools stay yours'}`} · EEG NOT CONNECTED <span>SPACE · HOLD TO DRAW&nbsp;&nbsp; ESC · PAUSE&nbsp;&nbsp; BLINK · NEXT CONTROL&nbsp;&nbsp; WINK · SELECT</span></div>
    </div>
    <div className="studio-message" role="status">{message || (gazeMap ? 'Gaze cursor only · drawing requires an intentional action' : 'Enable gaze for eye control · mouse draws when DRAW is active')}</div>
    {openPanel === 'gallery' && <div className="studio-gallery-popover">
      <div className="popover-heading"><span>YOUR GALLERY</span><button onClick={() => setOpenPanel(null)} aria-label="Close gallery"><X size={14} /></button></div>
      {gallery.length === 0 ? <p>No saved artwork yet.</p> : gallery.map((item, index) => <button key={`${item.name}-${index}`} className="gallery-saved-item" onClick={() => loadArt(item)}><img src={item.image} alt="" /><span><strong>{item.name}</strong><small>{item.date}</small></span><Download size={14} onClick={(event) => { event.stopPropagation(); downloadImage(item.image, `${item.name}.png`) }} /></button>)}
    </div>}
    {calibrationIndex !== null && <div className="gaze-calibration">
      <div className="calibration-instructions"><span>WEBCAM GAZE · CALIBRATION {calibrationIndex + 1} / {GAZE_CALIBRATION_TARGETS.length}</span><p>{calibrationHint || 'Look at the target and capture when ready.'}</p><small>Approximate gaze estimation only. Keep your head steady and use even lighting.</small></div>
      <div className={calibrationCapture ? 'calibration-target is-capturing' : 'calibration-target'} style={{ left: `${GAZE_CALIBRATION_TARGETS[calibrationIndex].x * 100}%`, top: `${GAZE_CALIBRATION_TARGETS[calibrationIndex].y * 100}%` }}><i /><span>{GAZE_CALIBRATION_TARGETS[calibrationIndex].label}</span></div>
      <div className="calibration-actions"><button onClick={captureTarget} disabled={calibrationCapture || !cameraActive}>{calibrationCapture ? 'CAPTURING…' : `CAPTURE ${GAZE_CALIBRATION_TARGETS[calibrationIndex].label}`}</button><button onClick={() => { captureRef.current = false; if (calibrationTimerRef.current !== null) window.clearTimeout(calibrationTimerRef.current); setCalibrationIndex(null); setCalibrationCapture(false) }}>CANCEL</button></div>
    </div>}
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
  return <section className="subpage about-page"><div className="page-heading"><span className="eyebrow">A DIFFERENT KIND OF INTERFACE</span><h1>PLAY, WITHOUT<br /><span>THE CONTROLLER.</span></h1><p>Neuroverse is an exploration of a more personal kind of entertainment—where tiny movements can shape entire worlds.</p></div><div className="about-grid"><div><Lightbulb /><span className="eyebrow">THE IDEA</span><h2>Technology that gets out of the way.</h2><p>Our first demo uses keyboard simulation and optional webcam-based facial landmarks. Each input source is separate from the experiences, so future signal processing can plug in without rebuilding the worlds.</p></div><div><Radio /><span className="eyebrow">THE FUTURE</span><h2>Built to grow with the signal.</h2><p>The EEG adapter is intentionally a placeholder. A future ANT Neuro → LSL → Python → WebSocket pipeline can send movement events to the shared input engine. No EEG hardware is connected or simulated today.</p></div></div><div className="about-cta"><p>Curious what it feels like?</p><button className="button button-primary" onClick={() => navigate('explore')}>STEP INTO A WORLD <ArrowRight size={15} /></button></div></section>
}

function DeveloperPanel({ source, webcamActive, events, currentEvent, onMovement, onReset, onClose }: { source: InputSource; webcamActive: boolean; events: MovementEvent[]; currentEvent: MovementEvent | null; onMovement: (event: MovementEvent) => void; onReset: () => void; onClose: () => void }) {
  return <motion.aside className="developer-panel" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }}><div className="dev-heading"><div><span className="eyebrow">NEUROVERSE / DEV</span><strong>Signal monitor</strong></div><button onClick={onClose} aria-label="Close developer panel"><X size={16} /></button></div><div className="dev-status"><span className="eyebrow">INPUT SOURCE</span><strong><i className={source === 'eeg' ? 'muted-dot' : ''} />{source === 'simulation' ? 'Keyboard simulation' : source === 'webcam' ? 'Webcam selected' : 'EEG · disconnected'}</strong></div><div className="dev-current"><span className="eyebrow">LATEST MOVEMENT</span><strong>{currentEvent ? movementNames[currentEvent.movement] : '—'}</strong><small>{currentEvent ? `${currentEvent.confidence.toFixed(2)} confidence · ${currentEvent.source}` : 'Waiting for input'}{currentEvent ? ` · ${new Date(currentEvent.timestamp).toLocaleTimeString()}` : ''}</small></div><div className="dev-test"><span className="eyebrow">TEST MOVEMENT</span><div>{(['BLINK', 'WINK', 'JAW_CLENCH'] as Movement[]).map((movement) => <button key={movement} onClick={() => onMovement({ movement, source: 'simulation', timestamp: Date.now(), confidence: 1 })}>{movementNames[movement]}</button>)}</div></div><div className="dev-history"><div><span className="eyebrow">EVENT HISTORY</span><button onClick={onReset}>RESET</button></div>{events.length === 0 ? <p>No events yet.</p> : events.slice(0, 6).map((event, index) => <div className="dev-event" key={`${event.timestamp}-${index}`}><span className="event-source">{event.source === 'simulation' ? 'KEY' : event.source.toUpperCase()}</span><strong>{movementNames[event.movement]}</strong><small>{event.confidence.toFixed(2)}</small></div>)}</div><div className="dev-footer"><span>WEBCAM · {webcamActive ? 'CONNECTED' : source === 'webcam' ? 'SELECTED / OFF' : 'OFF'}</span><span>EEG · NOT CONNECTED</span><small>CTRL + SHIFT + D TO TOGGLE</small></div></motion.aside>
}

export default App
