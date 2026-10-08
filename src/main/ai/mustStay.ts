// The "must stay true" list (step 4 of the consistency plan, Adam 2026-10-07): a short list of the facts that matter
// right now, written by the app, not the model, and sent right before the instruction to write, where models pay the
// most attention (the full briefing stays above it). Drawn from the stage (where things stand at the point of writing,
// continuity/tracker.ts) and from the codex entries in the scene, it holds only current values, each with where it
// became true: "Mara: left arm in a sling (since Ch 3, Sc 2)". Older values that no longer hold are never sent: near-miss
// facts confuse models. Capped, so it stays short. Since 2026-10-07 it also says what the people in the scene gave
// away, lost or got however long ago ("Wren: no longer has the brass compass (gave it to Mother Agate; since Ch 2,
// Sc 7)", memory/items.ts), the items the scene names first. Piece by piece (step 2b, Adam 2026-10-07): each piece of
// clothing is its own line ("Wren: boots off, by the door"), at most MUST_CLOTHES a person, those the scene names first;
// so is each thing in the place ("The door: barred from inside"), at most MUST_THINGS; and, carrying on inside a scene,
// who touches whom and who can see or hear whom. Pure.

import type { EntryState, FactState, ID } from '@shared/types'
import {
  clothesOf,
  heldNotPlaced,
  pieceClashes,
  pieceSource,
  sourceKey,
  thingKey,
  thingsOf,
  type CharacterState,
  type SceneState,
  type StateField,
  type StateSource
} from '@shared/continuity'
import { FIELD_GROUPS } from '@shared/fields'
import { isOff, namesItem as namesStageItem, pieceText, thingText, type StageItem } from '@shared/stageItems'
import { holdingLine, holdingsFirst, nameIn, namesItem, type Holding } from '../memory/items'
import { deathOf } from './deaths'
import { cleanKnows, happenedOf, pastDeathNote, type KnowsContext } from './knows'

/** The most lines the list holds; its short form, for a model with little room, holds fewer. */
export const MUST_MOST = 12
export const MUST_SHORT = 6
/** The most "does not know" lines among them. */
export const MUST_GAPS = 3
/** The most lines among them about what someone gave away, lost or got. */
export const MUST_ITEMS = 4
/** The most pieces of clothing a person, and things in the place, among them (those the scene names first). */
export const MUST_CLOTHES = 3
export const MUST_THINGS = 3
/** The longest a line's words are kept, in characters (since when it holds comes after, whole), and a secret's. */
const LONGEST_LINE = 320
const LONGEST_FACT = 200

export const MUST_TITLE = 'Must stay true'

/** What the list says first: at the start of a scene (as the one before ended), or where the writing carries on. */
export const MUST_LEAD = {
  start:
    'Keep to these unless the scene card says otherwise. They are true as this scene begins, and where anything above disagrees, these are right. Anything that changes, changes on the page.',
  here: 'Keep to these. They are true at this point in the scene, and where anything above disagrees, these are right. Anything that changes, changes on the page, in the words.'
} as const

/**
 * How much of the stage the list keeps to. 'here': the writing carries on inside the scene (everything that holds
 * there). 'start': a new scene on the same day as the one before, by both cards' When (no positions or time of day:
 * the scene card sets those). 'later': a later day, or a gap not known ("Three weeks later", no When): only how each
 * person is, injuries and the like. 'none': the stage isn't this story's, or isn't known.
 */
export type StageReach = 'here' | 'start' | 'later' | 'none'

