// Making a recipe (spec, "Story recipes"), in the background, as the import catch-up reads an imported story:
// the Recipe maker reads the story chapter by chapter (a long chapter in pieces that fit its model) and takes
// notes on each, then writes the recipe from the notes and the pacing figures counted in code, then checks it
// against the story (leaks.ts): a part that names the story's people or places or copies its words is asked for
// once more, and whatever still does is taken out a sentence at a time.
// A chapter's notes count only in the form asked (two of Moves, Roles, Style) and when they aren't a refusal; else it
// is asked once more, then marked "couldn't read" and left out (2026-10-17). The recipe's room grows with the
// chapters, and an answer cut off at its limit is said in the finished toast.
//
// One recipe at a time, in the order they were asked for. Each chapter's notes are saved as they come
// (making.json), so quitting midway loses at most the chapter being read, and it carries on when the app starts.
// It pauses, saying why, when there is no model or the monthly spending limit holds AI calls (and carries on by
// itself when the settings change), or when a call fails twice in a row (Try again carries on). Cancel stops it
// and moves the recipe out of the library (its Undo brings it back, paused).
// No Electron imports: the caller passes the files, the model, the call and `emit`.

import type { RecipeMakerState, RecipeMaking, RecipePartId, RecipeParts } from '@shared/contracts/recipes'
import type { JobModel } from '../ai/jobModel'
import { looksLikeRefusalReply } from '@shared/refusal'
import { now as clock } from '../util'
import { estimateTokens } from '../keeper/text'
import { DEFAULT_RECIPE_CONTEXT, NOTES_REPLY, fixReply, pieceChars, recipeReply } from './estimate'
import { buildCheck, findLeaks, scrubText, type SourceCheck } from './leaks'
import { emptyParts, parseRecipe } from './parse'
import { feelText, parseFeel } from './feel'
import { chapterAsk, chapterSystem, combineAsk, combineSystem, fixAsk, fixSystem } from './prompts'
import { chapterSpans, chapterStats, chapterText, pacingTable, piecesOf, sourceWords, type RecipeSource } from './source'
import type { MakingFile, RecipeFiles, StoredRecipe } from './store'

export interface CallRequest {
  recipeId: string
  system: string
  user: string
  /** Room for the reply, in tokens. */
  reply: number
  temperature: number
}

export interface CallOutcome {
  status: 'complete' | 'stopped' | 'error'
  text: string
  error: string | null
  cutOff: boolean
}

export interface MakerDeps {
  /** The recipe library's files, or null when the library folder can't be reached. */
  files: () => RecipeFiles | null
  /** The Recipe maker's model, or why there is none (plain words). */
  model: () => JobModel | { error: string }
  /** While the monthly spending limit holds AI calls: the words saying so; else null. */
  held: () => string | null
  /** One AI call. Never throws; `signal` stops it (what came is kept). */
  call: (req: CallRequest, signal: AbortSignal) => Promise<CallOutcome>
  emit: (s: RecipeMakerState) => void
  /** The library changed (a recipe finished, paused...). */
  changed: () => void
}

/** Two failed calls in a row pause the recipe: something is wrong beyond one chapter. */
const FAILS_TO_PAUSE = 2
const NOTES_TEMPERATURE = 0.3
const RECIPE_TEMPERATURE = 0.5

const STOPPED = 'It stopped before it finished. Try again to carry on from where it was.'
const GONE = 'The story’s text for this recipe is no longer kept, so it can’t be read again.'
const NONE_READ = 'The recipe maker model wouldn’t read any of the story’s chapters. Pick another recipe maker model in Settings › Models, then Try again.'

/** Thrown inside a make to end it: paused (with the reason and whether it carries on by itself) or stopped. */
class Halt {
  constructor(
    readonly problem: string | null,
    readonly held: MakingFile['held'] = 'adam',
    /** The library folder changed: the recipe is left as it was, to carry on when that library is back. */
    readonly moved = false
  ) {}
}

/** The labels a chapter's notes are asked under (prompts.ts chapterSystem): notes with fewer than two are no notes. */
const NOTE_LABELS = ['Moves:', 'Roles:', 'Style:']

