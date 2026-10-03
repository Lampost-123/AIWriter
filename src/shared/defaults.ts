import type { SceneCard, Settings, SpeechSettings, StyleGuide, WritingPrefs } from './types'

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
  notes: '',
  whenSort: null,
  setsUpIds: [],
  paysOffIds: []
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

/** Where installers for every version are published. */
export const RELEASES_URL = 'https://github.com/lampost-123/aiwriter/releases'

/**
 * Whether the installed app looks for new versions by itself. Installed copies can only read
 * public releases (see "Releases and updates" in docs/ARCHITECTURE.md); while they can't, the app
 * says updates aren't set up and links to GitHub. Off means Adam updates by hand.
 */
export const AUTO_UPDATES = true

export const defaultSettings = (libraryPath: string): Settings => ({
  libraryPath,
  providers: [],
  models: { writer: null, memory: null, chat: null, builder: null, speech: null, world: null, check: null },
  // No thinking unless Adam asks for it: it slows every job down and can use up the room to answer.
  thinking: { writer: 'off', memory: 'off', chat: 'off', builder: 'off', speech: 'off', world: 'off', check: 'off' },
  creativity: 'balanced',
  theme: 'system',
  editor: { fontSize: 19, lineHeight: 1.7, pageWidth: 70 },
  layout: { binderWidth: 272, inspectorWidth: 340, binderOpen: true, inspectorOpen: true },
  lastWorldId: null,
  lastStoryId: null,
  lastSceneId: null,
  lastPlaces: {},
  backup: { extraFolder: null },
  speech: defaultSpeechSettings(),
  accent: null,
  usage: { monthlyLimit: null, notice: null }
})

/** The speech server's own address: port 8766, so it never clashes with MCreader or Poor Man's Holodeck (8765). */
export const SPEECH_SERVER_URL = 'http://127.0.0.1:8766/v1'

/** Read aloud and dictation as they start (spec, "Read aloud and dictation"). */
export const defaultSpeechSettings = (): SpeechSettings => ({
  readAloud: false,
  runServer: false,
  serverUrl: SPEECH_SERVER_URL,
  engine: 'breeze',
  narratorVoice: 'narrator',
  narratorDescription: '',
  dialogueVoice: '',
  sample: 'The rain had not stopped for three days, and the river was beginning to remember its old shape.',
  speed: 1,
  castVoices: true,
  style: 'A seasoned audiobook narrator: warm, unhurried, with natural pauses. Give dialogue life without overacting.',
  steadyNarrator: true,
  markSpeakers: false,
  showSpeakers: false,
  sounds: false,
  keepReading: true,
  followAlong: true,
  cacheLimitGb: 5,
  dictationEngine: 'none',
  dictationKey: '',
  microphone: ''
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
