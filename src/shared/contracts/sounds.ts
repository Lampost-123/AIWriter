// AI sound effects under Read aloud (spec, "AI sound effects"): optional and off by default, with a download of its
// own. While a scene is read aloud, the AI marks the sounds of each part just ahead of the voice (job 'speech' records
// with `params.sounds`, the Read aloud model, the Thinking set for sound effects). A one-off effect fires on the word
// that describes it; ambience plays over its stretch, looping. The sounds are made on this computer by the speech server
// (Stable Audio Open, best of a few takes as CLAP ranks them) and kept in one app-wide sound library in the app's data
// folder (never in a world), so a sound is never made twice. The Sounds view shows a scene's sounds, and Adam can change,
// remove or add them there; a paragraph whose sounds he changed is his, and the AI never marks it again.
//
// Where things are kept:
//  - The library: `<userData>/sounds/` (library.json and the clips). It survives the Read aloud cache's Clear; only
//    clearSoundLibrary empties it.
//  - The AI's marks: a cache per scene in `<userData>/speech-cache/sounds/<world>/<scene>.json`, each paragraph's with
//    the hash of its words (dropped when they change, like the speaker marks).
//  - Adam's sounds: the world's meta key `sounds` (SoundEdits by scene id), so they travel with the world.
//  - When an anchor word is heard in a spoken clip: beside the clip in the Read aloud audio cache (its word times).
import type { ID } from '../types'
import type { ClipRequest, ReadParagraph } from './readAloud'

export type SoundKind = 'effect' | 'ambience'

/** A place in a paragraph's words: [from, to) in its text, and the words there (to find them again after an edit). */
export interface CueAnchor {
  pid: string
  from: number
  to: number
  words: string
}

/**
 * One sound placed in a scene. An effect fires as `at` is spoken. Ambience starts as `at` is spoken and plays until
 * `until` is spoken, another ambience starts, or the scene ends (`until` null). One ambience plays at a time.
 */
export interface SoundCue {
  /** 'ai:<hash>' for the AI's (stable while its paragraph's words are the same); Adam's are made by the app. */
  id: string
  kind: SoundKind
  /** What it sounds like, in plain words ("a heavy wooden door slamming shut"). */
  description: string
  /** The library sound it plays ('' until there is one). */
  soundId: string
  at: CueAnchor
  until?: CueAnchor | null
  origin: 'ai' | 'adam'
  /** How loud this sound is beside the others, 0.25 to 2 (1, or missing: as made). Adam's to set. */
  volume?: number
  /** Adam muted this sound: it stays in the list but doesn't play. */
  muted?: boolean
}

/** A cue as the Sounds view shows it: where it is now, and whether its sound can play yet. */
export interface SceneCue extends SoundCue {
  /** Its words were found where they are now (false: they changed, and it plays at the nearest place). */
  placed: boolean
  /** The library sound: 'ready' plays; 'waiting' and 'making' are being made; 'failed' couldn't be made. */
  sound: 'ready' | 'waiting' | 'making' | 'failed'
  /**
   * A new take of its sound: 'making' while it is made; 'ready' once made and playing, with the earlier take kept so
   * Adam can keep the new one or go back (keepTake); null otherwise. A take is the library sound's, so every scene
   * using it hears the new one.
   */
  retake: 'making' | 'ready' | null
}

/** A scene's sounds in reading order, for the Sounds view and the page's marks. */
export interface SceneSounds {
  sceneId: ID
  cues: SceneCue[]
  /** Paragraphs the AI is marking now. */
  marking: string[]
  /** Paragraphs whose sounds are Adam's: the AI leaves them alone. */
  owned: string[]
  /** Adam muted the sounds of this scene (the reading bar's button): none play in it. */
  muted: boolean
}

/** Adam's sounds in one scene (world meta `sounds`, by scene id). A paragraph listed is his, even with no cues. */
export interface SoundEdits {
  owned: Record<string, SoundCue[]>
  /** The scene's sounds are muted (the reading bar's button). */
  muted?: boolean
}

/** One sound in the app-wide library. */
export interface LibrarySound {
  id: string
  description: string
  kind: SoundKind
  /** Its length in seconds; 0 until it is made. */
  seconds: number
  state: 'ready' | 'waiting' | 'making' | 'failed'
  bytes: number
}

