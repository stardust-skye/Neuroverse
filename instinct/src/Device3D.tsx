import { useEffect, useMemo, useRef } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
  RoundedBox,
} from '@react-three/drei'
import * as THREE from 'three'
import { BRAND } from './brand'

/*
 * Procedural EEG headphone. Everything is built from three.js primitives and an
 * offline Lightformer environment, so nothing is fetched at runtime.
 *
 * Axes: +x = wearer's right, +y = up, +z = front (nose).
 */

type Vec3 = [number, number, number]
type Signal = Record<string, number>
type PadName = 'C3' | 'Cz' | 'C4' | 'Fz' | 'Pz' | 'T7' | 'T8'

export type Device3DProps = {
  /** Per-channel activity 0..1, keyed by 10-20 names, e.g. { Fz: 0.4, C3: 0.9, T7: 0.2 } */
  signal?: Record<string, number>
  /** Canvas height in px (default 320) */
  height?: number
  /** Slowly spin the model (default true) */
  autoRotate?: boolean
}

// ---------------------------------------------------------------- look

const GRAPHITE = { color: '#2a2d32', roughness: 0.5, metalness: 0.25 } as const
const GRAPHITE_DARK = { color: '#1b1d21', roughness: 0.32, metalness: 0.35 } as const
const SOFT = { color: '#3a3d42', roughness: 0.95, metalness: 0 } as const
const FABRIC = { color: '#16181b', roughness: 1, metalness: 0 } as const
const ACCENT = { color: '#4fb3aa', roughness: 0.35, metalness: 0.5 } as const

const TEAL = new THREE.Color('#0f6b66')
const AMBER = new THREE.Color('#ffb21f')

// ---------------------------------------------------------------- geometry constants

const R = 1.1 // headband radius (ear to ear)
const CUP_Y = -0.6 // ear-cup centre height
const CUP_SY = 1.18 // ear cups are slightly oval (taller than deep)
const STRIP_R = 1.035 // inner padded strip radius
const STRIP_TUBE = 0.032
const SPINE_R = 0.985 // short sagittal sensor spine (carries Fz / Pz)
const SPINE_TUBE = 0.02

// ---------------------------------------------------------------- signal helpers

function finite01(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined
  return Math.min(1, Math.max(0, v))
}

function readChannel(signal: Signal | undefined, name: PadName): number | undefined {
  if (!signal) return undefined
  if (name === 'Cz') {
    // The real cap has no Cz: drive it with the mean of C3 / C4.
    const a = finite01(signal.C3)
    const b = finite01(signal.C4)
    if (a !== undefined && b !== undefined) return (a + b) / 2
    return a ?? b
  }
  return finite01(signal[name])
}

// ---------------------------------------------------------------- parts

