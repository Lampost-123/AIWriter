// The sound library (AI sound effects under Read aloud): every sound made on this computer, kept once for the whole
// app (every scene, story and world shares it) in the app's data folder, never in a world: `<userData>/sounds/`, with
// library.json and the clips (`clips/<id>.wav`). A sound is never made twice: it is found by its description's key
// (normaliseKey), then by the other keys that led to it before (`aliases`), then by a description close enough to
// mean the same sound ("rain on a roof" is "steady rain on a roof"). Read aloud's Clear leaves it alone; only
// clear() empties it, kept aside for Undo for a couple of minutes.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { LibrarySound, SoundKind } from '@shared/contracts/sounds'
import { isLocked, readJson, writeFileAtomic } from '../util'

export type SoundState = LibrarySound['state']

/** One sound as the library keeps it. */
export interface LibraryEntry {
  id: string
  /** The words it was first asked for with, as written. */
  description: string
  /** normaliseKey(description). */
  key: string
  kind: SoundKind
  /** How long it was asked to be (effects; ambience loops), in seconds. */
  want: number
  /** How long it is, once made; 0 until then. */
  seconds: number
  bytes: number
  state: SoundState
  /** How the speech server ranked the take it kept (CLAP), when it said. */
  score?: number | null
  /** When it was asked for, made and last played (ms). */
  asked: number
  made: number
  used: number
  /** Other keys that led to it (a near match), so the next lookup for them is exact. */
  aliases: string[]
  /** Times making it failed, and when it last did. */
  failures: number
  failedAt: number
  /**
   * A new take: 'making' while it is made (the take before plays meanwhile), 'ready' once made with the take before
   * kept aside (`prev`, its clip `clips/<id>.prev.wav`) until Adam keeps the new one or goes back.
   */
  retake?: 'making' | 'ready'
  /** The seed the new take is made with, so it differs from the last. */
  seed?: number
  /** Times making the new take failed. */
  retakeFailures?: number
  /** The take before the new one, kept aside. */
  prev?: { seconds: number; bytes: number; score: number | null; made: number }
}

interface LibraryFile {
  v: 1
  sounds: Record<string, LibraryEntry>
}

/** Words that say nothing about how a sound sounds: left out of keys' comparisons and of the key itself. */
const ARTICLES = new Set(['a', 'an', 'the'])
const FILLER = new Set([
  ...ARTICLES,
  'of',
  'on',
  'in',
  'at',
  'with',
  'and',
  'or',
  'to',
  'from',
  'into',
  'onto',
  'by',
  'for',
  'over',
  'under',
  'through',
  'across',
  'against',
  'as',
  'its',
  'it',
  'is',
  'are',
  'some',
  'very',
  'then',
  'up',
  'down',
  'out',
  'away',
  'sound',
  'sounds',
  'noise'
])

/**
 * A description as a key: lower case, punctuation as spaces, without "a", "an" and "the", spaces collapsed.
 * "The heavy door, slamming!" → "heavy door slamming".
 */
export function normaliseKey(description: string): string {
  return description
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w && !ARTICLES.has(w))
    .join(' ')
}