export interface MustInput {
  /** Where things stand at the point of writing; null when not known. */
  stand: SceneState | null | undefined
  reach: StageReach
  /** The characters in the scene, point of view first: what the stage says of them, their marks and changed facts. */
  people: EntryState[]
  /** Everything else in the briefing: anyone named there who is dead by now says so. */
  named: EntryState[]
  /** Who knows what at this point. */
  facts: FactState[]
  /** The scene being written: a value from its own words is "since earlier in this scene". */
  sceneId: ID
  /** This story's title, left off the places in it ("Book 1, Ch 3, Sc 2" is "Ch 3, Sc 2" within Book 1). */
  storyTitle: string
  /** Where each scene the stage's words come from is, in plain words ("Book 1, Ch 3, Sc 2"), by scene id. */
  places: Record<ID, string>
  /**
   * What the people in the scene gave away, lost or got during the story, however long ago, as it is now (memory/items.ts
   * `holdingsOf`). Left out: none.
   */
  holdings?: Holding[]
  /** What the scene is about (its card, beats, Adam's direction, the scene so far): the items it names come first. */
  about?: string
  /**
   * The short form, for a model with little room: at most MUST_SHORT lines, and none of who knows what or of the
   * codex's changed looks (the briefing above has those).
   */
  short?: boolean
  /**
   * The briefing's stage block says where things stand at this same moment, right above the list (carrying on inside a
   * scene): the list then leaves out what the stage says, and keeps what it doesn't (who is dead, marks, changed looks,
   * what someone no longer has, secrets). Adam, 2026-10-08: the door, the boots and the coat were said three times over.
   */
  stageShown?: boolean
  /** What has happened so far, for telling a plan that has happened (realSecrets); left out: what has happened to `people` and `named`. */
  happened?: KnowsContext['happened']
}

/**
 * The order lines are chosen in when there are more than MUST_MOST: what goes wrong most and matters most first. A
 * piece of clothing that is off, or that the scene names, comes first after injuries ("wearingNamed": boots off by the
 * door are what a writer forgets), then a thing the scene names, what people hold and the things in the place; a piece
 * simply on ("skirt on") comes after those ("wearing"), so plain clothes never crowd out a held case or a barred door.
 * What someone no longer has comes after what is in the scene (Adam, 2026-10-07: in a trap run twelve lines of injuries
 * and "no longer has" left out the survey case on the sill, and the writer put it against Wren's hip), high when the
 * scene names it ("goneNamed").
 */
const RANK = {
  dead: 0,
  condition: 1,
  wearingNamed: 2,
  thingNamed: 3,
  holding: 4,
  thing: 5,
  goneNamed: 6,
  marks: 7,
  wearing: 8,
  gone: 9,
  gotNamed: 10,
  gap: 11,
  where: 12,
  posture: 13,
  touching: 14,
  sees: 15,
  changed: 16,
  got: 17,
  time: 18,
  light: 19,
  weather: 20
} as const
type Kind = keyof typeof RANK

/** Fields whose current value is a fact to keep to when a change set it during the story (a haircut in Ch 5). */
const FACT_FIELDS = (FIELD_GROUPS.character ?? []).filter((g) => g.id === 'basics' || g.id === 'looks').flatMap((g) => g.fields)
const FIELD_LABEL = new Map(FACT_FIELDS.map((f) => [f.key, f.label]))

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
const clipTo = (s: string, most: number): string => (s.length > most ? `${s.slice(0, most - 1).trimEnd()}…` : s)
const joinAnd = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** Something some of the people in a scene know and others don't. */
export interface Secret {
  fact: string
  /** Names of those who know it, and of those it is kept from. */
  knownBy: string[]
  keptFrom: string[]
}

/**
 * What some of these people know and others don't, the most lately learned first (FactState.at; among facts learned at
 * the same point, or with no place, the last listed first).
 */
export function secretsAmong(people: Pick<EntryState, 'id' | 'name' | 'kind'>[], facts: FactState[]): Secret[] {
  const here = people.filter((p) => p.kind === 'character')
  if (here.length < 2) return []
  const order = facts.map((f, i) => ({ f, i })).sort((a, b) => (b.f.at ?? -2) - (a.f.at ?? -2) || b.i - a.i)
  const out: Secret[] = []
  for (const { f } of order) {
    const fact = clean(f.fact).replace(/[.]$/, '')
    const knowers = here.filter((p) => f.knownBy.includes(p.id))
    if (!fact || !knowers.length || knowers.length === here.length) continue
    out.push({ fact, knownBy: knowers.map((p) => p.name), keptFrom: here.filter((p) => !f.knownBy.includes(p.id)).map((p) => p.name) })
  }
  return out
}

