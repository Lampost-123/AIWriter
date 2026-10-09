// Reading aloud in the main process (milestone 4): planning a stretch of a scene into clips, the AI's marks on who
// says what, the spoken audio kept on disk, the voices, samples, the warm-up and voice suggestions. The window
// plays the clips (features/readAloud). Owned by the Read aloud part; see src/shared/contracts/readAloud.ts.
//
// Both caches live in the app's user data folder (`speech-cache/`), never in a world folder or a backup: the
// spoken audio up to the limit Adam picks, and the AI's marks, one file per scene.
import { join } from 'node:path'
import type {
  AudioCacheStats,
  CastEntry,
  ClipRequest,
  EntryReadAloud,
  PlannedClip,
  ReadingPlan,
  ReadingRequest,
  ReadParagraph,
  SampleRequest,
  SpeakerLabel,
  SpeakerLabelsRequest
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
import { studioVoicesDir, voicesInstalled } from '../speech'
import { speechFetch } from '../speech/client'
import { AudioCache, GB } from './audioCache'
import { everyone, type CastMember, type SceneCast } from './cast'
import { DraftMarks } from './draftMarks'
import { asSpoken } from './italicSpeech'
import { getEntryReadAloud, readingCast, setEntryReadAloud } from './entries'
import { labelOf, labelSpeaker, markedEnough } from './labels'
import { Marker, MarkStore, textHash, type Ask, type MarkingScene } from './marks'
import { hasOwnVoice, planClips, type PlanSettings } from './plan'
import { clipKey, speak, VOICES_NOT_READY } from './speak'
import { TakeStore } from './takes'
import { quoteKey } from './speakers'
import type { WriterSpeaker } from '../ai/speakerTags'
import { linesSpokenBy, paragraphsOfDoc } from './suggest'
import { askVoice, voiceLater as queueVoices } from './autoVoice'
import { listVoices } from './voices'
import { castableCharacters, castFromStudio, castVoiceless, readStudioVoices } from './studio'
import { writerBlocks } from './writerBlocks'
import { castList, voicelessCharacters } from './castList'
import { soundsForReading, soundsInBackground, soundsWorldClosing, stopSoundMarks } from '../sounds'
import { autoCaster, CastingStore, type AutoCaster } from './autocast'
import { withoutDirectorTone } from './director'
import { ruleKinds, withRuleKinds } from './kinds'
import type { ParagraphMarks } from './types'

/** Where reading aloud keeps its caches. */
export const speechCacheDir = (): string => join(userDataDir(), 'speech-cache')

let audio: AudioCache | null = null
/** The spoken audio kept on disk, up to Adam's limit (Settings › Read aloud and dictation). */
export function audioCache(): AudioCache {
  audio ??= new AudioCache(join(speechCacheDir(), 'audio'), () => Math.max(0.5, getSettings().speech.cacheLimitGb || 5) * GB)
  return audio
}

let takes: TakeStore | null = null
/** Redo this line: the take each redone line is read as (takes.ts). */
const theTakes = (): TakeStore => (takes ??= new TakeStore(join(speechCacheDir(), 'takes.json')))

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

// ---------- Voices for everyone, and what each line is ----------

let castingFile: CastingStore | null = null
const castingStore = (): CastingStore => (castingFile ??= new CastingStore(join(speechCacheDir(), 'autocast.json')))

/**
 * With "Give characters their own voices" on and the studio voices downloaded: a caster for the people the marks name
 * who aren't in the world ("the guard"), the same voice each time, and a way to keep what it gave out. Null otherwise.
 */
function castingFor(worldId: ID, cast: CastMember[], s: SpeechSettings): { caster: AutoCaster; keep: () => void } | null {
  if (!s.castVoices || s.studioVoices === false) return null
  const voices = readStudioVoices(studioVoicesDir())
  if (!voices.length) return null
  const caster = autoCaster({ voices, narrator: s.narratorVoice, cast, kept: castingStore().load(worldId) })
  return {
    caster,
    keep: () => {
      const given = caster.given()
      if (!given) return
      try {
        castingStore().save(worldId, given)
      } catch (e) {
        console.warn('[read aloud] could not keep the voices cast', e)
      }
    }
  }
}

/**
 * The world's characters who speak in these clips (their lines, thoughts or messages) with no voice at all are given a
 * studio voice that fits them, saved on their page (studio.ts castVoiceless), so Adam sees it there and can change it.
 * True when anyone was given one: the cast is read again before planning.
 */
function castWhoSpeaks(db: Parameters<typeof castVoiceless>[0], s: SpeechSettings, cast: CastMember[], clips: readonly PlannedClip[]): boolean {
  if (!s.castVoices || s.studioVoices === false) return false
  const speaking = new Set(clips.map((c) => c.who))
  const voiceless = cast.filter((c) => speaking.has(c.name) && !c.voice?.voice?.trim() && !c.voice?.design?.trim()).map((c) => c.id)
  if (!voiceless.length) return false
  const voices = readStudioVoices(studioVoicesDir())
  const given = castVoiceless(db, voices, s.narratorVoice, voiceless)
  if (!given.length) return false
  emit('memory:changed', { sceneId: null, entryIds: given })
  return true
}

/**
 * The marks a plan reads: what is kept (the writer's tags first, then the director's), with what the rules can tell of
 * each line's kind filling the rest. With Emotion and tone off, the director's notes on how lines are said are left
 * unread (the writer's own stay, as before), so lines are read evenly; who says them and what they are stay.
 */
function forPlan(kept: Map<string, ParagraphMarks>, paragraphs: ReadParagraph[], cast: SceneCast, s: SpeechSettings): Map<string, ParagraphMarks> {
  const marks = withRuleKinds(kept, ruleKinds(paragraphs, cast))
  return s.markSpeakers ? marks : new Map([...marks].map(([pid, m]) => [pid, withoutDirectorTone(m)]))
}

// ---------- Who says each line, from the writer ----------

/** The speakers the writer gave the lines of its latest drafts (ai/speakerTags.ts), by scene, until their paragraphs are marked. */
const fromWriter = new Map<ID, WriterSpeaker[]>()
const WRITER_KEEP = 400
/**
 * When each scene's were last noted. Kept only a while: a line the writer tagged that never reached the page (the
 * draft was replaced or edited) mustn't give its speaker to another line with the same words later ("Yes.").
 */
const writerNoted = new Map<ID, number>()
const WRITER_FOR_MS = 10 * 60_000

/** A draft ended: who the writer said says each of its lines, kept for its paragraphs once they are in the page. */
export function noteWriterSpeakers(sceneId: ID, speakers: WriterSpeaker[]): void {
  if (!speakers.length) return
  fromWriter.set(sceneId, [...(fromWriter.get(sceneId) ?? []), ...speakers].slice(-WRITER_KEEP))
  writerNoted.set(sceneId, Date.now())
}

/**
 * What the writer said of the lines of a variant or an AI edit, by its record, until it goes into the page (History's
 * snapshot before it names the record) or has waited too long. Only the latest few are kept.
 */
const byGeneration = new Map<ID, { speakers: WriterSpeaker[]; at: number }>()
const GENERATIONS_KEPT = 30
const GENERATION_FOR_MS = 30 * 60_000

/** A variant or an AI edit finished: who says each of its lines, for when it goes into the scene. */
export function noteGenerationSpeakers(generationId: ID, speakers: WriterSpeaker[]): void {
  if (!speakers.length) return
  const now = Date.now()
  for (const [id, g] of byGeneration) if (now - g.at > GENERATION_FOR_MS) byGeneration.delete(id)
  byGeneration.set(generationId, { speakers, at: now })
  while (byGeneration.size > GENERATIONS_KEPT) byGeneration.delete(byGeneration.keys().next().value!)
}

/** A variant or an AI edit is going into the scene: what its writer said waits for the paragraphs it brings. */
export function generationGoingIn(sceneId: ID, generationId: ID): void {
  const g = byGeneration.get(generationId)
  if (!g) return
  byGeneration.delete(generationId)
  noteWriterSpeakers(sceneId, g.speakers)
}

/** The writer's speakers still waiting for a scene's paragraphs (none once they have waited too long). */
function writerFor(sceneId: ID): WriterSpeaker[] | undefined {
  if (Date.now() - (writerNoted.get(sceneId) ?? 0) > WRITER_FOR_MS) {
    fromWriter.delete(sceneId)
    writerNoted.delete(sceneId)
  }
  return fromWriter.get(sceneId)
}

/**
 * Puts the writer's speakers, how each line is said and the narrator's mood (writerBlocks.ts) on these paragraphs
 * where nothing is kept yet, each tag used once, and keeps them as the AI's marks are kept. Returns the marks as they
 * are now.
 */
function writerMarks(
  worldId: ID,
  sceneId: ID,
  paragraphs: { pid: string; text: string }[],
  cast: CastMember[],
  tone: boolean,
  /** Only these paragraphs take the writer's speakers (a draft's own new ones); all when left out. */
  only?: ReadonlySet<string>
) {
  const store = markStore()
  const kept = store.current(worldId, sceneId, paragraphs)
  const given = writerFor(sceneId)
  if (!given?.length) return kept
  const { blocks, left } = writerBlocks({ paragraphs, given, cast, kept, tone, only })
  if (left.length) fromWriter.set(sceneId, left)
  else fromWriter.delete(sceneId)
  if (!blocks.length) return kept
  try {
    store.save(worldId, sceneId, blocks, paragraphs, new Set(paragraphs.map((p) => p.pid)))
  } catch (e) {
    console.warn('[read aloud] could not keep the writer’s speakers', e)
    return kept
  }
  // These paragraphs are marked now, with no AI call to say so: the labels and a waiting reading hear it here.
  emit('readAloud:marked', { sceneId, pids: blocks.map((b) => b.id), error: null })
  return store.current(worldId, sceneId, paragraphs)
}

// ---------- Marking a draft as it lands ----------

/** Marks are worth making: read aloud is on or set up (its voices are downloaded), or "Show speakers and tone" is on. */
function marksWanted(): boolean {
  const s = speech()
  return s.readAloud || s.showSpeakers || voicesInstalled()
}

/**
 * Starts the AI marking these paragraphs of a scene in the background (the director: what each line is, whose it is
 * and how it is said). Paragraphs already being marked for the same words are left to that call (a reading's, or an
 * earlier draft's). Failures are only logged.
 */
function markInBackground(sceneId: ID, onPage: ReadParagraph[], pids: string[], o: { sounds?: boolean } = {}): void {
  const w = world.maybeCurrentWorld()
  if (!w) return
  // Speech in italics is read as dialogue, as a reading reads it (italicSpeech.ts).
  const paragraphs = onPage.map((p) => asSpoken(p).para)
  const s = speech()
  const sceneText = paragraphs.map((p) => p.text).join('\n\n')
  const rc = readingCast(w.db, sceneId, sceneText)
  // The writer said who says the new lines: only what it didn't is left to the AI. What it said of lines that never
  // reached the page goes, so it can't land on another line with the same words later.
  const kept = writerMarks(w.id, sceneId, paragraphs, rc.cast.all, s.markSpeakers, new Set(pids))
  fromWriter.delete(sceneId)
  writerNoted.delete(sceneId)
  const marking: MarkingScene = {
    worldId: w.id,
    sceneId,
    blocks: paragraphs.map((p) => ({ id: p.pid, text: p.text, ...(p.block ? { block: p.block } : {}), ...(p.italics ? { italics: p.italics } : {}), ...kept.get(p.pid) })),
    run: paragraphs.map((p) => p.pid),
    cast: rc.forAi(sceneText),
    pov: rc.narrator,
    pids: new Set(paragraphs.map((p) => p.pid))
  }
  const want = new Set(pids)
  // Sound effects: the new paragraphs' sounds are marked too, quietly (src/main/sounds).
  if (o.sounds !== false) soundsInBackground(w.id, w.db, sceneId, paragraphs, pids)
  theMarker().noteAll(marking, want)
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
 * known), from the paragraphs as the page shows them. Paragraphs being marked now, or not marked yet, get none; with
 * `mark`, those not marked yet are marked in the background (not while a draft is being written into the scene).
 */
export function speakerLabels(req: SpeakerLabelsRequest): SpeakerLabel[] {
  const w = world.maybeCurrentWorld()
  if (!w || typeof req?.sceneId !== 'string' || !Array.isArray(req.paragraphs)) return []
  const s = speech()
  const onPage = req.paragraphs
    .slice(0, 5000)
    .map(paragraphOf)
    .filter((p) => p.pid && /[\p{L}\p{N}]/u.test(p.text))
  const paragraphs = onPage.map((p) => asSpoken(p).para)
  if (!paragraphs.length) return []
  const sceneText = paragraphs.map((p) => p.text).join('\n\n')
  let rc = readingCast(w.db, req.sceneId, sceneText)
  const kept = markStore().current(w.id, req.sceneId, paragraphs)
  const marks = forPlan(kept, paragraphs, rc.cast, s)
  const planned = () => {
    const casting = castingFor(w.id, rc.cast.all, s)
    const got = planClips({ paragraphs, settings: s, cast: rc.cast, lexicon: rc.lexicon, marks, ...(casting ? { autocast: casting.caster } : {}) })
    casting?.keep()
    return got
  }
  let plan = planned()
  // A character speaking with no voice yet is given one on their page, and the labels say so at once.
  if (castWhoSpeaks(w.db, s, rc.cast.all, plan.clips)) {
    rc = readingCast(w.db, req.sceneId, sceneText)
    plan = planned()
  }
  const { clips, unplaced } = plan
  const busy = marker?.busyIn(w.id, req.sceneId) ?? new Set<string>()
  const byPid = new Map<string, PlannedClip[]>()
  for (const c of clips) (byPid.get(c.pid) ?? byPid.set(c.pid, []).get(c.pid)!).push(c)
  const missing: string[] = []
  const labels = paragraphs.flatMap((p) => {
    if (busy.has(p.pid)) return []
    if (!markedEnough(p.text, kept.get(p.pid), { tone: true, unplaced: unplaced.has(p.pid) })) {
      missing.push(p.pid)
      return []
    }
    const clipsHere = byPid.get(p.pid) ?? []
    const label = labelOf(clipsHere)
    if (!label) return []
    // Their name on the page opens their voice.
    const who = labelSpeaker(clipsHere)
    const member = who ? rc.cast.all.find((m) => m.name === who) : undefined
    return [{ pid: p.pid, label, ...(member ? { speaker: { entryId: member.id, name: member.name } } : {}) }]
  })
  if (req.mark && !isDrafting(req.sceneId)) {
    const text = new Map(paragraphs.map((p) => [p.pid, p.text]))
    const pids = missing.filter((pid) => labelTry(req.sceneId, pid, text.get(pid)!))
    if (pids.length) markInBackground(req.sceneId, onPage, pids, { sounds: false })
  }
  return labels
}

/** Times the labels may start the AI marking the same words of a paragraph: a reply that left a line out is asked once more. */
const LABEL_TRIES = 2
const labelTries = new Map<string, number>()

/** True when the labels may ask about these words again (and counts it). */
function labelTry(sceneId: ID, pid: string, text: string): boolean {
  if (labelTries.size > 5000) labelTries.clear()
  const key = `${sceneId}:${pid}:${textHash(text)}`
  const n = labelTries.get(key) ?? 0
  if (n >= LABEL_TRIES) return false
  labelTries.set(key, n + 1)
  return true
}

/** A paragraph from the window, checked and cut to size. */
function paragraphOf(p: ReadParagraph): ReadParagraph {
  const text = typeof p?.text === 'string' ? p.text.slice(0, 20_000) : ''
  const italics = Array.isArray(p?.italics)
    ? p.italics
        .filter((r): r is [number, number] => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0])
        .slice(0, 200)
    : undefined
  return {
    pid: typeof p?.pid === 'string' ? p.pid.slice(0, 40) : '',
    text,
    ...(italics?.length ? { italics } : {}),
    ...(p?.block === 'quote' ? { block: 'quote' as const } : {})
  }
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
  let rc = readingCast(w.db, req.sceneId, sceneText)
  const kept = writerMarks(w.id, req.sceneId, scene, rc.cast.all, s.markSpeakers)
  const marks = forPlan(kept, scene, rc.cast, s)
  let casting = castingFor(w.id, rc.cast.all, s)
  let base = {
    paragraphs,
    before,
    offset: pageParagraphs[0] ? spoken.get(pageParagraphs[0].pid)!.forward(startAt) : startAt,
    quick: !!req.quick,
    settings: s,
    cast: rc.cast,
    lexicon: rc.lexicon,
    marks,
    takes: (key: string) => theTakes().get(key),
    ...(casting ? { autocast: casting.caster } : {})
  }
  let first = planClips(base)
  casting?.keep()
  // A character speaking with no voice yet is given one on their page, and is read in it from the first line.
  if (castWhoSpeaks(w.db, s, rc.cast.all, first.clips)) {
    rc = readingCast(w.db, req.sceneId, sceneText)
    casting = castingFor(w.id, rc.cast.all, s)
    base = { ...base, cast: rc.cast, ...(casting ? { autocast: casting.caster } : {}) }
    first = planClips(base)
    casting?.keep()
  }
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
    blocks: scene.map((p) => ({ id: p.pid, text: p.text, ...(p.block ? { block: p.block } : {}), ...(p.italics ? { italics: p.italics } : {}), ...kept.get(p.pid) })),
    run: paragraphs.map((p) => p.pid),
    offset: base.offset,
    cast: rc.forAi(sceneText),
    pov: rc.narrator,
    pids: pidsOf(req.pids)
  }
  // The director marks the scene a little ahead of the reading: what each line is, whose it is and how it is said.
  const markAhead: ReadingPlan['markAhead'] = m.note(marking).again
  const ahead = markAhead ? { markAhead } : {}
  const busy = m.busyIn(w.id, req.sceneId)
  if (!busy.size) return done({ clips: first.clips, marking: [], ...ahead })
  // A line waits for its marks only when they can change its voice: with nobody's own voice and no casting, and
  // Emotion and tone off, only the bar's name would.
  if (!s.markSpeakers && !casting && !rc.cast.scene.some((c) => hasOwnVoice(c, s))) return done({ clips: first.clips, marking: [...busy], ...ahead })
  const again = planClips({ ...base, marking: busy })
  casting?.keep()
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
    pace: c?.pace === 'slow' || c?.pace === 'fast' || c?.pace === 'lively' ? c.pace : '',
    gentle: c?.gentle === true,
    sounds: c?.sounds === true,
    ...(typeof c?.mood === 'string' && /^[a-z]{1,20}$/.test(c.mood) ? { mood: c.mood } : {}),
    ...(Number.isInteger(c?.take) && c.take! > 0 ? { take: Math.min(99, c.take!) } : {}),
    ...(c?.check === true ? { check: true } : {})
  }
}

