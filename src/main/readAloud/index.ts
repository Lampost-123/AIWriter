// Reading aloud in the main process (milestone 4): planning a stretch of a scene into clips, the AI's marks on who
// says what, the spoken audio kept on disk, the voices, samples, the warm-up and voice suggestions. The window
// plays the clips (features/readAloud). Owned by the Read aloud part; see src/shared/contracts/readAloud.ts.
//
// Both caches live in the app's user data folder (`speech-cache/`), never in a world folder or a backup: the
// spoken audio up to the limit Adam picks, and the AI's marks, one file per scene.
import { join } from 'node:path'
import {
  canHaveVoice,
  type AudioCacheStats,
  type ClipRequest,
  type EntryReadAloud,
  type PlannedClip,
  type ReadingPlan,
  type ReadingRequest,
  type ReadParagraph,
  type SampleRequest,
  type SpeakerLabel,
  type SpeakerLabelsRequest
} from '@shared/contracts/readAloud'
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
import { isDrafting, type DraftActivity } from '../ai/drafts'
import { voicesInstalled } from '../speech'
import { speechFetch } from '../speech/client'
import { AudioCache, GB } from './audioCache'
import { everyone, memberNamed, type CastMember } from './cast'
import { DraftMarks } from './draftMarks'
import { asSpoken } from './italicSpeech'
import { getEntryReadAloud, readingCast, setEntryReadAloud } from './entries'
import { labelOf, markedEnough } from './labels'
import { Marker, MarkStore, type Ask, type MarkingScene } from './marks'
import { hasOwnVoice, planClips, type PlanSettings } from './plan'
import { speak, VOICES_NOT_READY } from './speak'
import { NARRATION, NARRATOR, quoteKey, readMark, spansIn, withLabels, type Para } from './speakers'
import type { LineDelivery } from './types'
import type { WriterSpeaker } from '../ai/speakerTags'
import { linesSpokenBy, paragraphsOfDoc } from './suggest'
import { askVoice, voiceLater as queueVoices } from './autoVoice'
import { listVoices } from './voices'
import { soundsForReading, soundsInBackground, soundsWorldClosing, stopSoundMarks } from '../sounds'

/** Where reading aloud keeps its caches. */
export const speechCacheDir = (): string => join(userDataDir(), 'speech-cache')

let audio: AudioCache | null = null
/** The spoken audio kept on disk, up to Adam's limit (Settings › Read aloud and dictation). */
export function audioCache(): AudioCache {
  audio ??= new AudioCache(join(speechCacheDir(), 'audio'), () => Math.max(0.5, getSettings().speech.cacheLimitGb || 5) * GB)
  return audio
}

let marks: MarkStore | null = null
const markStore = (): MarkStore => (marks ??= new MarkStore(join(speechCacheDir(), 'marks')))

const modelSources = (): Parameters<typeof jobModel>[1] => ({
  settings: getSettings(),
  getProvider: providers.getProvider,
  providerTarget: providers.providerTarget
})

/** A way to ask the Read aloud model, through the task runner, for the open world; or why it can't be asked. */
function askFor(sceneId: ID): { call: Ask; stop: () => void } | { error: string } {
  const open = world.maybeCurrentWorld()
  if (!open) return { error: 'No world is open.' }
  // Who says each line and how is the writer's to say (Adam, 2026-10-04): what it didn't write itself (Adam's own
  // words, older drafts, a line it left untagged) is marked by the writer model too, without thinking (a quick job).
  let model: JobModel
  try {
    model = { ...jobModel('writer', modelSources()), thinking: 'off' }
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
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          reply,
          temperature,
          emit,
          onKeyRejected: () => providers.markCheck(model.target.id, false)
        })
        return done.status === 'complete'
          ? { text: done.text, error: null }
          : { text: null, error: done.status === 'error' ? done.error : null }
      } catch (e) {
        return { text: null, error: e instanceof UserError ? e.message : 'Something went wrong asking the AI. Try again.' }
      } finally {
        running.delete(taskId)
      }
    },
    stop: () => {
      for (const id of running) void stopTask(id).catch(() => undefined)
    }
  }
}

let marker: Marker | null = null
const theMarker = (): Marker =>
  (marker ??= new Marker(markStore(), askFor, (sceneId, pids, error) => emit('readAloud:marked', { sceneId, pids, error })))

/** The world closed: its marking stops (the task runner stops the calls themselves). */
export function readAloudWorldClosing(): void {
  marker?.forgetAll()
  draftMarks?.forget()
  soundsWorldClosing()
}

