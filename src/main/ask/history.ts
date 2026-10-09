// The chat overhaul's history hygiene (AIWRITE_EXP_CHAT_HISTORY, plan E9): an earlier answer as the model is shown it
// again. Its proposals become compact lines saying what each changed (so "make change 2 shorter" needs no re-read);
// "I'll read the scene first" preambles are taken out; an answer that only asked a question is cut to the question.
// (Text an earlier nudge replaced never reaches the record: ai/tasks.ts takes it out of the reply.) With the answer
// format (AIWRITE_EXP_CHAT_FORMAT), an answer in blocks is shown again compact: compactBlocks. Pure.

import { answerText, hasBlockMarkers, parseAnswer, type AnswerBlock } from '@shared/answerBlocks'
import type { DraftMode, Proposal } from '@shared/contracts/ask'

/** The most of either side of a change shown again. */
export const CLIP = 120

/** Words on one line, cut to `max` characters with an ellipsis. */
export function clipLine(s: string, max = CLIP): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

const q = (s: string): string => `"${clipLine(s)}"`

/** "[4]" for one paragraph, "[4]–[6]" for several. */
const paraSpan = (from: number, to: number): string => (from === to ? `[${from}]` : `[${from}]–[${to}]`)

/** A proposed draft's mode in words. */
const DRAFT_WORDS: Record<DraftMode, string> = { generate: 'whole scene', add_below: 'add below', continue: 'continue', redo_beat: 'redo beat' }

/** What a beats change did: one beat put in, reworded or taken out, or the whole new list. */
function beatsChange(p: Extract<Proposal, { kind: 'beats' }>): string {
  const at = p.index ?? 0
  if (p.op === 'insert') return `insert ${at} ${q(p.beats[at - 1] ?? '')}`
  if (p.op === 'edit') return `beat ${at} ${q(p.before[at - 1] ?? '')} → ${q(p.beats[at - 1] ?? '')}`
  if (p.op === 'remove') return `remove ${at} ${q(p.before[at - 1] ?? '')}`
  return `${p.before.length} → ${p.beats.length}: ${q(p.beats.join('; '))}`
}

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
      case 'insert':
        return `[${p.sceneLabel}] insert ${p.where} [${p.at.paragraph}]: ${q(p.text)}`
      case 'cut':
        return `[${p.sceneLabel}] cut ${paraSpan(p.from.paragraph, p.to.paragraph)}: ${q(p.paragraphs.join(' '))}`
      case 'beats':
        return `[${p.sceneLabel}] beats: ${beatsChange(p)}`
      case 'draft':
        return `[${p.sceneLabel}] draft (${DRAFT_WORDS[p.mode]}${p.mode === 'redo_beat' && p.beat ? ` ${p.beat.index}` : ''}): ${q(p.direction)}`
      case 'issueFix':
        return `${p.sceneLabel ? `[${p.sceneLabel}] ` : ''}issue fix (${p.how === 'memory' ? 'memory' : 'text'}) ${q(p.message)}${
          p.how === 'memory' && p.memory ? `: ${p.memory.name} ${p.memory.fieldLabel} ${q(p.memory.from)} → ${q(p.memory.to)}` : p.fix ? `: ${q(p.quote)} → ${q(p.fix)}` : ''
        }`
      case 'chapterCard':
        return `[${p.chapterLabel}] chapter card: ${p.lines.map((l) => `${l.label} ${q(l.to)}`).join(', ') || 'no parts'}${p.scenes ? ` (into ${p.scenes} scene card${p.scenes === 1 ? '' : 's'})` : ''}`
      case 'thread':
        return `[${p.sceneLabel}] thread ${q(p.name)}${p.threadId ? '' : ' (new)'}: ${p.action} (${p.list === 'paysOff' ? 'pays off' : 'sets up'})${p.note ? ` ${q(p.note)}` : ''}`
      case 'replaceAll':
        // Phase 4 (EXTRATOOLS): every place the words stand, with how many when proposed and the entry renamed too.
        return `${p.sceneLabel ? `[${p.sceneLabel}] ` : ''}replace all ${q(p.find)} → ${p.replace ? q(p.replace) : '(cut)'} (${p.count} in ${p.scenes} scene${p.scenes === 1 ? '' : 's'}${p.renameEntry && p.rename ? `, ${p.rename.name} renamed` : ''})`
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

/** The most words text written before a step's tool calls may have and still be taken for narration of its steps. */
export const STEP_PREAMBLE_WORDS = 40

/**
 * True for words written just before tool calls in the same step that only narrate the model's own steps ("I'll read
 * the scene first…", "Let me check the outline."): short (STEP_PREAMBLE_WORDS words or fewer). With the contract on
 * (ai/tasks.ts), they are left out of the reply; longer words before the calls are kept.
 */
export function stepPreamble(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return words > 0 && words <= STEP_PREAMBLE_WORDS
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

/** The most of an option's why, and of a fact, kept when an answer in blocks is shown again. */
export const OPTION_WHY_CLIP = 60
export const FACT_CLIP = 120

/**
 * An earlier answer in the block format, made compact for the model to see again: still in blocks, so it sees what it
 * offered ("the second one" needs the option titles in order), but each option's why and each fact cut short and
 * ::more left out. An answer without blocks is returned as it was.
 */
export function compactBlocks(answer: string): string {
  if (!hasBlockMarkers(answer)) return answer
  const blocks = parseAnswer(answer).flatMap((b): AnswerBlock[] => {
    if (b.kind === 'more') return []
    if (b.kind === 'options') return [{ kind: 'options', items: b.items.map((o) => ({ title: clipLine(o.title, 80), why: o.why ? clipLine(o.why, OPTION_WHY_CLIP) : '' })) }]
    if (b.kind === 'facts') return [{ ...b, items: b.items.map((x) => clipLine(x, FACT_CLIP)) }]
    return [b]
  })
  return answerText(blocks)
}

/** The longest clarifying answer kept whole in the history with ACTFIRST (what it offered is what "do it" means). */
export const ASKED_KEEP_CHARS = 320

/**
 * A clarifying answer as the history keeps it with ACTFIRST: whole when short, since cutting "I'd cut the narration
 * before Hesper's line. Want me to?" to "(Asked) Want me to?" left "do it" meaning nothing (the Phase 2 run's R17, R15);
 * a long one cut to its question(s). Never the "(Asked)" tag, which the model copied into its own answers.
 */
export function keptQuestion(answer: string): string {
  const a = answer.trim()
  return a.length <= ASKED_KEEP_CHARS ? a : shortQuestion(a).replace(/^\(Asked\) /, '')
}

/**
 * An earlier answer as the model sees it again (switch on): trimmed, with what its proposals changed. `keepAsked`
 * (ACTFIRST): a clarifying answer keeps what it offered (keptQuestion), not only its question.
 */
export function pastAnswer(answer: string, proposals: Proposal[], keepAsked = false): string {
  let a = withoutPreambles(answer)
  if (!proposals.length && onlyAsks(a)) a = keepAsked ? keptQuestion(a) : shortQuestion(a)
  if (!proposals.length) return a
  return `${a}${a ? '\n\n' : ''}[Proposed with the tools:\n${proposals.map(proposalLine).join('\n')}]`
}
