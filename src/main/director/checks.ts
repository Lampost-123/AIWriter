// Directed writing's free checks over each new stretch (Adam's spec, "Directed writing (an option)": "The free checks run
// first, at no cost"). The app's own rules, over the stretch's words alone, before any AI call: a place named otherwise
// than the scene card's (checks/placeNames.ts) and a time claim that doesn't fit the story calendar
// (checks/timeClaims.ts), as check and repair runs them over new words (repair/free.ts); someone the memory has dead
// speaking (checks/rules.ts deadHere); a piece of clothing already off used as worn (clothes.ts); and a thing the story
// index has elsewhere, or someone it has in another place, used or acting here (plan/preconditions.ts, the same check
// the plan's beats get). What the world says is read once a draft (checkWorld); each stretch is then checked in a few
// milliseconds. Never throws: what can't be read says nothing.

import type Database from 'better-sqlite3'
import type { EntryState, ID } from '@shared/types'
import { clothesOf } from '@shared/continuity'
import { freeContext } from '../checks/freeContext'
import { openingOf, placeRuleFindings, timeRuleFindings, type FreeContext } from '../checks/freeRules'
import { deadHere, dreamlikeCard, type RuleScene } from '../checks/rules'
import { ruleScene } from '../checks/ruleChecks'
import { toldStage, type ContextInput } from '../ai/context'
import { beatsCanHappen, type BeatWorld } from '../plan/preconditions'
import { sentencesOf } from '../storyIndex/routes'
import { buildStoryIndex } from '../storyIndex'
import { clothesSlips, type Wearer } from './clothes'
import { lastParagraph } from './stretch'

type DB = Database.Database

/** Which rule found it. */
export type FindingRule = 'time-claim' | 'place-name' | 'dead' | 'clothes' | 'thing-elsewhere' | 'person-elsewhere'

/** One thing the free checks found in a stretch. */
export interface StretchFinding {
  rule: FindingRule
  /** What is wrong, in plain words. */
  message: string
  /** The words it is about ('' when none). */
  quote: string
  /** It is in the stretch's last paragraph, so a retake can put it right. */
  inLast: boolean
  /** A slip that must not stand (a fact the record is sure of); otherwise worth a note. */
  mustFix: boolean
}

/** What the checks read of the world, once for a draft. */
export interface CheckWorld {
  free: FreeContext | null
  dreamlike: boolean
  rules: RuleScene | null
  beats: BeatWorld | null
  wearers: Wearer[]
}

const NONE: CheckWorld = { free: null, dreamlike: false, rules: null, beats: null, wearers: [] }

function safely<T>(what: string, fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (e) {
    console.warn(`Directed writing: could not read ${what}`, e)
    return fallback
  }
}

const pronounOf = (e: Pick<EntryState, 'fields'>): Wearer['pronoun'] => {
  const p = (e.fields?.pronouns ?? '').trim().toLowerCase()
  return /^she\b/.test(p) ? 'she' : /^he\b/.test(p) ? 'he' : /^they\b/.test(p) ? 'they' : null
}

/**
 * What the checks need, read from the world for one draft: the time and place rules' context, the memory as the rules
 * read it, the story index's view of things and people, and what everyone here has on. `carryOn`: the scene's words the
 * draft carries on from (Add below).
 */
export function checkWorld(db: DB, sceneId: ID, input: ContextInput, carryOn: string): CheckWorld {
  if (!db.open) return NONE
  const card = input.scene.card
  const storyId = input.memory.storyId
  const free = safely('the time and place rules’ context', () => freeContext(db, sceneId), null)
  const dreamlike = safely('the scene card', () => dreamlikeCard(card), false)
  // The memory as the rules read it, with a stand-in for the words (each stretch puts its own in).
  const rules = safely('the memory for the rules', () => ruleScene(db, sceneId, { text: '…' }), null)
  const stage = safely('where things stand', () => toldStage(input), null)
  const entries = input.memory.entries
  const characters = entries.filter((e) => e.kind === 'character')
  const byName = (name: string): EntryState | undefined => {
    const n = name.trim().toLowerCase()
    return characters.find((e) => [e.name, ...(e.aliases ?? [])].some((x) => x.trim().toLowerCase() === n))
  }
  const present = new Set<ID>([card.povId, ...(card.presentIds ?? [])].filter((x): x is ID => !!x))
  for (const c of stage?.characters ?? []) {
    const e = byName(c.name)
    if (e) present.add(e.id)
  }
  const wearers: Wearer[] = [...present].flatMap((id) => {
    const e = characters.find((x) => x.id === id)
    if (!e) return []
    const on = (stage?.characters ?? []).find((c) => byName(c.name)?.id === id)
    const names = [e.name, ...(e.aliases ?? [])].map((n) => n.trim()).filter((n) => n.length >= 2)
    const first = e.name.trim().split(/\s+/)[0]
    if (first && first.length >= 2 && !names.includes(first) && !characters.some((o) => o.id !== id && o.name.trim().split(/\s+/)[0] === first)) names.push(first)
    return [{ name: e.name, names: names.sort((a, b) => b.length - a.length), pronoun: pronounOf(e), clothes: clothesOf(on) }]
  })
  const beats: BeatWorld | null = storyId
    ? safely(
        'the story index',
        () => {
          buildStoryIndex(db, storyId)
          return {
            db,
            storyId,
            sceneId,
            asItBegins: !carryOn.trim(),
            card: { povId: card.povId, presentIds: card.presentIds, locationId: card.locationId },
            present: [...present],
            entries,
            stand: stage,
            calls: [card.goal, card.conflict, card.outcome, card.notes, ...card.beats, input.options.direction].filter((t) => t?.trim()).join('\n')
          }
        },
        null
      )
    : null
  return { free, dreamlike, rules, beats, wearers }
}

