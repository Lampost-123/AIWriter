// The AI's sound marks (AI sound effects under Read aloud): which sounds each paragraph has and where, kept per scene
// in the app's data folder (`speech-cache/sounds/<world>/<scene>.json`), never in the world, each paragraph's with the
// hash of its words, as the speaker marks are (readAloud/marks.ts). Every paragraph the AI was asked about is kept,
// with no sounds too, so it isn't asked again until its words change.
//
// The SoundMarker asks the AI as reading goes, beside the speaker marks and in the same rhythm: a part of the scene at
// a time, a little ahead of the voice (a small part as a reading starts), at most one call per paragraph at a time.
// Paragraphs that are Adam's are never marked. Failures are quiet: sounds never interrupt a reading.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { CueAnchor, SceneCue } from '@shared/contracts/sounds'
import type { ID } from '@shared/types'
import { readJson, writeFileAtomic } from '../util'
import { textHash, type Ask } from '../readAloud/marks'
import { MARK_FIRST, MARK_PART } from '../readAloud/speakers'
import { normaliseKey } from './library'
import { CONTEXT, locate, numberedPids, parseSounds, SOUNDS_PROMPT, soundsUser, type PromptParagraph, type SaidSound, type ShownSound } from './prompt'
import { ambienceAt, type MarkedCue, type Paragraph } from './scene'

/** A paragraph's sounds as kept: with the hash of the words they were marked for. */
export interface KeptSounds {
  hash: string
  cues: MarkedCue[]
}

interface SoundsFile {
  v: 1
  paragraphs: Record<string, KeptSounds>
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/

export class SoundStore {
  constructor(readonly dir: string) {}

  private fileOf(worldId: ID, sceneId: ID): string | null {
    if (!SAFE_ID.test(worldId) || !SAFE_ID.test(sceneId)) return null
    return join(this.dir, worldId, `${sceneId}.json`)
  }

  /** Everything kept for a scene, whatever its words are now. */
  load(worldId: ID, sceneId: ID): Record<string, KeptSounds> {
    const file = this.fileOf(worldId, sceneId)
    if (!file) return {}
    const kept = readJson<Partial<SoundsFile>>(file, {})
    return kept.v === 1 && kept.paragraphs && typeof kept.paragraphs === 'object' ? kept.paragraphs : {}
  }

  /** The marks of these paragraphs whose words are the ones they were made for (an entry, maybe empty, means "asked"). */
  current(worldId: ID, sceneId: ID, paragraphs: readonly Paragraph[]): Map<string, MarkedCue[]> {
    const kept = this.load(worldId, sceneId)
    const out = new Map<string, MarkedCue[]>()
    for (const p of paragraphs) {
      const k = kept[p.pid]
      if (k && k.hash === textHash(p.text) && Array.isArray(k.cues)) out.set(p.pid, k.cues)
    }
    return out
  }

