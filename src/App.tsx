import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown, ArrowLeft, ArrowRight, AudioLines, BookOpen, Check,
  Command, Download, Eye, Gamepad2, Heart, Lightbulb, Menu,
  PawPrint, Play, Plus, Radio, RotateCcw, ScanFace, Settings2, Sparkles, Stars, Sun, WandSparkles,
  X, Zap,
} from 'lucide-react'
import { story } from './storyData'
import { EEG_SERVICE_MESSAGE } from './services/eegService'
import WebcamInput from './WebcamInput'
import { initialWorkloadAdaptation } from './types'
import type { InputSource, Movement, MovementEvent, WorkloadAdaptation, WorkloadPrediction } from './types'

type Page = 'home' | 'explore' | 'calibration' | 'story' | 'pet' | 'create' | 'adapt' | 'about'
type Action = 'confirm' | 'switch' | 'special'
type SavedArt = { name: string; image: string; date: string }

const experiences = [
  { id: 'story' as const, number: '01', title: 'THE LAST SIGNAL', mode: 'STORY MODE', description: 'Your movements. Your choices. Your story.', icon: BookOpen, className: 'story-art', tag: 'A branching cinematic' },
  { id: 'pet' as const, number: '02', title: 'A LITTLE MAGIC', mode: 'PET MODE', description: 'Meet a creature that grows with every interaction.', icon: PawPrint, className: 'pet-art', tag: 'A tiny life, yours to shape' },
  { id: 'create' as const, number: '03', title: 'LIVING COLOR', mode: 'CREATE MODE', description: 'Turn your movements into living digital art.', icon: WandSparkles, className: 'create-art', tag: 'Your hands-free art studio' },
]