/** True when the words at [start, end) of the stretch are in its last paragraph. */
function inLastParagraph(stretch: string, at: number | null): boolean {
  const last = lastParagraph(stretch)
  if (!last) return false
  const from = stretch.replace(/\s+$/, '').length - last.length
  return at !== null && at >= from
}

/** Where a quote is in the stretch, or null. */
const whereIs = (stretch: string, quote: string): number | null => {
  const q = quote.trim()
  if (!q) return null
  const at = stretch.indexOf(q)
  return at < 0 ? null : at
}

/**
 * The free checks over one stretch. `before`: the words before it (the scene's own for Add below, and the draft's so
 * far), which the rules read as what is already on the page.
 */
export function checkStretch(w: CheckWorld, o: { before: string; stretch: string }): StretchFinding[] {
  const stretch = o.stretch
  if (!stretch.trim()) return []
  const out: StretchFinding[] = []
  const add = (f: Omit<StretchFinding, 'inLast'>, at: number | null): void => {
    if (out.some((x) => x.rule === f.rule && x.message === f.message)) return
    out.push({ ...f, inLast: inLastParagraph(stretch, at) })
  }
  const atStart = !o.before.trim()
  // The time and place rules, as check and repair runs them over new words (repair/free.ts).
  if (w.free && !w.dreamlike) {
    safely('the time rule', () => {
      if (w.free!.time.date?.back) return
      for (const f of timeRuleFindings(stretch, w.free!.time, atStart ? openingOf(stretch) : 0))
        add({ rule: 'time-claim', message: f.message, quote: f.quote, mustFix: f.severity !== 'minor' }, f.at?.start ?? whereIs(stretch, f.quote))
    }, undefined)
    safely('the place rule', () => {
      const place = placeRuleFindings(stretch, w.free!.place, `${o.before}\n\n${stretch}`)
      for (const f of place.findings) add({ rule: 'place-name', message: f.message, quote: f.quote, mustFix: true }, f.at?.start ?? whereIs(stretch, f.quote))
    }, undefined)
  }
  // Someone the memory is sure is dead, speaking a line in the stretch (the card's own list is not the stretch's doing).
  if (w.rules) {
    safely('the dead', () => {
      for (const f of deadHere({ ...w.rules!, text: stretch, stage: null })) {
        if (!f.quote.trim()) continue
        add({ rule: 'dead', message: f.message, quote: f.quote, mustFix: true }, whereIs(stretch, f.quote))
      }
    }, undefined)
  }
  // A piece of clothing already off, used as worn.
  for (const s of clothesSlips(stretch, o.before, w.wearers)) add({ rule: 'clothes', message: s.message, quote: s.quote, mustFix: true }, s.start)
  // A thing the story index has elsewhere, or someone it has in another place, used or acting here: each sentence read as
  // a plan's beat is (plan/preconditions.ts), with the words before as the scene so far.
  if (w.beats) {
    safely('the story index', () => {
      const sentences = sentencesOf(stretch).map((s) => ({ ...s, text: stretch.slice(s.start, s.end) }))
      const can = beatsCanHappen({ ...w.beats!, soFar: o.before }, { beats: sentences.map((s) => s.text), changes: [] })
      for (const n of can.notes) {
        const s = sentences[n.beat]
        add({ rule: 'thing-elsewhere', message: n.note, quote: s?.text.trim() ?? '', mustFix: false }, s?.start ?? null)
      }
      for (const f of can.flags) {
        // "Beat 3 (“…”) needs the letter, but …" is said of the sentence: "This needs the letter, but …".
        const m = /^Beat (\d+) \(“[^”]*”\) /.exec(f)
        const s = m ? sentences[Number(m[1]) - 1] : undefined
        const rest = m ? f.slice(m[0].length) : f
        const rule: FindingRule = /^has /.test(rest) ? 'person-elsewhere' : 'thing-elsewhere'
        add({ rule, message: m ? `This ${rest}` : f, quote: s?.text.trim() ?? '', mustFix: false }, s?.start ?? null)
      }
    }, undefined)
  }
  return out
}
