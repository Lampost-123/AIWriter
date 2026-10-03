// AI sound effects under Read aloud, in the main process (src/shared/contracts/sounds.ts): optional and off by default
// (`speech.soundEffects`), with a download of its own (the sound model). As a scene is read aloud, the AI marks the
// sounds of each part a little ahead of the voice (marks.ts, beside Read aloud's speaker marks), the sounds are made
// on this computer in the background, nearest the reading first (making.ts), and kept in one app-wide library
// (library.ts). Each clip of the reading carries its sounds and the ambience playing as it starts (scene.ts); the
// window plays them, at the clip's start plus when the anchor word is heard (align.ts). Adam's own changes in the
// Sounds view are kept in the world (edits.ts) and never overwritten. Sounds never hold a reading up: one that isn't
// made in time doesn't play, and marking failures are only logged.
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { ReadingPlan, ReadParagraph } from '@shared/contracts/readAloud'
import type { SceneCue, SceneSounds, SoundEdits, SoundsStatus, LibrarySound, CueInput } from '@shared/contracts/sounds'
import { defaultSpeechSettings } from '@shared/defaults'
import type { ID, SpeechSettings } from '@shared/types'
import * as repo from '../db/repo'
import { emit } from '../events'
import { userDataDir } from '../paths'
import { getSettings } from '../settings'
import * as world from '../world'
import { newId, UserError } from '../util'
import * as providers from '../ai/providers'
import { jobModel, type JobModel } from '../ai/jobModel'
import { runTask, stopTask } from '../ai/tasks'
import { soundsInstalled, soundsServerState, type SoundsServerState } from '../speech'
import { speechFetch } from '../speech/client'
import type { Ask } from '../readAloud/marks'
import { paragraphsOfDoc } from '../readAloud/suggest'
import { CueTimer, type ClipStore } from './align'
import { cleanEdits, cueInputOf, editCue, saveSceneEdits, sceneEdits } from './edits'
import { SOUND_ID, SoundLibrary, type LibraryEntry } from './library'
import { generateSound, SoundMaker } from './making'
import { SoundMarker, SoundStore, type SoundScene } from './marks'
import { clipSounds, sceneCues, soundsAhead, type Paragraph, type SoundOf } from './scene'

type DB = Database.Database

const speech = (): SpeechSettings => ({ ...defaultSpeechSettings(), ...getSettings().speech })

// ---------- Where things are kept ----------

let lib: SoundLibrary | null = null
/** The app-wide sound library: `<userData>/sounds/`. */
export function library(): SoundLibrary {
  if (!lib) {
    lib = new SoundLibrary(join(userDataDir(), 'sounds'))
    lib.sweep()
  }
  return lib
}

let marksStore: SoundStore | null = null
/** The AI's sound marks, beside Read aloud's other caches: `<userData>/speech-cache/sounds/`. */
const store = (): SoundStore => (marksStore ??= new SoundStore(join(userDataDir(), 'speech-cache', 'sounds')))

// ---------- Whether sounds can be made ----------

/**
 * The sound model is downloaded, and what the speech server last said about sounds (its 10-second health check):
 * whether it can make them now, beside the voices, and time words. Null while it isn't answering.
 */
const server = (): SoundsServerState | null => soundsServerState()

/** Sound effects are on and their model is downloaded. */
function soundsOn(): boolean {
  return speech().soundEffects && soundsInstalled()
}

// ---------- Making sounds ----------

let maker: SoundMaker | null = null
function theMaker(): SoundMaker {
  if (maker) return maker
  const l = library()
  maker = new SoundMaker({
    library: l,
    enabled: () => speech().soundEffects,
    ready: async () => soundsInstalled() && !!server()?.ready,
    beside: async () => !!server()?.beside,
    generate: (req) => generateSound(speechFetch, req, () => server() !== null),
    made: (soundId, ok) => emit('sounds:ready', { soundId, ok }),
    retook: () => tellShown(),
    changed: () => statusSoon()
  })
  // Sounds wanted before the app last closed are still wanted.
  maker.background(
    l
      .list()
      .filter((e) => e.state === 'waiting' || e.retake === 'making')
      .sort((a, b) => a.asked - b.asked)
      .map((e) => e.id)
  )
  return maker
}

/** Sounds wanted some time: made in the background, but only while sound effects are on (the queue isn't even started otherwise). */
function wantMade(ids: string[]): void {
  if (ids.length && speech().soundEffects) theMaker().background(ids)
}

