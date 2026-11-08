import type { Landmark } from './gaze'

export type HeadPose = { yaw: number; pitch: number }
export type HeadPoint = { x: number; y: number }

const distance = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Landmark, b: Landmark): Landmark => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function estimateHeadPose(points: Landmark[]): HeadPose | null {
  if (points.length <= 362) return null
  const required = [1, 33, 133, 152, 263, 362]
  if (required.some((index) => !Number.isFinite(points[index]?.x) || !Number.isFinite(points[index]?.y))) return null
  const leftEye = midpoint(points[33], points[133])
  const rightEye = midpoint(points[362], points[263])
  const eyeCenter = midpoint(leftEye, rightEye)
  const faceWidth = distance(points[33], points[263])
  const faceHeight = distance(eyeCenter, points[152])
  if (faceWidth < 0.02 || faceHeight < 0.02) return null
  return {
    yaw: (points[1].x - eyeCenter.x) / faceWidth,
    pitch: (points[1].y - eyeCenter.y) / faceHeight,
  }
}

export function averageHeadPose(samples: HeadPose[]): HeadPose | null {
  if (samples.length < 10 || samples.some(({ yaw, pitch }) => !Number.isFinite(yaw) || !Number.isFinite(pitch))) return null
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }
  const yaw = median(samples.map(({ yaw }) => yaw))
  const pitch = median(samples.map(({ pitch }) => pitch))
  const stable = samples.filter((sample) => Math.hypot(sample.yaw - yaw, sample.pitch - pitch) <= 0.035)
  if (stable.length < Math.max(10, Math.ceil(samples.length * 0.6))) return null
  return {
    yaw: median(stable.map(({ yaw }) => yaw)),
    pitch: median(stable.map(({ pitch }) => pitch)),
  }
}

function deadZoned(value: number, deadZone: number): number {
  const magnitude = Math.abs(value)
  if (magnitude <= deadZone) return 0
  return Math.sign(value) * (magnitude - deadZone)
}

export function mapHeadPoseToPoint(
  pose: HeadPose,
  neutral: HeadPose,
  sensitivity = 5,
  deadZone = 0.012,
): HeadPoint {
  const gain = Math.max(1, Math.min(10, sensitivity)) * 2.8
  const horizontal = deadZoned(pose.yaw - neutral.yaw, deadZone)
  const vertical = deadZoned(pose.pitch - neutral.pitch, deadZone)
  return {
    // Landmark yaw is in camera-image coordinates; the cursor uses mirrored screen coordinates.
    x: Math.max(0.06, Math.min(0.94, 0.5 - horizontal * gain)),
    y: Math.max(0.06, Math.min(0.94, 0.5 + vertical * gain)),
  }
}

export function smoothHeadPoint(previous: HeadPoint | null, next: HeadPoint, alpha = 0.24): HeadPoint {
  if (!previous) return next
  const amount = Math.max(0.05, Math.min(1, alpha))
  return {
    x: previous.x + (next.x - previous.x) * amount,
    y: previous.y + (next.y - previous.y) * amount,
  }
}

export function isHeadPoseOutlier(next: HeadPose, previous: HeadPose | null, pending: HeadPose | null): boolean {
  if (!previous) return false
  const jump = Math.hypot(next.yaw - previous.yaw, next.pitch - previous.pitch)
  return jump > 0.12 && (!pending || Math.hypot(next.yaw - pending.yaw, next.pitch - pending.pitch) > 0.06)
}