const speech = (): SpeechSettings => ({ ...defaultSpeechSettings(), ...getSettings().speech })

// ---------- Who says each line, from the writer ----------

/** The speakers the writer gave the lines of its latest drafts (ai/speakerTags.ts), by scene, until their paragraphs are marked. */
const fromWriter = new Map<ID, WriterSpeaker[]>()
const WRITER_KEEP = 400

/** A draft ended: who the writer said says each of its lines, kept for its paragraphs once they are in the page. */
export function noteWriterSpeakers(sceneId: ID, speakers: WriterSpeaker[]): void {
  if (!speakers.length) return
  fromWriter.set(sceneId, [...(fromWriter.get(sceneId) ?? []), ...speakers].slice(-WRITER_KEEP))
}

/**
 * Puts the writer's speakers (and how each line is said) on the quotes of these paragraphs that have none kept yet,
 * each used once, and keeps them as the AI's marks are kept. Returns the marks as they are now.
 */
function writerMarks(worldId: ID, sceneId: ID, paragraphs: { pid: string; text: string }[], cast: CastMember[], tone: boolean) {
  const store = markStore()
  const kept = store.current(worldId, sceneId, paragraphs)
  const given = fromWriter.get(sceneId)
  if (!given?.length) return kept
  const blocks: Para[] = []
  for (const p of paragraphs) {
    const had = kept.get(p.pid)
    const speakers: Record<string, string> = {}
    const delivery: Record<string, LineDelivery> = {}
    for (const q of spansIn(p.text)) {
      // A sentence of narration: how the narrator reads it.
      if (!q.quote) {
        if (had?.delivery?.[q.key] !== undefined || delivery[q.key] !== undefined) continue
        const n = given.findIndex((g) => g.key === q.key)
        if (n < 0) continue
        const [g] = given.splice(n, 1)
        const { how } = readMark(`narration | ${g.tone}`)
        if (how) delivery[q.key] = how
        continue
      }
      if (had?.speakers?.[q.key] !== undefined || speakers[q.key] !== undefined) continue
      const i = given.findIndex((g) => g.key === q.key)
      if (i < 0) continue
      const [g] = given.splice(i, 1)
      // "the narrator", in any case, is the narrator; a name the writer wrote a little differently is still that page.
      const { who, how } = readMark(`${g.who} | ${g.tone}`)
      const name = who === NARRATION ? NARRATOR : who
      speakers[q.key] = memberNamed(cast, name)?.name ?? name
      // With Mark who says what, a line the writer gave no note on how it is said is left for the AI to note.
      if (how || !tone) delivery[q.key] = how ?? {}
    }
    if (!Object.keys(speakers).length && !Object.keys(delivery).length) continue
    const block = withLabels({ id: p.pid, text: p.text, ...had }, speakers)
    blocks.push({ ...block, delivery: { ...delivery, ...(had?.delivery ?? {}) } })
  }
  if (!given.length) fromWriter.delete(sceneId)
  if (!blocks.length) return kept
  try {
    store.save(worldId, sceneId, blocks, paragraphs, new Set(paragraphs.map((p) => p.pid)))
  } catch (e) {
    console.warn('[read aloud] could not keep the writer’s speakers', e)
    return kept
  }
  return store.current(worldId, sceneId, paragraphs)
}

// ---------- Marking a draft as it lands ----------

/** Marks are worth making: read aloud is on or set up (its voices are downloaded), or "Show speakers and tone" is on. */
function marksWanted(): boolean {
  const s = speech()
  return s.readAloud || s.showSpeakers || voicesInstalled()
}

/**
 * Starts the AI marking these paragraphs of a scene in the background, with the Read aloud model: with Mark who says
 * what, who says each line and how; otherwise who says the quotes the rules can't place. Paragraphs already being
 * marked for the same words are left to that call (a reading's, or an earlier draft's). Failures are only logged.
 */
