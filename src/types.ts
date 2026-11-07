export type Movement = 'BLINK' | 'WINK' | 'JAW_CLENCH' | 'REST' | 'UNKNOWN'
export type InputSource = 'simulation' | 'webcam' | 'eeg'

export interface MovementEvent {
  movement: Movement
  source: InputSource
  timestamp: number
  confidence: number
}

export interface StoryChoice {
  label: string
  next: string
}

export interface StoryBeat {
  chapter: string
  title: string
  text: string
  dialogue?: string
  special?: string
  choices?: StoryChoice[]
  ending?: boolean
}
