// The writer's "Who knows what" block (long story memory fix 9, the who-knows-what ledger). Characters acting on what
// they couldn't know yet is a named error in story benchmarks, and the most asked-for feature in other writing tools. The
// briefing told the full "what they know" only for the point of view (block 4), and up to three secrets among those on
// the card. Now everyone in the scene (on the card, on the stage, or named in the scene so far) gets a compact section:
//   - what they don't know yet that someone else here knows (a secret kept from them, with who knows it);
//   - what they believe that isn't true;
//   - what they know, the most lately learned first, each with since when and how they learned it (the point of view's
//     whole list is block 4's, so here only what they learned during the story).
// What matters most goes in first when there is too much: every secret kept from someone here, then false beliefs, then
// what they know; the most lately learned first within each. Caps grow with the room the model has (memoryRoom.ts
// memoryScale, at most twice), and what they know comes only with more room than the smallest model's: a model that
// reads 16,000 tokens (or one whose limit isn't known) gets what is kept from them and what they believe wrongly, as
// block 6 used to give, so the block doesn't push out the setting there (the fitting shortens priority 7 before 6).
// The facts are the memory's as this scene begins (memory/ledger.ts), cleaned as block 4's are (knows.ts cleanKnows),
// and a secret is told only when who knows it rests on who was there or on Adam (B5), never kept from someone it is
// about (mustStay.ts realSecrets' rules). Who is in the scene can change from one step of a scene to the next (the
// scene so far names someone), so the block is sent late (ai/context.ts SEND_ORDER). Pure.

import type { BeliefState, EntryState, FactState, ID, Learned } from '@shared/types'
import { learnedWords } from '@shared/knowWords'
import { cleanKnows, type KnowsContext } from './knows'
import { isPerson, namesPerson, namesUpTo, shortPlace } from './mustStay'
import { deathOf } from './deaths'

/** The block: priority 6, as block 6's secrets were. */
export const LEDGER_BLOCK = { id: 'knowledge', priority: 6, title: 'Who knows what' } as const

/** At the smallest scale (memoryScale 1), each person's most of each kind of line, and the block's most lines in all. */
export const LEDGER_GAPS = 3
export const LEDGER_WRONG = 2
export const LEDGER_LINES = 10
/**
 * What each person knows, with twice the room or more (none at memoryScale 1, growing to this at 2): the point of view's
 * fewer, as block 4 lists all they know.
 */
export const LEDGER_KNOWS = 4
export const LEDGER_POV_KNOWS = 2
/** The most people the block covers (point of view first, then the card, the stage and the scene so far). */
export const LEDGER_PEOPLE = 6
/** The short form: only what someone doesn't know yet or believes wrongly, without since when, this many lines at most. */
export const LEDGER_SHORT_LINES = 6

/** What the block says first. */
export const LEDGER_LEAD =
  "No one here acts on, says or thinks what they don't know yet unless the page shows them learning it, and what someone believes wrongly they take as true."

export interface LedgerInput {
  /** Everyone in the scene, point of view first; the dead and animals are left out. */
  people: EntryState[]
  povId: ID | null
  /** Who knows what as this scene begins, and what is believed that isn't true. */
  facts: FactState[]
  beliefs: BeliefState[]
  /** What has happened so far (knows.ts cleanKnows: plans that happened are left out). */
  happened: KnowsContext['happened']
  /** This story's title, left off the places in it. */
  storyTitle: string
  /** Names of anyone (who told them). */
  nameOf: (id: ID) => string | null
  /** memoryRoom.ts memoryScale. */
  scale: number
}

