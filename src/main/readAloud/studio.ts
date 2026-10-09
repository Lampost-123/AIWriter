// Adapted from mcreader-v2, src/server/speech/library.ts (the studio voice library: pickVoices, castingPrompt,
// ageHint, describeVoice) and src/server/speech/cast.ts (castFromLibrary, recastFromLibrary) (reading aloud's own
// text-to-speech code; Adam's rule, 2 October 2026). MCreader cast a story's characters; AI Write casts a world's.
//
// The studio voices: real people recorded in a studio (the speech server's voices/library/, downloaded from the EARS
// dataset), which characters are given instead of a voice designed from a description. A designed voice copies
// whatever microphone and room Breeze imagined with it, and some came out tinny or echoey; these can't. The Read
// aloud model picks a voice for each character from what is known of them, all different, and the rules fill in what
// it didn't (or everyone, when it can't be reached). A character's description is kept: clearing the pick goes back to
// it. Nothing here ever replaces a voice picked from the list.
import type Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage, Entry, ID, SpeechSettings } from '@shared/types'
import * as repo from '../db/repo'
import { runTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import { newId } from '../util'
import { getEntryReadAloud, hasOwnVoice, readAloudOf, setEntryReadAloud } from './voiceStore'

type DB = Database.Database

export interface StudioVoice {
  id: string
  /** A first name for the voice ("Clara"). */
  name?: string
  gender: 'male' | 'female'
  /** The age band, as the dataset gives it ("26-35"). */
  age: string
  /** Low, mid or high, for their gender across the library. */
  pitch?: 'low' | 'mid' | 'high'
}

/** The studio voices in their folder (index.json), or none when they aren't downloaded or the list can't be read. */
export function readStudioVoices(dir: string | null): StudioVoice[] {
  if (!dir) return []
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.flatMap((v): StudioVoice[] => {
      const r = (v ?? {}) as Record<string, unknown>
      if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(r.id)) return []
      if (r.gender !== 'male' && r.gender !== 'female') return []
      const pitch = r.pitch === 'low' || r.pitch === 'mid' || r.pitch === 'high' ? r.pitch : undefined
      return [
        {
          id: r.id,
          gender: r.gender,
          age: typeof r.age === 'string' ? r.age.slice(0, 20) : '',
          ...(typeof r.name === 'string' && r.name ? { name: r.name.slice(0, 40) } : {}),
          ...(pitch ? { pitch } : {})
        }
      ]
    })
  } catch {
    return []
  }
}

/** The speech server's voice id that plays a studio voice. */
export const studioClip = (id: string): string => `clip:library/${id}.wav`
/** The studio voice a voice id plays, if it is one. */
export const studioIdOf = (voice: string | undefined): string | null => voice?.match(/^clip:library\/([A-Za-z0-9_-]+)\.wav$/)?.[1] ?? null

/** How a studio voice is described to the model that casts: who they sound like, in a few words. */
const describeVoice = (v: StudioVoice): string => `${v.id}: ${v.gender === 'female' ? 'woman' : 'man'}, ${v.age}, ${v.pitch ?? 'mid'} voice`

/** The age band a description suggests, as the library's bands go, or null. */
export function ageHint(text: string): string | null {
  const t = text.toLowerCase()
  // A number first: "34 years old", "a 34-year-old", "aged 60", "age 52".
  const years = t.match(/\b(\d{1,3})[- ]?(?:years?|yrs?)[- ]?old\b/) ?? t.match(/\bage[ds]?:? (\d{1,3})\b/)
  if (years) return bandOfYears(Number(years[1]))
  const decade = decadeYears(t)
  if (decade !== null) return bandOfYears(decade)
  if (/\b(elderly|old (?:man|woman|lady)|grand(?:mother|father|ma|pa)|aged)\b/.test(t)) return '66-75'
  if (/\b(older|retired|veteran|grey-haired|gray-haired)\b/.test(t)) return '56-65'
  if (/\b(middle-aged)\b/.test(t)) return '46-55'
  if (/\b(child|children|kid|teen\w*|student|young|youth|girl|boy|college)\b/.test(t)) return '18-25'
  return null
}