/** Torus arc with rounded end caps. Lies in the local XY plane starting at +x. */
function Arc(props: {
  radius: number
  tube: number
  arc: number
  start?: number
  rotation?: Vec3
  scale?: Vec3
  children: ReactNode // material for the tube
  capMaterial: ReactNode // material for the end caps
}) {
  const { radius, tube, arc, start = 0, rotation = [0, 0, 0], scale = [1, 1, 1] } = props
  // Euler XYZ applies Z first, so `start` rotates the arc within its own plane.
  const rot: Vec3 = [rotation[0], rotation[1], rotation[2] + start]
  return (
    <group rotation={rot} scale={scale}>
      <mesh castShadow>
        <torusGeometry args={[radius, tube, 24, 96, arc]} />
        {props.children}
      </mesh>
      <mesh position={[radius, 0, 0]}>
        <sphereGeometry args={[tube, 24, 16]} />
        {props.capMaterial}
      </mesh>
      <mesh position={[radius * Math.cos(arc), radius * Math.sin(arc), 0]}>
        <sphereGeometry args={[tube, 24, 16]} />
        {props.capMaterial}
      </mesh>
    </group>
  )
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** Electrode pad: graphite base, emissive gel dome and an additive halo. */
function Pad(props: {
  name: PadName
  position: Vec3
  normal: Vec3 // points from the pad toward the skin
  phase: number
  signalRef: RefObject<Signal | undefined>
}) {
  const { name, position, normal, phase, signalRef } = props
  const gel = useRef<THREE.MeshStandardMaterial>(null)
  const halo = useRef<THREE.MeshBasicMaterial>(null)
  const level = useRef(0.1)
  const tmp = useMemo(() => new THREE.Color(), [])

  const quaternion = useMemo(() => {
    const n = new THREE.Vector3(...normal).normalize()
    return new THREE.Quaternion().setFromUnitVectors(Y_AXIS, n)
  }, [normal])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const v = readChannel(signalRef.current, name)
    // Idle pads breathe gently so the model looks alive.
    const target = v ?? 0.08 + 0.09 * (0.5 + 0.5 * Math.sin(t * 1.7 + phase))
    level.current += (target - level.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 9))
    const l = level.current
    tmp.copy(TEAL).lerp(AMBER, l)
    if (gel.current) {
      gel.current.emissive.copy(tmp)
      gel.current.emissiveIntensity = 0.35 + 2.4 * l
    }
    if (halo.current) {
      halo.current.color.copy(tmp)
      halo.current.opacity = 0.12 + 0.6 * l
    }
  })

  return (
    <group position={position} quaternion={quaternion}>
      <mesh position={[0, 0.009, 0]}>
        <cylinderGeometry args={[0.05, 0.054, 0.018, 32]} />
        <meshStandardMaterial {...GRAPHITE_DARK} />
      </mesh>
      <mesh position={[0, 0.018, 0]} scale={[1, 0.42, 1]}>
        <sphereGeometry args={[0.038, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          ref={gel}
          color="#0a1414"
          roughness={0.25}
          metalness={0}
          emissive={TEAL}
          emissiveIntensity={0.5}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.095, 32]} />
        <meshBasicMaterial
          ref={halo}
          color={TEAL}
          transparent
          opacity={0.2}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

/** Small "engraved" wordmark drawn into a canvas texture (system font, offline). */
function useBrandTexture(): THREE.CanvasTexture | null {
  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = "600 60px system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    const label = BRAND.toUpperCase().split('').join(' ')
    ctx.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width - 24)
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [])
  useEffect(() => () => tex?.dispose(), [tex])
  return tex
}