const defaultMapping: Record<Movement, Action | 'none'> = {
  BLINK: 'confirm', WINK: 'switch', JAW_CLENCH: 'special', REST: 'none', UNKNOWN: 'none',
}
const movementNames: Record<Movement, string> = {
  BLINK: 'Blink', WINK: 'Wink', JAW_CLENCH: 'Jaw clench', REST: 'Rest', UNKNOWN: 'Unknown',
}
const actionNames: Record<Action, string> = { confirm: 'Confirm / interact', switch: 'Switch / change', special: 'Special action' }

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
  const [pendingExperience, setPendingExperience] = useState<'story' | 'pet' | 'create'>('story')
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
      const keyMap: Record<string, Movement> = { ' ': 'BLINK', a: 'WINK', s: 'JAW_CLENCH', r: 'REST' }
      const movement = keyMap[event.key.toLowerCase()]
      if (movement) {
        event.preventDefault()
        emit({ movement, source: 'simulation', timestamp: Date.now(), confidence: 1 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [emit])

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
    <div className="app-shell">
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
            {page === 'create' && <CreateMode navigate={navigate} actionFor={actionFor} lastMovement={currentEvent} adaptation={workloadAdaptation} />}
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

function Landing({ navigate, onChoose }: { navigate: (page: Page) => void; onChoose: (experience: 'story' | 'pet' | 'create') => void }) {
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
        <div className="portal-label label-left"><span className="label-dot" /> SIGNAL DETECTED <small>0.98 / ACTIVE</small></div>
        <div className="portal-label label-right"><small>NEURAL INTERFACE</small><span>READY TO CONNECT</span></div>
        <div className="hero-floating">MOVE A LITTLE.<br /><span>FEEL A LOT.</span></div>
      </div>
      <div className="hero-scroll"><ArrowDown size={13} /> SCROLL TO EXPLORE <span>01 — 03</span></div>
    </section>
    <section className="experience-strip"><div className="strip-heading"><span className="eyebrow">THREE WORLDS. ONE YOU.</span><button className="text-button" onClick={() => navigate('explore')}>EXPLORE ALL <ArrowRight size={14} /></button></div>
      <div className="experience-preview">{experiences.map((item) => <button key={item.id} className={`preview-tile ${item.className}`} onClick={() => onChoose(item.id)}><div className="tile-symbol">{item.id === 'story' ? <BookOpen /> : item.id === 'pet' ? <PawPrint /> : <WandSparkles />}</div><span>{item.mode}</span><strong>{item.title}</strong><small>{item.tag}</small><ArrowRight className="tile-arrow" size={16} /></button>)}</div>
    </section>
    <HowItWorks navigate={navigate} />
  </div>
}

function HowItWorks({ navigate }: { navigate: (page: Page) => void }) {
  return <section className="how-section" id="how-it-works"><div className="section-lead"><div><span className="eyebrow">SIMPLE BY DESIGN</span><h2>YOU’RE THE<br /><span>CONTROLLER.</span></h2></div><p>No headset. No learning curve. Just small, natural movements that turn a story into something that feels like yours.</p></div>
    <div className="movement-explainer">{[['BLINK', 'A quick blink confirms your choice.', '◉'], ['WINK', 'A wink moves you between options.', '◒'], ['JAW CLENCH', 'A clench unleashes a special action.', '⌁']].map(([name, text, glyph], index) => <div className="movement-step" key={name}><span className="step-num">0{index + 1}</span><span className="movement-glyph">{glyph}</span><strong>{name}</strong><p>{text}</p></div>)}</div>
    <div className="how-bottom"><span>START WITH KEYBOARD OR WEBCAM. EEG IS COMING SOON.</span><button className="text-button" onClick={() => navigate('calibration')}>SET UP YOUR INPUT <ArrowRight size={14} /></button></div>
  </section>
}

function Explore({ navigate, onChoose }: { navigate: (page: Page) => void; onChoose: (experience: 'story' | 'pet' | 'create') => void }) {
  return <section className="subpage explore-page"><div className="page-heading"><span className="eyebrow">YOUR UNIVERSE AWAITS</span><h1>CHOOSE YOUR<br /><span>ADVENTURE.</span></h1><p>Three ways to step out of the ordinary. Pick a world to make your own.</p></div>
    <div className="universe-grid">{experiences.map((item) => { const Icon = item.icon; return <article className={`universe-card ${item.className}`} key={item.id}><div className="universe-card-visual"><span className="universe-index">{item.number} / 03</span><div className="visual-orb">{item.id === 'story' ? <div className="orb-station"><span /><i /><b /></div> : item.id === 'pet' ? <div className="creature-mini"><i /><b /><span /></div> : <div className="mini-art"><i /><i /><i /><i /></div>}</div><span className="universe-badge"><Icon size={14} /> {item.mode}</span></div><div className="universe-card-copy"><div><span className="eyebrow">{item.tag}</span><h2>{item.title}</h2><p>{item.description}</p></div><button className="round-arrow" aria-label={`Enter ${item.mode}`} onClick={() => onChoose(item.id)}><ArrowRight size={18} /></button></div></article>})}</div>
    <div className="page-bottom-note"><span className="status-dot" /> YOUR INPUT CAN BE CHANGED ANYTIME <button onClick={() => navigate('calibration')}>SET UP INPUT <ArrowRight size={14} /></button></div>
  </section>
}

function Calibration({ navigate, destination, source, setSource, onMovement, onWebcamStatus, currentEvent, mapping, setMapping }: { navigate: (page: Page) => void; destination: 'story' | 'pet' | 'create'; source: InputSource; setSource: (source: InputSource) => void; onMovement: (event: MovementEvent) => void; onWebcamStatus: (active: boolean) => void; currentEvent: MovementEvent | null; mapping: Record<Movement, Action | 'none'>; setMapping: (mapping: Record<Movement, Action | 'none'>) => void }) {
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

function CreateMode({ navigate, actionFor, lastMovement, adaptation }: { navigate: (page: Page) => void; actionFor: (movement: Movement) => Action | 'none'; lastMovement: MovementEvent | null; adaptation: WorkloadAdaptation }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)
  const [playing, setPlaying] = useState(true)
  const [palette, setPalette] = useState(0)
  const [pattern, setPattern] = useState(0)
  const [burst, setBurst] = useState(0)
  const [name, setName] = useState('')
  const [gallery, setGallery] = useState<SavedArt[]>(() => readStorage('neuroverse.gallery', []))
  const lastMovementAt = useRef(lastMovement?.timestamp ?? 0)
  const palettes = useMemo(() => [['#8c58ff', '#25d9ce', '#fa53aa'], ['#ffb14a', '#f34c79', '#9d6aff'], ['#6be8ff', '#248cff', '#ad80ff']], [])
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    let width = 0
    let height = 0
    const particles = Array.from({ length: 92 }, (_, index) => ({ angle: index * 2.4, radius: 25 + (index * 37) % 190, speed: 0.001 + (index % 8) * 0.00016, size: 1 + (index % 4) * 0.8 }))
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width; height = rect.height
      canvas.width = width * ratio; canvas.height = height * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    const draw = (time: number) => {
      context.fillStyle = 'rgba(7, 9, 18, 0.22)'
      context.fillRect(0, 0, width, height)
      const cx = width * 0.5, cy = height * 0.49
      const colors = palettes[palette]
      const energy = 0.8 + Math.sin(time / 930) * 0.13
      const glow = context.createRadialGradient(cx, cy, 2, cx, cy, Math.min(width, height) * 0.44)
      glow.addColorStop(0, `${colors[0]}23`); glow.addColorStop(0.52, `${colors[1]}0b`); glow.addColorStop(1, '#080a1200')
      context.fillStyle = glow; context.fillRect(0, 0, width, height)
      for (let ring = 0; ring < 5; ring++) {
        context.beginPath()
        context.ellipse(cx, cy, (50 + ring * 31) * energy, (24 + ring * 19) * energy, Math.sin(time / 3400 + ring) * 0.34, 0, Math.PI * 2)
        context.strokeStyle = `${colors[(ring + pattern) % colors.length]}${ring === 0 ? '54' : '25'}`
        context.lineWidth = ring === 0 ? 1.3 : 0.7
        context.stroke()
      }
      particles.forEach((particle, index) => {
        const angle = particle.angle + time * particle.speed * (pattern % 2 ? -1 : 1)
        const radius = particle.radius * energy + (burst % 2 ? Math.sin(time / 100 + index) * 10 : 0)
        const x = cx + Math.cos(angle) * radius * (1 + Math.sin(angle * (pattern + 2)) * 0.16)
        const y = cy + Math.sin(angle) * radius * 0.64
        context.beginPath(); context.arc(x, y, particle.size, 0, Math.PI * 2)
        context.fillStyle = colors[index % colors.length]; context.globalAlpha = 0.48 + Math.sin(time / 500 + index) * 0.35; context.fill(); context.globalAlpha = 1
      })
      if (burst) {
        const radius = ((time - burst) / 850) * Math.max(width, height) * 0.7
        if (radius < Math.max(width, height)) { context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.strokeStyle = `${colors[0]}8a`; context.lineWidth = 2; context.stroke() } else setBurst(0)
      }
      if (playing) animationRef.current = requestAnimationFrame(draw)
    }
    if (playing) animationRef.current = requestAnimationFrame(draw)
    return () => { window.removeEventListener('resize', resize); if (animationRef.current !== null) cancelAnimationFrame(animationRef.current) }
  }, [playing, palette, pattern, burst, palettes])
  useEffect(() => {
    if (!lastMovement || lastMovement.timestamp === lastMovementAt.current) return
    lastMovementAt.current = lastMovement.timestamp
    const action = actionFor(lastMovement.movement)
    if (action === 'confirm') setPalette((current) => (current + 1) % palettes.length)
    if (action === 'switch') setPattern((current) => current + 1)
    if (action === 'special') setBurst(Date.now())
  }, [lastMovement, actionFor, palettes.length])
  const saveArt = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const item = { name: name.trim() || `Untitled ${gallery.length + 1}`, image: canvas.toDataURL('image/png'), date: new Date().toLocaleDateString() }
    const next = [item, ...gallery].slice(0, 8)
    setGallery(next)
    localStorage.setItem('neuroverse.gallery', JSON.stringify(next))
    setName('')
  }
  const clearCanvas = () => { setPlaying(false); const context = canvasRef.current?.getContext('2d'); if (context && canvasRef.current) context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height) }
  const downloadArt = () => { const canvas = canvasRef.current; if (!canvas) return; const link = document.createElement('a'); link.download = `${name.trim() || 'neuroverse-art'}.png`; link.href = canvas.toDataURL('image/png'); link.click() }
  return <section className="experience-page create-page"><div className="experience-toolbar"><button className="back-link" onClick={() => navigate('explore')}><ArrowLeft size={15} /> ALL WORLDS</button><span className="mode-label"><WandSparkles size={14} /> CREATE MODE</span><span className="canvas-live"><i /> CANVAS LIVE</span></div><div className="create-heading"><div><span className="eyebrow">YOUR MOVEMENTS, MADE VISIBLE</span><h1>MAKE SOMETHING<br /><span>UNIVERSE-SIZED.</span></h1></div><p>There’s no wrong move here. Follow a feeling and see where it takes you.</p></div><AdaptationNotice adaptation={adaptation} world="create" />
    <div className="studio"><div className="studio-canvas"><canvas ref={canvasRef} /><div className="canvas-overlay"><span>NEUROVERSE / GENERATIVE FIELD</span><span>01 — {String(pattern + 1).padStart(2, '0')}</span></div><div className="canvas-toolbar"><button onClick={() => setPlaying(!playing)}>{playing ? <span className="pause-icon">Ⅱ</span> : <Play size={14} />}{playing ? 'PAUSE' : 'PLAY'}</button><button onClick={() => { setBurst(Date.now()); setPattern((current) => current + 1) }}><Sparkles size={14} /> RANDOMIZE</button><button onClick={clearCanvas}><X size={14} /> CLEAR</button><button onClick={downloadArt}><Download size={14} /> EXPORT PNG</button></div><div className="canvas-response">MOVE TO MAKE <span>SPACE · PALETTE</span><i /> <span>A · FORM</span><i /> <span>S · BURST</span></div></div>
      <aside className="studio-aside"><div className="studio-aside-heading"><span className="eyebrow">ARTWORK SETTINGS</span><Settings2 size={15} /></div><label className="art-name-label">GIVE IT A NAME<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Untitled universe" maxLength={34} /></label><div className="palette-control"><span>COLOR ENERGY</span><div>{palettes.map((colors, index) => <button className={palette === index ? 'palette-button palette-active' : 'palette-button'} key={index} onClick={() => setPalette(index)} aria-label={`Choose palette ${index + 1}`}><i style={{ background: colors[0] }} /><i style={{ background: colors[1] }} /><i style={{ background: colors[2] }} /></button>)}</div></div><button className="button button-primary save-art" onClick={saveArt}><Plus size={15} /> SAVE TO GALLERY</button><div className="gallery-heading"><span className="eyebrow">YOUR GALLERY</span><span>{String(gallery.length).padStart(2, '0')}</span></div><div className="gallery-list">{gallery.length === 0 ? <p className="gallery-empty">Your saved pieces will live here. Make something you love.</p> : gallery.slice(0, 3).map((item, index) => <button className="gallery-item" key={`${item.name}-${index}`} onClick={() => { const image = new Image(); image.onload = () => { const canvas = canvasRef.current; const context = canvas?.getContext('2d'); if (canvas && context) context.drawImage(image, 0, 0, canvas.width, canvas.height) }; image.src = item.image }}><img src={item.image} alt="" /><span><strong>{item.name}</strong><small>{item.date}</small></span><Download size={14} onClick={(event) => { event.stopPropagation(); const link = document.createElement('a'); link.href = item.image; link.download = `${item.name}.png`; link.click() }} /></button>)}</div></aside></div>
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
      <div className="adapt-status-card"><span className="eyebrow">CURRENT PREDICTION</span><strong className={current ? `workload-${current.workload_class}` : ''}>{current ? current.workload_class.toUpperCase() : '—'}</strong><small>{current ? `${(current.confidence * 100).toFixed(1)}% confidence · ${current.window_start}` : 'Start a recorded session to see model output'}</small></div>
      <div className="adapt-status-card"><span className="eyebrow">EXPERIENCE PACE</span><strong className={`difficulty-${current?.adaptation.difficulty ?? 'balanced'}`}>{current?.adaptation.difficulty ?? 'balanced'}</strong><small>{current?.adaptation.last_adaptation ?? 'Waiting for consistent predictions'}</small></div>
    </div>
    <div className="replay-workspace">
      <div className="replay-panel">
        <div className="panel-title"><span className="eyebrow">01 / CHOOSE A RECORDING</span><span>{serviceReady ? 'LOCAL MODEL SERVICE READY' : 'LOCAL MODEL SERVICE OFFLINE'}</span></div>
        <div className="replay-controls"><label>PARTICIPANT & TASK<select value={selection} onChange={(event) => setSelection(event.target.value)} disabled={!sessions.length}><option value="">Select a recorded session</option>{sessions.map((item) => <option key={`${item.subject}-${item.test}`} value={`${item.subject}|${item.test}`}>{item.subject} · Task {item.test} · {item.recorded_condition} · {item.windows} windows</option>)}</select></label><button className="button button-primary" onClick={replay} disabled={loading || !status?.model_available || !selectedSession}>{loading ? 'LOADING MODEL…' : <><Play size={14} /> PLAY RECORDED EEG</>}</button></div>
        {!serviceReady && <p className="backend-help">Start the local backend with <code>python -m uvicorn ml.api:app --reload --port 8000</code>. No prediction is shown until the service and trained model are available.</p>}
        {error && <p className="backend-error" role="alert">{error}</p>}
        <div className="timeline-heading"><span className="eyebrow">02 / PREDICTED WORKLOAD TIMELINE</span><span>{timeline.length ? `${playIndex + 1} / ${timeline.length} · 10-SECOND WINDOWS` : 'NO REPLAY LOADED'}</span></div>
        <div className="workload-chart" aria-label="Recorded workload prediction timeline">{timeline.map((item, index) => <span key={`${item.window_start}-${index}`} className={`chart-bar workload-${item.workload_class} ${index === playIndex ? 'chart-current' : ''}`} style={{ height: `${Math.max(14, Math.round(item.confidence * 84))}px` }} title={`${item.window_start} · ${item.workload_class} · ${(item.confidence * 100).toFixed(1)}%`} />)}</div>
        <div className="chart-legend"><span><i className="workload-low" />LOW</span><span><i className="workload-moderate" />MODERATE</span><span><i className="workload-high" />HIGH</span>{timeline.length > 0 && <button onClick={() => setPlaying(!playing)}>{playing ? 'PAUSE REPLAY' : playIndex >= timeline.length - 1 ? 'REPLAY AGAIN' : 'RESUME'}</button>}</div>
        {timeline.length > 0 && !playing && playIndex >= timeline.length - 1 && <div className="replay-complete"><Check size={14} /> Replay complete. The model processed {timeline.length} recorded windows from {replayInfo?.participant}, task {replayInfo?.test} ({replayInfo?.recorded_condition} task condition).</div>}
      </div>
      <aside className="adaptation-panel"><span className="eyebrow">03 / NEURO-ADAPT RESPONSE</span><div className="adaptation-orb"><Sparkles size={23} /></div><h2>{current?.adaptation.difficulty ?? 'balanced'} pace</h2><p>{current?.adaptation.last_adaptation ?? 'The experience stays balanced until the model has made several consistent, confident predictions.'}</p><div className="consistency-row"><span>CONFIDENT CONSISTENCY</span><strong>{Math.min(3, current?.adaptation.consistent_predictions ?? 0)} / 3</strong></div><div className="consistency-track"><i style={{ width: `${Math.min(100, (current?.adaptation.consistent_predictions ?? 0) / 3 * 100)}%` }} /></div><div className="adaptation-detail"><span>Hints</span><strong>{current?.adaptation.hint_available ? 'Available' : 'Optional'}</strong></div><div className="adaptation-detail"><span>Time pressure</span><strong>{current?.adaptation.time_pressure === 'reduced' ? 'Reduced' : 'Unchanged'}</strong></div><small>Changes are gradual and suggestions only. Your choices and creative controls remain available.</small></aside>
    </div>
    {current && <div className="probability-row"><span className="eyebrow">MODEL PROBABILITIES · {current.workload_class.toUpperCase()} PREDICTED</span>{(['low', 'moderate', 'high'] as const).map((label) => <div key={label}><span>{label}</span><div><i className={`workload-${label}`} style={{ width: `${current.probabilities[label] * 100}%` }} /></div><strong>{(current.probabilities[label] * 100).toFixed(0)}%</strong></div>)}</div>}
    <p className="adapt-footnote">Classes are experimental N-back task conditions: position 1-back (low), arithmetic 1-back (moderate), and dual arithmetic 2-back (high). The model is trained on Emotiv EPOC X features and is not validated for ANT Neuro hardware.</p>
  </section>
}