type Kind = 'gap' | 'wrong' | 'knows'
interface Line {
  who: ID
  fact: ID
  kind: Kind
  /** Higher is more lately learned. */
  at: number
  /** The memory's own order, for ties (later listed first). */
  i: number
  text: string
  short: string
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
const bare = (s: string): string => clean(s).replace(/[.]+$/, '')
const TIER: Record<Kind, number> = { gap: 0, wrong: 1, knows: 2 }

/** How much the caps grow: the room the model has (memoryScale), at most twice; the short form, not at all. */
const growOf = (scale: number, short = false): number => (short ? 1 : Math.min(2, Math.max(1, scale || 1)))

/**
 * The people the block covers, in order: people only, the living, each once, at most LEDGER_PEOPLE (grown with the room).
 * What must stay true is given the same list (ai/context.ts), so both name the same people.
 */
export function ledgerPeople(people: EntryState[], scale: number, short = false): EntryState[] {
  const most = Math.round(LEDGER_PEOPLE * growOf(scale, short))
  return people.filter((p, i, all) => isPerson(p) && !deathOf(p) && all.findIndex((x) => x.id === p.id) === i).slice(0, most)
}

/** The block's text: the full form, or the short one (null when it would hold nothing). */
export function ledgerText(o: LedgerInput, short = false): string | null {
  const grow = growOf(o.scale, short)
  const most = (n: number): number => Math.round(n * grow)
  /** What they know: nothing at the smallest scale, all of `n` at twice the room. */
  const knowsMost = (n: number): number => Math.round(n * (grow - 1))
  const people = ledgerPeople(o.people, o.scale, short)
  if (!people.length) return null
  const ids = new Set(people.map((p) => p.id))
  const place = (w: string): string => shortPlace(w, o.storyTitle)
  const since = (l: Learned | null | undefined): string => learnedWords(l, o.nameOf, place)
  const facts = cleanKnows(o.facts, { happened: o.happened })
  const lines: Line[] = []

  // What someone here doesn't know yet that another here knows: only when who knows it rests on who was there or on
  // Adam (B5), and never kept from someone it is about.
  facts.forEach((f, i) => {
    if (f.backed === false) return
    const knowers = people.filter((p) => f.knownBy.includes(p.id))
    if (!knowers.length || knowers.length === people.length) return
    const fact = bare(f.fact)
    if (!fact) return
    const one = knowers.length === 1 ? since(f.since?.[knowers[0].id]) : ''
    const who = knowers.length === 1 ? `${knowers[0].name} knows it` : `${namesUpTo(knowers.map((p) => p.name))} know it`
    for (const p of people) {
      if (f.knownBy.includes(p.id) || namesPerson(f.fact, p)) continue
      lines.push({
        who: p.id,
        fact: f.factId,
        kind: 'gap',
        at: f.at ?? -2,
        i,
        text: `Doesn't know yet: ${fact} (${who}${one ? `, ${one}` : ''}).`,
        short: `Doesn't know yet: ${fact} (${who}).`
      })
    }
  })

  // What they believe that isn't true.
  o.beliefs.forEach((b, i) => {
    const fact = bare(b.fact)
    if (!fact) return
    for (const id of b.believedBy) {
      if (!ids.has(id)) continue
      const s = since(b.since[id])
      lines.push({
        who: id,
        fact: b.factId,
        kind: 'wrong',
        at: b.since[id]?.at ?? b.at,
        i,
        text: `Wrongly believes: ${fact}${s ? ` (${s})` : ''}. It isn't true.`,
        short: `Wrongly believes: ${fact}. It isn't true.`
      })
    }
  })

  // What matters most first: tier by tier, the most lately learned first, within each person's and the block's caps.
  const cap = (who: ID, kind: Kind): number =>
    kind === 'gap' ? most(LEDGER_GAPS) : kind === 'wrong' ? most(LEDGER_WRONG) : knowsMost(who === o.povId ? LEDGER_POV_KNOWS : LEDGER_KNOWS)
  const total = short ? LEDGER_SHORT_LINES : most(LEDGER_LINES)
  const count = new Map<string, number>()
  const chosen = new Set<Line>()
  const choose = (list: Line[]): void => {
    for (const l of [...list].sort((a, b) => TIER[a.kind] - TIER[b.kind] || b.at - a.at || b.i - a.i)) {
      if (chosen.size >= total) break
      if (chosen.has(l)) continue
      const k = `${l.who}|${l.kind}`
      if ((count.get(k) ?? 0) >= cap(l.who, l.kind)) continue
      count.set(k, (count.get(k) ?? 0) + 1)
      chosen.add(l)
    }
  }
  // Each believer's most lately come to belief keeps its seat before any secret takes it: one a person (the people are
  // capped at no more than the block's lines, so all fit).
  choose(people.flatMap((p) => lines.filter((l) => l.kind === 'wrong' && l.who === p.id).slice(0, 1)))
  choose(lines)

  // What they know, with since when and how; a secret told as someone's "doesn't know yet" (with who knows it) isn't
  // told again.
  const told = new Set([...chosen].filter((l) => l.kind === 'gap').map((l) => l.fact))
  const known: Line[] = []
  if (!short && knowsMost(LEDGER_KNOWS) > 0)
    facts.forEach((f, i) => {
      const fact = bare(f.fact)
      if (!fact || told.has(f.factId)) return
      for (const id of f.knownBy) {
        if (!ids.has(id)) continue
        const s = f.since?.[id]
        // The point of view's whole list is block 4's: here only what they learned during the story.
        if (id === o.povId && !(s && s.at >= 0)) continue
        const words = since(s)
        known.push({ who: id, fact: f.factId, kind: 'knows', at: s?.at ?? f.at ?? -2, i, text: `Knows: ${fact}${words ? ` (${words})` : ''}.`, short: '' })
      }
    })
  choose(known)
  lines.push(...known)
  if (!chosen.size) return null

  const sections: string[] = []
  for (const p of people) {
    const mine = lines.filter((l) => l.who === p.id && chosen.has(l)).sort((a, b) => TIER[a.kind] - TIER[b.kind] || b.at - a.at || b.i - a.i)
    if (!mine.length) continue
    const head = `${p.name}${p.id === o.povId ? ' (point of view)' : ''}:`
    sections.push([head, ...mine.map((l) => `- ${short ? l.short : l.text}`)].join('\n'))
  }
  return [LEDGER_LEAD, ...sections].join('\n\n')
}
