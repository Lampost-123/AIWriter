// When each of a clip's sounds is heard (AI sound effects under Read aloud). A sound is anchored to a word of the page;
// the window plays it at the clip's start plus the time that word is spoken. Once a clip is spoken, the speech
// server's dictation engine hears it back (`POST /v1/align`: the clip's WAV, answered with each word heard and when),
// and those times are kept beside the clip in Read aloud's audio cache, so it is done once. The page's words and the
// words heard are lined up (forgiving "Say it as" respellings and words said differently or not at all). When there
// is no dictation engine, or hearing fails, the time is estimated from the word's place in the clip.
import type { Fetcher } from '../readAloud/speak'
import { wavSeconds } from './wav'

/** A word as the dictation engine heard it, with when (seconds from the clip's start). */
export interface HeardWord {
  word: string
  start: number
  end: number
}

/** A word's letters and digits only, lower case ("Don't!" → "dont"). */
export const normWord = (w: string): string =>
  w
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

/** The words in [from, to) of a paragraph's text, with where each is. */
export function pageWords(text: string, from: number, to: number): { word: string; start: number; end: number }[] {
  const out: { word: string; start: number; end: number }[] = []
  for (const m of text.slice(from, to).matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)) {
    const word = normWord(m[0])
    if (word) out.push({ word, start: from + m.index!, end: from + m.index! + m[0].length })
  }
  return out
}

/** How alike two words are: 3 the same, 2 nearly (a respelling, a plural), 0 not. */
function likeness(a: string, b: string): number {
  if (a === b) return 3
  if (!a || !b) return 0
  const short = Math.min(a.length, b.length)
  let prefix = 0
  while (prefix < short && a[prefix] === b[prefix]) prefix++
  if (prefix >= 3 || (short >= 2 && prefix === short)) return 2
  return editDistance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 3)) ? 2 : 0
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]!
}

/** Scores for lining the words up: a word heard as written, nearly, as something else, or skipped. */
const SAME = 3
const NEAR = 2
const OTHER = 0
const SKIP = -1

/**
 * Lines up the page's words with the words heard: for each page word, the heard word it was spoken as (null when it
 * wasn't heard), and whether that is a real match (the same word, or nearly) rather than a word said differently.
 */
export function alignWords(page: readonly string[], heard: readonly string[]): { j: number | null; match: boolean }[] {
  const n = page.length
  const m = heard.length
  const score: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  for (let i = 1; i <= n; i++) score[i]![0] = i * SKIP
  for (let j = 1; j <= m; j++) score[0]![j] = j * SKIP
  const pair = (i: number, j: number): number => {
    const l = likeness(page[i]!, heard[j]!)
    return l === 3 ? SAME : l === 2 ? NEAR : OTHER
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      score[i]![j] = Math.max(score[i - 1]![j - 1]! + pair(i - 1, j - 1), score[i - 1]![j]! + SKIP, score[i]![j - 1]! + SKIP)
    }
  }
  const out: { j: number | null; match: boolean }[] = Array.from({ length: n }, () => ({ j: null, match: false }))
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const here = score[i]![j]!
    const p = pair(i - 1, j - 1)
    const diagonal = here === score[i - 1]![j - 1]! + p
    // A word said as something else ("Siobhan" heard as "shiv awn") is taken as the first of the words heard for it.
    if (diagonal && p === OTHER && here === score[i]![j - 1]! + SKIP) j--
    else if (diagonal) {
      out[i - 1] = { j: j - 1, match: p > OTHER }
      i--
      j--
    } else if (here === score[i - 1]![j]! + SKIP) i--
    else j--
  }
  return out
}

/** Below this share of the page's words heard as written, the times aren't trusted: estimated instead. */
export const MIN_MATCHED = 0.4
/** A rough speaking speed, for a clip that isn't to hand: characters a second. */
export const CHARS_PER_SECOND = 15

/** Estimates: each place's share of the clip's characters, of its length (or at a rough speaking speed). */
export function estimateTimes(o: { from: number; to: number; at: readonly number[]; duration: number | null }): number[] {
  const span = Math.max(1, o.to - o.from)
  return o.at.map((a) => {
    const into = Math.max(0, Math.min(span, a - o.from))
    const t = o.duration != null ? (o.duration * into) / span : into / CHARS_PER_SECOND
    return Math.round(t * 1000) / 1000
  })
}

/**
 * When each place in a clip is heard, from the words heard: the place's word (the one it is in, else the next) lined
 * up with the words heard; a word not heard takes a time between its neighbours'. Null when too few words line up.
 */