/**
 * The real secrets among these people (Adam, 2026-10-08): what one of them knows that another here doesn't, as of this
 * point, never kept from someone the fact is about ("Wren does not know: Wren will go up to the abbey"), with plans
 * that have happened or whose time has passed left out and the same fact given once (knows.ts cleanKnows); the most
 * lately learned first, at most `most`.
 */
export function realSecrets(
  people: Pick<EntryState, 'id' | 'name' | 'kind' | 'aliases'>[],
  facts: FactState[],
  ctx: KnowsContext,
  most = MUST_GAPS
): Secret[] {
  const here = people.filter((p) => p.kind === 'character')
  const out: Secret[] = []
  for (const s of secretsAmong(here, cleanKnows(facts, ctx))) {
    if (out.length >= most) break
    const keptFrom = s.keptFrom.filter((name) => {
      const p = here.find((x) => x.name === name)
      return !p || !namesPerson(s.fact, p)
    })
    if (keptFrom.length) out.push({ ...s, keptFrom })
  }
  return out
}

/** True when a text names this person: by name, another name, or a first name of three letters or more. */
export function namesPerson(text: string, p: Pick<EntryState, 'name' | 'aliases'>): boolean {
  const names = [p.name, ...(p.aliases ?? [])].map(clean).filter(Boolean)
  const first = clean(p.name).split(' ')[0] ?? ''
  if (first.length >= 3 && /^\p{Lu}/u.test(first)) names.push(first)
  return names.some((n) => nameIn(text, n))
}

/** A place without this story's title ("Book 1, Ch 3, Sc 2" in Book 1 is "Ch 3, Sc 2"). */
export function shortPlace(where: string, storyTitle: string): string {
  const w = clean(where)
  const t = clean(storyTitle)
  return t && w.startsWith(`${t}, `) ? w.slice(t.length + 2) : w
}

/** The stage's entry for a character: by name or other name, or a first name alone ("Mara" for Mara Venn). */
export function stageFor(e: Pick<EntryState, 'name' | 'aliases'>, stand: SceneState | null | undefined): CharacterState | null {
  if (!stand) return null
  const names = [e.name, ...(e.aliases ?? [])].map((n) => clean(n).toLowerCase()).filter(Boolean)
  const same = (c: CharacterState): boolean => names.includes(clean(c.name).toLowerCase())
  const partly = (c: CharacterState): boolean => {
    const n = clean(c.name).toLowerCase()
    return !!n && names.some((x) => x.startsWith(`${n} `) || n.startsWith(`${x} `))
  }
  return stand.characters.find(same) ?? stand.characters.find(partly) ?? null
}

// ---------- Only the people in the scene, and a time that still holds ----------
// Where things stand is kept for everyone the story has met, and with the time, light and weather as last read. What
// the writer, this list, the plan and the check of new words are told is narrower (Adam, 2026-10-07, after a trap run
// where Bryn, Gale, Oskar and "the boy" from earlier scenes sat in an inn scene's stage, and a stale line about the boy
// raised a wrong question): only the people in this scene, and the time, light and weather only from this scene's own
// words or when they carry over from the scene before (both cards' When the same). The stage as kept is left whole.

/** Who and what of the stage belongs in the scene being written. */
export interface StageScope {
  /** The scene being written: a time, light or weather read from its own words always holds. */
  sceneId: ID
  /** Whether the time, light and weather as the scene before ended still hold (both cards' When the same, same story). */
  timeCarries: boolean
  /** The characters on the scene card (point of view and those present). */
  onCard: Pick<EntryState, 'name' | 'aliases'>[]
  /** The characters the memory knows here, for each stage name's other names. */
  cast: Pick<EntryState, 'name' | 'aliases'>[]
  /** The scene's own words that can name someone: its card's beats, notes and aims, Adam's direction, the scene so far. */
  words: string
  /**
   * The scene before this one on the story's line (null: none). Given, values whose words are from an older scene stay
   * out (Adam, 2026-10-08: "out in the middle of the flood" and "hat on" indoors, days later), except how someone is and
   * what they hold; and someone only named in the scene's words is in it only with words from this scene (or the one
   * before, when its time carries on). Left out (older callers): no such rule.
   */
  previousSceneId?: ID | null
  /** The characters dead by now (their names and other names): only ever dead on the stage, never "burning in his chair". */
  dead?: string[]
}

