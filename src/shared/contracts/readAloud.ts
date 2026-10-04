// Reading aloud (milestone 4, "Read aloud and dictation"): Listen (Ctrl+L) from the cursor, the slim bar
// above the page, sentence highlight and Follow along, Keep reading, the audio cache, voices for the
// narrator and each character, "Say it as", who says each line and how, and calibration (Sample, How to
// read, speed). Owned by the Read aloud part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Character voices and "Say it as" pronunciations are kept in the world's `meta` key `read_aloud`, by
// entry id (no data model change). Speaker and tone marks are a cache per scene in the app's cache folder,
// keyed by paragraph id and a hash of its text; spoken audio too, up to the limit Adam picks. The AI calls
// are 'speech' generation records with the "Read aloud" model (jobModel('speech')).
//
// How a reading works: the window sends the scene's paragraphs (planReading) and gets back its clips, each
// with who says it, how, and what to ask the speech server for; it plays them (speakClip gives each one's
// audio, from the disk cache when heard before), three ahead, and asks again after an edit, when the AI's marks
// come in ('readAloud:marked') and, with Mark who says what, when it reaches `markAhead`, so the AI's notes keep a
// little ahead of it. Speed is the player's (pitch kept); the server speaks at its own pace.
import type { ID } from '../types'

/** One voice the speech server offers: one of Breeze's own, or one of Adam's clips. */
export interface ReadAloudVoice {
  id: string
  name: string
  /** A few words about it from the server ("female · warm, measured"); '' when it says nothing. */
  about: string
  /** One of Adam's own clips (the server lists them; they never leave his computer). */
  clip: boolean
  /** One of the best to try first. */
  recommended: boolean
}

/** How a character sounds when read aloud: described in plain words (made once and kept), or a voice from the list. */
export interface CharacterVoice {
  /** "A woman in her sixties with a low, smoky voice and a slow, amused delivery." */
  design: string
  /** A voice from the list; '' when the voice is made from the description. */
  voice: string
}

/** What the world keeps about one entry for reading aloud (meta `read_aloud`, by entry id). */
export interface EntryReadAloud {
  /** A character's own voice (empty for other kinds). */
  voice: CharacterVoice
  /** How its name is said: a respelling ("shiv-AWN"), or pairs for the words that need one ("Siobhan = shiv-AWN; Nguyen = win"). */
  say: string
}

/** One paragraph of the page, as reading aloud gets it. */
export interface ReadParagraph {
  /** The paragraph's id on the page (`data-pid`). */
  pid: string
  /** Its words as the page shows them; a line break is "\n". */
  text: string
  /** The stretches in italics, [from, to) in `text`. */
  italics?: [number, number][]
}

export interface ReadingRequest {
  sceneId: ID
  /** The paragraphs to read, from the one reading starts in to the end of the scene. */
  paragraphs: ReadParagraph[]
  /** The scene's paragraphs before them: not read, but they say who is talking. */
  before?: ReadParagraph[]
  /** Where reading starts in the first paragraph, in characters. */
  offset?: number
  /** A new reading: its first clip is a single sentence, so the sound starts quickly. */
  quick?: boolean
  /** Every paragraph id the scene has now, so the AI's marks kept for paragraphs it no longer has are let go. */
  pids?: string[]
}

/** What is asked of the speech server for one clip: everything that changes how it sounds. */
export interface ClipRequest {
  /** The words as the voice says them ("Say it as" applied, quote marks and written punctuation taken out). */
  input: string
  /** A voice from the list. */
  voice: string
  /** A voice described in plain words, made once and kept; '' for none. */
  voiceDesign: string
  /** The standing note for the narrator (How to read); '' for none. */
  instruct: string
  /** How this line is said ("sharp and irritated"); '' for none. */
  delivery: string
  pace: '' | 'slow' | 'fast'
  /** Narration read with its note but held close to the narrator's voice (Keep the narrator's voice steady). */
  gentle: boolean
  /** Written sounds are performed (sighs, laughs), not read out. */
  sounds: boolean
}

/** One clip of a reading: where it is on the page, who says it and how, and what to ask the speech server for. */
export interface PlannedClip {
  /** The same words, voice and delivery always give the same key (the window keeps clips by it). */
  key: string
  /** The paragraph it is in, and [from, to) in that paragraph's text: what is highlighted. */
  pid: string
  from: number
  to: number
  /** The sentences inside it, [from, to) each, so the highlight moves sentence by sentence. */
  sentences: [number, number][]
  /** Who the bar says is speaking: "Narrator", a character's name, or "Someone". */
  who: string
  /** How, in a few words ("quiet and wary"); '' when nothing says. */
  how: string
  /** Silence after it, in ms at normal speed (a breath between paragraphs and between voices). */
  restMs: number
  /** The AI is marking who says this or how, and will be done soon: wait a little for 'readAloud:marked' before speaking it. */
  waits: boolean
  clip: ClipRequest
  /**
   * Sound effects (contracts/sounds.ts), when they are on: the ambience playing as this clip starts (a library sound id,
   * or null for none), so stepping back or ahead puts the right one on.
   */
  bed?: string | null
  /** How loud that ambience is (its sound's own volume, 1 when missing). */
  bedVolume?: number
  /** Sound effects: the sounds heard during this clip, in order. */
  sounds?: ClipSound[]
}

