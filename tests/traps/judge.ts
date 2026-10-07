// The judge: one model call per written passage, given only the passage, the facts true where it begins and the
// probe's yes/no questions. It never sees the writer's briefing. Pure (the call itself is made in run.ts), so the
// prompt and the reading of its reply can be tested.

import type { Probe } from './story'

/** Starts the judge's system prompt, so a stand-in model can tell its requests apart. */
export const JUDGE_MARKER = '[AIWRITE-TRAPS-JUDGE v1]'

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
- With "yes" or "no", give "quote": the exact words of the passage that show it, copied exactly, at most 30 words. For a "no" that rests on something the passage never does, quote "".

Reply with only a JSON object:
{"answers": [{"id": "Q1", "answer": "yes", "quote": "..."}]}`

/** The judge's request for one passage. */
export function judgeMessages(probe: Pick<Probe, 'facts' | 'checks'>, passage: string): ChatMessage[] {
  const user = [
    `What is true where the passage begins:\n${probe.facts.map((f) => `- ${f}`).join('\n')}`,
    `The passage:\n"""\n${passage.trim()}\n"""`,
    `Questions:\n${probe.checks.map((c) => `${c.id}: ${c.ask}`).join('\n')}`
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
