// The Sounds view's data: the open scene's sounds as the page stands (api.getSceneSounds with the page's paragraphs,
// saved or not), "Find sounds in this scene", and Adam's changes (add, move, describe, remove), each undoable from its
// toast (restoreSoundEdits). Listen waits for a sound being made on purpose and plays it once it is.
import { create } from 'zustand'
import type { ReadParagraph } from '@shared/contracts/readAloud'
import type { CueInput, SceneCue, SceneSounds, SoundEdits } from '@shared/contracts/sounds'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { openScene } from '@/features/memory/openScene'
import { forPlan, hasWords, pageParagraphs } from '@/features/readAloud/pageText'
import { pauseReading, useReading } from '@/features/readAloud/control'
import { stopSample } from '@/features/readAloud/useSample'
import { mixer } from './mixer'
import { noteSceneMuted } from './sceneMute'
import { replanReading } from '@/features/readAloud/control'

interface SoundsState {
  sceneId: ID | null
  /** The scene's sounds; null until they are read. */
  sounds: SceneSounds | null
  /** Why they couldn't be read (the last ones read stay showing). */
  error: string | null
  /** Scenes where "Find sounds in this scene" was pressed and hasn't answered yet. */
  finding: ID[]
  /** Listen was pressed on a sound being made now: it plays once it is made. */
  waiting: string | null
}

export const useSounds = create<SoundsState>(() => ({ sceneId: null, sounds: null, error: null, finding: [], waiting: null }))

/** The page's paragraphs with words, as they stand now, when the page shows this scene. */
export function pageNow(sceneId: ID): ReadParagraph[] | null {
  const bridge = editorBridge()
  const editor = bridge?.editor
  if (!bridge || !editor || editor.isDestroyed || bridge.sceneId !== sceneId) return null
  return pageParagraphs(editor.state.doc).filter(hasWords).map(forPlan)
}

let token = 0

/** Reads the scene's sounds again (the newest answer wins). */
export async function loadSounds(sceneId: ID): Promise<void> {
  const paragraphs = pageNow(sceneId)
  if (!paragraphs) return
  const mine = ++token
  if (useSounds.getState().sceneId !== sceneId) useSounds.setState({ sceneId, sounds: null, error: null })
  try {
    const sounds = await api.getSceneSounds(sceneId, paragraphs)
    noteSceneMuted(sceneId, !!sounds.muted)
    if (mine !== token) return
    useSounds.setState({ sceneId, sounds, error: null })
  } catch (e) {
    if (mine !== token) return
    useSounds.setState({ error: (e as Error).message || 'The sounds couldn’t be read just now.' })
  }
}

/**
 * An answer that carries the scene's sounds: shown, when the view still shows that scene (it is then newer than any
 * read still on its way). Another scene's answer changes nothing here.
 */
function keep(sceneId: ID, sounds: SceneSounds): void {
  noteSceneMuted(sceneId, !!sounds.muted)
  if (useSounds.getState().sceneId !== sceneId) return
  token++
  useSounds.setState({ sounds, error: null })
}

const failed = (e: unknown, words: string): void =>
  void toast((e as Error).message || words, { tone: 'danger' })

/** "Find sounds in this scene": the AI marks the whole scene now (Adam's paragraphs are left as they are). */
export async function findSounds(sceneId: ID): Promise<void> {
  const paragraphs = pageNow(sceneId)
  if (!paragraphs || useSounds.getState().finding.includes(sceneId)) return
  useSounds.setState((s) => ({ finding: [...s.finding, sceneId] }))
  try {
    keep(sceneId, await api.markSceneSounds(sceneId, paragraphs))
  } catch (e) {
    failed(e, 'Sounds couldn’t be found just now. Try again in a moment.')
  } finally {
    useSounds.setState((s) => ({ finding: s.finding.filter((id) => id !== sceneId) }))
  }
}

/**
 * Adds a sound (`cueId` null), changes one, or removes one (`cue` null), and says so in a toast with Undo. False when
 * it couldn't be done (a toast says why).
 */
export async function changeSound(sceneId: ID, cueId: string | null, cue: CueInput | null, done: string): Promise<boolean> {
  const paragraphs = pageNow(sceneId)
  if (!paragraphs) return false
  try {
    const { sounds, undo } = await api.editSoundCue(sceneId, paragraphs, cueId, cue)
    keep(sceneId, sounds)
    toast(done, { action: { label: 'Undo', run: () => void undoChange(sceneId, undo) } })
    return true
  } catch (e) {
    failed(e, 'That change couldn’t be saved. Try again in a moment.')
    return false
  }
}

async function undoChange(sceneId: ID, edits: SoundEdits): Promise<void> {
  try {
    keep(sceneId, await api.restoreSoundEdits(sceneId, edits, pageNow(sceneId) ?? []))
  } catch (e) {
    failed(e, 'That couldn’t be undone. Try again in a moment.')
  }
}