/** What Settings shows about sound effects. */
export interface SoundsStatus {
  /** The sound model is downloaded (SpeechStatus.installed.sounds) and the speech server can make sounds now. */
  ready: boolean
  /** How many sounds the library holds, and their size on disk. */
  library: { count: number; bytes: number }
  /** The sound being made now, in plain words; null when none is. */
  making: string | null
  /** Sounds waiting to be made. */
  waiting: number
}

/** A sound Adam adds or changes in the Sounds view. */
export interface CueInput {
  kind: SoundKind
  description: string
  at: CueAnchor
  until?: CueAnchor | null
  volume?: number
  muted?: boolean
}

/** What the window asks to time a clip's sounds: the clip, and where its sounds are in its paragraph's words. */
export interface CueTimesRequest {
  clip: ClipRequest
  /** The paragraph's words the clip reads: [from, to) of `text`. */
  text: string
  from: number
  to: number
  /** Where each sound is, in `text`. */
  at: number[]
}

export interface SoundsApi {
  /** Sound effects in Settings: whether sounds can be made now, and the library's size. */
  getSoundsStatus(): Promise<SoundsStatus>
  /** A scene's sounds as the page stands (the window sends its paragraphs, saved or not). */
  getSceneSounds(sceneId: ID, paragraphs: ReadParagraph[]): Promise<SceneSounds>
  /** "Find sounds": the AI marks the sounds of the whole scene now (paragraphs that are Adam's are left alone). */
  markSceneSounds(sceneId: ID, paragraphs: ReadParagraph[]): Promise<SceneSounds>
  /**
   * Adds a sound (`cueId` null) or changes one, or removes one (`cue` null). The paragraph it starts in becomes Adam's:
   * the AI's sounds there are kept as his, and the AI never marks it again. Returns the scene's sounds and, for Undo,
   * the scene's edits as they were (restoreSoundEdits puts them back).
   */
  editSoundCue(
    sceneId: ID,
    paragraphs: ReadParagraph[],
    cueId: string | null,
    cue: CueInput | null
  ): Promise<{ sounds: SceneSounds; undo: SoundEdits }>
  /** Undo: a scene's edits as they were before. */
  restoreSoundEdits(sceneId: ID, edits: SoundEdits, paragraphs: ReadParagraph[]): Promise<SceneSounds>
  /** A library sound's audio (WAV), or null when it isn't made yet. */
  soundAudio(soundId: string): Promise<Uint8Array | null>
  /** Plays nothing: makes a sound for the Sounds view's Listen now, if it isn't made yet (it is then 'waiting' first). */
  makeSoundNow(soundId: string): Promise<void>
  /**
   * When each of a clip's sounds is heard, in seconds from the clip's start: from where the speech server's dictation
   * engine heard the words (kept beside the clip), else an estimate by the words' place in the clip.
   */
  soundCueTimes(req: CueTimesRequest): Promise<{ seconds: number[]; aligned: boolean }>
  /** The sound library in Settings. */
  listSoundLibrary(): Promise<LibrarySound[]>
  /** Empties the sound library (kept aside for Undo for a couple of minutes). */
  clearSoundLibrary(): Promise<SoundsStatus>
  /** Undo for clearSoundLibrary. */
  undoClearSoundLibrary(): Promise<SoundsStatus>
  /** "New take": makes the sound afresh (first in the queue); once made it plays, and the earlier take is kept aside. */
  retakeSound(soundId: string): Promise<void>
  /** After a new take: keep it (the earlier one is let go) or go back to the earlier one (`keep` false). */
  keepTake(soundId: string, keep: boolean): Promise<void>
  /** The reading bar's "Mute sounds in this scene" (and back on). Kept with the world, like Adam's other sound edits. */
  muteSceneSounds(sceneId: ID, muted: boolean): Promise<void>
}

export interface SoundsEvents {
  /** A scene's sounds changed: the AI marked some of it (`pids`), or Adam edited them. A reading of it plans again. */
  'sounds:marked': { sceneId: ID; pids: string[] }
  /** A library sound was made (or couldn't be): a reading that wants it fetches it. */
  'sounds:ready': { soundId: string; ok: boolean }
  /** Settings' sound effects line changed (one being made, the library's size). */
  'sounds:status': SoundsStatus
}