function markInBackground(sceneId: ID, onPage: ReadParagraph[], pids: string[]): void {
  const w = world.maybeCurrentWorld()
  if (!w) return
  // Speech in italics is read as dialogue, as a reading reads it (italicSpeech.ts).
  const paragraphs = onPage.map((p) => asSpoken(p).para)
  const s = speech()
  const sceneText = paragraphs.map((p) => p.text).join('\n\n')
  const rc = readingCast(w.db, sceneId, sceneText)
  // The writer said who says the new lines: only what it didn't is left to the AI.
  const kept = writerMarks(w.id, sceneId, paragraphs, rc.cast.all, s.markSpeakers)
  const marking: MarkingScene = {
    worldId: w.id,
    sceneId,
    blocks: paragraphs.map((p) => ({ id: p.pid, text: p.text, ...kept.get(p.pid) })),
    run: paragraphs.map((p) => p.pid),
    cast: rc.forAi(sceneText),
    pov: rc.narrator,
    pids: new Set(paragraphs.map((p) => p.pid))
  }
  const want = new Set(pids)
  // Sound effects: the new paragraphs' sounds are marked too, quietly (src/main/sounds).
  soundsInBackground(w.id, w.db, sceneId, paragraphs, pids)
  if (s.markSpeakers) {
    theMarker().noteAll(marking, want)
    return
  }
  const { unplaced } = planClips({ paragraphs, settings: s, cast: rc.cast, lexicon: rc.lexicon, marks: kept })
  const mine = new Map([...unplaced].filter(([pid]) => want.has(pid)))
  if (mine.size) theMarker().label(marking, mine, { quiet: true })
}

let draftMarks: DraftMarks | null = null
const theDraftMarks = (): DraftMarks =>
  (draftMarks ??= new DraftMarks({
    wanted: marksWanted,
    drafting: isDrafting,
    savedDoc: (sceneId) => {
      const w = world.maybeCurrentWorld()
      if (!w) return null
      try {
        return repo.getScene(w.db, sceneId).doc
      } catch {
        return null
      }
    },
    mark: markInBackground
  }))

/** AI-written text is about to go into a scene (History's snapshot before it, with the page as it is). Never throws. */
export function aiChangeComing(sceneId: ID, before?: unknown): void {
  if (typeof sceneId === 'string') theDraftMarks().aiChange(sceneId, before)
}

/** A scene's text was saved (src/main/ipc/core.ts). Never throws, and returns at once. */
export function sceneSavedForMarks(sceneId: ID, doc: unknown): void {
  theDraftMarks().saved(sceneId, doc)
}

/** A draft started or finished (ai/drafts.ts): a variant goes into the scene only when picked (its snapshot says so). */
export function draftActivity(e: DraftActivity): void {
  if (e.variant) return
  if (e.phase === 'start') theDraftMarks().aiChange(e.sceneId)
  else theDraftMarks().draftEnded(e.sceneId)
}

/**
 * "Show speakers and tone": a few words for each paragraph whose marks are in (who says it, and how when that is
 * known), from the paragraphs as the page shows them. Paragraphs being marked now, or not marked yet, get none.
 */
export function speakerLabels(req: SpeakerLabelsRequest): SpeakerLabel[] {
  const w = world.maybeCurrentWorld()
  if (!w || typeof req?.sceneId !== 'string' || !Array.isArray(req.paragraphs)) return []
  const s = speech()
  const paragraphs = req.paragraphs
    .slice(0, 5000)
    .map(paragraphOf)
    .filter((p) => p.pid && /[\p{L}\p{N}]/u.test(p.text))
    .map((p) => asSpoken(p).para)
  if (!paragraphs.length) return []
  const sceneText = paragraphs.map((p) => p.text).join('\n\n')
  const rc = readingCast(w.db, req.sceneId, sceneText)
  const kept = markStore().current(w.id, req.sceneId, paragraphs)
  const { clips, unplaced } = planClips({ paragraphs, settings: s, cast: rc.cast, lexicon: rc.lexicon, marks: kept })
  const busy = marker?.busyIn(w.id, req.sceneId) ?? new Set<string>()
  const byPid = new Map<string, PlannedClip[]>()
  for (const c of clips) (byPid.get(c.pid) ?? byPid.set(c.pid, []).get(c.pid)!).push(c)
  return paragraphs.flatMap((p) => {
    if (busy.has(p.pid) || !markedEnough(p.text, kept.get(p.pid), { tone: s.markSpeakers, unplaced: unplaced.has(p.pid) })) return []
    const label = labelOf(byPid.get(p.pid) ?? [])
    return label ? [{ pid: p.pid, label }] : []
  })
}

/** A paragraph from the window, checked and cut to size. */
function paragraphOf(p: ReadParagraph): ReadParagraph {
  const text = typeof p?.text === 'string' ? p.text.slice(0, 20_000) : ''
  const italics = Array.isArray(p?.italics)
    ? p.italics
        .filter((r): r is [number, number] => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0])
        .slice(0, 200)
    : undefined
  return { pid: typeof p?.pid === 'string' ? p.pid.slice(0, 40) : '', text, ...(italics?.length ? { italics } : {}) }
}