  /**
   * Keeps marks for some paragraphs (`got`: each with the words they were made for). `scene`: the paragraphs whose
   * words are known now, so marks for any of them whose words changed are dropped; `all`: every paragraph the scene
   * has, when known, so marks for paragraphs it no longer has are dropped too.
   */
  save(worldId: ID, sceneId: ID, got: { pid: string; text: string; cues: MarkedCue[] }[], scene: readonly Paragraph[], all?: ReadonlySet<string>): void {
    const file = this.fileOf(worldId, sceneId)
    if (!file) return
    const now = new Map(scene.map((p) => [p.pid, textHash(p.text)]))
    const stays = ([pid, k]: [string, KeptSounds]): boolean => (now.has(pid) ? now.get(pid) === k.hash : !all || all.has(pid))
    const kept = Object.fromEntries(Object.entries(this.load(worldId, sceneId)).filter(stays))
    for (const g of got) {
      const hash = textHash(g.text)
      if (now.get(g.pid) !== hash) continue
      kept[g.pid] = { hash, cues: g.cues }
    }
    const out: SoundsFile = { v: 1, paragraphs: kept }
    writeFileAtomic(file, JSON.stringify(out))
  }
}

/** A cue the AI marked gets an id that stays the same while its paragraph's words do. */
export const aiCueId = (pid: string, hash: string, description: string, from: number): string =>
  `ai:${createHash('sha256').update(`${pid}\n${hash}\n${normaliseKey(description)}\n${from}`).digest('hex').slice(0, 16)}`

/** At most this many sounds in one paragraph (it should be far fewer). */
export const MAX_PER_PARAGRAPH = 2

/** What a reply adds: each numbered paragraph's sounds (none too), and an end for an ambience started before. */
export interface ReplyCues {
  cues: Map<string, MarkedCue[]>
  /** The ambience playing as the part started (the AI's, in an earlier paragraph) ends here. */
  ends?: { pid: string; cueId: string; until: CueAnchor; untilHash: string }
}

/**
 * The AI's reply as cues: each sound found where it said (dropped when its words can't be found), an ambience that is
 * already playing not started again, and at most a couple of sounds in a paragraph. `playing`: the ambience playing as
 * the part starts.
 */
export function cuesFromReply(said: SaidSound[], part: PromptParagraph[], playing: SceneCue | null): ReplyCues {
  const numbered = numberedPids(part)
  const order = new Map(part.map((p, i) => [p.pid, i]))
  const textOf = new Map(part.map((p) => [p.pid, p.text]))
  const placeOf = (p: number, at: string, word: string): CueAnchor | null => {
    const pid = numbered[p - 1]
    return pid ? locate(textOf.get(pid)!, pid, at, word) : null
  }
  const after = (a: CueAnchor, b: CueAnchor): boolean => order.get(b.pid)! > order.get(a.pid)! || (a.pid === b.pid && b.from > a.from)
  const found = said
    .map((s) => ({ s, at: placeOf(s.p, s.at, s.word) }))
    .filter((x): x is { s: SaidSound; at: CueAnchor } => !!x.at)
    .sort((a, b) => order.get(a.at.pid)! - order.get(b.at.pid)! || a.at.from - b.at.from)
  const cues = new Map<string, MarkedCue[]>(numbered.map((pid) => [pid, []]))
  const out: ReplyCues = { cues }
  // What is playing as each sound is reached: the one from before the part, or one of this reply's.
  let now: { before: SceneCue } | { mine: MarkedCue } | null = playing ? { before: playing } : null
  const describe = (n: typeof now): string => (n ? normaliseKey('before' in n ? n.before.description : n.mine.description) : '')
  for (const { s, at } of found) {
    const list = cues.get(at.pid)!
    if (s.type === 'stop') {
      if (now && 'mine' in now && !now.mine.until && after(now.mine.at, at)) {
        now.mine.until = at
        now.mine.untilHash = textHash(textOf.get(at.pid)!)
      } else if (now && 'before' in now && now.before.origin === 'ai' && !out.ends) {
        out.ends = { pid: now.before.at.pid, cueId: now.before.id, until: at, untilHash: textHash(textOf.get(at.pid)!) }
      }
      now = null
      continue
    }
    if (list.length >= MAX_PER_PARAGRAPH) continue
    const hash = textHash(textOf.get(at.pid)!)
    const id = aiCueId(at.pid, hash, s.sound, at.from)
    if ([...cues.values()].some((l) => l.some((c) => c.id === id))) continue
    if (s.type === 'effect') {
      list.push({ id, kind: 'effect', description: s.sound, ...(s.seconds ? { seconds: s.seconds } : {}), at, until: null })
      continue
    }
    // Already playing: not started again.
    if (describe(now) === normaliseKey(s.sound)) continue
    const cue: MarkedCue = { id, kind: 'ambience', description: s.sound, at, until: null }
    const u = s.until ? placeOf(s.until.p, s.until.at, s.until.word) : null
    if (u && after(at, u)) {
      cue.until = u
      cue.untilHash = textHash(textOf.get(u.pid)!)
    }
    list.push(cue)
    now = cue.until ? null : { mine: cue }
  }
  return out
}

/** The scene as the SoundMarker sees it. */
export interface SoundScene {
  worldId: ID
  sceneId: ID
  /** The scene's paragraphs as known now, in order. */
  paragraphs: Paragraph[]
  /** The paragraphs being read, in order, from where reading is now (none: marking in the background). */
  run: string[]
  /** Where reading is in the run's first paragraph, in characters. */
  offset?: number
  /** Adam's paragraphs: never marked. */
  owned: ReadonlySet<string>
  /** Every paragraph id the scene has now, when known. */
  pids?: ReadonlySet<string>
}

export interface SoundMarkerDeps {
  store: SoundStore
  /** A way to ask the AI for this scene, or why it can't be asked. */
  ask(sceneId: ID): { call: Ask; stop: () => void } | { error: string }
  /** The library sounds to show the AI for a part's words. */
  library(text: string): ShownSound[]
  /** The scene's sounds as they stand now. */
  cuesOf(s: SoundScene): SceneCue[]
  /** New marks were kept for these paragraphs (a reading plans again). */
  done(sceneId: ID, pids: string[]): void
  /** The sounds just marked, in order: wanted in the library. */
  found(s: SoundScene, cues: MarkedCue[]): void
}

/** Where reading asks again (ReadingPlan.markAhead). */
export interface Ahead {
  pid: string
  at: number
}

/** Paragraphs that failed are left alone this long. */
const RETRY_MS = 120_000

interface RunEntry {
  p: Paragraph
  from: number
  start: number
  end: number
}

function runOf(s: SoundScene): RunEntry[] {
  const byId = new Map(s.paragraphs.map((p) => [p.pid, p]))
  const out: RunEntry[] = []
  let pos = 0
  s.run.forEach((pid, i) => {
    const p = byId.get(pid)
    if (!p) return
    const from = i === 0 ? Math.min(Math.max(0, s.offset ?? 0), p.text.length) : 0
    out.push({ p, from, start: pos, end: pos + p.text.length - from })
    pos += p.text.length - from
  })
  return out
}

function placeIn(run: RunEntry[], at: number): Ahead | undefined {
  const e = run.find((x) => at < x.end) ?? run.at(-1)
  return e ? { pid: e.p.pid, at: e.from + Math.max(0, Math.min(at, e.end) - e.start) } : undefined
}

/** A part to ask about: its paragraphs as sent, and the scene's words before it. */
export interface SoundPart {
  paragraphs: PromptParagraph[]
  before: string
}

/**
 * The parts to ask about for the paragraphs in `wanted`: from the first of them, each about `size` characters (the
 * first `first`), with the paragraphs between them shown as context ([--]), each ending with a paragraph it asks about.
 */
export function soundParts(paragraphs: readonly Paragraph[], wanted: ReadonlySet<string>, first = MARK_FIRST, size = MARK_PART): SoundPart[] {
  const parts: SoundPart[] = []
  let plain = ''
  let part: (SoundPart & { len: number; last: number }) | null = null
  const close = (p: SoundPart & { last: number }): void => {
    if (p.last >= 0) parts.push({ paragraphs: p.paragraphs.slice(0, p.last + 1), before: p.before })
  }
  for (const p of paragraphs) {
    if (!p.text.trim()) continue
    const asked = wanted.has(p.pid)
    if (part && part.len + p.text.length > (parts.length ? size : first) && part.last >= 0) {
      close(part)
      part = null
    }
    if (asked || part) {
      part ??= { paragraphs: [], before: plain.slice(-CONTEXT), len: 0, last: -1 }
      part.paragraphs.push({ pid: p.pid, text: p.text, owned: !asked })
      part.len += p.text.length
      if (asked) part.last = part.paragraphs.length - 1
    }
    plain += (plain ? '\n\n' : '') + p.text
  }
  if (part) close(part)
  return parts
}

/**
 * Starts and keeps track of the AI's sound marking: at most one call per paragraph at a time, a part at a time a
 * little ahead of the reading, the parts of one go asked one after another (so each knows what the last left
 * playing), and nothing asked again soon after it failed.
 */
export class SoundMarker {
  private busy = new Map<string, Map<string, number>>()
  private live = new Map<number, { key: string; stop: () => void }>()
  private failed = new Map<string, Map<string, { hash: string; at: number }>>()
  private calls = 0

