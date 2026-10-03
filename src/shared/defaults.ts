import type { SceneCard, Settings, SpeechSettings, StyleGuide, WritingPrefs } from './types'

/**
 * Auto length: the AI picks the length a scene needs, within these limits (words). Most scenes run
 * 1,000 to 3,000 words; 800 keeps a scene from coming back as a fragment, and 4,000 is a long scene
 * that still fits most writer models' reply limit in one go. The briefing keeps room for the longest
 * (max + 40%); a model with less room gets a lower ceiling, never under min. `typical` stands in for
 * Auto wherever a number is needed: cost estimates, and sharing a scene out between its beats.
 */
export const AUTO_LENGTH = { min: 800, max: 4000, typical: 2000 } as const

/** The scene card's length before Auto existed; a card saved with it (and no lengthSet) reads as Auto. */
export const OLD_DEFAULT_LENGTH = 1500

/** The scene card's length: its word count when Adam set one, else null (Auto). */
export function cardLength(card: Pick<SceneCard, 'targetWords' | 'lengthSet'> | null | undefined): number | null {
  if (!card) return null
  const words = Number(card.targetWords)
  if (!Number.isFinite(words) || words <= 0) return null
  const set = card.lengthSet ?? words !== OLD_DEFAULT_LENGTH
  return set ? Math.round(words) : null
}

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
  // Auto until Adam sets a length (lengthSet is left out so older cards keep theirs: see cardLength).
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
  notes: '',
  genres: [],
  genreNotes: '',
  intensity: {}
})

export const defaultWritingPrefs = (): WritingPrefs => ({
  spelling: 'UK',
  pov: 'Close third person',
  tense: 'Past tense',
  voiceNotes: '',
  avoidWords: [],
  avoidAiPhrases: true
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
  models: { writer: null, memory: null, chat: null, builder: null, speech: null, world: null, check: null, recipe: null },
  // No thinking unless Adam asks for it: it slows every job down and can use up the room to answer.
  thinking: { writer: 'off', memory: 'off', chat: 'off', builder: 'off', speech: 'off', world: 'off', check: 'off', recipe: 'off', sounds: 'off', sample: 'off', polish: 'off' },
  creativity: 'balanced',
  theme: 'system',
  editor: { fontSize: 19, lineHeight: 1.7, pageWidth: 70, paragraphStyle: 'spaced', smartPunctuation: true, spellCheck: true, typewriter: false },
  goals: { daily: null, days: [] },
  layout: { binderWidth: 272, inspectorWidth: 340, binderOpen: true, inspectorOpen: true },
  lastWorldId: null,
  lastStoryId: null,
  lastSceneId: null,
  lastPlaces: {},
  backup: { extraFolder: null },
  speech: defaultSpeechSettings(),
  accent: null,
  usage: { monthlyLimit: null, notice: null },
  startWith: 'start',
  worldsSeenAt: {}
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
  soundEffects: false,
  soundVolume: 0.5,
  cacheLimitGb: 5,
  dictationEngine: 'none',
  dictationKey: '',
  microphone: ''
})

/**
 * Sampling settings for each creativity preset. `min_p` (null: not sent) trims the least likely words, so a
 * warmer temperature stays coherent; it is sent only to OpenRouter (other servers may reject fields they
 * don't know), and a model that turns it down is asked again without it (ai/client.ts).
 */
export const CREATIVITY_PRESETS = {
  steady: { label: 'Steady', temperature: 0.6, top_p: 0.9, min_p: null },
  balanced: { label: 'Balanced', temperature: 0.85, top_p: 0.95, min_p: 0.05 },
  adventurous: { label: 'Adventurous', temperature: 1.05, top_p: 1, min_p: 0.05 }
} as const

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return m ? m.length : 0
}