/** Every paragraph id the scene has, from the window, when it is a list it could be. */
function pidsOf(v: unknown): Set<string> | undefined {
  if (!Array.isArray(v) || v.length > 20_000 || !v.every((p) => typeof p === 'string')) return undefined
  return new Set((v as string[]).map((p) => p.slice(0, 40)))
}

/**
 * The clips for a stretch of a scene, as the rules and the marks kept so far decide them, and the AI started on
 * what they can't tell: with Mark who says what, who says each line and how, a little ahead of the reading (and
 * `markAhead` says where the reading asks again, so the notes keep ahead of it); otherwise the speakers of the quotes
 * the rules can't place.
 */
export function planReading(req: ReadingRequest): ReadingPlan {
  const w = world.currentWorld()
  const s = speech()
  const pageParagraphs = (req.paragraphs ?? []).map(paragraphOf).filter((p) => p.pid)
  const pageBefore = (req.before ?? []).map(paragraphOf).filter((p) => p.pid)
  // Speech in italics is read as dialogue (italicSpeech.ts): the plan is made from the paragraphs with it in quote
  // marks, and its places are put back where they are on the page.
  const spoken = new Map([...pageBefore, ...pageParagraphs].map((p) => [p.pid, asSpoken(p)]))
  const paragraphs = pageParagraphs.map((p) => spoken.get(p.pid)!.para)
  const before = pageBefore.map((p) => spoken.get(p.pid)!.para)
  const scene = [...before, ...paragraphs]
  const backOf = (pid: string, n: number): number => spoken.get(pid)?.back(n) ?? n
  const toPage = (plan: ReadingPlan): ReadingPlan => ({
    ...plan,
    clips: plan.clips.map((c) => ({
      ...c,
      from: backOf(c.pid, c.from),
      to: backOf(c.pid, c.to),
      sentences: c.sentences.map(([a, b]): [number, number] => [backOf(c.pid, a), backOf(c.pid, b)])
    })),
    ...(plan.markAhead ? { markAhead: { ...plan.markAhead, at: backOf(plan.markAhead.pid, plan.markAhead.at) } } : {})
  })
  const startAt = req.offset ?? 0
  const sceneText = scene.map((p) => p.text).join('\n\n')
  const rc = readingCast(w.db, req.sceneId, sceneText)
  const kept = writerMarks(w.id, req.sceneId, scene, rc.cast.all, s.markSpeakers)
  const base = {
    paragraphs,
    before,
    offset: pageParagraphs[0] ? spoken.get(pageParagraphs[0].pid)!.forward(startAt) : startAt,
    quick: !!req.quick,
    settings: s,
    cast: rc.cast,
    lexicon: rc.lexicon,
    marks: kept
  }
  const first = planClips(base)
  // Sound effects (src/main/sounds): their marking starts beside the speakers', and each clip gets its sounds. They
  // never make a clip wait.
  const sfx = soundsForReading({
    worldId: w.id,
    db: w.db,
    sceneId: req.sceneId,
    before: pageBefore,
    paragraphs: pageParagraphs,
    offset: startAt,
    pids: pidsOf(req.pids)
  })
  const done = (plan: ReadingPlan): ReadingPlan => (sfx ? sfx.finish(toPage(plan)) : toPage(plan))
  const m = theMarker()
  const marking: MarkingScene = {
    worldId: w.id,
    sceneId: req.sceneId,
    blocks: scene.map((p) => ({ id: p.pid, text: p.text, ...kept.get(p.pid) })),
    run: paragraphs.map((p) => p.pid),
    offset: base.offset,
    cast: rc.forAi(sceneText),
    pov: rc.narrator,
    pids: pidsOf(req.pids)
  }
  let markAhead: ReadingPlan['markAhead']
  if (s.markSpeakers) markAhead = m.note(marking).again
  // Where the rules can't tell who says a line, the AI marks the speakers for the scene.
  else if (first.unplaced.size) m.label(marking, first.unplaced)
  const ahead = markAhead ? { markAhead } : {}
  const busy = m.busyIn(w.id, req.sceneId)
  if (!busy.size) return done({ clips: first.clips, marking: [], ...ahead })
  // A line waits for its speaker only when that changes its voice: with nobody's own voice, only the bar's name does.
  // Anyone in the world may be named (a tag, or the AI), not only the scene's card's people.
  if (!s.markSpeakers && !rc.cast.all.some((c) => hasOwnVoice(c, s))) return done({ clips: first.clips, marking: [...busy], ...ahead })
  const again = planClips({ ...base, ...(s.markSpeakers ? { marking: busy } : { labelling: busy }) })
  return done({ clips: again.clips, marking: [...busy], ...ahead })
}