/** The names a stage person goes by: as the stage has them, their codex entry's names, and their first name when no one else here shares it. */
function namesFor(c: CharacterState, scope: StageScope, stand: SceneState): string[] {
  const e = scope.cast.find((x) => stageFor(x, { ...stand, characters: [c] }))
  const names = [c.name, ...(e ? [e.name, ...(e.aliases ?? [])] : [])].map(clean).filter((n) => n.length >= 2)
  const first = (n: string): string => (/^\p{Lu}/u.test(n) && /\s/.test(n) ? n.split(/\s+/)[0] : '')
  const others = [...stand.characters.filter((x) => x !== c).map((x) => x.name), ...scope.cast.filter((x) => x !== e).map((x) => x.name)]
  for (const n of [...names]) {
    const f = first(n)
    if (f.length >= 2 && !others.some((o) => clean(o).split(/\s+/)[0]?.toLowerCase() === f.toLowerCase())) names.push(f)
  }
  return [...new Set(names)]
}

/**
 * Where things stand as told for one scene: only the people in it (on its card, or named in its card's words, Adam's
 * direction or the scene so far), and the scene's time, light and weather only from its own words or when they carry
 * over (scope.timeCarries). Each value keeps its words. Null when nothing is known.
 */
export function stageInScene(stand: SceneState | null | undefined, scope: StageScope): SceneState | null {
  if (!stand) return null
  const ruled = scope.previousSceneId !== undefined
  /** The scenes whose words still hold here: this one, and the one before (a value whose words aren't known is kept). */
  const fresh = (sceneId: string | undefined): boolean => !ruled || !sceneId || sceneId === scope.sceneId || sceneId === scope.previousSceneId
  const sourcesOf = (c: CharacterState): StateSource[] => {
    const who = `${clean(c.name).toLowerCase()}|`
    return Object.entries(stand.said ?? {})
      .filter(([k]) => k.startsWith(who))
      .map(([, v]) => v)
  }
  const onCard = (c: CharacterState): boolean => scope.onCard.some((e) => stageFor(e, { ...stand, characters: [c] }))
  const named = (c: CharacterState): boolean => namesFor(c, scope, stand).some((n) => nameIn(scope.words, n))
  /** Only named in the scene's words: in it only with words from this scene (or the one before, its time carrying on). */
  const seenHere = (c: CharacterState): boolean => {
    const from = sourcesOf(c)
    return !ruled || !from.length || from.some((f) => f.sceneId === scope.sceneId || (scope.timeCarries && f.sceneId === scope.previousSceneId))
  }
  const deadNames = new Set((scope.dead ?? []).map((n) => clean(n).toLowerCase()).filter(Boolean))
  const isDead = (c: CharacterState): boolean => namesFor(c, scope, stand).some((n) => deadNames.has(n.toLowerCase()))
  const characters: CharacterState[] = []
  for (const c of stand.characters) {
    if (!onCard(c) && !(named(c) && seenHere(c))) continue
    if (isDead(c)) {
      // Dead: never a live state. Where the body is, only from this scene's own words; otherwise left out (the scene
      // card and what must stay true say who is dead).
      const whereFrom = stand.said?.[sourceKey(c.name, 'where')]?.sceneId
      if (!sourcesOf(c).some((f) => f.sceneId === scope.sceneId)) continue
      characters.push({ name: c.name, where: whereFrom === scope.sceneId ? c.where : '', posture: '', holding: '', condition: 'dead', mood: '', lastAction: '', clothes: [] })
      continue
    }
    if (!ruled) {
      characters.push(c)
      continue
    }
    // Words from an older scene no longer hold, except how they are (injuries) and what they hold.
    const field = (f: StateField): string => (f === 'condition' || f === 'holding' || fresh(stand.said?.[sourceKey(c.name, f)]?.sceneId) ? (c[f] ?? '') : '')
    const kept: CharacterState = {
      ...c,
      where: field('where'),
      posture: field('posture'),
      mood: field('mood'),
      lastAction: field('lastAction'),
      ...(c.touching !== undefined ? { touching: field('touching') } : {}),
      ...(c.sees !== undefined ? { sees: field('sees') } : {})
    }
    if (c.clothes) kept.clothes = c.clothes.filter((p) => fresh(pieceSource(stand.said, c.name, p.name)?.sceneId))
    characters.push(kept)
  }
  const out: SceneState = { ...stand, characters }
  for (const f of ['time', 'weather', 'light'] as const) {
    if (!scope.timeCarries && stand.said?.[sourceKey(null, f)]?.sceneId !== scope.sceneId) out[f] = ''
  }
  if (stand.said) {
    const names = new Set(['', ...characters.map((c) => c.name.toLowerCase())])
    out.said = Object.fromEntries(
      Object.entries(stand.said).filter(([k]) => {
        const who = k.slice(0, k.lastIndexOf('|'))
        const field = k.slice(k.lastIndexOf('|') + 1)
        // A thing in the place keeps its words (step 2b).
        return names.has(who) && (who || field.startsWith('thing:') || out[field as 'time' | 'weather' | 'light'])
      })
    )
  }
  return out.time || out.weather || out.light || characters.length || thingsOf(out).length ? out : null
}