/**
 * Redo this line: the clip, as first planned (without its take), is read as one more take from now on. Returns the clip
 * as it is asked for now, and its key.
 */
export function redoClip(c: ClipRequest): { key: string; clip: ClipRequest } {
  const { take: _take, ...first } = clipOf(c)
  if (!first.input.trim()) throw new UserError('There are no words to read there.')
  const engine = speech().engine
  const clip = { ...first, take: theTakes().next(clipKey(first, engine)) }
  return { key: clipKey(clip, engine), clip }
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
  if (entry.kind !== 'character') throw new UserError('Only characters have a voice of their own.')
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
    castAfter: (ids) => (speech().studioVoices ? castStudio(db, ids) : Promise.resolve([])),
    onVoiced: (ids) => {
      // Their pages show the voice, and backups see the world changed.
      repo.touchWorld(db)
      emit('memory:changed', { sceneId: null, entryIds: ids })
    }
  })
}

/** Gives these characters studio voices, when they are downloaded (studio.ts). Never throws; returns those given one. */
async function castStudio(db: ReturnType<typeof world.db>, entryIds: ID[]): Promise<ID[]> {
  const voices = readStudioVoices(studioVoicesDir())
  if (!voices.length) return []
  let model: JobModel | null = null
  try {
    model = jobModel('speech', modelSources())
  } catch {
    /* No Read aloud model: the rules cast alone. */
  }
  const s = speech()
  return castFromStudio(
    {
      db,
      voices,
      narrator: s.narratorDescription.trim() ? '' : s.narratorVoice,
      model,
      emit,
      onKeyRejected: model ? () => providers.markCheck(model.target.id, false) : undefined,
      stopped: () => world.maybeCurrentWorld()?.db !== db
    },
    entryIds
  ).catch((e) => {
    console.warn('[read aloud] could not give studio voices', e)
    return []
  })
}