/** Stops the AI marking a scene (its reading stopped). */
export function stopMarks(sceneId: ID): void {
  const w = world.maybeCurrentWorld()
  if (!w) return
  marker?.stop(w.id, sceneId)
  stopSoundMarks(w.id, sceneId)
}

/** A clip from the window, checked and cut to size, so only what reading aloud would ask for is sent. */
export function clipOf(c: ClipRequest): ClipRequest {
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
  return {
    input: str(c?.input, 4000),
    voice: str(c?.voice, 200),
    voiceDesign: str(c?.voiceDesign, 2000),
    instruct: str(c?.instruct, 2000),
    delivery: str(c?.delivery, 600),
    pace: c?.pace === 'slow' || c?.pace === 'fast' ? c.pace : '',
    gentle: c?.gentle === true,
    sounds: c?.sounds === true
  }
}

/** One clip's audio (WAV), from the disk cache when it was heard before. */
export async function speakClip(clip: ClipRequest): Promise<Uint8Array> {
  const audio = await speak(clipOf(clip), audioCache(), speech().engine)
  return new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength)
}

/** The voices the speech server offers. */
export const readAloudVoices = (): ReturnType<typeof listVoices> => listVoices(speech().engine)

/** One paragraph read as reading reads it, with these settings. */
function sampleOf(
  text: string,
  settings: PlanSettings,
  opts: { speaker?: { id: ID; name: string; voice: EntryReadAloud['voice'] } } = {}
): PlannedClip[] {
  const w = world.maybeCurrentWorld()
  const lexicon = w ? readingCast(w.db, null).lexicon : []
  if (opts.speaker) {
    // A line of theirs, marked as theirs, in their own voice (whatever "Give characters their own voices" says).
    const line = `“${text.replace(/["“”]/g, '')}”`
    const me = { id: opts.speaker.id, name: opts.speaker.name, names: [opts.speaker.name], voice: opts.speaker.voice }
    return planClips({
      paragraphs: [{ pid: 'sample', text: line }],
      settings: { ...settings, castVoices: true },
      cast: everyone([me]),
      lexicon,
      marks: new Map([['sample', { speakers: { [quoteKey(line)]: opts.speaker.name } }]])
    }).clips
  }
  return planClips({ paragraphs: [{ pid: 'sample', text }], settings, cast: everyone([]), lexicon, marks: new Map() }).clips
}

/** The clips a Sample, Hear or Listen button plays, exactly as reading will sound. */
export function sampleReading(req: SampleRequest): PlannedClip[] {
  const s = speech()
  const sample = s.sample.trim() || defaultSpeechSettings().sample
  switch (req?.kind) {
    case 'narrator':
      return sampleOf((typeof req.text === 'string' && req.text.trim().slice(0, 500)) || sample, s)
    case 'voice':
      return sampleOf(sample, { ...s, narratorVoice: String(req.voice ?? '').slice(0, 200), narratorDescription: '' })
    case 'ready':
      return sampleOf('Ready when you are.', s)
    case 'say': {
      const db = world.db()
      const entry = repo.getEntry(db, req.entryId)
      return sampleOf(`${entry.name}.`, s)
    }
    case 'character': {
      const db = world.db()
      const entry = repo.getEntry(db, req.entryId)
      const voice = getEntryReadAloud(db, entry.id).voice
      if (!voice.voice && !voice.design) throw new UserError('Describe how they sound, or pick a voice, first.')
      const line = linesFor(db, entry)[0] ?? sample
      return sampleOf(line, s, { speaker: { id: entry.id, name: entry.name, voice } })
    }
    default:
      throw new UserError('Nothing to play.')
  }
}