/** A character's Age field as an age band: "34", "34 years old", "mid-30s", "early twenties", "child"; null when unclear. */
export function ageFieldBand(field: string): string | null {
  const t = field.trim().toLowerCase()
  if (!t) return null
  const bare = t.match(/^(?:about |around |roughly |~)?(\d{1,3})\+?$/)
  if (bare) return bandOfYears(Number(bare[1]))
  return ageHint(t)
}

const DECADES: Record<string, number> = { twenties: 20, thirties: 30, forties: 40, fifties: 50, sixties: 60, seventies: 70, eighties: 80, nineties: 90 }

/** "mid-30s", "late forties", "in her 50s": the age it suggests (early 2, mid or none 5, late 8 into the decade). */
function decadeYears(t: string): number | null {
  const m = t.match(/\b(?:(early|mid|late)[- ])?(?:(\d)0'?s|(twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties))\b/)
  if (!m) return null
  const base = m[2] ? Number(m[2]) * 10 : DECADES[m[3]!]!
  if (base < 20) return null
  return base + (m[1] === 'early' ? 2 : m[1] === 'late' ? 8 : 5)
}

/** An age in years as the library's band: under 26 the youngest (there are no children's voices), over 65 the oldest. */
function bandOfYears(n: number): string {
  if (n <= 25) return '18-25'
  if (n >= 66) return '66-75'
  return BANDS[Math.min(BANDS.length - 1, Math.floor((n - 26) / 10) + 1)]!
}

const BANDS = ['18-25', '26-35', '36-45', '46-55', '56-65', '66-75']
const bandGap = (a: string, b: string): number => {
  const i = BANDS.indexOf(a)
  const j = BANDS.indexOf(b)
  return i < 0 || j < 0 ? 2 : Math.abs(i - j)
}

/**
 * A character's gender for casting: a Sex or Gender field when their page has one, else their pronouns, else how their
 * voice or page describes them; null when unsure.
 */
export function genderOf(pronouns: string, words: string, field = ''): 'male' | 'female' | null {
  const f = field.trim().toLowerCase()
  if (/^(f|female|woman|girl|she\b)/.test(f)) return 'female'
  if (/^(m|male|man|boy|he\b)/.test(f)) return 'male'
  const p = pronouns.toLowerCase()
  if (/\bshe\b|\bher\b/.test(p)) return 'female'
  if (/\bhe\b|\bhim\b/.test(p)) return 'male'
  const t = words.toLowerCase()
  const female = /\b(woman|women|girl|lady|female|mother|grandmother|she|her)\b/.test(t)
  const male = /\b(man|men|boy|gentleman|male|father|grandfather|he|his|him)\b/.test(t)
  return female && !male ? 'female' : male && !female ? 'male' : null
}

export interface CastingNeed {
  id: ID
  name: string
  gender: 'male' | 'female' | null
  /** What is known of them: their voice's description, their one line, their page. */
  about: string
  /** Their age band from their Age field, which wins over what the words suggest; null or absent when it doesn't say. */
  age?: string | null
}

/**
 * A studio voice for each character, all different and none in `used`: the model's pick when it gives one that fits
 * (the right gender, not taken), else the closest by gender, age and pitch the character's words suggest.
 */
export function pickVoices(
  needs: CastingNeed[],
  voices: StudioVoice[],
  used: Set<string>,
  suggested: Record<string, string> = {}
): Record<ID, string> {
  const taken = new Set(used)
  const out: Record<ID, string> = {}
  const fits = (need: CastingNeed, v: StudioVoice): boolean => !taken.has(v.id) && (!need.gender || v.gender === need.gender)
  for (const need of needs) {
    const offered = voices.find((v) => v.id === suggested[need.name])
    if (offered && fits(need, offered)) {
      out[need.id] = offered.id
      taken.add(offered.id)
      continue
    }
    const age = need.age ?? ageHint(need.about)
    const pitch = /\b(deep|low|gravel\w*|baritone|bass|husky|rumbl\w*)\b/i.test(need.about)
      ? 'low'
      : /\b(high|light|bright|thin|squeak\w*|piping)\b/i.test(need.about)
        ? 'high'
        : null
    const score = (v: StudioVoice): number => (age ? bandGap(v.age, age) * 2 : 0) + (pitch && v.pitch !== pitch ? 1 : 0)
    const best = voices.filter((v) => fits(need, v)).sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))[0]
    if (best) {
      out[need.id] = best.id
      taken.add(best.id)
    }
  }
  return out
}