/**
 * "Give characters studio voices": every character in the open world without a voice picked from the list gets a
 * studio voice that fits them. Their descriptions are kept, so clearing the pick goes back to them. Undo is
 * `restoreStudioVoices` with what this returns.
 */
export async function giveStudioVoices(): Promise<{ given: number; before: Record<ID, EntryReadAloud> }> {
  const db = world.db()
  if (!readStudioVoices(studioVoicesDir()).length) {
    throw new UserError('Download the studio voices first, in Settings › Read aloud and dictation.')
  }
  const ids = castableCharacters(db)
  const before = Object.fromEntries(ids.map((id) => [id, getEntryReadAloud(db, id)]))
  const given = await castStudio(db, ids)
  if (given.length) {
    repo.touchWorld(db)
    emit('memory:changed', { sceneId: null, entryIds: given })
  }
  return { given: given.length, before: Object.fromEntries(given.map((id) => [id, before[id]!])) }
}

/** Undo for giveStudioVoices: puts back what those characters had, unless one was changed since. */
export function restoreStudioVoices(before: Record<ID, EntryReadAloud>): number {
  const db = world.db()
  const back: ID[] = []
  for (const [id, was] of Object.entries(before ?? {})) {
    try {
      const now = getEntryReadAloud(db, id)
      // Only a studio voice this gave, still as it was given.
      if (!/^clip:library\//.test(now.voice.voice) || now.voice.design !== was.voice.design) continue
      setEntryReadAloud(db, id, was)
      back.push(id)
    } catch {
      /* gone meanwhile */
    }
  }
  if (back.length) {
    repo.touchWorld(db)
    emit('memory:changed', { sceneId: null, entryIds: back })
  }
  return back.length
}

/** Settings › Read aloud › Cast: every character in the open world with the voice they are read in. */
export const readAloudCast = (): CastEntry[] => castList(world.db(), readStudioVoices(studioVoicesDir()))

/**
 * "Give everyone without a voice a voice": each character with no voice at all gets a studio voice that fits them, by
 * the rules, as reading gives one when they first speak (studio.ts castVoiceless). Undo is `restoreStudioVoices`.
 */
export function castVoicelessCharacters(): { given: ID[]; before: Record<ID, EntryReadAloud> } {
  const db = world.db()
  const voices = readStudioVoices(studioVoicesDir())
  if (!voices.length) throw new UserError('Download the studio voices first, in Settings › Read aloud and dictation.')
  const ids = voicelessCharacters(db)
  const before = Object.fromEntries(ids.map((id) => [id, getEntryReadAloud(db, id)]))
  const s = speech()
  const given = castVoiceless(db, voices, s.narratorDescription.trim() ? '' : s.narratorVoice, ids)
  if (given.length) {
    repo.touchWorld(db)
    emit('memory:changed', { sceneId: null, entryIds: given })
  }
  return { given, before: Object.fromEntries(given.map((id) => [id, before[id]!])) }
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