/** The lines of the list, without their dashes, in the order they are sent. Empty when nothing is known. */
export function mustStayTrue(o: MustInput): string[] {
  const out: { rank: number; who: number; text: string; piece: boolean }[] = []
  /** A line: its words (cut short when long, unless `whole`), then since when it holds, never cut. */
  const add = (kind: Kind, who: number, text: string, where = '', whole = false): void => {
    const since = where ? ` (since ${where})` : ''
    out.push({ rank: RANK[kind], who, text: `${whole ? text : clipTo(text, LONGEST_LINE)}${since}`, piece: kind === 'wearing' || kind === 'wearingNamed' })
  }
  /** Where a stage value's words are: this scene, or another one's place. */
  const sinceOf = (from: StateSource | undefined): string => {
    if (!from) return ''
    if (from.sceneId === o.sceneId) return 'earlier in this scene'
    return shortPlace(o.places[from.sceneId] ?? '', o.storyTitle)
  }
  const stageSince = (name: string | null, field: string): string => sinceOf(o.stand?.said?.[sourceKey(name, field)])
  // The things in the place reach a new scene's start only when it is the same place: the stage has none otherwise
  // (continuity/tracker.ts startFrom).
  const keep = new Set<Kind>(
    o.reach === 'here'
      ? ['condition', 'wearing', 'holding', 'thing', 'where', 'posture', 'touching', 'sees', 'time', 'light', 'weather']
      : o.reach === 'start'
        ? ['condition', 'wearing', 'holding', 'thing']
        : o.reach === 'later'
          ? ['condition']
          : []
  )
  const people = o.people.filter((e) => e.kind === 'character')
  const about = o.about ?? ''

  // Each person in the scene: what the stage says of them now, their marks, and what changed in their codex entry.
  // Someone dead by now is said to be dead (below), and nothing else: no marks, no "no longer has".
  const living = new Set(people.filter((e) => !clean(deathOf(e)?.note)).map((e) => e.id))
  people.forEach((e, who) => {
    const c = stageFor(e, o.stand)
    if (c) stageLines(c, who)
    if (!living.has(e.id)) return
    const marks = clean(e.fields?.marks)
    if (marks) add('marks', who, `${e.name}: ${marks}`, shortPlace(e.changedWhere?.marks ?? '', o.storyTitle))
    for (const k of e.changed ?? []) {
      const label = FIELD_LABEL.get(k)
      const v = clean(e.fields?.[k])
      const where = e.changedWhere?.[k]
      if (!label || k === 'marks' || !v || !where) continue
      add('changed', who, `${e.name}, ${label.toLowerCase()}: ${v}`, shortPlace(where, o.storyTitle))
    }
  })
  // Carrying on with no one on the scene card: everyone the stage has in the scene.
  if (!people.length && o.reach === 'here') o.stand?.characters.forEach((c, i) => stageLines(c, i))

  // What someone in the scene gave away, lost or got, however long ago (memory/items.ts): only how it is now, the items
  // the scene names first. "Wren: no longer has the brass compass (gave it to Mother Agate; since Ch 2, Sc 7)".
  const whoOf = new Map(people.map((e, i) => [e.id, i] as const).filter(([id]) => living.has(id)))
  holdingsFirst(
    (o.holdings ?? []).filter((h) => whoOf.has(h.personId)),
    about
  )
    .slice(0, MUST_ITEMS)
    .forEach((h) => {
      const named = namesItem(about, h)
      const kind: Kind = h.has ? (named ? 'gotNamed' : 'got') : named ? 'goneNamed' : 'gone'
      add(kind, whoOf.get(h.personId)!, holdingLine(h, (w) => shortPlace(w, o.storyTitle)), '', true)
    })

  function stageLines(c: CharacterState, who: number): void {
    if (o.stageShown && o.reach === 'here') return
    const name = clean(c.name)
    // Never what they hold or have on that a thing in the place says is somewhere else (the case on the sill, not on
    // her back): the thing's line says where it is.
    const stand = o.stand ?? { things: [], characters: [] }
    for (const kind of ['condition', 'holding', 'where', 'posture', 'touching', 'sees'] as const) {
      const v = clean(kind === 'holding' ? heldNotPlaced(stand, name, c.holding) : c[kind])
      if (v && keep.has(kind)) add(kind, who, stageLine(name, kind, v), stageSince(name, kind))
    }
    // What they wear, piece by piece: those the scene names first, then what is off, then what is on in some way.
    if (!keep.has('wearing')) return
    // Not a piece a thing in the place already says where it is (the boots on the hearth), and one line for a piece kept
    // under two names (an oilskin and an oilskin coat): the newer (Adam, 2026-10-08: the oilskin was listed twice).
    const placed = keep.has('thing') ? thingsOf(stand) : []
    const all = clothesOf(c).filter((p) => !pieceClashes(stand, name, p) && !placed.some((t) => namesStageItem(clean(t.name), p)))
    const worn = all.filter((p, i) => !all.some((q, j) => j > i && (namesStageItem(clean(q.name), p) || namesStageItem(clean(p.name), q))))
    for (const p of namedFirst(worn, about, true).slice(0, MUST_CLOTHES)) {
      const line = pieceLine(name, p)
      if (line) add(namesStageItem(about, p) || isOff(p.state) ? 'wearingNamed' : 'wearing', who, line, sinceOf(pieceSource(o.stand?.said, name, p.name)))
    }
  }

  // The scene's time, light and weather, carrying on inside it (a new scene's are on its card); and the things in the
  // place, those the scene names first, then those changed most lately.
  const scene = o.stageShown && o.reach === 'here' ? null : o.stand
  if (scene) {
    for (const kind of ['time', 'light', 'weather'] as const) {
      const v = clean(scene[kind])
      if (v && keep.has(kind)) add(kind, 1000, stageLine('', kind, v), stageSince(null, kind))
    }
    if (keep.has('thing'))
      for (const t of namedFirst([...thingsOf(scene)].reverse(), about, false).slice(0, MUST_THINGS)) {
        const text = clean(thingText(t))
        if (text)
          add(
            namesStageItem(about, t) ? 'thingNamed' : 'thing',
            1000,
            stageLine('', 'thing', text),
            sinceOf(o.stand?.said?.[thingKey(t.name)])
          )
      }
  }

  // Anyone in the briefing who is dead by now.
  const all = [...people, ...o.named.filter((e) => !people.some((p) => p.id === e.id))]
  all.forEach((e, i) => {
    const died = deathOf(e)
    const note = clean(died?.note).replace(/[.]$/, '')
    if (note) add('dead', i, `${e.name} is dead: ${pastDeathNote(note)}`, shortPlace(died?.where ?? '', o.storyTitle))
  })

  // What some of those in the scene know and others don't, the most lately learned first: kept from the others, who
  // must not learn, guess or think it here (when the point-of-view character is one of them, not even in thought).
  realSecrets(people, o.facts, { happened: o.happened ?? happenedOf([...people, ...o.named]) })
    .slice(0, MUST_GAPS)
    .forEach((s, i) => {
      const not = joinAnd(s.keptFrom)
      const knows = s.knownBy.length === 1 ? `${s.knownBy[0]} knows it` : `${joinAnd(s.knownBy)} know it`
      add('gap', 2000 + i, `Kept from ${not}: ${clipTo(s.fact, LONGEST_FACT)} (${knows}). ${not} must not learn, guess or think it here unless the scene card says so`, '', true)
    })

  // The most that matter, then in order: person by person, then the scene, then who knows what. The same line once only.
  const seen = new Set<string>()
  const once = out.filter((l) => {
    const k = l.text.replace(/\s*\(since [^)]*\)$/, '').toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const room = o.short ? once.filter((l) => l.rank !== RANK.gap && l.rank !== RANK.changed) : once
  // The short form: one piece of clothing a person at most, the one that matters most.
  const dressed = new Set<number>()
  const ranked = [...room]
    .sort((a, b) => a.rank - b.rank || a.who - b.who)
    .filter((l) => !o.short || !l.piece || (!dressed.has(l.who) && !!dressed.add(l.who)))
  const chosen = ranked.slice(0, o.short ? MUST_SHORT : MUST_MOST)
  return chosen.sort((a, b) => a.who - b.who || a.rank - b.rank).map((l) => l.text)
}

/**
 * Pieces of clothing or things, those `about` names first; for clothing then what is off (boots off by the door are
 * what a writer forgets), then what is on in some way ("on, unbuttoned"), then the rest; else as listed.
 */
function namedFirst(list: StageItem[], about: string, clothing: boolean): StageItem[] {
  const order = (x: StageItem): number =>
    namesStageItem(about, x) ? 0 : !clothing ? 1 : isOff(x.state) ? 1 : x.state && clean(x.state).toLowerCase() !== 'on' ? 2 : 3
  return list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => order(a.x) - order(b.x) || a.i - b.i)
    .map(({ x }) => x)
}