/** A sound as it is, ready to change one part of it. */
export const asInput = (cue: SceneCue): CueInput => ({
  kind: cue.kind,
  description: cue.description,
  at: cue.at,
  until: cue.until ?? null,
  ...(cue.volume != null ? { volume: cue.volume } : {}),
  ...(cue.muted ? { muted: true } : {})
})

/** "Try again" on a sound that couldn't be made. */
export async function makeAgain(cue: SceneCue): Promise<void> {
  if (!cue.soundId) return
  try {
    await api.makeSoundNow(cue.soundId)
    const sceneId = useSounds.getState().sceneId
    if (sceneId) void loadSounds(sceneId)
  } catch (e) {
    failed(e, 'That sound couldn’t be made just now. Try again in a moment.')
  }
}

let listening = false
/** What the sound waited for is: an ambience plays a few seconds, an effect once. */
let waitingKind: SceneCue['kind'] = 'effect'
let waitingVolume: number | undefined

/**
 * Listen: plays the sound on its own at the volume set (and its own, or `volume` while its slider shows); one not made
 * yet is made now and plays once it is.
 */
export async function listenTo(cue: SceneCue, volume = cue.volume): Promise<void> {
  if (!cue.soundId) return
  if (!listening) {
    listening = true
    onEvent('sounds:ready', ({ soundId, ok }) => {
      if (useSounds.getState().waiting !== soundId) return
      useSounds.setState({ waiting: null })
      if (ok) void mixer.listen(soundId, waitingKind, waitingVolume)
      else toast('That sound couldn’t be made. Try again in a moment.')
    })
  }
  // Never over the reading or a voice sample.
  stopSample()
  if (useReading.getState().reading && !useReading.getState().paused) pauseReading()
  useSounds.setState({ waiting: null })
  if (cue.sound === 'ready' && (await mixer.listen(cue.soundId, cue.kind, volume))) return
  waitingKind = cue.kind
  waitingVolume = volume
  useSounds.setState({ waiting: cue.soundId })
  try {
    await api.makeSoundNow(cue.soundId)
  } catch (e) {
    useSounds.setState({ waiting: null })
    failed(e, 'That sound couldn’t be made just now. Try again in a moment.')
  }
}

/** Stops Listen (or stops waiting to). */
export function stopListening(): void {
  useSounds.setState({ waiting: null })
  mixer.stopListening()
}

/** "New take": the sound is made afresh; the row shows it being made, then Keep it or Go back. */
export async function newTake(cue: SceneCue): Promise<void> {
  if (!cue.soundId) return
  stopListening()
  try {
    await api.retakeSound(cue.soundId)
    const sceneId = useSounds.getState().sceneId
    if (sceneId) void loadSounds(sceneId)
  } catch (e) {
    failed(e, 'A new take couldn’t be started just now. Try again in a moment.')
  }
}

/** After a new take: keep it, or go back to the earlier one. */
export async function keepTake(cue: SceneCue, keep: boolean): Promise<void> {
  if (!cue.soundId) return
  stopListening()
  try {
    await api.keepTake(cue.soundId, keep)
    // The sound kept here may be the take let go.
    mixer.forgetSound(cue.soundId)
    const sceneId = useSounds.getState().sceneId
    if (sceneId) void loadSounds(sceneId)
  } catch (e) {
    failed(e, 'That couldn’t be done just now. Try again in a moment.')
  }
}

/**
 * The reading bar's "Mute sounds in this scene" (and back on): heard at once (the ambience fades out), kept with the
 * world, and the reading plans its next lines again.
 */
export async function setSceneMuted(sceneId: ID, muted: boolean): Promise<void> {
  noteSceneMuted(sceneId, muted)
  if (muted) mixer.silence()
  try {
    await api.muteSceneSounds(sceneId, muted)
  } catch (e) {
    noteSceneMuted(sceneId, !muted)
    failed(e, 'That couldn’t be saved just now. Try again in a moment.')
    return
  }
  replanReading()
  if (useSounds.getState().sceneId === sceneId) void loadSounds(sceneId)
}

/** The scene's sounds as last read, for the reading bar's button (its paragraphs as the page has them, when it shows it). */
export async function loadSceneMute(sceneId: ID): Promise<void> {
  try {
    const sounds = await api.getSceneSounds(sceneId, pageNow(sceneId) ?? [])
    noteSceneMuted(sceneId, !!sounds.muted)
  } catch {
    // The button keeps what it knew.
  }
}

/** Shows a scene's Sounds tab beside the page (opening the scene, and the panel, when needed). */
export async function showSounds(sceneId: ID): Promise<void> {
  const app = useApp.getState()
  if (app.sceneId !== sceneId || app.view.kind !== 'write') await openScene(sceneId)
  const a = useApp.getState()
  a.setAskOpen(false)
  a.peekEntry(null)
  a.setInspectorTab('sounds')
  if (a.settings && !a.settings.layout.inspectorOpen) void a.updateSettings({ layout: { inspectorOpen: true } })
}
