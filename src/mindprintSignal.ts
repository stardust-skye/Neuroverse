export type MindprintMeta = { name: string; srate: number; channels: string[]; eegIndices: number[] }
export type MindprintFeatures = { texture: number; variation: number; balance: number; amplitudes: number[] }
export type MindprintBaseline = { amplitudes: number[]; texture: number }
export type MindprintVisuals = { activity: number; hue: number; ripple: number; texture: number; balance: number }

export function parseMindprintMeta(value: unknown): MindprintMeta | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (data.type !== 'meta' || typeof data.name !== 'string' || !data.name.trim()
    || data.name.toUpperCase() === 'SIMULATED' || data.name === 'none'
    || typeof data.srate !== 'number' || !Number.isFinite(data.srate)
    || data.srate < 50 || data.srate > 2000 || !Array.isArray(data.channels)
    || data.channels.length < 1 || data.channels.length > 128
    || !data.channels.every((label: unknown) => typeof label === 'string' && label.length > 0)
    || !Array.isArray(data.channel_types) || data.channel_types.length !== data.channels.length
    || !data.channel_types.every((type: unknown) => typeof type === 'string')) return null
  const eegIndices = data.channel_types.flatMap((type: string, index: number) =>
    ['eeg', 'referential'].includes(type.trim().toLowerCase()) ? [index] : [])
  if (!eegIndices.length) return null
  return { name: data.name, srate: data.srate, channels: data.channels, eegIndices }
}

export function parseMindprintSamples(value: unknown, channelCount: number): number[][] | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (data.type !== 'samples' || typeof data.t0 !== 'number' || !Number.isFinite(data.t0)
    || !Array.isArray(data.data) || data.data.length < 1 || data.data.length > 4096
    || !data.data.every((row: unknown) => Array.isArray(row) && row.length === channelCount
      && row.every((sample: unknown) => typeof sample === 'number' && Number.isFinite(sample)))) return null
  return data.data
}

export function selectEegSamples(rows: number[][], eegIndices: number[]): number[][] {
  return rows.map((row) => eegIndices.map((index) => row[index]))
}

export function mindprintFeatures(rows: number[][], channels: number): MindprintFeatures | null {
  if (rows.length < 50 || channels < 1) return null
  let texture = 0
  let variation = 0
  let balance = 0
  let active = 0
  const amplitudes: number[] = []
  for (let c = 0; c < channels; c++) {
    let mean = 0
    for (const row of rows) mean += row[c]
    mean /= rows.length
    let energy = 0
    let difference = 0
    for (let i = 0; i < rows.length; i++) {
      energy += (rows[i][c] - mean) ** 2
      if (i) difference += (rows[i][c] - rows[i - 1][c]) ** 2
    }
    if (!Number.isFinite(energy) || !Number.isFinite(difference) || energy <= 1e-20) {
      amplitudes.push(0)
      continue
    }
    amplitudes.push(Math.sqrt(energy / rows.length))
    const change = Math.min(1, Math.sqrt(difference / energy) / 2)
    texture += change
    variation += change * change
    balance += change * (channels === 1 ? 0.5 : c / (channels - 1))
    active++
  }
  if (!active) return null
  return { texture: texture / active, variation: Math.sqrt(variation / active), balance: balance / active, amplitudes }
}

export function createMindprintBaseline(features: MindprintFeatures): MindprintBaseline {
  return { amplitudes: [...features.amplitudes], texture: features.texture }
}

export function mindprintVisuals(features: MindprintFeatures, baseline: MindprintBaseline): MindprintVisuals {
  const changes = features.amplitudes.flatMap((amplitude, index) => {
    const reference = baseline.amplitudes[index]
    return amplitude > 0 && reference > 0 ? [Math.log2(amplitude / reference)] : []
  }).sort((a, b) => a - b)
  const change = changes.length ? changes[Math.min(changes.length - 1, Math.floor(changes.length * 0.9))] : 0
  const activity = Math.max(0, Math.min(1, 0.35 + change * 0.32))
  const textureChange = Math.max(-1, Math.min(1,
    Math.log2(Math.max(features.texture, 1e-8) / Math.max(baseline.texture, 1e-8))))
  return {
    activity,
    hue: 185 + activity * 180 + textureChange * 30,
    ripple: 0.08 + activity * 0.4,
    texture: Math.max(0, Math.min(1, 0.5 + textureChange * 0.5)),
    balance: features.balance,
  }
}
