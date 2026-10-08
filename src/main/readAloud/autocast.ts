// A speaker with no voice of their own is given one of the studio voices as they speak, so their lines aren't read by
// the narrator just because nobody picked them a voice. The world's characters are given theirs on their page
// (studio.ts castVoiceless); this is for the people the marks name who aren't in the world ("the guard"), and for a
// character whose page couldn't be written. Pure apart from the small store at the end.
//
// The rules (each tested in autocast.test.ts):
// - Only for someone with nothing in "How they sound": a voice picked from the list or a description is theirs.
// - A cast member by their entry id, someone the marks name ("the guard") by their label: the same speaker gets the
//   same voice every time, kept per world once given (the store), so a voice never moves when someone new turns up.
// - Matched by what the page says of them (studio.ts: gender, age and pitch words), all different while there are
//   voices free, and never the narrator's voice.
// - Nobody in particular ("someone", "a voice") gets none: the dialogue voice or the narrator reads them, as now.
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileAtomic } from '../util'
import type { CastMember } from './cast'
import { ageHint, genderOf, studioClip, studioIdOf, type StudioVoice } from './studio'

/** A speaker as casting knows them: a cast member's id, or `label:` and the words the marks name them by. */
export interface Castee {
  key: string
  /** Their names and what is known of them: the gender, age and pitch words come from here. */
  words: string
}

/** Labels that name nobody in particular: no voice of their own. */
const NOBODY = /^(?:someone|somebody|a voice|voices?|unknown|\?|everyone|all|they|the crowd|crowd|narrator|narration)$/i

/** The key a label is cast under: no case, no "the" or "a", single spaces. */
export function labelKey(label: string): string | null {
  const bare = label
    .toLowerCase()
    .replace(/^new:/, '')
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!bare || NOBODY.test(bare)) return null
  const key = bare.replace(/^(?:the|a|an) /, '')
  return key && !NOBODY.test(key) ? `label:${key}` : null
}

/** A small, steady number for a pair of strings (FNV-1a), so ties between equally good voices are broken the same way every time. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

const BANDS = ['18-25', '26-35', '36-45', '46-55', '56-65', '66-75']
const gap = (a: string, b: string): number => {
  const i = BANDS.indexOf(a)
  const j = BANDS.indexOf(b)
  return i < 0 || j < 0 ? 2 : Math.abs(i - j)
}

/** How well a voice fits someone: lower is better (Infinity: the wrong gender). */
function fit(c: Castee, v: StudioVoice): number {
  const gender = genderOf('', c.words)
  if (gender && v.gender !== gender) return Infinity
  const age = ageHint(c.words)
  const pitch = /\b(deep|low|gravel\w*|baritone|bass|husky|rumbl\w*)\b/i.test(c.words)
    ? 'low'
    : /\b(high|light|bright|thin|squeak\w*|piping)\b/i.test(c.words)
      ? 'high'
      : null
  return (age ? gap(v.age, age) * 2 : 0) + (pitch && v.pitch !== pitch ? 1 : 0)
}

/**
 * A studio voice for someone, as a speech server voice id: the one they were given before, else the best fit that
 * nobody has (`taken`: the voices the world's characters and earlier castees have), never `narrator`'s. When every
 * fitting voice is taken, the best fit is shared rather than none given. Null when there are no studio voices.
 */
export function pickFor(c: Castee, voices: StudioVoice[], taken: ReadonlySet<string>, narrator: string): string | null {
  const own = studioIdOf(narrator)
  const allowed = voices.filter((v) => v.id !== own && fit(c, v) < Infinity)
  const pool = allowed.length ? allowed : voices.filter((v) => v.id !== own)
  if (!pool.length) return null
  const order = (list: StudioVoice[]): StudioVoice[] =>
    [...list].sort((a, b) => fit(c, a) - fit(c, b) || hash(`${c.key}|${a.id}`) - hash(`${c.key}|${b.id}`) || a.id.localeCompare(b.id))
  const free = pool.filter((v) => !taken.has(v.id))
  return studioClip(order(free.length ? free : pool)[0]!.id)
}

/** What a world has given out so far: castee key → speech server voice id. */
export type Casting = Record<string, string>

export interface AutoCaster {
  /** The voice for this speaker, or null to read them as now (the dialogue voice, else the narrator). */
  voiceFor(who: CastMember | null, label?: string): string | null
  /** The voices given out while planning, so the caller can keep them (null when nothing new). */
  given(): Casting | null
}

/**
 * Casts the speakers of a world: `cast`, its characters (those with a voice of their own are never cast, and their
 * studio voices are nobody else's), `kept`, what was given before.
 */
export function autoCaster(o: { voices: StudioVoice[]; narrator: string; cast: CastMember[]; kept?: Casting }): AutoCaster {
  const kept: Casting = { ...(o.kept ?? {}) }
  let changed = false
  const taken = new Set<string>()
  for (const c of o.cast) {
    const s = studioIdOf(c.voice?.voice)
    if (s) taken.add(s)
  }
  for (const v of Object.values(kept)) {
    const s = studioIdOf(v)
    if (s) taken.add(s)
  }
  const ids = new Set(o.voices.map((v) => v.id))
  const give = (c: Castee): string | null => {
    const was = kept[c.key]
    // A voice given before stays, unless it went from the list or became the narrator's.
    if (was && ids.has(studioIdOf(was) ?? '') && studioIdOf(was) !== studioIdOf(o.narrator)) return was
    const got = pickFor(c, o.voices, taken, o.narrator)
    if (!got) return null
    kept[c.key] = got
    taken.add(studioIdOf(got)!)
    changed = true
    return got
  }
  return {
    voiceFor(who, label) {
      if (!o.voices.length) return null
      if (who) {
        if (who.voice?.voice?.trim() || who.voice?.design?.trim()) return null
        return give({ key: who.id, words: [who.name, ...who.names, who.about ?? ''].join(' ') })
      }
      const key = label ? labelKey(label) : null
      return key ? give({ key, words: key.slice('label:'.length) }) : null
    },
    given: () => (changed ? { ...kept } : null)
  }
}

/** The voices given out, per world, in a file of the app's user data (never the world): cast once, kept. */
export class CastingStore {
  constructor(readonly file: string) {}

  private all(): Record<string, Casting> {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Casting>) : {}
    } catch {
      return {}
    }
  }

  load(worldId: string): Casting {
    const got = this.all()[worldId]
    return got && typeof got === 'object' ? Object.fromEntries(Object.entries(got).filter(([, v]) => typeof v === 'string')) : {}
  }

  save(worldId: string, casting: Casting): void {
    const all = this.all()
    all[worldId] = casting
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileAtomic(this.file, JSON.stringify(all))
  }
}