/** Some of a character's own lines from the stories (the last story Adam had open first). */
function linesFor(db: ReturnType<typeof world.db>, entry: ReturnType<typeof repo.getEntry>): string[] {
  const w = world.currentWorld()
  const last = getSettings().lastStoryId
  const stories = repo.listStories(db).map((st) => st.id)
  const storyIds = last && stories.includes(last) ? [last, ...stories.filter((id) => id !== last)] : stories
  const names = new Set([entry.name, ...entry.aliases].map((n) => n.trim().toLowerCase()).filter(Boolean))
  return linesSpokenBy(db, entry, {
    storyIds,
    marked: (sceneId) => {
      const out = new Map<string, Set<string>>()
      let paragraphs: { pid: string; text: string }[]
      try {
        paragraphs = paragraphsOfDoc(repo.getScene(db, sceneId).doc)
      } catch {
        return out
      }
      for (const [pid, m] of markStore().current(w.id, sceneId, paragraphs)) {
        const keys = Object.entries(m.speakers ?? {})
          .filter(([, who]) => names.has(who.trim().toLowerCase()))
          .map(([key]) => key)
        if (keys.length) out.set(pid, new Set(keys))
      }
      return out
    }
  })
}

/**
 * Loads the voices so the first Listen is quick: the speech server loads its engine and says "Ready when you are."
 * to itself (on its first load on the graphics card it also tests itself, and falls back to its safe mode).
 */
export async function warmUpVoices(): Promise<void> {
  const engine = speech().engine
  const res = await speechFetch('/warmup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ engines: [engine] }),
    timeoutMs: 600_000
  })
  // A server without a warm-up loads the voices with the first clip instead.
  if (res.status === 404 || res.status === 405) return
  if (!res.ok) throw new UserError(VOICES_NOT_READY, 'voices-not-ready')
  const body = (await res.json().catch(() => ({}))) as { engines?: Record<string, unknown> }
  const state = body.engines?.[engine]
  if (state !== undefined && state !== 'ready') {
    console.warn(`[read aloud] warm-up: ${String(state).slice(0, 300)}`)
    throw new UserError(VOICES_NOT_READY, 'voices-not-ready')
  }
}

export const getEntryVoice = (entryId: ID): EntryReadAloud => getEntryReadAloud(world.db(), entryId)
export const setEntryVoice = (entryId: ID, value: EntryReadAloud): EntryReadAloud => setEntryReadAloud(world.db(), entryId, value)

/** Suggest: the AI describes how a character sounds. Streams as 'task:progress' for `taskId`; nothing is kept. */
export async function suggestCharacterVoice(
  entryId: ID,
  taskId: ID
): Promise<{ design: string; status: 'complete' | 'stopped' | 'error'; error: string | null }> {
  const db = world.db()
  const entry = repo.getEntry(db, entryId)
  if (!canHaveVoice(entry.kind)) throw new UserError('Only characters, and things that talk, have a voice of their own.')
  const model = jobModel('speech', modelSources())
  const current = getEntryReadAloud(db, entryId).voice.design
  const { done, design } = await askVoice({
    db,
    entry,
    lines: linesFor(db, entry),
    current,
    model,
    taskId,
    emit,
    onKeyRejected: () => providers.markCheck(model.target.id, false)
  })
  return { design, status: done.status, error: done.error }
}

/**
 * The AI made or filled in these entries (the builder, the memory finding someone in a scene): each character among
 * them without a voice gets one in the background, as Suggest would write it, with the Read aloud model, and "Say it
 * as" when the name is easy to misread (autoVoice.ts). Never replaces what Adam set; a failure leaves the box empty.
 * `delayMs` waits that long first, starting again each time the same character is handed over.
 */
export function voiceLater(db: ReturnType<typeof world.db>, entryIds: ID[], opts: { delayMs?: number } = {}): void {
  if (!entryIds.length) return
  queueVoices(entryIds, {
    db,
    model: () => {
      try {
        return jobModel('speech', modelSources())
      } catch {
        return null
      }
    },
    live: () => world.maybeCurrentWorld()?.db === db,
    lines: (e) => linesFor(db, e),
    delayMs: opts.delayMs,
    onVoiced: (ids) => {
      // Their pages show the voice, and backups see the world changed.
      repo.touchWorld(db)
      emit('memory:changed', { sceneId: null, entryIds: ids })
    }
  })
}

export async function cacheStats(): Promise<AudioCacheStats> {
  const cache = audioCache()
  // A lower limit takes effect at once (a clip in use stays until next time).
  await cache.prune().catch((e) => console.warn('[read aloud] could not trim the saved audio', e))
  return cache.stats()
}

export async function clearCache(): Promise<AudioCacheStats> {
  const cache = audioCache()
  await cache.clear()
  return cache.stats()
}
