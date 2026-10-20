// The director's one short call (Adam's spec, "Directed writing (an option)"): made only when the free checks found
// something, a planned beat or ask is overdue, Adam gave a note, or the plan's stretches are written and the scene doesn't
// yet show it is complete. It reads the latest stretch against the scene plan, the checklist (the scene contract's asks,
// ai/contract.ts) and Adam's direction, and answers with a verdict and a note of a line or two. It never writes prose.
// The director model is its own job in Settings › Models ('director'; the memory model unless Adam picks another). Pure.

import type { ChatMessage } from '@shared/types'
import type { DirectorVerdict } from '@shared/contracts/director'
import { parseLenient } from '../keeper/json'
import type { StretchFinding } from './checks'
import type { Progress, Why } from './decide'
import { MOST_RETAKES, type StretchPlan, type StretchUnit } from './stretch'

export const DIRECTOR_MARKER = '[AIWRITE-DIRECTOR v1]'
/** Room for the director's reply: a verdict and a line or two. */
export const DIRECTOR_REPLY_TOKENS = 300
export const DIRECTOR_TEMPERATURE = 0.3
/** How much of the draft before the latest stretch the director reads (its end), in words. */
export const DIRECTOR_BEFORE_WORDS = 350
/** The longest note and reason kept from the reply, in characters. */
export const NOTE_MOST = 360
export const REASON_MOST = 240

export const DIRECTOR_SYSTEM = `${DIRECTOR_MARKER}
You are the director of a novel being written a stretch at a time, like a film director giving notes between takes. You never write the story's prose: you read the stretch just written and decide what happens next.

Decide one of three things:
- "continue": carry on. Give the writer a note of a line or two for the next stretch: what to land next, what to keep in mind, what to put right from here on.
- "retake": take the last paragraph again. Only when that paragraph itself has a slip that must not stand: something the checks found in it, someone saying or doing what they can't, a fact against the story so far, or the author's note asks for it. Say what is wrong in "reason", and how to write it instead in "note".
- "done": the scene is complete: every beat of the plan and every item of the checklist has landed, and it has reached its closing image.

Notes are short, concrete and in plain words; name people and things as the story does; never write the prose for the writer, and quote at most a few words of it. A beat landed in other words than the plan's counts as landed.

Reply with JSON only, nothing before or after it:
{"verdict": "continue" | "retake" | "done", "note": "…", "reason": "…"}`

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** The last `most` words of a text, with "…" before them when it was longer. */
function endOf(text: string, most: number): string {
  const words = text.trim().split(/(\s+)/)
  const count = words.filter((w) => w.trim()).length
  if (count <= most) return text.trim()
  let seen = 0
  let i = words.length
  while (i > 0 && seen < most) {
    i--
    if (words[i].trim()) seen++
  }
  return `…${words.slice(i).join('')}`
}

/** What the director is asked about one stretch. */
export interface DirectorAsk {
  plan: StretchPlan
  progress: Progress
  /** Stretches written (this one included), and how many are planned. */
  stretch: number
  of: number
  closing: string
  direction: string
  findings: readonly StretchFinding[]
  why: readonly Why[]
  /** The draft's words (and the scene's, carrying on) before the stretch. */
  before: string
  stretchText: string
  /** How many times its last paragraph has been taken again. */
  retakes: number
  /** The next stretch as planned; null when the plan's stretches are written. */
  next: StretchUnit | null
}

/** The director's request: its instructions, then the plan, the checklist, the direction, why it is asked, and the words. */
export function directorMessages(a: DirectorAsk): ChatMessage[] {
  const due = a.plan.units.slice(0, a.stretch).reduce((n, u) => n + u.beats.length, 0)
  const beats = a.plan.beats.map((b, i) => {
    const state = i < a.progress.beatsOn ? 'on the page' : i < due ? 'written for, not found on the page' : i === due ? 'next' : 'to come'
    return `${i + 1}. ${clean(b)} (${state})`
  })
  const parts = [
    '## The scene plan',
    beats.length ? beats.join('\n') : `No beats: about ${a.plan.target} words, a stretch at a time.`,
    a.closing.trim() ? `It ends on: ${clean(a.closing)}` : '',
    a.progress.asks.length ? `\n## The checklist (what must change in this scene)\n${a.progress.asks.map((x) => `- ${clean(x.text)} (${x.landed ? 'on the page' : 'not yet'})`).join('\n')}` : '',
    a.direction.trim() ? `\n## The author's direction\n${clean(a.direction)}` : '',
    a.findings.length
      ? `\n## What the free checks found in the latest stretch\n${a.findings.map((f) => `- ${f.message}${f.quote ? ` (“${clean(f.quote).slice(0, 200)}”)` : ''}${f.inLast ? ' [its last paragraph]' : ''}`).join('\n')}`
      : '',
    `\n## Why you are asked\n${a.why.map((w) => `- ${w.text}`).join('\n')}`,
    a.before.trim() ? `\n## The story just before the latest stretch\n${endOf(a.before, DIRECTOR_BEFORE_WORDS)}` : '',
    `\n## The latest stretch (stretch ${a.stretch} of ${a.of})\n${a.stretchText.trim()}`,
    `\n## Retakes of its last paragraph so far: ${a.retakes} of ${MOST_RETAKES}${a.retakes >= MOST_RETAKES ? ' (no more: carry on or end)' : ''}`,
    a.next?.beats.length ? `The next stretch, as planned: ${a.next.beats.map(clean).join(' Then ')}` : a.next ? 'The next stretch, as planned: what comes next.' : 'The planned stretches are all written.'
  ]
  return [
    { role: 'system', content: DIRECTOR_SYSTEM },
    { role: 'user', content: parts.filter(Boolean).join('\n') }
  ]
}

const VERDICTS: readonly DirectorVerdict[] = ['continue', 'retake', 'done']

/** The director's reply read: its verdict, note and reason; null when it can't be read. */
export function readVerdict(reply: string): { verdict: DirectorVerdict; note: string; reason: string } | null {
  const parsed = parseLenient(reply)
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return null
  const v = parsed.value as Record<string, unknown>
  const verdict = String(v.verdict ?? '').trim().toLowerCase().replace(/^carry on$/, 'continue') as DirectorVerdict
  if (!VERDICTS.includes(verdict)) return null
  const text = (x: unknown, most: number): string => {
    const t = typeof x === 'string' ? clean(x) : ''
    return t.length > most ? `${t.slice(0, most - 1).trimEnd()}…` : t
  }
  return { verdict, note: text(v.note, NOTE_MOST), reason: text(v.reason, REASON_MOST) }
}
