// The "must stay true" list (step 4 of the consistency plan, Adam 2026-10-07): a short list of the facts that matter
// right now, written by the app, not the model, and sent right before the instruction to write, where models pay the
// most attention (the full briefing stays above it). Drawn from the stage (where things stand at the point of writing,
// continuity/tracker.ts) and from the codex entries in the scene, it holds only current values, each with where it
// became true: "Mara: left arm in a sling (since Ch 3, Sc 2)". Older values that no longer hold are never sent: near-miss
// facts confuse models. Capped, so it stays short. Since 2026-10-07 it also says what the people in the scene gave
// away, lost or got however long ago ("Wren: no longer has the brass compass (gave it to Mother Agate; since Ch 2,
// Sc 7)", memory/items.ts), the items the scene names first. Pure.

import type { EntryState, FactState, ID } from '@shared/types'
import { sourceKey, type CharacterState, type SceneState, type StateField } from '@shared/continuity'
import { FIELD_GROUPS } from '@shared/fields'
import { holdingLine, holdingsFirst, namesItem, type Holding } from '../memory/items'
import { deathOf } from './deaths'

/** The most lines the list holds; its short form, for a model with little room, holds fewer. */
export const MUST_MOST = 12
export const MUST_SHORT = 6
/** The most "does not know" lines among them. */
export const MUST_GAPS = 3
/** The most lines among them about what someone gave away, lost or got. */
export const MUST_ITEMS = 4
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
}

/**
 * The order lines are chosen in when there are more than MUST_MOST: what goes wrong most and matters most first. What
 * someone no longer has comes high when the scene names it ("goneNamed"), and right after what they hold otherwise.
 */
const RANK = {
  dead: 0,
  condition: 1,
  goneNamed: 2,
  marks: 3,
  wearing: 4,
  holding: 5,
  gone: 6,
  gotNamed: 7,
  gap: 8,
  where: 9,
  posture: 10,
  changed: 11,
  got: 12,
  time: 13,
  light: 14,
  weather: 15
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

/** The lines of the list, without their dashes, in the order they are sent. Empty when nothing is known. */
export function mustStayTrue(o: MustInput): string[] {
  const out: { rank: number; who: number; text: string }[] = []
  /** A line: its words (cut short when long, unless `whole`), then since when it holds, never cut. */
  const add = (kind: Kind, who: number, text: string, where = '', whole = false): void => {
    const since = where ? ` (since ${where})` : ''
    out.push({ rank: RANK[kind], who, text: `${whole ? text : clipTo(text, LONGEST_LINE)}${since}` })
  }
  /** Where a stage value's words are: this scene, or another one's place. */
  const stageSince = (name: string | null, field: string): string => {
    const from = o.stand?.said?.[sourceKey(name, field)]
    if (!from) return ''
    if (from.sceneId === o.sceneId) return 'earlier in this scene'
    return shortPlace(o.places[from.sceneId] ?? '', o.storyTitle)
  }
  const keep = new Set<Kind>(
    o.reach === 'here'
      ? ['condition', 'wearing', 'holding', 'where', 'posture', 'time', 'light', 'weather']
      : o.reach === 'start'
        ? ['condition', 'wearing', 'holding']
        : o.reach === 'later'
          ? ['condition']
          : []
  )
  const people = o.people.filter((e) => e.kind === 'character')

  // Each person in the scene: what the stage says of them now, their marks, and what changed in their codex entry.
  people.forEach((e, who) => {
    const c = stageFor(e, o.stand)
    if (c) stageLines(c, who)
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
  const whoOf = new Map(people.map((e, i) => [e.id, i]))
  const about = o.about ?? ''
  holdingsFirst((o.holdings ?? []).filter((h) => whoOf.has(h.personId)), about)
    .slice(0, MUST_ITEMS)
    .forEach((h) => {
      const named = namesItem(about, h)
      const kind: Kind = h.has ? (named ? 'gotNamed' : 'got') : named ? 'goneNamed' : 'gone'
      add(kind, whoOf.get(h.personId)!, holdingLine(h, (w) => shortPlace(w, o.storyTitle)), '', true)
    })

  function stageLines(c: CharacterState, who: number): void {
    const name = clean(c.name)
    for (const kind of ['condition', 'wearing', 'holding', 'where', 'posture'] as const) {
      const v = clean(c[kind])
      if (v && keep.has(kind)) add(kind, who, stageLine(name, kind, v), stageSince(name, kind))
    }
  }

  // The scene's time, light and weather, carrying on inside it (a new scene's are on its card).
  const scene = o.stand
  if (scene) {
    for (const kind of ['time', 'light', 'weather'] as const) {
      const v = clean(scene[kind])
      if (v && keep.has(kind)) add(kind, 1000, stageLine('', kind, v), stageSince(null, kind))
    }
  }

  // Anyone in the briefing who is dead by now.
  const all = [...people, ...o.named.filter((e) => !people.some((p) => p.id === e.id))]
  all.forEach((e, i) => {
    const died = deathOf(e)
    const note = clean(died?.note).replace(/[.]$/, '')
    if (note) add('dead', i, `${e.name} is dead: ${note}`, shortPlace(died?.where ?? '', o.storyTitle))
  })

  // What some of those in the scene know and others don't, the most lately learned first: kept from the others, who
  // must not learn, guess or think it here (when the point-of-view character is one of them, not even in thought).
  secretsAmong(people, o.facts)
    .slice(0, MUST_GAPS)
    .forEach((s, i) => {
      const not = joinAnd(s.keptFrom)
      const knows = s.knownBy.length === 1 ? `${s.knownBy[0]} knows it` : `${joinAnd(s.knownBy)} know it`
      add('gap', 2000 + i, `Kept from ${not}: ${clipTo(s.fact, LONGEST_FACT)} (${knows}). ${not} must not learn, guess or think it here unless the scene card says so`, '', true)
    })

  // The most that matter, then in order: person by person, then the scene, then who knows what.
  const room = o.short ? out.filter((l) => l.rank !== RANK.gap && l.rank !== RANK.changed) : out
  const chosen = [...room].sort((a, b) => a.rank - b.rank || a.who - b.who).slice(0, o.short ? MUST_SHORT : MUST_MOST)
  return chosen.sort((a, b) => a.who - b.who || a.rank - b.rank).map((l) => l.text)
}

/** One value of where things stand, as the list (and the plan) says it: "Mara is wearing: a grey cloak". */
export function stageLine(name: string, field: StateField | 'time' | 'light' | 'weather', value: string): string {
  switch (field) {
    case 'condition':
      return `${name}: ${value}`
    case 'wearing':
      return `${name} is wearing: ${value}`
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
