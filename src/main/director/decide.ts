// What the director decides after each stretch, as far as it can be decided for free (Adam's spec, "Directed writing (an
// option)"): the free checks run first; only when something is wrong, a planned beat or ask is overdue, Adam gave a note,
// or the plan's stretches are written without the scene showing it is complete, is the director asked (one short AI
// call). Otherwise, and whenever that call can't be made or read, the decision is made here: carry on (with the next beat
// as the note), take the last paragraph again for a slip that must not stand, or the scene is done. Pure.

import type { DirectorVerdict } from '@shared/contracts/director'
import { beatsOnPage } from '@shared/beats'
import { mostlyIn } from '../ai/contract'
import type { StretchFinding } from './checks'
import { MOST_RETAKES, type StretchPlan, type StretchUnit } from './stretch'

/** How far the draft has got with its plan, read from its words for free. */
export interface Progress {
  /** How many of the plan's beats are on the page, in order (shared/beats.ts beatsOnPage). */
  beatsOn: number
  /** The checklist (the scene contract's "must change" asks), each with whether its words are on the page. */
  asks: { text: string; landed: boolean }[]
  /** The closing image is in the latest stretch; null when the plan gives none. */
  closing: boolean | null
}

/** Why the director is asked, in plain words. */
export interface Why {
  kind: 'finding' | 'beat' | 'ask' | 'adam' | 'end'
  text: string
}

export interface Decision {
  verdict: DirectorVerdict
  /** For the writer's next stretch (or the paragraph taken again); '' for none. */
  note: string
  /** Why: for a retake, what is wrong with the paragraph. */
  reason: string
  /** Decided here, or by the director's call. */
  by: 'free' | 'director'
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()
const clip = (s: string, most: number): string => (s.length > most ? `${s.slice(0, most - 1).trimEnd()}…` : s)

/**
 * Whether an ask's words are on the page: most of them, names aside (ai/contract.ts mostlyIn). Said in other words, it
 * isn't found here, and the director (an AI) judges it.
 */
const landed = (ask: string, page: string): boolean => mostlyIn(ask, page)

/** Reads how far the draft has got: beats on the page, the checklist, and the closing image in the latest stretch. */
export function progressOf(plan: StretchPlan, asks: readonly string[], closing: string, page: string, latest: string): Progress {
  return {
    beatsOn: beatsOnPage(plan.beats, page),
    asks: asks.map((text) => ({ text, landed: landed(text, page) })),
    closing: closing.trim() ? landed(closing, latest) : null
  }
}

/** How many of the plan's beats the first `stretches` stretches were asked to write. */
export const beatsDue = (plan: StretchPlan, stretches: number): number =>
  plan.units.slice(0, stretches).reduce((n, u) => n + u.beats.length, 0)

/** Everything landed: every beat, every ask, and the closing image when there is one. */
export const allLanded = (plan: StretchPlan, p: Progress): boolean =>
  p.beatsOn >= plan.beats.length && p.asks.every((a) => a.landed) && p.closing !== false

/** The checklist's asks not on the page yet. */
const missingAsks = (p: Progress): string[] => p.asks.filter((a) => !a.landed).map((a) => a.text)

/**
 * Why the director should be asked after this stretch; none: everything is as planned, and the decision is made here.
 * `stretches`: how many are written; `words`: the draft's words so far.
 */
export function reasonsToAsk(o: {
  findings: readonly StretchFinding[]
  progress: Progress
  plan: StretchPlan
  stretches: number
  words: number
  adam: readonly string[]
}): Why[] {
  const out: Why[] = []
  for (const f of o.findings) out.push({ kind: 'finding', text: `${f.message}${f.inLast ? ' (in its last paragraph)' : ''}` })
  for (const n of o.adam) out.push({ kind: 'adam', text: `The author’s note: “${clean(n)}”` })
  const due = beatsDue(o.plan, o.stretches)
  for (let i = o.progress.beatsOn; i < due; i++) out.push({ kind: 'beat', text: `Beat ${i + 1}, “${clip(o.plan.beats[i], 160)}”, isn’t on the page yet.` })
  const atEnd = o.stretches >= o.plan.units.length
  if (atEnd || o.words >= o.plan.target * 0.8) for (const a of missingAsks(o.progress)) out.push({ kind: 'ask', text: `Not on the page yet: “${clip(a, 200)}”` })
  if (atEnd && !out.length && !allLanded(o.plan, o.progress)) out.push({ kind: 'end', text: 'The planned stretches are written, but the closing image isn’t on the page yet.' })
  return out
}

/** The line the window shows, in a few plain words, for a decision ("Carry on — next, the knock at the door"). */
export function decisionLine(d: Pick<Decision, 'verdict' | 'reason'>, next: StretchUnit | null): string {
  if (d.verdict === 'done') return 'That’s the scene.'
  if (d.verdict === 'retake') return `Taking the last paragraph again${d.reason.trim() ? ` — ${clip(lowerStart(clean(d.reason)), 120)}` : ''}`
  const beat = next?.beats[0]
  return beat ? `Carry on — next, ${clip(lowerStart(clean(beat).replace(/[.!]+$/, '')), 90)}` : 'Carry on'
}

/** "Someone knocks at the door" reads "someone knocks at the door" after "next,"; a name stays as it is. */
function lowerStart(s: string): string {
  const first = s.split(/\s/)[0] ?? ''
  return /^(?:The|A|An|Someone|Somebody|They|She|He|It|Then|At|In|On|As|When|After|Before|Both|Everyone|Nobody|No|One|Their|Her|His|Its|This|That|There|What|Who|Why|How|Finally|Later|Now|Next)$/.test(first)
    ? s.charAt(0).toLowerCase() + s.slice(1)
    : s
}

/**
 * The decision made here, with no AI call: a slip that must not stand in the last paragraph is taken again (at most
 * MOST_RETAKES times); once the plan's stretches are written, the scene is done when everything landed, or after one
 * stretch more to land what didn't; otherwise carry on, with what is overdue as the note.
 */
export function freeDecision(o: {
  findings: readonly StretchFinding[]
  progress: Progress
  plan: StretchPlan
  stretches: number
  retakes: number
}): Decision {
  const slip = o.findings.find((f) => f.inLast && f.mustFix)
  if (slip && o.retakes < MOST_RETAKES) return { verdict: 'retake', note: '', reason: slip.message, by: 'free' }
  const units = o.plan.units.length
  const missing = [
    ...o.plan.beats.slice(o.progress.beatsOn, beatsDue(o.plan, o.stretches)).map((b) => clean(b)),
    ...(o.stretches >= units ? missingAsks(o.progress) : [])
  ]
  if (o.stretches >= units) {
    if (!missing.length || o.stretches >= units + 1) return { verdict: 'done', note: '', reason: '', by: 'free' }
    return { verdict: 'continue', note: `Before the scene ends: ${missing.map((m) => `“${clip(m, 140)}”`).join('; ')}`, reason: '', by: 'free' }
  }
  const notes = [
    missing.length ? `Land this now: ${missing.map((m) => `“${clip(m, 140)}”`).join('; ')}` : '',
    ...o.findings.filter((f) => !(f.inLast && f.mustFix)).slice(0, 2).map((f) => `Keep to the story: ${f.message}`)
  ].filter(Boolean)
  return { verdict: 'continue', note: notes.join(' '), reason: '', by: 'free' }
}