export function alignedTimes(o: { text: string; from: number; to: number; at: readonly number[]; heard: readonly HeardWord[] }): number[] | null {
  const words = pageWords(o.text, o.from, o.to)
  const heard = o.heard.map((h) => ({ ...h, word: normWord(h.word) })).filter((h) => h.word)
  if (!words.length || !heard.length) return null
  const lined = alignWords(
    words.map((w) => w.word),
    heard.map((h) => h.word)
  )
  const matched = lined.filter((l) => l.match).length
  if (matched / words.length < MIN_MATCHED) return null
  const timeOf = (k: number): number => {
    const l = lined[k]!
    if (l.j !== null) return heard[l.j]!.start
    // Not heard: between the last word heard before it and the next after, by characters.
    let p = k - 1
    while (p >= 0 && lined[p]!.j === null) p--
    let q = k + 1
    while (q < lined.length && lined[q]!.j === null) q++
    const after = p >= 0 ? heard[lined[p]!.j!]!.end : null
    const next = q < lined.length ? heard[lined[q]!.j!]!.start : null
    if (after === null) return next ?? 0
    if (next === null) return after
    const a = words[p]!.end
    const b = words[q]!.start
    return after + ((next - after) * (words[k]!.start - a)) / Math.max(1, b - a)
  }
  return o.at.map((a) => {
    let k = words.findIndex((w) => w.end > a)
    if (k < 0) k = words.length - 1
    return Math.round(timeOf(k) * 1000) / 1000
  })
}

/** What the dictation engine heard in a clip, as kept beside it in the audio cache. */
export interface HeardFile {
  v: 1
  engine: string
  words: HeardWord[]
}

/** Asks the speech server to hear a clip: its words and times; 'no-aligner' when it has no dictation engine; null on failure. */
export async function hearClip(fetcher: Fetcher, wav: Buffer): Promise<HeardFile | 'no-aligner' | null> {
  let res: Response
  try {
    res = await fetcher('/align', {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: new Uint8Array(wav),
      timeoutMs: 60_000
    })
  } catch {
    return null
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 503 && detail.includes('no-aligner')) return 'no-aligner'
    console.warn(`[sounds] hearing a clip's words failed: ${res.status} ${detail.slice(0, 200)}`)
    return null
  }
  const body = (await res.json().catch(() => null)) as { words?: unknown; engine?: unknown } | null
  if (!body || !Array.isArray(body.words)) return null
  const words = body.words
    .filter(
      (w): w is HeardWord =>
        !!w && typeof w === 'object' && typeof (w as HeardWord).word === 'string' && Number.isFinite((w as HeardWord).start) && Number.isFinite((w as HeardWord).end)
    )
    .map((w) => ({ word: w.word.slice(0, 80), start: w.start, end: w.end }))
    .slice(0, 5000)
  return { v: 1, engine: typeof body.engine === 'string' ? body.engine.slice(0, 40) : '', words }
}

/** The audio cache, as timing uses it. */
export interface ClipStore {
  get(key: string): Promise<Buffer | null>
  getExtra(key: string, name: string): Promise<string | null>
  putExtra(key: string, name: string, data: string): Promise<void>
}

/** Remembered this long: the server has no dictation engine; and a clip that couldn't be heard. */
export const NO_ALIGNER_MS = 60_000
export const FAILED_MS = 10 * 60_000

/** Times the sounds of clips: from the words heard (kept beside each clip), else estimates. */
export class CueTimer {
  private noAligner = 0
  private failed = new Map<string, number>()
  private hearing = new Map<string, Promise<HeardFile | null>>()

  constructor(
    private readonly cache: ClipStore,
    private readonly fetcher: Fetcher,
    private readonly now: () => number = Date.now
  ) {}

  /** The words heard in a clip: kept, else asked for (once at a time) and kept. */
  private async heard(key: string, wav: Buffer): Promise<HeardFile | null> {
    const kept = await this.cache.getExtra(key, 'words').catch(() => null)
    if (kept) {
      try {
        const f = JSON.parse(kept) as HeardFile
        if (f?.v === 1 && Array.isArray(f.words)) return f
      } catch {
        /* unreadable: heard again */
      }
    }
    if (this.now() < this.noAligner || this.now() < (this.failed.get(key) ?? 0)) return null
    let pending = this.hearing.get(key)
    if (!pending) {
      pending = hearClip(this.fetcher, wav).then(async (got) => {
        if (got === 'no-aligner') {
          this.noAligner = this.now() + NO_ALIGNER_MS
          return null
        }
        if (!got) {
          this.failed.set(key, this.now() + FAILED_MS)
          return null
        }
        await this.cache.putExtra(key, 'words', JSON.stringify(got)).catch((e) => console.warn('[sounds] could not keep the words heard', e))
        return got
      })
      this.hearing.set(key, pending)
      void pending.finally(() => this.hearing.delete(key)).catch(() => undefined)
    }
    return pending
  }

  /** When each place in a clip (`key`: its audio cache key) is heard, in seconds from its start. Never throws. */
  async times(o: { key: string; text: string; from: number; to: number; at: readonly number[] }): Promise<{ seconds: number[]; aligned: boolean }> {
    const wav = await this.cache.get(o.key).catch(() => null)
    const duration = wav ? wavSeconds(wav) : null
    if (wav) {
      const heard = await this.heard(o.key, wav).catch(() => null)
      const times = heard ? alignedTimes({ text: o.text, from: o.from, to: o.to, at: o.at, heard: heard.words }) : null
      if (times) return { seconds: duration != null ? times.map((t) => Math.min(t, duration)) : times, aligned: true }
    }
    return { seconds: estimateTimes({ from: o.from, to: o.to, at: o.at, duration }), aligned: false }
  }
}