function About({ navigate }: { navigate: (page: Page) => void }) {
  return <section className="subpage about-page"><div className="page-heading"><span className="eyebrow">A DIFFERENT KIND OF INTERFACE</span><h1>PLAY, WITHOUT<br /><span>THE CONTROLLER.</span></h1><p>Neuroverse is an exploration of a more personal kind of entertainment—where tiny movements can shape entire worlds.</p></div><div className="about-grid"><div><Lightbulb /><span className="eyebrow">THE IDEA</span><h2>Technology that gets out of the way.</h2><p>Our first demo uses keyboard simulation and optional webcam-based facial landmarks. Each input source is separate from the experiences, so future signal processing can plug in without rebuilding the worlds.</p></div><div><Radio /><span className="eyebrow">THE FUTURE</span><h2>Built to grow with the signal.</h2><p>The EEG adapter is intentionally a placeholder. A future ANT Neuro → LSL → Python → WebSocket pipeline can send movement events to the shared input engine. No EEG hardware is connected or simulated today.</p></div></div><div className="about-cta"><p>Curious what it feels like?</p><button className="button button-primary" onClick={() => navigate('explore')}>STEP INTO A WORLD <ArrowRight size={15} /></button></div></section>
}

function DeveloperPanel({ source, webcamActive, events, currentEvent, onMovement, onReset, onClose }: { source: InputSource; webcamActive: boolean; events: MovementEvent[]; currentEvent: MovementEvent | null; onMovement: (event: MovementEvent) => void; onReset: () => void; onClose: () => void }) {
  return <motion.aside className="developer-panel" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }}><div className="dev-heading"><div><span className="eyebrow">NEUROVERSE / DEV</span><strong>Signal monitor</strong></div><button onClick={onClose} aria-label="Close developer panel"><X size={16} /></button></div><div className="dev-status"><span className="eyebrow">INPUT SOURCE</span><strong><i className={source === 'eeg' ? 'muted-dot' : ''} />{source === 'simulation' ? 'Keyboard simulation' : source === 'webcam' ? 'Webcam selected' : 'EEG · disconnected'}</strong></div><div className="dev-current"><span className="eyebrow">LATEST MOVEMENT</span><strong>{currentEvent ? movementNames[currentEvent.movement] : '—'}</strong><small>{currentEvent ? `${currentEvent.confidence.toFixed(2)} confidence · ${currentEvent.source}` : 'Waiting for input'}{currentEvent ? ` · ${new Date(currentEvent.timestamp).toLocaleTimeString()}` : ''}</small></div><div className="dev-test"><span className="eyebrow">TEST MOVEMENT</span><div>{(['BLINK', 'WINK', 'JAW_CLENCH'] as Movement[]).map((movement) => <button key={movement} onClick={() => onMovement({ movement, source: 'simulation', timestamp: Date.now(), confidence: 1 })}>{movementNames[movement]}</button>)}</div></div><div className="dev-history"><div><span className="eyebrow">EVENT HISTORY</span><button onClick={onReset}>RESET</button></div>{events.length === 0 ? <p>No events yet.</p> : events.slice(0, 6).map((event, index) => <div className="dev-event" key={`${event.timestamp}-${index}`}><span className="event-source">{event.source === 'simulation' ? 'KEY' : event.source.toUpperCase()}</span><strong>{movementNames[event.movement]}</strong><small>{event.confidence.toFixed(2)}</small></div>)}</div><div className="dev-footer"><span>WEBCAM · {webcamActive ? 'CONNECTED' : source === 'webcam' ? 'SELECTED / OFF' : 'OFF'}</span><span>EEG · NOT CONNECTED</span><small>CTRL + SHIFT + D TO TOGGLE</small></div></motion.aside>
}

export default App
