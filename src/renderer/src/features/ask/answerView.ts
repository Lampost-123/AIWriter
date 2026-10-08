// What the new Ask panel (chat overhaul Phase 2) works out to draw an answer: how long an answer took, a fact's scene
// label, the follow-up questions, the line a screen reader hears when an answer is ready, and the empty state's starter
// questions (the tool calls' words are toolView.ts's). Pure, so it is unit-tested.
import type { AnswerBlock, Verdict } from '@shared/answerBlocks'
import type { Proposal } from '@shared/contracts/ask'
import { plainAnswer } from './citations'

/** An option as one line of words to keep: "The lamp fails — Edric hides his failing hands." (names without brackets). */
export function optionWords(title: string, why: string): string {
  const t = plainAnswer(title).replace(/[.:]\s*$/, '')
  const w = plainAnswer(why)
  return w ? `${t} — ${w}` : t
}

/** The beats with one added at the end, and the card's number for it (1 = the first). */
export function withBeat(beats: string[], beat: string): { beats: string[]; index: number } {
  const next = [...beats.filter((b) => b.trim()), beat]
  return { beats: next, index: next.length }
}

/** The beats without the one added as `index` (only when it is still there, as added; else its last copy). */
export function withoutBeat(beats: string[], beat: string, index: number): string[] {
  if (beats[index - 1] === beat) return beats.filter((_, i) => i !== index - 1)
  const at = beats.lastIndexOf(beat)
  return at < 0 ? beats : beats.filter((_, i) => i !== at)
}

/** How long an answer took, short: "4s", "1m 05s". */
export function durationWords(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const SCENE_AT_END = /[ \t]*\(((?:Book \d+, )?Ch \d+(?:, Sc \d+)?[^()]*)\)[ \t]*([.;]?)[ \t]*$/

/** A fact's words and the scene it is from, when it ends with one: "… (Ch 1, Sc 1)." → the scene set apart. */
export function factParts(item: string): { text: string; scene: string | null } {
  const m = SCENE_AT_END.exec(item)
  if (!m) return { text: item, scene: null }
  return { text: `${item.slice(0, m.index).trimEnd()}${m[2] || ''}`, scene: m[1].trim() }
}

/** The follow-up questions an answer offers (at most three, each once). */
export function followUpsOf(blocks: AnswerBlock[]): string[] {
  const out: string[] = []
  for (const b of blocks) {
    if (b.kind !== 'next') continue
    for (const q of b.items) {
      const t = q.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, n: string, shown?: string) => shown ?? n).trim()
      if (t && !out.includes(t)) out.push(t)
    }
  }
  return out.slice(0, 3)
}

/** The options an answer offers, counted across its option blocks. */
export const optionCount = (blocks: AnswerBlock[]): number => blocks.reduce((n, b) => n + (b.kind === 'options' ? b.items.length : 0), 0)

/** What a screen reader hears once an answer has ended: "Answer ready: 3 options, 2 changes", "Stopped", "Failed". */
export function readyWords(status: string, blocks: AnswerBlock[], proposals: Proposal[] | undefined): string {
  if (status === 'stopped') return 'Stopped'
  if (status === 'error') return 'Failed'
  const parts: string[] = []
  const options = optionCount(blocks)
  if (options) parts.push(`${options} ${options === 1 ? 'option' : 'options'}`)
  const changes = proposals?.length ?? 0
  if (changes) parts.push(`${changes} ${changes === 1 ? 'change' : 'changes'}`)
  return parts.length ? `Answer ready: ${parts.join(', ')}` : 'Answer ready'
}

const VERDICT_WORDS: Record<Verdict, RegExp> = {
  yes: /^[*_]{0,2}yes[*_]{0,2}(?:[.!,:;]|\s+[—–-])[*_]{0,2}\s*/i,
  no: /^[*_]{0,2}no[*_]{0,2}(?:[.!,:;]|\s+[—–-])[*_]{0,2}\s*/i,
  unknown:
    /^[*_]{0,2}(?:not in (?:the )?memory(?: yet)?|not (?:yet )?established|the memory (?:doesn['’]t|does not) say|unknown)[*_]{0,2}(?:[.!,:;]|\s+[—–-])[*_]{0,2}\s*/i
}

/**
 * A lead's words once its verdict shows as a chip: "Yes. Mara is 34." → "Mara is 34." The word goes only where it
 * stands as its own sentence or before a comma or dash ("The memory doesn't say how old she is" keeps all its words).
 */
export function leadWords(text: string, verdict: Verdict | undefined): string {
  if (!verdict) return text
  const rest = text.replace(VERDICT_WORDS[verdict], '')
  if (rest === text) return text
  // The rest starts as a sentence of its own.
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : ''
}

/** True when a question asks for ideas, so a plain list in its answer reads as option cards. */
export const asksForIdeas = (question: string): boolean =>
  /\b(brainstorm|ideas?|options?|suggest(?:ions?)?|names?|titles?|ways|what could|alternatives?)\b/i.test(question)

/** The chips over an empty box: each fills it with the start of a question. */
export const QUICK_ACTIONS: { kind: StarterCard['kind']; label: string; short: string; fill: string }[] = [
  { kind: 'brainstorm', label: 'Brainstorm', short: 'Ideas', fill: 'Brainstorm ideas for ' },
  { kind: 'check', label: 'Is this established?', short: 'Check', fill: 'Have I already established ' },
  { kind: 'tighten', label: 'Tighten', short: 'Tighten', fill: 'Tighten the opening paragraph, keeping my voice' },
  { kind: 'spelling', label: 'Fix spelling', short: 'Spelling', fill: 'Fix the spelling and grammar in this scene' }
]

/** One of the empty state's cards: what it does, and the question it puts in the box. */
export interface StarterCard {
  kind: 'brainstorm' | 'check' | 'tighten' | 'spelling'
  label: string
  question: string
}

/**
 * The empty state's cards, naming the open scene's people where it has them (its point of view first, then who
 * else is in it); without them, the spec's own examples.
 */
export function starterCards(cast: string[], fallback: readonly string[]): StarterCard[] {
  const [a, b] = cast
  return [
    {
      kind: 'brainstorm',
      label: 'Brainstorm',
      question: a && b ? `What would ${a} do if ${b} lied to them?` : a ? `What could go wrong for ${a} in this scene?` : fallback[0]
    },
    { kind: 'check', label: 'Is this established?', question: a ? `Did I already say how old ${a} is?` : fallback[1] },
    { kind: 'tighten', label: 'Tighten', question: fallback[3] },
    { kind: 'spelling', label: 'Fix spelling', question: fallback[2] }
  ]
}