  constructor(private readonly deps: SoundMarkerDeps) {}

  private key = (worldId: ID, sceneId: ID): string => `${worldId}:${sceneId}`

  /** The paragraphs of a scene being marked now. */
  busyIn(worldId: ID, sceneId: ID): Set<string> {
    return new Set(this.busy.get(this.key(worldId, sceneId))?.keys() ?? [])
  }

  /** Paragraphs the AI could be asked about now: not Adam's, with words, not marked for these words, not busy or failing. */
  private openIn(s: SoundScene): (p: Paragraph) => boolean {
    const key = this.key(s.worldId, s.sceneId)
    const kept = this.deps.store.current(s.worldId, s.sceneId, s.paragraphs)
    const busy = this.busy.get(key)
    const failed = this.failed.get(key)
    return (p) => {
      if (s.owned.has(p.pid) || !/[\p{L}\p{N}]/u.test(p.text) || kept.has(p.pid) || busy?.has(p.pid)) return false
      const f = failed?.get(p.pid)
      return !(f && f.hash === textHash(p.text) && Date.now() - f.at < RETRY_MS)
    }
  }

  /**
   * As a reading plans: when it is about to reach paragraphs with no sound marks, the AI marks the part from there
   * (and, as a reading starts, a small part first, then the next). Returns `again`: where the reading should ask
   * again, a little before the next paragraph that needs marks, so they keep ahead of it to the end of the scene.
   */
  note(s: SoundScene): { again?: Ahead } {
    const run = runOf(s)
    let open = this.openIn(s)
    const first = run.find((e) => open(e.p))
    if (first && first.start <= MARK_FIRST) {
      const starting = first.start < MARK_FIRST / 2
      const ids = new Set(run.filter((e) => e.end > first.start && e.start < first.start + MARK_FIRST + MARK_PART && open(e.p)).map((e) => e.p.pid))
      const parts = soundParts(s.paragraphs, ids, starting ? MARK_FIRST : MARK_PART).slice(0, starting ? 2 : 1)
      this.askParts(s, parts)
      open = this.openIn(s)
    }
    const next = run.find((e) => open(e.p))
    const again = next ? placeIn(run, Math.max(0, next.start - MARK_FIRST)) : undefined
    return again ? { again } : {}
  }

