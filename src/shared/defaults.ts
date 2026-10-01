import type { SceneCard, Settings, StyleGuide, WritingPrefs } from './types'

export const emptySceneCard = (): SceneCard => ({
  povId: null,
  presentIds: [],
  locationId: null,
  when: '',
  beats: [],
  goal: '',
  conflict: '',
  outcome: '',
  mood: '',
  targetWords: 1500,
  notes: ''
})

export const defaultStyleGuide = (): StyleGuide => ({
  pov: '',
  tense: '',
  proseStyle: '',
  samplePassage: '',
  avoidPhrases: [],
  spelling: '',
  contentLimits: '',
  notes: ''
})

export const defaultWritingPrefs = (): WritingPrefs => ({
  spelling: 'UK',
  pov: 'Close third person',
  tense: 'Past tense',
  voiceNotes: '',
  avoidWords: []
})

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export const defaultSettings = (libraryPath: string): Settings => ({
  libraryPath,
  providers: [],
  models: { writer: null, memory: null, chat: null },
  creativity: 'balanced',
  theme: 'system',
  editor: { fontSize: 19, lineHeight: 1.7, pageWidth: 70 },
  layout: { binderWidth: 272, inspectorWidth: 340, binderOpen: true, inspectorOpen: true },
  lastWorldId: null,
  lastStoryId: null,
  lastSceneId: null,
  backup: { extraFolder: null }
})

/** Sampling settings for each creativity preset. */
export const CREATIVITY_PRESETS = {
  steady: { label: 'Steady', temperature: 0.6, top_p: 0.9 },
  balanced: { label: 'Balanced', temperature: 0.85, top_p: 0.95 },
  adventurous: { label: 'Adventurous', temperature: 1.05, top_p: 1 }
} as const

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return m ? m.length : 0
}
