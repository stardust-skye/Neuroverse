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

export interface WorkloadAdaptation {
  difficulty_level: number
  difficulty: 'supportive' | 'balanced' | 'challenging'
  last_adaptation: string
  hint_available: boolean
  time_pressure: 'unchanged' | 'reduced'
  accepted_class: 'low' | 'moderate' | 'high' | null
  consistent_predictions: number
}

export interface WorkloadPrediction {
  window_start: string
  workload_class: 'low' | 'moderate' | 'high'
  model_score: number
  probabilities: Record<'low' | 'moderate' | 'high', number>
  adaptation: WorkloadAdaptation
}

export const initialWorkloadAdaptation: WorkloadAdaptation = {
  difficulty_level: 1,
  difficulty: 'balanced',
  last_adaptation: 'Waiting for a recorded EEG demo',
  hint_available: false,
  time_pressure: 'unchanged',
  accepted_class: null,
  consistent_predictions: 0,
}