/** A word's stem, lightly: plurals, -ing and -ed ("slamming", "slammed", "slams" → "slam"). */
export function stem(word: string): string {
  let w = word
  const undouble = (s: string): string => (/([bdgmnprt])\1$/.test(s) ? s.slice(0, -1) : s)
  if (w.length > 5 && w.endsWith('ing')) w = undouble(w.slice(0, -3))
  else if (w.length > 4 && w.endsWith('ed')) w = undouble(w.slice(0, -2))
  else if (w.length > 4 && /(?:ss|sh|ch|x)es$/.test(w)) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

/** The words of a description that say how it sounds, stemmed. */
export function contentWords(description: string): string[] {
  return [
    ...new Set(
      normaliseKey(description)
        .split(' ')
        .filter((w) => w.length > 1 && !FILLER.has(w))
        .map(stem)
    )
  ]
}

/** Two descriptions share this much of their words (shared ÷ all): the same sound. */
export const NEAR_JACCARD = 0.6
/** Or every word of one is in the other, when the shorter has at least this many words... */
export const MIN_SHARED = 2
/** ...the longer at least this many... */
export const MIN_CONTAINED = 3
/** ...and the longer adds at most this many. */
export const MAX_EXTRA = 3

/** How alike two descriptions' words are (0 to 1), or 0 when they don't mean the same sound. */
export function nearness(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a)
  const B = new Set(b)
  if (!A.size || !B.size) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  const jaccard = shared / (A.size + B.size - shared)
  if (jaccard >= NEAR_JACCARD) return jaccard
  const small = Math.min(A.size, B.size)
  const large = Math.max(A.size, B.size)
  const contained = shared === small && small >= MIN_SHARED && large >= MIN_CONTAINED && large - small <= MAX_EXTRA
  return contained ? jaccard : 0
}

/** True when two descriptions mean the same sound ("rain on a roof", "steady rain on a roof"). */
export const nearDuplicate = (a: string, b: string): boolean => nearness(contentWords(a), contentWords(b)) > 0

/** A sound's id: the hash of its kind and key, so the same sound always has the same id. */
export const soundIdOf = (kind: SoundKind, key: string): string =>
  createHash('sha256').update(`${kind}\n${key}`).digest('hex').slice(0, 16)

/** An id that could be a library sound's (anything else is refused before it reaches a path). */
export const SOUND_ID = /^[0-9a-f]{16}$/

/** Effects are made this long when nothing says (seconds), and between these. */
export const EFFECT_SECONDS = 3
export const MIN_EFFECT_SECONDS = 1
export const MAX_EFFECT_SECONDS = 10
/** Ambience is made this long; the speech server makes it loop without a seam. */
export const AMBIENCE_SECONDS = 20

/** The length a sound is asked for. */
export function wantSeconds(kind: SoundKind, seconds?: number | null): number {
  if (kind === 'ambience') return AMBIENCE_SECONDS
  const s = Number(seconds)
  return Number.isFinite(s) && s > 0 ? Math.min(MAX_EFFECT_SECONDS, Math.max(MIN_EFFECT_SECONDS, Math.round(s * 2) / 2)) : EFFECT_SECONDS
}

/** Cleared sounds are kept aside this long for Undo. */
export const UNDO_CLEAR_MS = 120_000
/** Undo tries this many times when a folder is held open for a moment. */
const UNDO_TRIES = 8

export class SoundLibrary {
  private sounds: Record<string, LibraryEntry> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private aside: { dir: string; timer: ReturnType<typeof setTimeout> } | null = null

  constructor(
    readonly dir: string,
    private readonly now: () => number = Date.now
  ) {}

  private get file(): string {
    return join(this.dir, 'library.json')
  }

  private prevOf(id: string): string {
    return this.clipOf(id).replace(/\.wav$/, '.prev.wav')
  }

  private clipOf(id: string): string {
    if (!SOUND_ID.test(id)) throw new Error('Bad sound id')
    return join(this.dir, 'clips', `${id}.wav`)
  }

  private load(): Record<string, LibraryEntry> {
    if (this.sounds) return this.sounds
    const kept = readJson<Partial<LibraryFile>>(this.file, {})
    const sounds: Record<string, LibraryEntry> = {}
    if (kept.v === 1 && kept.sounds && typeof kept.sounds === 'object') {
      for (const [id, e] of Object.entries(kept.sounds)) {
        if (!SOUND_ID.test(id) || !e || typeof e.description !== 'string' || (e.kind !== 'effect' && e.kind !== 'ambience')) continue
        // One being made when the app closed is waiting again.
        sounds[id] = { ...e, id, aliases: Array.isArray(e.aliases) ? e.aliases : [], state: e.state === 'making' ? 'waiting' : e.state }
      }
    }
    this.sounds = sounds
    return sounds
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const out: LibraryFile = { v: 1, sounds: this.load() }
    try {
      writeFileAtomic(this.file, JSON.stringify(out))
    } catch (e) {
      console.warn('[sounds] could not save the sound library', e)
    }
  }

