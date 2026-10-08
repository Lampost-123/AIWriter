// The chat overhaul's history hygiene (AIWRITE_EXP_CHAT_HISTORY, plan E9): an earlier answer as the model is shown it
// again. Its proposals become compact lines saying what each changed (so "make change 2 shorter" needs no re-read);
// "I'll read the scene first" preambles are taken out; an answer that only asked a question is cut to the question.
// (Text an earlier nudge replaced never reaches the record: ai/tasks.ts takes it out of the reply.) Pure.

import type { Proposal } from '@shared/contracts/ask'

/** The most of either side of a change shown again. */
export const CLIP = 120

/** Words on one line, cut to `max` characters with an ellipsis. */
export function clipLine(s: string, max = CLIP): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

const q = (s: string): string => `"${clipLine(s)}"`

/** What one proposal changed, on one line: `change 2: [Ch 1, Sc 2] "old" → "new" (applied)`. */
export function proposalLine(p: Proposal): string {
  const what = ((): string => {
    switch (p.kind) {
      case 'text':
        return `[${p.sceneLabel}] ${q(p.find)} → ${p.replace ? q(p.replace) : '(cut)'}`
      case 'passage':
        return `[${p.sceneLabel}] ${q(p.original || `${p.start} … ${p.end}`)} → ${p.replace ? q(p.replace) : '(cut)'}`
      case 'card':
        return `[${p.sceneLabel}] scene card: ${Object.entries(p.patch)
          .map(([k, v]) => `${k} ${q(Array.isArray(v) ? v.join('; ') : String(v ?? ''))}`)
          .join(', ')}`
      case 'entry':
        return `entry ${p.name}: ${[
          p.patch.summary != null ? `summary ${q(p.patch.summary)}` : '',
          p.patch.description != null ? `description ${q(p.patch.description)}` : '',
          p.patch.aliases ? `aliases ${q(p.patch.aliases.join(', '))}` : '',
          ...Object.entries(p.patch.fields ?? {}).map(([k, v]) => `${k} ${q(v)}`)
        ]
          .filter(Boolean)
          .join(', ')}`
      case 'newEntry':
        return `new ${p.entryKind} ${q(p.name)}: ${q(p.summary || p.description)}`
      case 'newScene':
        return `new scene ${q(p.title)} at the end of ${p.chapterLabel}`
      case 'newChapter':
        return `new chapter ${q(p.title)}`
      case 'rename':
        return `rename ${p.target} ${q(p.from)} → ${q(p.to)}`
      default:
        return `a ${(p as { kind: string }).kind} change`
    }
  })()
  return `change ${p.id}: ${what} (${p.status})`
}

/** A sentence that only says what the model is about to look at ("I'll read the scene first.", "Let me check…"). */
const PREAMBLE =
  /^(?:(?:ok(?:ay)?|sure|right|great|alright|got it)[,.!]?\s+)?(?:first,?\s+)?(?:(?:let me|i['’]?ll|i will|i['’]?m going to|i am going to|i need to)\s+(?:first\s+|quickly\s+|just\s+)?(?:read|look|check|see|open|search|find|pull up|review|scan|take a look)\b|(?:reading|looking at|checking|searching)\b)[^.!?\n]{0,160}?(?:[.!…:]+|$)\s*/i

/** An answer without its opening "I'll read the scene first" sentences, when something else follows them. */
export function withoutPreambles(answer: string): string {
  return answer
    .split(/\n{2,}/)
    .map((para) => {
      let p = para.trim()
      for (let i = 0; i < 3; i++) {
        const m = PREAMBLE.exec(p)
        if (!m || !p.slice(m[0].length).trim()) break
        p = p.slice(m[0].length).trim()
      }
      // A paragraph that is nothing but a preamble goes when more of the answer follows.
      return p
    })
    .filter((p, i, all) => !(PREAMBLE.test(p) && p.replace(PREAMBLE, '').trim() === '' && all.slice(i + 1).some((x) => x.trim())))
    .join('\n\n')
    .trim()
}

/** True for an answer that only asked the writer something: short, ending on a question, no list. */
export function onlyAsks(answer: string): boolean {
  const a = answer.trim()
  return !!a && a.length <= 600 && /\?["”')\]]*$/.test(a) && !/\n\s*(\d+[.)]|[-*•])\s/.test(a)
}

/** A clarifying answer cut to its question(s), on one line. */
export function shortQuestion(answer: string): string {
  const sentences = answer
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]+["”')\]]*/g) ?? [answer]
  const asked = sentences.filter((s) => /\?["”')\]]*$/.test(s.trim()))
  return `(Asked) ${clipLine(asked.join(' ').trim() || answer, 240)}`
}

/** An earlier answer as the model sees it again (switch on): trimmed, with what its proposals changed. */
export function pastAnswer(answer: string, proposals: Proposal[]): string {
  let a = withoutPreambles(answer)
  if (!proposals.length && onlyAsks(a)) a = shortQuestion(a)
  if (!proposals.length) return a
  return `${a}${a ? '\n\n' : ''}[Proposed with the tools:\n${proposals.map(proposalLine).join('\n')}]`
}