/** A sound heard during a clip: an effect firing, or an ambience starting or ending, as the word at `at` is spoken. */
export interface ClipSound {
  cueId: string
  /** The library sound ('' when it hasn't one yet: nothing plays). */
  soundId: string
  edge: 'fire' | 'start' | 'end'
  /** How loud it is (its sound's own volume, 1 when missing). Muted sounds and muted scenes aren't in a plan at all. */
  volume?: number
  /** Where in the clip's paragraph's text, [from, to) of the clip. */
  at: number
}

export interface ReadingPlan {
  clips: PlannedClip[]
  /** The paragraphs the AI is marking now ('readAloud:marked' says when it is done). */
  marking: string[]
  /**
   * Mark who says what: where reading asks for its clips again, so the AI's notes keep a little ahead of it. Reached
   * by a clip in paragraph `pid` that ends past `at` (in its words), or by any clip after that paragraph.
   */
  markAhead?: { pid: string; at: number }
}

/** "Show speakers and tone": the paragraphs of a scene as the page shows them now. */
export interface SpeakerLabelsRequest {
  sceneId: ID
  paragraphs: ReadParagraph[]
  /** Also start the AI marking the paragraphs that have no label yet, in the background ('readAloud:marked' says when). */
  mark?: boolean
}

/** The few words shown faintly above a paragraph: "Mara · sharp, quickly", "Narrator". Never part of the text. */
export interface SpeakerLabel {
  pid: string
  label: string
}

/** What a Sample, Hear or Listen button plays, exactly as reading will sound. */
export type SampleRequest =
  /** Settings › Sample: the sample sentence (as typed now, else the saved one) in the narrator's voice. */
  | { kind: 'narrator'; text?: string }
  /** "Hear this voice": the sample sentence in one voice from the list, on its own. */
  | { kind: 'voice'; voice: string }
  /** A character's Hear: one of their own lines from the story, or the sample sentence, in their voice. */
  | { kind: 'character'; entryId: ID }
  /** "Say it as" › Listen: the entry's name as the voice will say it. */
  | { kind: 'say'; entryId: ID }
  /** The warm-up's "Ready when you are." */
  | { kind: 'ready' }

/** The spoken audio kept on disk. */
export interface AudioCacheStats {
  files: number
  bytes: number
  limitBytes: number
}

export interface ReadAloudApi {
  /** The voices the speech server offers. Plain-words error (code 'speech-not-running') when it isn't running. */
  listReadAloudVoices(): Promise<ReadAloudVoice[]>
  /**
   * The clips for a stretch of a scene: who says each line and how, worked out by the rules and the AI's marks
   * saved so far. Starts the AI marking what the rules can't tell (or, with Mark who says what, the tone and
   * pace a little ahead of the reading) in the background.
   */
  planReading(req: ReadingRequest): Promise<ReadingPlan>
  /** Stops the AI marking a scene for reading (reading stopped). */
  stopReadingMarks(sceneId: ID): Promise<void>
  /**
   * One clip's audio (WAV), from the disk cache when it was heard before. Plain-words errors with codes:
   * 'speech-not-running', 'voices-not-ready' (the voices aren't downloaded or can't load), 'speech-failed'.
   */
  speakClip(clip: ClipRequest): Promise<Uint8Array>
  /** The clips for a Sample, Hear or Listen button. */
  sampleReading(req: SampleRequest): Promise<PlannedClip[]>
  /** Loads the voices so the first Listen is quick (the server says "Ready when you are." to itself). */
  warmUpVoices(): Promise<void>
  /** An entry's read-aloud voice and "Say it as". */
  getEntryReadAloud(entryId: ID): Promise<EntryReadAloud>
  /** Saves an entry's read-aloud voice and "Say it as" (empty ones are removed). Returns what was saved. */
  setEntryReadAloud(entryId: ID, value: EntryReadAloud): Promise<EntryReadAloud>
  /**
   * Suggest: the AI describes a character's voice from their age, looks, background and lines. Streams as
   * 'task:progress' for `taskId` (Stop is stopTask); resolves with the description, which isn't saved.
   */
  suggestCharacterVoice(
    entryId: ID,
    taskId: ID
  ): Promise<{ design: string; status: 'complete' | 'stopped' | 'error'; error: string | null }>
  /**
   * "Show speakers and tone": who says each paragraph and how, for the paragraphs whose marks are in (marked as a
   * draft landed, or by reading aloud). Paragraphs not marked yet, or being marked now, are left out.
   */
  speakerLabels(req: SpeakerLabelsRequest): Promise<SpeakerLabel[]>
  /** How much spoken audio is kept. */
  getReadAloudCache(): Promise<AudioCacheStats>
  /** Deletes the spoken audio kept on disk. */
  clearReadAloudCache(): Promise<AudioCacheStats>
}

export interface ReadAloudEvents {
  /**
   * The AI finished marking some paragraphs of a scene (or gave up: `error`, in plain words): a reading of it
   * asks for its clips again.
   */
  'readAloud:marked': { sceneId: ID; pids: string[]; error: string | null }
}