/** The casting model's instructions and message: characters to cast, and the voices free for them. */
export function castingPrompt(needs: CastingNeed[], voices: StudioVoice[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You cast an audiobook. Each character needs a voice from a library of real studio recordings, described by gender, age and how low or high the voice is. ' +
        'Pick the voice that best fits who each character is: their gender, age, and the kind of person they are. Give every character a different voice, ' +
        'and make characters who talk to each other easy to tell apart. Reply with only a JSON object from each character\'s name to a voice id, like {"Mara": "p021"}.'
    },
    {
      role: 'user',
      content: [
        'CHARACTERS:',
        ...needs.map(
          (n) => `- ${n.name}${castingFacts(n)}${n.about ? `: ${n.about.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`
        ),
        '',
        'VOICES:',
        ...voices.map(describeVoice)
      ].join('\n')
    }
  ]
}

/** " (female, 26-35)": what is known for sure of a character's gender and age band, for the casting model. */
function castingFacts(n: CastingNeed): string {
  const facts = [n.gender, n.age ?? ageHint(n.about)].filter(Boolean)
  return facts.length ? ` (${facts.join(', ')})` : ''
}

/** The model's picks, read leniently: the first JSON object in the reply, its string values only. */
export function readCasting(text: string): Record<string, string> {
  try {
    const raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    return {}
  }
}

/** What casting knows of a character: their voice's description, their one line, and the start of their page. */
function needOf(db: DB, e: Entry): CastingNeed {
  const design = getEntryReadAloud(db, e.id).voice.design.trim()
  const about = [
    design,
    e.summary.trim(),
    (e.fields.age ?? '').trim() ? `Age: ${e.fields.age!.trim()}` : '',
    e.description.trim().slice(0, 300)
  ]
    .filter(Boolean)
    .join(' ')
  const sex = e.fields.sex ?? e.fields.gender ?? ''
  return {
    id: e.id,
    name: e.name,
    gender: genderOf(e.fields.pronouns ?? '', `${design} ${e.summary} ${e.description}`, sex),
    about,
    age: ageFieldBand(e.fields.age ?? '')
  }
}

/** The studio voices the world's characters (and the narrator) have now, so no one else is given them. */
function voicesInUse(db: DB, except: Set<ID>, narrator: string): Set<string> {
  const used = new Set<string>()
  const own = studioIdOf(narrator)
  if (own) used.add(own)
  for (const [id, v] of Object.entries(readAloudOf(db))) {
    const s = studioIdOf(v.voice.voice)
    if (s && !except.has(id)) used.add(s)
  }
  return used
}

export interface CastOptions {
  db: DB
  /** The studio voices downloaded (readStudioVoices). */
  voices: StudioVoice[]
  /** The narrator's voice, so no character sounds like the narrator. */
  narrator: string
  /** The Read aloud model; null casts by the rules alone. */
  model: JobModel | null
  emit?: Emit
  onKeyRejected?: () => void
  /** True once the caller has stopped: nothing is written. */
  stopped?: () => boolean
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
  /** Only characters with no voice of Adam's own (castByItself): those after the AI made them. */
  byItself?: boolean
}

/** "Give characters their own voices" and "Studio voices" are both on: the app may give studio voices by itself. */
export const castsByItself = (s: Pick<SpeechSettings, 'castVoices' | 'studioVoices'>): boolean => !!s.castVoices && s.studioVoices !== false

/** A character who can be given a studio voice: a character with no voice picked from the list. */
function castable(db: DB, e: Entry): boolean {
  return e.kind === 'character' && !getEntryReadAloud(db, e.id).voice.voice.trim()
}

/**
 * A character the app may give a studio voice by itself: no voice from the list, and no description of Adam's own (none
 * at all, or one the AI wrote, which is kept underneath). A voice Adam picked or a description he wrote is never cast over.
 */
export function castByItself(db: DB, e: Pick<Entry, 'id' | 'kind'>): boolean {
  return e.kind === 'character' && !getEntryReadAloud(db, e.id).voice.voice.trim() && !hasOwnVoice(db, e.id)
}

/**
 * Gives these characters studio voices, all different from each other and from the ones the rest of the world has. A
 * character with a voice picked from the list (a studio voice or another) is left alone, even one picked meanwhile.
 * Their descriptions are kept. Returns the characters given one. Never throws.
 */
export async function castFromStudio(o: CastOptions, entryIds: ID[]): Promise<ID[]> {
  if (!o.voices.length || !entryIds.length) return []
  let characters: Entry[]
  try {
    characters = repo.getEntries(o.db, [...new Set(entryIds)]).filter((e) => (o.byItself ? castByItself : castable)(o.db, e))
  } catch (e) {
    console.warn('Could not find the characters to give studio voices', e)
    return []
  }
  if (!characters.length) return []
  const needs = characters.map((e) => needOf(o.db, e))
  const used = voicesInUse(o.db, new Set(characters.map((e) => e.id)), o.narrator)
  let suggested: Record<string, string> = {}
  if (o.model) {
    try {
      const done = await runTask({
        db: o.db,
        taskId: newId(),
        job: 'speech',
        sceneId: null,
        model: o.model,
        messages: castingPrompt(
          needs,
          o.voices.filter((v) => !used.has(v.id))
        ),
        reply: 120 + needs.length * 20,
        temperature: 0.3,
        direction: needs.length === 1 ? `A studio voice for ${needs[0]!.name}` : `Studio voices for ${needs.length} characters`,
        emit: o.emit ?? (() => undefined),
        onKeyRejected: o.onKeyRejected,
        fetchImpl: o.fetchImpl,
        retryDelays: o.retryDelays
      })
      if (done.status === 'complete') suggested = readCasting(done.text)
    } catch (e) {
      // The rules cast alone.
      console.warn('Could not ask which studio voices fit', e)
    }
  }
  if (o.stopped?.() || !o.db.open) return []
  const picks = pickVoices(needs, o.voices, used, suggested)
  const cast: ID[] = []
  for (const e of characters) {
    const id = picks[e.id]
    if (!id) continue
    try {
      if (!repo.getEntries(o.db, [e.id]).length) continue
      const now = getEntryReadAloud(o.db, e.id)
      // Picked meanwhile (or, casting by itself, described by Adam meanwhile): theirs stays.
      if (now.voice.voice.trim() || (o.byItself && hasOwnVoice(o.db, e.id))) continue
      setEntryReadAloud(o.db, e.id, { ...now, voice: { design: now.voice.design, voice: studioClip(id) } }, { auto: true })
      cast.push(e.id)
    } catch (err) {
      console.warn('Could not save a studio voice', err)
    }
  }
  return cast
}

/** The world's characters who could be given a studio voice now: those with no voice picked from the list. */
export function castableCharacters(db: DB): ID[] {
  return repo
    .listEntries(db, 'character')
    .filter((e) => castable(db, e))
    .map((e) => e.id)
}

/**
 * Reading aloud's own casting, as it reads (and over the whole world once the studio voices are here): these
 * characters, the ones with no voice of Adam's own (none picked from the list, and no description or only one the AI
 * wrote: castByItself), are given a studio voice by the rules alone (`castFromStudio` with no model, at once),
 * saved on their page so Adam sees it there and can change it. All different from each other and from the ones the
 * rest of the world has, and never the narrator's. Returns the characters given one. Never throws.
 */
export function castVoiceless(db: DB, voices: StudioVoice[], narrator: string, entryIds: ID[]): ID[] {
  if (!voices.length || !entryIds.length || !db.open) return []
  try {
    const characters = repo
      .getEntries(db, [...new Set(entryIds)])
      .filter((e) => castByItself(db, e))
    if (!characters.length) return []
    const picks = pickVoices(
      characters.map((e) => needOf(db, e)),
      voices,
      voicesInUse(db, new Set(characters.map((e) => e.id)), narrator)
    )
    const cast: ID[] = []
    for (const e of characters) {
      const id = picks[e.id]
      if (!id) continue
      const now = getEntryReadAloud(db, e.id)
      setEntryReadAloud(db, e.id, { ...now, voice: { design: now.voice.design, voice: studioClip(id) } }, { auto: true })
      cast.push(e.id)
    }
    return cast
  } catch (e) {
    console.warn('Could not give the characters studio voices', e)
    return []
  }
}