function status(): SoundsStatus {
  const m = maker?.status() ?? { making: null, waiting: 0 }
  return {
    ready: soundsInstalled() && !!server()?.ready,
    library: library().stats(),
    making: m.making ? (library().get(m.making)?.description ?? null) : null,
    waiting: m.waiting
  }
}

let statusTimer: ReturnType<typeof setTimeout> | null = null
/** Tells Settings, at most a few times a second. */
function statusSoon(): void {
  if (statusTimer) return
  statusTimer = setTimeout(() => {
    statusTimer = null
    emit('sounds:status', status())
  }, 250)
  ;(statusTimer as { unref?: () => void }).unref?.()
}

// ---------- Marking ----------

/** A way to ask the Read aloud model, with the Thinking set for sound effects, as 'speech' records marked as sounds. */
function askFor(sceneId: ID): { call: Ask; stop: () => void } | { error: string } {
  const open = world.maybeCurrentWorld()
  if (!open) return { error: 'No world is open.' }
  let m: JobModel
  try {
    const settings = getSettings()
    m = {
      ...jobModel('speech', { settings, getProvider: providers.getProvider, providerTarget: providers.providerTarget }),
      thinking: settings.thinking?.sounds ?? 'off'
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  const running = new Set<ID>()
  return {
    call: async ({ system, user, reply, temperature }) => {
      const taskId = newId()
      running.add(taskId)
      try {
        const done = await runTask({
          db: open.db,
          taskId,
          job: 'speech',
          sceneId,
          model: m,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          reply,
          temperature,
          extra: { sounds: true },
          emit,
          onKeyRejected: () => providers.markCheck(m.target.id, false)
        })
        return done.status === 'complete' ? { text: done.text, error: null } : { text: null, error: done.status === 'error' ? done.error : null }
      } catch (e) {
        return { text: null, error: e instanceof UserError ? e.message : 'Something went wrong asking the AI.' }
      } finally {
        running.delete(taskId)
      }
    },
    stop: () => {
      for (const id of running) void stopTask(id).catch(() => undefined)
    }
  }
}

/** A scene's sounds as they stand: the AI's for paragraphs whose words haven't changed, Adam's for his. */
function cuesNow(worldId: ID, sceneId: ID, paragraphs: readonly Paragraph[], edits: SoundEdits, want: boolean): SceneCue[] {
  const l = library()
  const asked = new Map<string, number | undefined>()
  const cues = sceneCues({
    paragraphs,
    ai: store().current(worldId, sceneId, paragraphs),
    edits,
    sound: (kind, description, seconds) => {
      asked.set(`${kind}\n${description}`, seconds)
      const e = l.find(kind, description)
      return e ? soundOf(e) : null
    }
  })
  // Wanted in the library (so they are made): only sounds that play, in a scene that isn't muted.
  if (!want || edits.muted) return cues
  return cues.map((c) => {
    if (c.soundId || c.muted) return c
    const e = l.want(c.kind, c.description, asked.get(`${c.kind}\n${c.description}`))
    return e ? { ...c, ...cueSound(e) } : c
  })
}

/** A library sound as a cue sees it. */
const soundOf = (e: LibraryEntry): SoundOf => ({ id: e.id, state: e.state, retake: e.retake ?? null })
const cueSound = (e: LibraryEntry): Pick<SceneCue, 'soundId' | 'sound' | 'retake'> => ({ soundId: e.id, sound: e.state, retake: e.retake ?? null })

/** Scenes whose sounds were looked at lately (the Sounds view, a reading): told when a sound's take changes. */
const shown = new Map<ID, number>()
const SHOWN_MS = 30 * 60_000
function showing(sceneId: ID): void {
  shown.set(sceneId, Date.now())
}
/** A library sound changed (a new take, or going back): the scenes on screen look again, and readings plan again. */
function tellShown(): void {
  for (const [sceneId, at] of [...shown]) {
    if (Date.now() - at > SHOWN_MS) shown.delete(sceneId)
    else emit('sounds:marked', { sceneId, pids: [] })
  }
}

let marker: SoundMarker | null = null
const theMarker = (): SoundMarker =>
  (marker ??= new SoundMarker({
    store: store(),
    ask: askFor,
    library: (text) => library().relevant(text, 60).map((e) => ({ kind: e.kind, description: e.description })),
    cuesOf: (s) => {
      const w = world.maybeCurrentWorld()
      return w && w.id === s.worldId ? cuesNow(s.worldId, s.sceneId, s.paragraphs, sceneEdits(w.db, s.sceneId), false) : []
    },
    done: (sceneId, pids) => emit('sounds:marked', { sceneId, pids }),
    found: (s, cues) => {
      // A muted scene's sounds are marked (so they are there when it is unmuted) but not made.
      const w = world.maybeCurrentWorld()
      if (!w || w.id !== s.worldId || sceneEdits(w.db, s.sceneId).muted) return
      const l = library()
      wantMade(cues.flatMap((c) => l.want(c.kind, c.description, c.seconds)?.id ?? []))
    }
  }))

/**
 * The scene's paragraphs in order, as well as they are known: the ones the window sent, and the others (`pids`: every
 * paragraph the scene has, in order) from the scene as last saved, so what plays as reading starts is worked out from
 * the start of the scene.
 */
function wholeScene(db: DB, sceneId: ID, given: readonly ReadParagraph[], pids?: ReadonlySet<string>): Paragraph[] {
  const sent = new Map(given.map((p) => [p.pid, p.text]))
  if (!pids || given.some((p) => !pids.has(p.pid))) return given.map((p) => ({ pid: p.pid, text: p.text }))
  let saved = new Map<string, string>()
  if ([...pids].some((pid) => !sent.has(pid))) {
    try {
      saved = new Map(paragraphsOfDoc(repo.getScene(db, sceneId).doc).map((p) => [p.pid, p.text]))
    } catch {
      /* the scene has gone: what was sent is all there is */
    }
  }
  return [...pids].flatMap((pid) => {
    const text = sent.get(pid) ?? saved.get(pid)
    return text === undefined ? [] : [{ pid, text }]
  })
}

/** Which of two places a reading reaches first (`order`: the run's paragraphs in order). */
function earlier(order: string[], a?: { pid: string; at: number }, b?: { pid: string; at: number }): { pid: string; at: number } | undefined {
  if (!a || !b) return a ?? b
  const i = order.indexOf(a.pid)
  const j = order.indexOf(b.pid)
  return i < j || (i === j && a.at <= b.at) ? a : b
}

/**
 * Read aloud planned a stretch of a scene (readAloud/index.ts planReading): with sound effects on and their model
 * downloaded, the AI marks the sounds a little ahead of the reading, the sounds are wanted nearest first, and
 * `finish` puts each clip's sounds and ambience on the plan (and asks the reading to plan again where sounds need
 * marking next). Null when sounds are off. Never throws.
 */
export function soundsForReading(o: {
  worldId: ID
  db: DB
  sceneId: ID
  before: readonly ReadParagraph[]
  paragraphs: readonly ReadParagraph[]
  offset: number
  pids?: ReadonlySet<string>
}): { finish(plan: ReadingPlan): ReadingPlan } | null {
  if (!soundsOn()) return null
  try {
    const scene = wholeScene(o.db, o.sceneId, [...o.before, ...o.paragraphs], o.pids)
    const edits = sceneEdits(o.db, o.sceneId)
    const run = o.paragraphs.map((p) => p.pid)
    const s: SoundScene = {
      worldId: o.worldId,
      sceneId: o.sceneId,
      paragraphs: scene,
      run,
      offset: o.offset,
      owned: new Set(Object.keys(edits.owned)),
      ...(o.pids ? { pids: o.pids } : {})
    }
    showing(o.sceneId)
    // Marked even when the scene is muted, so its sounds are there when it is unmuted.
    const { again } = theMarker().note(s)
    const cues = cuesNow(o.worldId, o.sceneId, scene, edits, true)
    const m = theMaker()
    m.playing()
    if (run.length && !edits.muted) {
      const ahead = soundsAhead(cues, scene, run[0]!, o.offset)
      m.forReading(`${o.worldId}:${o.sceneId}`, [...new Set(ahead.map((c) => c.soundId).filter(Boolean))])
    }
    return {
      finish: (plan) => {
        const markAhead = earlier(run, plan.markAhead, again)
        return { ...plan, clips: clipSounds(plan.clips, cues, scene, { muted: !!edits.muted }), ...(markAhead ? { markAhead } : {}) }
      }
    }
  } catch (e) {
    console.warn('[sounds] the sounds of a reading could not be worked out', e)
    return null
  }
}

/** A draft landed (readAloud/index.ts markInBackground): its new paragraphs' sounds are marked quietly too. Never throws. */
export function soundsInBackground(worldId: ID, db: DB, sceneId: ID, paragraphs: readonly Paragraph[], pids: readonly string[]): void {
  if (!soundsOn()) return
  try {
    const edits = sceneEdits(db, sceneId)
    theMarker().noteAll(
      { worldId, sceneId, paragraphs: [...paragraphs], run: [], owned: new Set(Object.keys(edits.owned)), pids: new Set(paragraphs.map((p) => p.pid)) },
      new Set(pids)
    )
  } catch (e) {
    console.warn('[sounds] the sounds of a new draft were not marked', e)
  }
}

/** A reading stopped: its sound marking stops, and sounds can be made beside nothing. */
export function stopSoundMarks(worldId: ID, sceneId: ID): void {
  marker?.stop(worldId, sceneId)
  maker?.stopped()
}

/** The world closed: its marking is forgotten; the library goes on making what was wanted (it is the app's). */
export function soundsWorldClosing(): void {
  marker?.forgetAll()
  maker?.dropReadings()
  shown.clear()
}

// ---------- The Sounds view and Settings ----------

/** A paragraph from the window, checked and cut to size. */
export function paragraphsOf(v: unknown): Paragraph[] {
  if (!Array.isArray(v)) return []
  return v
    .slice(0, 5000)
    .map((p: unknown) => {
      const o = (p ?? {}) as { pid?: unknown; text?: unknown }
      return { pid: typeof o.pid === 'string' ? o.pid.slice(0, 40) : '', text: typeof o.text === 'string' ? o.text.slice(0, 20_000) : '' }
    })
    .filter((p) => p.pid)
}

const checkScene = (sceneId: unknown): ID => {
  if (typeof sceneId !== 'string' || !sceneId || sceneId.length > 80) throw new UserError('That scene could not be found.')
  return sceneId
}

export function getSoundsStatus(): SoundsStatus {
  // Turned on (Settings asks as it shows the line): sounds wanted before are made now.
  if (speech().soundEffects) theMaker().kick()
  return status()
}

export function getSceneSounds(sceneId: ID, given: unknown): SceneSounds {
  const w = world.currentWorld()
  const id = checkScene(sceneId)
  const paragraphs = paragraphsOf(given)
  const edits = sceneEdits(w.db, id)
  const cues = cuesNow(w.id, id, paragraphs, edits, true)
  showing(id)
  // Shown: the sounds that play are made in the background (while sound effects are on and the scene isn't muted).
  if (!edits.muted) wantMade([...new Set(cues.filter((c) => !c.muted).map((c) => c.soundId).filter(Boolean))])
  const here = new Set(paragraphs.map((p) => p.pid))
  return {
    sceneId: id,
    cues,
    marking: [...(marker?.busyIn(w.id, id) ?? [])].filter((pid) => here.has(pid)),
    owned: Object.keys(edits.owned).filter((pid) => here.has(pid)),
    muted: !!edits.muted
  }
}

/** Find sounds: the AI marks the whole scene now (Adam's paragraphs aside). */
export function markSceneSounds(sceneId: ID, given: unknown): SceneSounds {
  const w = world.currentWorld()
  const id = checkScene(sceneId)
  const paragraphs = paragraphsOf(given)
  // Find sounds asks the AI only when the sounds it finds can be made.
  if (!speech().soundEffects) throw new UserError('Turn on sound effects first, in Settings › Read aloud and dictation.')
  if (!soundsInstalled()) throw new UserError('Download the sound effects first, in Settings › Read aloud and dictation.')
  const edits = sceneEdits(w.db, id)
  const m = theMarker()
  m.forgive(w.id, id)
  const pids = new Set(paragraphs.map((p) => p.pid))
  const { error } = m.noteAll({ worldId: w.id, sceneId: id, paragraphs, run: [], owned: new Set(Object.keys(edits.owned)), pids }, pids)
  if (error) throw new UserError(error)
  return getSceneSounds(id, paragraphs)
}

export function editSoundCue(sceneId: ID, given: unknown, cueId: unknown, cue: unknown): { sounds: SceneSounds; undo: SoundEdits } {
  const w = world.currentWorld()
  const id = checkScene(sceneId)
  const paragraphs = paragraphsOf(given)
  if (cueId !== null && (typeof cueId !== 'string' || !cueId || cueId.length > 80)) throw new UserError("That sound isn't there any more. Try again.")
  if (cueId === null && cue === null) throw new UserError('Nothing to change.')
  const before = sceneEdits(w.db, id)
  const input: CueInput | null = cue === null ? null : cueInputOf(cue, paragraphs)
  const next = editCue({ edits: before, cues: cuesNow(w.id, id, paragraphs, before, false), cueId, cue: input, newId })
  saveSceneEdits(w.db, id, next)
  // Its sound is wanted (and made, unless it or the scene is muted) as the scene's sounds are worked out below.
  emit('sounds:marked', { sceneId: id, pids: changedPids(before, next) })
  return { sounds: getSceneSounds(id, paragraphs), undo: before }
}

export function restoreSoundEdits(sceneId: ID, edits: unknown, given: unknown): SceneSounds {
  const w = world.currentWorld()
  const id = checkScene(sceneId)
  const before = sceneEdits(w.db, id)
  // Undo puts the sounds back as they were; the scene's mute has its own button, so it stays as it is now.
  const { muted: _wasMuted, ...owned } = cleanEdits(edits)
  const next: SoundEdits = { ...owned, ...(before.muted ? { muted: true } : {}) }
  saveSceneEdits(w.db, id, next)
  emit('sounds:marked', { sceneId: id, pids: changedPids(before, next) })
  return getSceneSounds(id, given)
}

/** The paragraphs whose sounds differ between two sets of edits. */
function changedPids(a: SoundEdits, b: SoundEdits): string[] {
  const pids = new Set([...Object.keys(a.owned), ...Object.keys(b.owned)])
  return [...pids].filter((pid) => JSON.stringify(a.owned[pid] ?? null) !== JSON.stringify(b.owned[pid] ?? null))
}

export async function soundAudio(soundId: unknown): Promise<Uint8Array | null> {
  if (typeof soundId !== 'string' || !SOUND_ID.test(soundId)) return null
  const wav = await library().audio(soundId)
  return wav ? new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength) : null
}

export function makeSoundNow(soundId: unknown): void {
  if (typeof soundId !== 'string' || !SOUND_ID.test(soundId)) return
  const e = library().retry(soundId)
  if (!e || e.state === 'ready' || !speech().soundEffects) return
  theMaker().first(soundId)
  statusSoon()
}

let timer: CueTimer | null = null
/** When a clip's sounds are heard (`key`: the clip's key in Read aloud's audio cache). Never throws. */
export function soundCueTimes(
  o: { key: string; text: string; from: number; to: number; at: number[] },
  cache: ClipStore
): Promise<{ seconds: number[]; aligned: boolean }> {
  // Words are timed only when the server has a dictation model to hear them with (and is answering).
  timer ??= new CueTimer(cache, speechFetch, { canHear: () => !!server()?.aligner })
  return timer.times(o)
}

export function listSoundLibrary(): LibrarySound[] {
  return library()
    .list()
    .sort((a, b) => Math.max(b.used, b.made, b.asked) - Math.max(a.used, a.made, a.asked))
    .map(SoundLibrary.shown)
}

/** "Mute sounds in this scene", and back on: kept with Adam's other sound edits in the world. */
export function muteSceneSounds(sceneId: ID, muted: unknown): void {
  const w = world.currentWorld()
  const id = checkScene(sceneId)
  const edits = sceneEdits(w.db, id)
  if (!!edits.muted === (muted === true)) return
  saveSceneEdits(w.db, id, { owned: edits.owned, ...(muted === true ? { muted: true } : {}) })
  // A reading of it plans again (without its sounds, or with them).
  emit('sounds:marked', { sceneId: id, pids: [] })
}

/**
 * "New take": a made sound is made afresh, first in the queue; once made it plays everywhere it is used, with the
 * take before kept aside (keepTake). One not made yet, or that couldn't be made, is simply made.
 */
export function retakeSound(soundId: unknown): void {
  if (typeof soundId !== 'string' || !SOUND_ID.test(soundId)) return
  const l = library()
  const e = l.get(soundId)
  if (!e || !speech().soundEffects) return
  if (e.state !== 'ready') return makeSoundNow(soundId)
  if (e.retake !== 'making' && !l.startRetake(soundId)) return
  theMaker().first(soundId)
  statusSoon()
  tellShown()
}

/** After a new take: keep it (the take before is let go), or go back to the take before (`keep` false). */
export async function keepTake(soundId: unknown, keep: unknown): Promise<void> {
  if (typeof soundId !== 'string' || !SOUND_ID.test(soundId)) return
  const l = library()
  const making = l.get(soundId)?.retake === 'making'
  const changed = await l.keepTake(soundId, keep === true)
  // Gone back before the new take was made: it isn't made.
  if (making && keep !== true) maker?.drop(soundId)
  // Its audio changed: windows holding the new take drop it.
  if (changed) emit('sounds:ready', { soundId, ok: true })
  statusSoon()
  tellShown()
}

export async function clearSoundLibrary(): Promise<SoundsStatus> {
  await library().clear()
  maker?.clear()
  return status()
}

export async function undoClearSoundLibrary(): Promise<SoundsStatus> {
  const l = library()
  if (!(await l.undoClear())) throw new UserError('The sounds can no longer be brought back.')
  wantMade(
    l
      .list()
      .filter((e) => e.state === 'waiting' || e.retake === 'making')
      .map((e) => e.id)
  )
  statusSoon()
  return status()
}
