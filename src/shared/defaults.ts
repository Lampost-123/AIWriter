import type { Creativity, SceneCard, Settings, SpeechSettings, StyleGuide, WritingPrefs } from './types'

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

/**
 * The New look's desk layout is ready for everyone (UI overhaul, step D3.7; Adam, 2026-10-08: "desk is new default").
 * Settings › Appearance shows the Layout choice (Desk / Panels) in the New look, and everyone on the New look who never
 * chose a layout moves to the desk (src/main/settings.ts), with a one-time note offering the panels to anyone who used
 * them. Classic is unchanged. (Before, the desk was reachable only in try-out builds, AIWRITE_DESK_READY=1, and app
 * tests, AIWRITE_ARRANGEMENT=desk.)
 */
export const DESK_READY = true

export const defaultSettings = (libraryPath: string): Settings => ({
  libraryPath,
  providers: [],
  models: { writer: null, memory: null, chat: null, builder: null, speech: null, world: null, check: null, recipe: null },
  // No thinking unless Adam asks for it: it slows every job down and can use up the room to answer.
  thinking: { writer: 'off', memory: 'off', chat: 'off', builder: 'off', speech: 'off', world: 'off', check: 'off', recipe: 'off', sounds: 'off', sample: 'off', polish: 'off' },
  creativity: 'balanced',
  planFirst: true,
  // Dark, the desk's "Night harbour", for a new install or anyone who never chose a theme (Adam, 2026-10-08: "desk is new
  // default in dark mode"). A theme Adam picked (Light, Sepia, Dark or Match the system) is kept in his settings.
  theme: 'dark',
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
  tourSeen: false,
  worldsSeenAt: {},
  look: 'new',
  lookNote: false,
  // The desk (DESK_READY); src/main/settings.ts moves New-look users who never chose a layout to it, with a note.
  arrangement: 'desk',
  arrangementNote: false,
  checkNewWords: true,
  findByMeaning: true,
  searchModelAuto: true
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
  studioVoices: true,
  actFeelings: true,
  checkWords: false,
  style: 'A seasoned audiobook narrator: warm, unhurried, with natural pauses. Give dialogue life without overacting.',
  steadyNarrator: true,
  voicedLines: true,
  skipSpeechTags: true,
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

/**
 * The writer's temperature (Generate, Add below, beats, Continue) for a preset. Balanced, the default, writes at 1.0
 * rather than 0.85 (the writer lab, 2026-10-08, on DeepSeek Flash: fewer stock phrases and echoes, canon and the
 * judge's marks the same; 1.3 and 1.5 fell apart). The edit tools and the other presets keep their own.
 */
export const WRITER_BALANCED_TEMPERATURE = 1.0
export const writerTemperature = (c: Creativity | undefined): number =>
  c === 'steady' || c === 'adventurous' ? CREATIVITY_PRESETS[c].temperature : WRITER_BALANCED_TEMPERATURE

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return m ? m.length : 0
}