/** One piece of what someone wears, as the list (and the plan) says it: "Mara: boots off, by the door", "Mara is wearing: grey cloak on". */
export function pieceLine(name: string, p: StageItem): string {
  const text = clean(pieceText(p))
  if (!text) return ''
  return isOff(p.state) ? stageLine(name, 'condition', text) : stageLine(name, 'wearing', text)
}

/** One value of where things stand, as the list (and the plan) says it: "Mara is wearing: a grey cloak". */
export function stageLine(name: string, field: StateField | 'wearing' | 'thing' | 'time' | 'light' | 'weather', value: string): string {
  switch (field) {
    case 'condition':
      return `${name}: ${value}`
    case 'wearing':
      return `${name} is wearing: ${value}`
    case 'touching':
      return `Who ${name} is touching: ${value}`
    case 'sees':
      return `What ${name} can see or hear: ${value}`
    case 'thing':
      return value.charAt(0).toUpperCase() + value.slice(1)
    case 'holding':
      return `${name} is holding: ${value}`
    case 'where':
      return `Where ${name} is: ${value}`
    case 'posture':
      return `How ${name} is placed: ${value}`
    case 'mood':
      return `${name}'s mood: ${value}`
    case 'lastAction':
      return `What ${name} last did: ${value}`
    case 'time':
      return `Time: ${value}`
    case 'light':
      return `Light: ${value}`
    case 'weather':
      return `Weather: ${value}`
  }
}

/** The list as sent: its lead (none in the short form, `reach` null), then a line for each. */
export function mustText(lines: string[], reach: StageReach | null): string {
  const list = lines.map((l) => `- ${l}`).join('\n')
  return reach ? `${reach === 'here' ? MUST_LEAD.here : MUST_LEAD.start}\n${list}` : list
}
