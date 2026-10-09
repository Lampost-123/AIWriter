// The judge: one model call per written passage, given only the passage, the facts true where it begins and the
// probe's yes/no questions. It never sees the writer's briefing. Pure (the call itself is made in run.ts), so the
// prompt and the reading of its reply can be tested.

import { RUBRIC_KEYS, type ProseRubric } from './prose'
import type { Probe } from './story'

/** Starts the judge's system prompt, so a stand-in model can tell its requests apart. */
export const JUDGE_MARKER = '[AIWRITE-TRAPS-JUDGE v3]'

export type JudgeWord = 'yes' | 'no' | 'unclear'

export interface JudgeAnswer {
  id: string
  answer: JudgeWord
  /** The passage's own words that show it ('' when none were given). */
  quote: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const SYSTEM = `${JUDGE_MARKER}
You check a passage of fiction against facts of its story that it must keep to. The passage carries on the story from the point the facts describe.

For each question, answer from the passage alone:
- "yes" or "no" when the passage shows the answer.
- "unclear" when the passage doesn't show it either way (it never mentions the thing asked about). Never guess from what is likely.
- What the passage shows happening counts. If it shows someone moving (going down the stairs, coming in, footsteps or a creak on the stairs before they appear, arriving from another room), taking something off or putting it on, picking something up or putting it down, then what follows from that is not a contradiction.
- Only what is really so counts: a coat or boots seen, mentioned or lying nearby are not being worn; a place only thought of or talked about is not where someone is.
- With "yes" or "no", give "quote": the exact words of the passage that show it, copied exactly, at most 30 words. For a "no" that rests on something the passage never does, quote "".

Reply with only a JSON object:
{"answers": [{"id": "Q1", "answer": "yes", "quote": "..."}]}`

/** What the judge is told to mark the writing against: the author's direction for the passage, if any. */
export interface RubricAsk {
  direction: string | null
}

/**
 * The prose rubric, folded into the call the judge makes anyway (never a call of its own): 1 to 5 on four things the
 * audit of rounds 7 and 8 found, each with what 1, 3 and 5 look like.
 */
export function rubricText(r: RubricAsk): string {
  const direction = r.direction?.trim()
    ? `the author asked for this: "${r.direction.trim()}". 1 = ignores it, or invents events nobody asked for (an arrival, a visitor, a new day, the scene's end) to fill the length; 3 = does it, padded with invented action; 5 = does what was asked and only what the moment needs.`
    : `there was no direction: the passage carries the scene on. 1 = invents events the scene doesn't need (an arrival, a visitor, a new day, the scene's end) or does again what already happened; 3 = carries on, padded with invented action; 5 = carries the moment on and nothing more.`
  return [
    'Also mark the passage\'s writing, 1 to 5 each, as "prose" in the same JSON object:',
    '- voices: 1 = everyone sounds alike, or lines are copied from what a character said before; 3 = the voices differ but lean on the same catchphrases; 5 = each person sounds like themselves, in new words.',
    '- subtext: 1 = feelings are named and explained; 3 = some is left unsaid; 5 = what matters is carried by what people do and leave unsaid.',
    `- direction: ${direction}`,
    '- ending: 1 = closes the scene off (sleep, silence, a summing-up line); 3 = winds down; 5 = stops mid-motion, ready to go on.'
  ].join('\n')
}

/** The judge's request for one passage; with `rubric`, it marks the writing too, in the same call. */
export function judgeMessages(probe: Pick<Probe, 'facts' | 'checks'>, passage: string, rubric?: RubricAsk): ChatMessage[] {
  const user = [
    `What is true where the passage begins:\n${probe.facts.map((f) => `- ${f}`).join('\n')}`,
    `The passage:\n"""\n${passage.trim()}\n"""`,
    `Questions:\n${probe.checks.map((c) => `${c.id}: ${c.ask}`).join('\n')}`,
    ...(rubric ? [`${rubricText(rubric)}\n\nThen reply as: {"answers": [...], "prose": {"voices": 3, "subtext": 3, "direction": 3, "ending": 3}}`] : [])
  ].join('\n\n')
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user }
  ]
}

function word(v: unknown): JudgeWord {
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
  if (/^(yes|y|true)\b/.test(s)) return 'yes'
  if (/^(no|n|false)\b/.test(s)) return 'no'
  return 'unclear'
}

/** The first JSON object or array in a reply (models wrap it in prose or code fences now and then). */
function firstJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '')
  const starts = [t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0)
  if (!starts.length) return null
  const start = Math.min(...starts)
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (end <= start) return null
  try {
    return JSON.parse(t.slice(start, end + 1))
  } catch {
    return null
  }
}

/** The judge's marks for the writing, when it gave them (each 1 to 5, else null); null when it gave none. */
export function readJudgeProse(text: string): ProseRubric | null {
  const v = firstJson(text) as { prose?: Record<string, unknown> } | null
  const p = v && !Array.isArray(v) && v.prose && typeof v.prose === 'object' ? v.prose : null
  if (!p) return null
  const out = {} as ProseRubric
  for (const k of RUBRIC_KEYS) {
    const n = Math.round(Number(p[k]))
    out[k] = Number.isFinite(n) && n >= 1 && n <= 5 ? n : null
  }
  return RUBRIC_KEYS.some((k) => out[k] != null) ? out : null
}

/** The judge's answers, by question id; null when the reply can't be read at all. */
export function readJudgeReply(text: string): JudgeAnswer[] | null {
  const v = firstJson(text)
  const list = Array.isArray(v) ? v : Array.isArray((v as { answers?: unknown } | null)?.answers) ? (v as { answers: unknown[] }).answers : null
  if (!list) return null
  const out: JudgeAnswer[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = String(o.id ?? '').trim()
    if (!id) continue
    out.push({ id, answer: word(o.answer), quote: typeof o.quote === 'string' ? o.quote.trim() : '' })
  }
  return out
}