function EarCup(props: {
  side: 1 | -1
  brand: THREE.CanvasTexture | null
  signalRef: RefObject<Signal | undefined>
}) {
  const { side: s, brand, signalRef } = props
  const pad: PadName = s === 1 ? 'T8' : 'T7'
  // T7/T8 pad sits on the cushion's skin-facing surface, upper-front (above the ear).
  const phi = (62 * Math.PI) / 180
  const padPos: Vec3 = [s * -0.236, 0.29 * Math.sin(phi) * CUP_SY, 0.29 * Math.cos(phi)]

  return (
    <group position={[s * R, CUP_Y, 0]}>
      {/* slider from the headband end into the yoke */}
      <RoundedBox args={[0.06, 0.26, 0.13]} radius={0.025} smoothness={4} position={[0, 0.6, 0]} castShadow>
        <meshStandardMaterial {...GRAPHITE_DARK} />
      </RoundedBox>
      <RoundedBox args={[0.064, 0.022, 0.134]} radius={0.008} smoothness={2} position={[0, 0.52, 0]}>
        <meshStandardMaterial {...ACCENT} />
      </RoundedBox>

      {/* yoke: thin arc hugging the top of the cup, pivoting front and back */}
      <mesh rotation={[0, Math.PI / 2, 0]} scale={[1, 1.12, 1]} castShadow>
        <torusGeometry args={[0.46, 0.024, 16, 64, Math.PI]} />
        <meshStandardMaterial {...GRAPHITE_DARK} />
      </mesh>
      {[1, -1].map((z) => (
        <mesh key={z} position={[0, 0, z * 0.435]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.036, 0.036, 0.09, 24]} />
          <meshStandardMaterial {...GRAPHITE_DARK} />
        </mesh>
      ))}

      {/* oval shell + cushion */}
      <group scale={[1, CUP_SY, 1]}>
        <mesh rotation={[0, 0, -s * (Math.PI / 2)]} castShadow>
          <cylinderGeometry args={[0.36, 0.4, 0.2, 64]} />
          <meshStandardMaterial {...GRAPHITE} />
        </mesh>
        <mesh position={[s * 0.105, 0, 0]} rotation={[0, 0, -s * (Math.PI / 2)]}>
          <cylinderGeometry args={[0.3, 0.3, 0.012, 64]} />
          <meshStandardMaterial {...GRAPHITE_DARK} />
        </mesh>
        <mesh position={[s * 0.1, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.33, 0.009, 12, 96]} />
          <meshStandardMaterial {...ACCENT} />
        </mesh>
        <mesh position={[s * -0.15, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
          <torusGeometry args={[0.29, 0.085, 24, 72]} />
          <meshStandardMaterial {...SOFT} />
        </mesh>
        <mesh position={[s * -0.14, 0, 0]} rotation={[0, 0, -s * (Math.PI / 2)]}>
          <cylinderGeometry args={[0.3, 0.3, 0.02, 48]} />
          <meshStandardMaterial {...FABRIC} />
        </mesh>
      </group>

      {brand && (
        <mesh position={[s * 0.113, 0, 0]} rotation={[0, s * (Math.PI / 2), 0]}>
          <planeGeometry args={[0.34, 0.085]} />
          <meshStandardMaterial
            map={brand}
            color="#8d949b"
            transparent
            opacity={0.7}
            roughness={0.35}
            metalness={0.4}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
          />
        </mesh>
      )}

      <Pad name={pad} position={padPos} normal={[-s, 0, 0]} phase={s === 1 ? 2.4 : 0.9} signalRef={signalRef} />
    </group>
  )
}

function bandPad(angleDeg: number): { position: Vec3; normal: Vec3 } {
  const a = (angleDeg * Math.PI) / 180
  const r = STRIP_R - STRIP_TUBE + 0.004
  const position: Vec3 = [r * Math.cos(a), r * Math.sin(a), 0]
  return { position, normal: [-Math.cos(a), -Math.sin(a), 0] }
}

function spinePad(offset: number): { position: Vec3; normal: Vec3 } {
  // Sagittal plane: angle measured from the back (-z) over the top to the front (+z).
  const th = Math.PI / 2 + offset
  const r = SPINE_R - SPINE_TUBE + 0.004
  const position: Vec3 = [0, r * Math.sin(th), -r * Math.cos(th)]
  return { position, normal: [0, -Math.sin(th), Math.cos(th)] }
}

const BAND_PADS: { name: PadName; phase: number; pos: { position: Vec3; normal: Vec3 } }[] = [
  { name: 'C4', phase: 0.0, pos: bandPad(58) },
  { name: 'Cz', phase: 1.3, pos: spinePad(0) }, // crown, where spine meets band
  { name: 'C3', phase: 2.1, pos: bandPad(122) },
  { name: 'Fz', phase: 3.4, pos: spinePad(0.44) },
  { name: 'Pz', phase: 4.6, pos: spinePad(-0.44) },
]

function Headset(props: { signalRef: RefObject<Signal | undefined> }) {
  const { signalRef } = props
  const brand = useBrandTexture()
  const graphite = <meshStandardMaterial {...GRAPHITE} />
  const soft = <meshStandardMaterial {...SOFT} />
  const accent = <meshStandardMaterial {...ACCENT} />
  const spineArc = 1.15

  return (
    <group position={[0, 0.02, 0]}>
      {/* outer headband: flattened half torus */}
      <Arc radius={R} tube={0.045} arc={Math.PI} scale={[1, 1, 2.4]} capMaterial={graphite}>
        {graphite}
      </Arc>
      {/* accent line along the crest */}
      <Arc radius={R + 0.044} tube={0.007} arc={Math.PI - 0.7} start={0.35} capMaterial={accent}>
        {accent}
      </Arc>
      {/* soft inner strip carrying the central electrodes */}
      <Arc radius={STRIP_R} tube={STRIP_TUBE} arc={Math.PI - 0.5} start={0.25} scale={[1, 1, 2.1]} capMaterial={soft}>
        {soft}
      </Arc>
      {/* short front-to-back spine under the crown for Fz / Pz */}
      <Arc
        radius={SPINE_R}
        tube={SPINE_TUBE}
        arc={spineArc}
        start={Math.PI / 2 - spineArc / 2}
        rotation={[0, Math.PI / 2, 0]}
        scale={[1, 1, 1.6]}
        capMaterial={soft}
      >
        {soft}
      </Arc>

      {BAND_PADS.map((p) => (
        <Pad
          key={p.name}
          name={p.name}
          position={p.pos.position}
          normal={p.pos.normal}
          phase={p.phase}
          signalRef={signalRef}
        />
      ))}

      <EarCup side={1} brand={brand} signalRef={signalRef} />
      <EarCup side={-1} brand={brand} signalRef={signalRef} />
    </group>
  )
}

function StudioEnvironment() {
  // Children-only Environment renders a local cube map: no HDRI download.
  return (
    <Environment resolution={128} frames={1} environmentIntensity={0.55}>
      <Lightformer form="rect" intensity={2.2} position={[0, 4, 3]} scale={[6, 2, 1]} />
      <Lightformer form="rect" intensity={1.2} position={[-5, 1, 0]} rotation={[0, Math.PI / 2, 0]} scale={[4, 3, 1]} />
      <Lightformer form="rect" intensity={1.6} color="#cfe9ff" position={[4, 1, -4]} scale={[3, 3, 1]} />
      <Lightformer form="ring" intensity={0.8} position={[0, -3, 2]} scale={2} />
    </Environment>
  )
}

export default function Device3D({ signal, height = 320, autoRotate = true }: Device3DProps): JSX.Element {
  // Signals can update many times per second; keep them in a ref so the
  // scene graph never re-renders, and let each pad read it in useFrame.
  const signalRef = useRef<Signal | undefined>(signal)
  signalRef.current = signal

  return (
    <div
      role="img"
      aria-label={`${BRAND} EEG headphones, 3D view`}
      style={{ width: '100%', height, background: 'transparent', touchAction: 'pan-y' }}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, -0.1, 4.6], fov: 32, near: 0.1, far: 50 }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.35} />
        <hemisphereLight args={['#e8eef5', '#1a1c20', 0.35]} />
        <directionalLight position={[3, 4, 5]} intensity={1.6} />
        <directionalLight position={[-4, 2.5, -4]} intensity={1.3} color="#bfe3ff" />
        <directionalLight position={[0, -3, 2]} intensity={0.25} />
        <StudioEnvironment />

        <Headset signalRef={signalRef} />

        <ContactShadows position={[0, -1.3, 0]} opacity={0.35} scale={5} blur={2.6} far={2.6} resolution={256} frames={1} />

        <OrbitControls
          makeDefault
          target={[0, 0.05, 0]}
          enableZoom={false}
          enablePan={false}
          autoRotate={autoRotate}
          autoRotateSpeed={1.1}
          minPolarAngle={Math.PI / 2.7}
          maxPolarAngle={Math.PI / 1.85}
        />
      </Canvas>
    </div>
  )
}