  /**
   * Marks these paragraphs in the background, all of them, a part at a time (a draft just landed, or Find sounds).
   * Returns the paragraphs being marked now, or why the AI can't be asked.
   */
  noteAll(s: SoundScene, pids: ReadonlySet<string>): { busy: Set<string>; error?: string } {
    const open = this.openIn(s)
    const ids = new Set(s.paragraphs.filter((p) => pids.has(p.pid) && open(p)).map((p) => p.pid))
    const error = this.askParts(s, soundParts(s.paragraphs, ids, MARK_PART, MARK_PART))
    return { busy: this.busyIn(s.worldId, s.sceneId), ...(error ? { error } : {}) }
  }

  /** Asks about the parts one after another. Returns why the AI can't be asked, if it can't. */
  private askParts(s: SoundScene, parts: SoundPart[]): string | undefined {
    if (!parts.length) return undefined
    const key = this.key(s.worldId, s.sceneId)
    const got = this.deps.ask(s.sceneId)
    if ('error' in got) {
      // No model for it: these paragraphs aren't asked about again for a while (the reading goes on without sounds).
      console.warn('[sounds] the AI could not be asked to mark sounds:', got.error)
      const f = this.failed.get(key) ?? this.failed.set(key, new Map()).get(key)!
      for (const p of parts.flatMap((x) => x.paragraphs.filter((q) => !q.owned))) f.set(p.pid, { hash: textHash(p.text), at: Date.now() })
      return got.error
    }
    const busy = this.busy.get(key) ?? this.busy.set(key, new Map()).get(key)!
    const token = ++this.calls
    this.live.set(token, { key, stop: got.stop })
    const asked = parts.map((part) => numberedPids(part.paragraphs))
    for (const pid of asked.flat()) busy.set(pid, token)
    void (async () => {
      for (const [i, part] of parts.entries()) {
        if (!this.live.has(token)) return
        await this.askPart(s, part, got.call, token).catch((e: unknown) => {
          console.warn('[sounds] marking sounds failed', e)
          this.release(key, s, asked[i]!, token, true)
        })
      }
    })().finally(() => {
      this.live.delete(token)
      // Anything still marked busy by this run (it was stopped partway) is free again.
      const b = this.busy.get(key)
      if (b) for (const [pid, t] of [...b]) if (t === token) b.delete(pid)
    })
    return undefined
  }