/** True when `text` has at least `min` of the labels, each at the start of a line (any case). */
export function hasLabels(text: string, labels: string[], min: number): boolean {
  const lines = text.split('\n').map((l) => l.replace(/^[\s*#_-]+/, '').toLowerCase())
  return labels.filter((label) => lines.some((l) => l.startsWith(label.toLowerCase()))).length >= min
}

/** A chapter's notes worth keeping (2026-10-17): in the form asked, not a refusal. */
export const usableNotes = (text: string): boolean => hasLabels(text, NOTE_LABELS, 2) && !looksLikeRefusalReply(text)

const listed = (xs: string[]): string => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''))

/** What the finished toast adds when the recipe isn't all there (null when it is). */
export function finishedNote(o: { cutShort: boolean; unread: number[] }): string | null {
  const out: string[] = []
  if (o.unread.length) {
    const which = o.unread.length === 1 ? `chapter ${o.unread[0]}` : `chapters ${listed(o.unread.map(String))}`
    out.push(`The AI couldn’t read ${which}, so the recipe leaves ${o.unread.length === 1 ? 'it' : 'them'} out.`)
  }
  if (o.cutShort) out.push('The recipe was cut short; the last parts may be thin.')
  if (!out.length) return null
  out.push(
    o.cutShort
      ? 'Pick a recipe maker model that writes longer answers in Settings › Models, then Read the story again.'
      : 'Pick another recipe maker model in Settings › Models, then Read the story again.'
  )
  return out.join(' ')
}

/** A recipe's name when the AI's would give the story away, or it gave none. */
export const fallbackName = (chapters: number): string => `A story in ${chapters} ${chapters === 1 ? 'chapter' : 'chapters'}`

export class RecipeMaker {
  private loop: Promise<void> | null = null
  /** The recipe being made now, until it ends (finished, paused or stopped). */
  private making: Promise<void> | null = null
  private current: {
    id: string
    step: RecipeMaking['step']
    chapter: number
    chapters: number
    controller: AbortController
    /** The library it is being made in: a call is never sent (or paid for) once the library folder has changed. */
    dir: string
  } | null = null
  /** The library the queue was last read from. */
  private dir: string | null = null
  private stopping = new Set<string>()
  private closed = false
  private finished: RecipeMakerState['finished'] = null

  constructor(private readonly d: MakerDeps) {}

  // ---------- What it says ----------

  state(): RecipeMakerState {
    const files = this.d.files()
    if (!files || this.closed) return { running: null, finished: this.finished }
    const queue = this.queue(files)
    const waiting = (id: string): number => queue.filter((r) => r.status === 'making' && r.id !== id).length
    const cur = this.current
    if (cur) {
      const r = files.read(cur.id)
      return {
        running: {
          recipeId: cur.id,
          name: r?.name ?? '',
          step: cur.step,
          chapter: cur.chapter,
          chapters: cur.chapters,
          status: this.stopping.has(cur.id) ? 'stopping' : 'going',
          error: null,
          waiting: waiting(cur.id)
        },
        finished: this.finished
      }
    }
    // Nothing going: the first paused one (with its reason), else one about to start.
    const next = queue.find((r) => r.status === 'paused') ?? queue.find((r) => r.status === 'making')
    if (!next) return { running: null, finished: this.finished }
    const m = files.making(next.id)
    const read = m ? m.notes.filter((n) => n != null).length : 0
    return {
      running: {
        recipeId: next.id,
        name: next.name,
        step: 'reading',
        chapter: Math.min(next.chapters, read + 1),
        chapters: next.chapters,
        status: next.status === 'paused' ? 'paused' : 'starting',
        error: next.status === 'paused' ? next.problem : null,
        waiting: waiting(next.id)
      },
      finished: this.finished
    }
  }

  /** Recipes with something left to make, in the order they were asked for. */
  private queue(files: RecipeFiles): StoredRecipe[] {
    // Each recipe's notes file read once (2026-10-17), not again for every comparison of the sort.
    const queued = new Map<string, string>()
    const out: StoredRecipe[] = []
    for (const r of files.list()) {
      if (r.status === 'ready') continue
      const m = files.making(r.id)
      if (!m) continue
      queued.set(r.id, m.queuedAt)
      out.push(r)
    }
    return out.sort((a, b) => queued.get(a.id)!.localeCompare(queued.get(b.id)!))
  }

  private tell(): void {
    if (this.closed) return
    try {
      this.d.emit(this.state())
    } catch (e) {
      console.warn('Could not send how the recipe is going', e)
    }
  }

  // ---------- Starting and stopping ----------

  /** At start, and whenever the library might have work: carries on with recipes waiting their turn. */
  resume(): void {
    this.dir = this.d.files()?.dir ?? null
    this.repair()
    this.run()
    this.tell()
  }

  /**
   * A recipe left "being made" with no notes (the app stopped between writing its files) is paused with Try again,
   * or put back as it was when it was already finished; one with nothing to read again is finished with what it has.
   */
  private repair(): void {
    const files = this.d.files()
    if (!files) return
    for (const r of files.list()) {
      if (r.status === 'ready' || files.making(r.id)) continue
      if (files.hasSource(r.id) && !r.byHand) {
        const src = files.source(r.id)
        files.writeMaking(r.id, { version: 1, queuedAt: r.createdAt, notes: (src?.chapters ?? []).map(() => null), held: 'adam' })
        files.write({ ...r, status: 'paused', problem: STOPPED })
      } else files.write({ ...r, status: 'ready', problem: null })
    }
  }

  /** Cancel on a finished recipe being read again: it goes back to how it was (its parts were never changed). */
  backToReady(id: string): boolean {
    const files = this.d.files()
    const r = files?.read(id)
    const m = files?.making(id)
    if (!files || !r || !m?.wasReady) return false
    files.writeMaking(id, null)
    files.write({ ...r, status: 'ready', problem: null })
    this.d.changed()
    this.tell()
    return true
  }

  /** Starts making a recipe whose folder (recipe.json and source.json) is ready. */
  start(id: string): void {
    const files = this.d.files()
    if (!files) return
    const r = files.read(id)
    const src = files.source(id)
    if (!r || !src) return
    // The notes first: a recipe marked as being made always has them, so it can never be stuck "Being made".
    // A finished recipe read again remembers it was finished, so Cancel puts it back as it was.
    const wasReady = r.status === 'ready' || !!files.making(id)?.wasReady
    files.writeMaking(id, { version: 1, queuedAt: clock(), notes: src.chapters.map(() => null), held: null, wasReady })
    files.write({ ...r, status: 'making', problem: null, updatedAt: clock() })
    this.run()
    this.tell()
  }

  /** Try again: a paused recipe carries on from where it was. */
  carryOn(id: string): void {
    const files = this.d.files()
    const r = files?.read(id)
    const m = files?.making(id)
    if (!files || !r || !m || r.status === 'ready') return
    files.writeMaking(id, { ...m, held: null })
    files.write({ ...r, status: 'making', problem: null })
    this.d.changed()
    this.run()
    this.tell()
  }

  /** The models, Thinking or spending limit changed: recipes paused for want of a model carry on. */
  settingsChanged(): void {
    const files = this.d.files()
    if (!files) return
    for (const r of this.queue(files)) if (r.status === 'paused' && files.making(r.id)?.held === 'auto') this.carryOn(r.id)
  }

  /** Stops making it (the call under way ends); it stays paused, waiting for Try again. Resolves once stopped. */
  async stop(id: string): Promise<void> {
    if (this.current?.id === id) {
      this.stopping.add(id)
      this.current.controller.abort()
      this.tell()
      await this.making
      this.stopping.delete(id)
    }
    const files = this.d.files()
    const r = files?.read(id)
    const m = files?.making(id)
    if (files && r && m && r.status !== 'ready') {
      files.writeMaking(id, { ...m, held: 'adam' })
      files.write({ ...r, status: 'paused', problem: STOPPED })
    }
    this.run()
    this.tell()
  }

  /**
   * The library folder changed (2026-10-17): the recipe being made in the old one stops where it is (what was read is
   * kept there, to carry on when that library is chosen again), and the new library's recipes carry on.
   */
  libraryChanged(): void {
    const files = this.d.files()
    if (this.current && this.current.dir !== files?.dir) this.current.controller.abort()
    this.resume()
  }

  /** The app is quitting: the call under way stops; what was read is kept, and it carries on next time. */
  close(): void {
    this.closed = true
    this.current?.controller.abort()
  }

  async whenIdle(): Promise<void> {
    while (this.loop) await this.loop
  }

  // ---------- Making ----------

  private run(): void {
    if (this.loop || this.closed) return
    this.loop = this.work()
      .catch((e) => {
        console.error('Making a recipe stopped unexpectedly', e)
        // The recipe it was making waits for Try again, saying so, rather than looking busy for ever.
        const id = this.current?.id
        const files = this.d.files()
        if (id && files && !this.closed) {
          try {
            this.pause(files, id, 'Something went wrong while making this recipe. Try again.', 'adam')
          } catch (err) {
            console.error('Could not pause the recipe', err)
          }
        }
      })
      .finally(() => {
        this.loop = null
        this.current = null
        this.tell()
      })
  }

  private async work(): Promise<void> {
    while (!this.closed) {
      const files = this.d.files()
      if (!files) return
      if (files.dir !== this.dir) {
        this.dir = files.dir
        this.repair()
      }
      const next = this.queue(files).find((r) => r.status === 'making')
      if (!next) return
      this.making = this.make(files, next)
      await this.making
      this.making = null
      this.current = null
    }
  }

  private async make(files: RecipeFiles, r: StoredRecipe): Promise<void> {
    const src = files.source(r.id)
    const m = files.making(r.id)
    if (!m) return
    const controller = new AbortController()
    this.current = { id: r.id, step: 'reading', chapter: 1, chapters: src?.chapters.length ?? r.chapters, controller, dir: files.dir }
    this.tell()
    try {
      if (!src || !src.chapters.length) throw new Halt(GONE)
      await this.readChapters(files, r.id, src, m, controller.signal)
      // Not one chapter read: no recipe worth paying for. Try again reads them all again.
      if ((m.unread ?? []).length >= src.chapters.length) {
        files.writeMaking(r.id, { ...m, notes: src.chapters.map(() => null), unread: [] })
        throw new Halt(NONE_READ)
      }
      const notes = m.notes.map((n) => n ?? '')
      this.current.step = 'writing'
      this.tell()
      const model = this.model()
      const reply = recipeReply(src.chapters.length, model.choice)
      const out = await this.ask(
        r.id,
        { system: combineSystem(), user: this.combineUser(src, notes, model, reply), reply, temperature: RECIPE_TEMPERATURE },
        controller.signal,
        (t) => Object.keys(parseRecipe(t).parts).length >= 3
      )
      const parsed = parseRecipe(out.text)
      this.current.step = 'checking'
      this.tell()
      const check = buildCheck(
        src.chapters.flatMap((c) => c.scenes.flat()),
        src.title
      )
      const parts = { ...emptyParts(), ...parsed.parts }
      if (!parts.pacing.trim()) parts.pacing = pacingTable(src)
      // Genre and content is rewritten in AI Write's own labels, so it holds none of the story's words to check.
      const feel = feelText(parseFeel(parts.feel))
      parts.feel = ''
      const fixed = await this.fixLeaks(r.id, parts, check, model, controller.signal)
      let removed = 0
      for (const k of Object.keys(fixed) as RecipePartId[]) {
        const s = scrubText(fixed[k], check)
        fixed[k] = s.text
        removed += s.removed
      }
      fixed.feel = feel
      let name = parsed.name.trim()
      if (!name || findLeaks(name, check).length || (src.title && name.toLowerCase().includes(src.title.toLowerCase()))) name = fallbackName(src.chapters.length)
      this.finish(files, r.id, src, fixed, name, removed, { cutShort: out.cutOff, unread: m.unread ?? [] })
    } catch (e) {
      if (!(e instanceof Halt)) throw e
      // Closing, or the library folder changed: left as it was, to carry on next time. Stopped by Adam (stop or
      // cancel): it waits for Try again.
      if (this.closed || e.moved || this.d.files()?.dir !== files.dir) return
      if (this.stopping.has(r.id)) this.pause(files, r.id, STOPPED, 'adam')
      else this.pause(files, r.id, e.problem ?? STOPPED, e.held)
    }
  }

  private model(): JobModel {
    const held = this.d.held()
    if (held) throw new Halt(held, 'auto')
    const m = this.d.model()
    if ('error' in m) throw new Halt(m.error, 'auto')
    return m
  }

  private async readChapters(files: RecipeFiles, id: string, src: RecipeSource, m: MakingFile, signal: AbortSignal): Promise<void> {
    const spans = chapterSpans(src)
    for (let i = 0; i < src.chapters.length; i++) {
      if (m.notes[i] != null) continue
      this.current!.chapter = i + 1
      this.tell()
      const model = this.model()
      const ch = src.chapters[i]
      const st = chapterStats(ch)
      const pieces = piecesOf(chapterText(ch), pieceChars(model.choice))
      const notes: (string | null)[] = []
      for (let p = 0; p < pieces.length; p++) {
        const user = chapterAsk({
          chapter: i + 1,
          chapters: src.chapters.length,
          span: spans[i],
          words: st.words,
          scenes: st.scenes,
          dialogue: st.dialogue,
          piece: { index: p + 1, of: pieces.length },
          text: pieces[p]
        })
        // Notes not in the form asked, or a refusal, are asked for once more; then that piece goes without (2026-10-17).
        const out = await this.ask(id, { system: chapterSystem(), user, reply: NOTES_REPLY, temperature: NOTES_TEMPERATURE }, signal, usableNotes, true)
        notes.push(out?.text ?? null)
      }
      const kept = notes.filter((n): n is string => n != null)
      m.notes[i] = kept.join('\n\n').trim()
      // A chapter none of whose pieces could be read is "couldn't read": the recipe page says so.
      if (!kept.length) m.unread = [...new Set([...(m.unread ?? []), i + 1])].sort((a, b) => a - b)
      files.writeMaking(id, m)
    }
  }

  /**
   * The notes, cut down evenly if all of them wouldn't fit the model with room for the recipe (`reply`). The room
   * leaves out the instructions, the pacing table and each chapter's heading (2026-10-17), so it never overflows.
   */
  private combineUser(src: RecipeSource, notes: string[], model: JobModel, reply: number): string {
    const length = model.choice.contextLength && model.choice.contextLength > 0 ? model.choice.contextLength : DEFAULT_RECIPE_CONTEXT
    const base = { chapters: src.chapters.length, words: sourceWords(src), pacing: pacingTable(src) }
    const frame = estimateTokens(combineAsk({ ...base, notes: notes.map(() => '') }))
    const room = length - reply * 1.5 - estimateTokens(combineSystem()) - frame - 300 - Math.ceil(length * 0.05)
    const total = estimateTokens(notes.join('\n'))
    if (total <= room) return combineAsk({ ...base, notes })
    // Each chapter's even share of the room, in characters. No floor above it: 200 characters each for 300 chapters
    // would be more than a small model holds.
    const share = Math.floor((Math.max(room, 0) * 3.5) / Math.max(1, notes.length))
    return combineAsk({ ...base, notes: notes.map((n) => n.slice(0, share)) })
  }

  /**
   * One call, asked once more if it fails or its answer can't be used (`usable`). Two failures in a row pause the
   * recipe with the reason, except with `orNone` when the last answer came but couldn't be used: then null.
   * Stopped by Adam, by the app closing or by the library folder changing: ends the make.
   */
  private async ask(id: string, req: Omit<CallRequest, 'recipeId'>, signal: AbortSignal, usable: (text: string) => boolean): Promise<{ text: string; cutOff: boolean }>
  private async ask(id: string, req: Omit<CallRequest, 'recipeId'>, signal: AbortSignal, usable: (text: string) => boolean, orNone: true): Promise<{ text: string; cutOff: boolean } | null>
  private async ask(id: string, req: Omit<CallRequest, 'recipeId'>, signal: AbortSignal, usable: (text: string) => boolean, orNone = false): Promise<{ text: string; cutOff: boolean } | null> {
    let last: string | null = null
    let said = false
    // A call stopped by something other than this maker (it shouldn't be: a window reload leaves it going) is
    // asked again once without counting as a failure.
    let spareStop = 1
    for (let attempt = 0; attempt < FAILS_TO_PAUSE; attempt++) {
      this.model()
      if (signal.aborted || this.closed) throw new Halt(null)
      // Never sent once the library folder has changed: its cost would go to the other library's records.
      if (this.d.files()?.dir !== this.current?.dir) throw new Halt(null, 'adam', true)
      const out = await this.d.call({ recipeId: id, ...req }, signal)
      if (signal.aborted || this.closed) throw new Halt(null)
      if (out.status === 'stopped' && !out.cutOff && spareStop-- > 0) {
        attempt--
        continue
      }
      if (out.status === 'complete' && usable(out.text)) return { text: out.text, cutOff: false }
      // Cut off at the reply limit is still worth keeping when it says something.
      if (out.status !== 'error' && out.cutOff && usable(out.text)) return { text: out.text, cutOff: true }
      last = out.status === 'error' ? out.error : out.status === 'stopped' ? STOPPED : null
      said = !!out.text.trim()
    }
    // Only an answer that said something it shouldn't (a refusal, notes in another form): no answer at all pauses.
    if (orNone && last === null && said) return null
    throw new Halt(last ?? 'The recipe maker’s answer couldn’t be used. Try again, or pick another recipe maker model in Settings › Models.')
  }

  /** Parts that leak are asked for once more; what comes back replaces them only where it leaks less. */
  private async fixLeaks(id: string, parts: RecipeParts, check: SourceCheck, model: JobModel, signal: AbortSignal): Promise<RecipeParts> {
    const bad = (Object.keys(parts) as RecipePartId[]).filter((k) => findLeaks(parts[k], check).length)
    if (!bad.length) return parts
    const leaks = bad.flatMap((k) => findLeaks(parts[k], check))
    const names = [...new Set(leaks.filter((l) => l.kind === 'name').map((l) => l.words))]
    const copied = [...new Set(leaks.filter((l) => l.kind === 'copied').map((l) => l.words))]
    const ask = Object.fromEntries(bad.map((k) => [k, parts[k]])) as Partial<RecipeParts>
    let text: string
    try {
      // Room for the leaking parts to come back whole (2026-10-17), not a fixed 2000.
      const reply = fixReply(bad.map((k) => parts[k]).join('\n\n'), model.choice)
      text = (await this.ask(id, { system: fixSystem(), user: fixAsk(ask, { names, copied }), reply, temperature: NOTES_TEMPERATURE }, signal, (t) => !!t.trim())).text
    } catch (e) {
      // A fix that fails isn't worth pausing for: the leaking sentences are simply taken out.
      if (e instanceof Halt && e.problem !== null && !signal.aborted) return parts
      throw e
    }
    const again = parseRecipe(text).parts
    const out = { ...parts }
    for (const k of bad) {
      const v = again[k]
      if (v && v.trim() && findLeaks(v, check).length < findLeaks(parts[k], check).length) out[k] = v
    }
    return out
  }

  private finish(
    files: RecipeFiles,
    id: string,
    src: RecipeSource,
    parts: RecipeParts,
    name: string,
    removed: number,
    gaps: { cutShort: boolean; unread: number[] }
  ): void {
    const r = files.read(id)
    if (!r) return
    const edited = new Set(r.edited)
    const merged = { ...r.parts }
    for (const k of Object.keys(parts) as RecipePartId[]) if (!edited.has(k)) merged[k] = parts[k]
    const finalName = r.nameBy === 'adam' && r.name.trim() ? r.name : name
    files.write({
      ...r,
      name: finalName,
      parts: merged,
      status: 'ready',
      problem: null,
      words: sourceWords(src),
      chapters: src.chapters.length,
      unread: gaps.unread,
      updatedAt: clock()
    })
    files.writeMaking(id, null)
    this.finished = { recipeId: id, name: finalName, at: new Date().toISOString(), removed, note: finishedNote(gaps) }
    this.d.changed()
  }

  private pause(files: RecipeFiles, id: string, problem: string, held: MakingFile['held']): void {
    const r = files.read(id)
    const m = files.making(id)
    if (!r || !m) return
    files.writeMaking(id, { ...m, held })
    files.write({ ...r, status: 'paused', problem })
    this.d.changed()
  }
}