  /** Saves a little later (when a sound was played: its time only). */
  private saveSoon(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => this.save(), 5000)
    ;(this.saveTimer as { unref?: () => void }).unref?.()
  }

  get(id: string): LibraryEntry | null {
    return (SOUND_ID.test(id) && this.load()[id]) || null
  }

  list(): LibraryEntry[] {
    return Object.values(this.load())
  }

  /**
   * The sound for a description, if the library has it or one close enough: by its key, then by a key that led to
   * one before, then by a near match of the same kind (which is remembered, so next time it is found by its key).
   * A sound that couldn't be made is found only by its own key.
   */
  find(kind: SoundKind, description: string): LibraryEntry | null {
    const key = normaliseKey(description)
    if (!key) return null
    const sounds = this.load()
    const exact = sounds[soundIdOf(kind, key)]
    if (exact) return exact
    const all = Object.values(sounds).filter((e) => e.kind === kind)
    const alias = all.find((e) => e.aliases.includes(key))
    if (alias) return alias
    const words = contentWords(description)
    let best: { e: LibraryEntry; near: number } | null = null
    for (const e of all) {
      if (e.state === 'failed') continue
      const near = nearness(words, contentWords(e.description))
      if (!near) continue
      const better =
        !best ||
        near > best.near ||
        (near === best.near && Number(e.state === 'ready') > Number(best.e.state === 'ready')) ||
        (near === best.near && e.state === best.e.state && e.used > best.e.used)
      if (better) best = { e, near }
    }
    if (!best) return null
    best.e.aliases = [...best.e.aliases, key].slice(-50)
    this.save()
    return best.e
  }

  /** The sound for a description: found as find() does, else a new one waiting to be made. */
  want(kind: SoundKind, description: string, seconds?: number | null): LibraryEntry | null {
    const found = this.find(kind, description)
    if (found) return found
    const key = normaliseKey(description)
    if (!key) return null
    const id = soundIdOf(kind, key)
    const e: LibraryEntry = {
      id,
      description: description.trim().replace(/\s+/g, ' ').slice(0, 120),
      key,
      kind,
      want: wantSeconds(kind, seconds),
      seconds: 0,
      bytes: 0,
      state: 'waiting',
      asked: this.now(),
      made: 0,
      used: 0,
      aliases: [],
      failures: 0,
      failedAt: 0
    }
    this.load()[id] = e
    this.save()
    return e
  }

  /** It is being made now, or waits again. */
  setState(id: string, state: 'waiting' | 'making'): void {
    const e = this.get(id)
    if (!e || e.state === 'ready' || e.state === state) return
    e.state = state
    // 'making' isn't kept: a sound being made when the app closes waits again.
    if (state === 'waiting') this.save()
  }

  /** Making it failed: counted, and with `giveUp` it is 'failed' (only asking for it again tries again). */
  failed(id: string, giveUp: boolean): LibraryEntry | null {
    const e = this.get(id)
    if (!e) return null
    e.failures++
    e.failedAt = this.now()
    e.state = giveUp ? 'failed' : 'waiting'
    this.save()
    return e
  }

  /** Listen now: a sound that couldn't be made gets another go. */
  retry(id: string): LibraryEntry | null {
    const e = this.get(id)
    if (!e) return null
    if (e.state === 'failed') {
      e.state = 'waiting'
      e.failures = 0
      this.save()
    }
    return e
  }

  /** Keeps a made sound. False when the library no longer wants it (it was cleared meanwhile). */
  async saveClip(id: string, wav: Buffer, seconds: number, score: number | null = null): Promise<boolean> {
    const e = this.get(id)
    if (!e) return false
    const file = this.clipOf(id)
    await fs.mkdir(dirname(file), { recursive: true })
    // Written beside it and renamed, so a half-written clip is never played.
    const temp = `${file}.${randomUUID()}.tmp`
    await fs.writeFile(temp, wav)
    // Cleared while it was written: not kept.
    if (this.get(id) !== e) {
      await fs.rm(temp, { force: true }).catch(() => undefined)
      return false
    }
    if (e.state === 'ready' && e.retake !== 'making') {
      // A new take that Adam went back from before it was made: it isn't kept, and the take playing stays.
      await fs.rm(temp, { force: true }).catch(() => undefined)
      return false
    }
    if (e.retake === 'making' && e.state === 'ready') {
      if (e.prev) {
        // Another new take before Adam chose: the take aside stays the last one he had (the one being replaced was
        // never kept), so Go back still goes back to it.
        e.retake = 'ready'
      } else {
        // A new take: the one before goes aside (one only), for going back.
        const kept = await fs.rename(file, this.prevOf(id)).then(
          () => true,
          () => false
        )
        e.prev = kept ? { seconds: e.seconds, bytes: e.bytes, score: e.score ?? null, made: e.made } : undefined
        e.retake = kept ? 'ready' : undefined
      }
    } else if (e.retake === 'making') e.retake = undefined
    await fs.rename(temp, file)
    e.state = 'ready'
    e.seconds = Math.round(seconds * 100) / 100
    e.bytes = wav.length
    e.score = score
    e.made = this.now()
    e.failures = 0
    this.save()
    return true
  }

  /**
   * New take: a made sound is made afresh with another seed (the take it has plays meanwhile). False when it isn't
   * made yet (then it is simply made).
   */
  startRetake(id: string): boolean {
    const e = this.get(id)
    if (!e || e.state !== 'ready') return false
    e.retake = 'making'
    e.seed = Math.floor(Math.random() * 2 ** 31)
    e.retakeFailures = 0
    this.save()
    return true
  }

  /** Making the new take failed: counted; with `giveUp` it is let go (the take it has stays). Returns the count. */
  retakeFailed(id: string, giveUp: boolean): number {
    const e = this.get(id)
    if (!e) return 0
    e.retakeFailures = (e.retakeFailures ?? 0) + 1
    const n = e.retakeFailures
    if (giveUp) this.endRetake(id)
    else this.save()
    return n
  }

  /** The new take isn't wanted any more (given up, or Adam went back before it was made). */
  endRetake(id: string): void {
    const e = this.get(id)
    if (!e || e.retake !== 'making') return
    e.retake = e.prev ? 'ready' : undefined
    e.retakeFailures = 0
    this.save()
  }

  /**
   * After a new take: keep it (the take before is deleted) or go back to the take before. Returns true when the
   * sound's audio changed (it went back).
   */
  async keepTake(id: string, keep: boolean): Promise<boolean> {
    const e = this.get(id)
    if (!e) return false
    if (e.retake === 'making' && !keep) {
      // Not made yet: it isn't made.
      this.endRetake(id)
      return false
    }
    const prev = e.prev
    if (!prev) return false
    if (keep) {
      await fs.rm(this.prevOf(id), { force: true }).catch(() => undefined)
    } else {
      try {
        await fs.rename(this.prevOf(id), this.clipOf(id))
      } catch (err) {
        console.warn('[sounds] could not go back to the earlier take', err)
        return false
      }
      if (this.get(id) !== e) return false
      Object.assign(e, { seconds: prev.seconds, bytes: prev.bytes, score: prev.score, made: prev.made })
    }
    e.prev = undefined
    if (e.retake === 'ready') e.retake = undefined
    this.save()
    return !keep
  }

  /** A made sound's audio, or null when it isn't made (or its file has gone, when it waits to be made again). */
  async audio(id: string): Promise<Buffer | null> {
    const e = this.get(id)
    if (!e || e.state !== 'ready') return null
    const wav = await fs.readFile(this.clipOf(id)).catch(() => null)
    if (!wav) {
      if (this.get(id) === e) {
        e.state = 'waiting'
        e.bytes = 0
        this.save()
      }
      return null
    }
    e.used = this.now()
    this.saveSoon()
    return wav
  }

  /** The sounds whose descriptions share the most words with `text`, most first (for the AI to reuse). */
  relevant(text: string, limit = 60): LibraryEntry[] {
    const words = new Set(contentWords(text))
    return this.list()
      .filter((e) => e.state !== 'failed')
      .map((e) => ({ e, n: contentWords(e.description).filter((w) => words.has(w)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || b.e.used - a.e.used || a.e.asked - b.e.asked)
      .slice(0, limit)
      .map((x) => x.e)
  }

  /** How many sounds are made, and their size on disk. */
  stats(): { count: number; bytes: number } {
    const made = this.list().filter((e) => e.state === 'ready')
    return { count: made.length, bytes: made.reduce((n, e) => n + e.bytes, 0) }
  }

  /** Empties the library: its folder is moved aside, for Undo, and deleted a couple of minutes later. */
  async clear(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.dropAside()
    this.sounds = {}
    if (!existsSync(this.dir)) return
    const aside = `${this.dir}-cleared-${this.now()}`
    try {
      renameSync(this.dir, aside)
    } catch (e) {
      // Held open (a clip playing, on Windows): its files go one by one instead, and there is nothing to undo.
      console.warn('[sounds] could not move the sound library aside', e)
      await fs.rm(this.dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
      return
    }
    const timer = setTimeout(() => this.dropAside(), UNDO_CLEAR_MS)
    ;(timer as { unref?: () => void }).unref?.()
    this.aside = { dir: aside, timer }
  }

  /** Undo for clear(): the sounds come back (any made since are let go). False when it is too late. */
  async undoClear(): Promise<boolean> {
    const aside = this.aside
    if (!aside || !existsSync(aside.dir)) return false
    clearTimeout(aside.timer)
    this.aside = null
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    // Both moves happen in one go, with nothing written between them: the sounds made since the clear (their folder
    // may have been made again meanwhile) go aside to be deleted, and the cleared ones come back. A folder held open
    // for a moment (on Windows) is tried again a few times.
    for (let tries = 1; ; tries++) {
      const since = existsSync(this.dir) ? `${this.dir}-cleared-${this.now()}-${tries}` : null
      try {
        if (since) renameSync(this.dir, since)
        try {
          renameSync(aside.dir, this.dir)
        } catch (e) {
          if (since) renameSync(since, this.dir)
          throw e
        }
        if (since) void fs.rm(since, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
        break
      } catch (e) {
        if (tries >= UNDO_TRIES || !isLocked(e)) {
          console.warn('[sounds] could not bring the sound library back', e)
          // Still kept aside: deleted later as it would have been.
          const timer = setTimeout(() => this.dropAside(), UNDO_CLEAR_MS)
          ;(timer as { unref?: () => void }).unref?.()
          this.aside = { dir: aside.dir, timer }
          return false
        }
        await new Promise((r) => setTimeout(r, 150))
      }
    }
    this.sounds = null
    this.load()
    return true
  }

  /** Deletes what clear() kept aside, and anything left aside from an earlier run of the app. */
  private dropAside(): void {
    if (this.aside) {
      clearTimeout(this.aside.timer)
      const dir = this.aside.dir
      this.aside = null
      void fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
    }
  }

  /** At start: deletes libraries cleared in an earlier run (their Undo is long gone). */
  sweep(): void {
    const parent = dirname(this.dir)
    const prefix = `${basename(this.dir)}-cleared-`
    let names: string[] = []
    try {
      names = readdirSync(parent).filter((n) => n.startsWith(prefix))
    } catch {
      return
    }
    for (const n of names) {
      const dir = join(parent, n)
      if (dir === this.aside?.dir) continue
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* in use: next time */
      }
    }
  }

  /** As Settings lists it. */
  static shown(e: LibraryEntry): LibrarySound {
    return { id: e.id, description: e.description, kind: e.kind, seconds: e.seconds, state: e.state, bytes: e.bytes }
  }
}