  /** Frees paragraphs a call had; `failed`: not asked about again for a while. */
  private release(key: string, s: SoundScene, pids: string[], token: number, failed: boolean): string[] {
    const busy = this.busy.get(key)
    const mine = pids.filter((pid) => busy?.get(pid) === token)
    for (const pid of mine) busy!.delete(pid)
    if (failed && mine.length) {
      const f = this.failed.get(key) ?? this.failed.set(key, new Map()).get(key)!
      const byId = new Map(s.paragraphs.map((p) => [p.pid, p]))
      for (const pid of mine) f.set(pid, { hash: textHash(byId.get(pid)?.text ?? ''), at: Date.now() })
    }
    return mine
  }

  private async askPart(s: SoundScene, part: SoundPart, call: Ask, token: number): Promise<void> {
    const key = this.key(s.worldId, s.sceneId)
    const pids = numberedPids(part.paragraphs)
    const firstPid = part.paragraphs[0]!.pid
    const playing = ambienceAt(this.deps.cuesOf(s), s.paragraphs, firstPid, 0)
    const text = part.paragraphs.map((p) => p.text).join('\n\n')
    const user = soundsUser({ before: part.before, playing: playing?.description ?? null, library: this.deps.library(text), paragraphs: part.paragraphs })
    const { text: reply, error } = await call({ system: SOUNDS_PROMPT, user, reply: 300 + pids.length * 60, temperature: 0.3 })
    // Stopped (the reading ended, the world closed): the reply is dropped.
    if (!this.live.has(token)) return
    if (reply == null) {
      if (error) console.warn('[sounds] marking sounds failed:', error)
      this.release(key, s, pids, token, true)
      return
    }
    const got = cuesFromReply(parseSounds(reply), part.paragraphs, playing)
    const mine = this.release(key, s, pids, token, false)
    if (!mine.length) return
    const textOf = new Map(s.paragraphs.map((p) => [p.pid, p.text]))
    const saved = mine.map((pid) => ({ pid, text: textOf.get(pid) ?? '', cues: got.cues.get(pid) ?? [] }))
    if (got.ends) {
      // The ambience playing as the part started (the AI's, earlier in the scene) ends where the AI said.
      const kept = this.deps.store.current(s.worldId, s.sceneId, s.paragraphs).get(got.ends.pid)
      const ends = got.ends
      if (kept && !s.owned.has(ends.pid)) {
        const cues = kept.map((c) => (c.id === ends.cueId ? { ...c, until: ends.until, untilHash: ends.untilHash } : c))
        saved.push({ pid: ends.pid, text: textOf.get(ends.pid) ?? '', cues })
      }
    }
    try {
      this.deps.store.save(s.worldId, s.sceneId, saved, s.paragraphs, s.pids)
    } catch (e) {
      console.warn('[sounds] could not keep the sound marks', e)
      return
    }
    const cues = mine.flatMap((pid) => got.cues.get(pid) ?? [])
    if (cues.length) this.deps.found(s, cues)
    this.deps.done(s.sceneId, saved.map((x) => x.pid))
  }

  /** Stops marking a scene (its reading stopped): calls in flight are stopped and their replies dropped. */
  stop(worldId: ID, sceneId: ID): void {
    const key = this.key(worldId, sceneId)
    this.busy.delete(key)
    this.failed.delete(key)
    for (const [t, c] of [...this.live]) {
      if (c.key !== key) continue
      this.live.delete(t)
      c.stop()
    }
  }

  /** Find sounds: paragraphs that failed lately may be asked about again at once. */
  forgive(worldId: ID, sceneId: ID): void {
    this.failed.delete(this.key(worldId, sceneId))
  }

  /** The world closed: forget everything (its calls are stopped by the task runner). */
  forgetAll(): void {
    this.busy.clear()
    this.failed.clear()
    this.live.clear()
  }
}
