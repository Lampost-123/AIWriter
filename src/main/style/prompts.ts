// What the writer model is told for the style guide's helpers: "Write a sample for me" (a short passage
// that shows the voice the style guide describes) and the polish pass (a revision of a finished Generate
// draft against common weaknesses and the style guide). Both system prompts start with a marker line,
// "[AIWRITE-STYLE v1] <job>", so the fake provider in tests can tell them apart. Pure, so it is unit-tested.

import type { ChatMessage, StyleGuide } from '@shared/types'
import { estimateTokens } from '../keeper/text'
import { feelLine, instructionsText, povRule } from '../ai/prompts'

export const STYLE_MARKER = '[AIWRITE-STYLE v1]'

/** The style in effect, with Adam's preference about common AI phrases. */
export type StyleForPrompt = StyleGuide & { avoidAiPhrases?: boolean }

const SPELLING_WORDS = { UK: 'UK spelling', US: 'US spelling' } as const

const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** "- Keep to close third person, past tense and UK spelling." or a line asking for steady choices when none is set. */
function keepLine(style: StyleGuide, none: string): string {
  const keep: string[] = []
  if (style.pov.trim()) keep.push(lowerFirst(style.pov.trim()))
  if (style.tense.trim()) keep.push(lowerFirst(style.tense.trim()))
  if (style.spelling) keep.push(SPELLING_WORDS[style.spelling])
  return keep.length ? `- Keep to ${joinAnd(keep)}.` : none
}

// ---------- Write a sample for me ----------

/** About how long the sample passage is, in words. */
export const SAMPLE_WORDS = 200
/** Room for the sample's reply, in tokens (about 200 words, with some to spare). */
export const SAMPLE_REPLY_TOKENS = 700
/** The sample is written with the Balanced creativity. */
export const SAMPLE_SAMPLING = { temperature: 0.85, topP: 0.95, minP: 0.05 } as const

function sampleIntro(pov: string): string {
  return `You are a skilled novelist writing a short sample passage for an author's style guide. The passage shows the voice the style guide below describes, so the author can hear how the book will sound, and so later drafts have an example to match.

How to write the sample
- Write one passage of about ${SAMPLE_WORDS} words: a small, self-contained moment you invent, with one or two characters in one place. An arrival, a meal, a task, a short exchange or a walk somewhere all work.
- It is not a scene from the author's book. Invent the people and the place, give nothing of any plot away, and don't end on a twist, a revelation or a cliffhanger.
- Show the voice rather than talk about it: its rhythm, sentence length, level of detail, how dialogue is handled and the mood it leaves.
- Write plain text. To put words in italics (a thought, emphasis, the name of a ship or a book), wrap them in single *asterisks*. Use no other formatting: no title, no headings, no notes, no comments before or after.
${povRule(pov)}
- Be specific and concrete. Ground the moment in a few telling sensory details, and prefer the precise noun and the active verb.
- Trust the reader: don't explain feelings the passage already shows, and don't close on a summary or a moral.`
}

/**
 * The messages for a sample passage: the style guide in effect (the genre picks and their blend, the author's
 * own take, prose style, point of view, tense, spelling, the content levels, the rules against AI phrasing)
 * without any sample passage of its own (the new one is written from the description), and the tone in effect.
 */
export function sampleMessages(style: StyleForPrompt, tone: string): ChatMessage[] {
  const guide: StyleForPrompt = { ...style, samplePassage: '' }
  const system = `${STYLE_MARKER} sample\n${instructionsText(guide, { intro: sampleIntro(guide.pov) })}`
  const lines = [
    `- About ${SAMPLE_WORDS} words of prose only, in plain text with *asterisks* only for italics: no title and no notes before or after.`,
    keepLine(guide, '- Pick a point of view and a tense that suit the style guide, and keep to them throughout.')
  ]
  const feel = feelLine(guide, tone)
  if (feel) lines.push(feel)
  lines.push('- Invent everything in it: no names, places or events from the author\'s book.')
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Write the sample passage now.\n${lines.join('\n')}` }
  ]
}

// ---------- The polish pass ----------

/** The polish pass is written with the Steady creativity: it keeps close to the draft. */
export const POLISH_SAMPLING = { temperature: 0.6, topP: 0.9 } as const

/** What the polish pass looks for, in order, as the prompt names them. */
export const POLISH_CHECKS = [
  'Clichés and stock phrases: replace each with something particular to this scene, or cut it.',
  "Needless explaining: cut lines that tell the reader what the scene already shows, and any closing summary or moral.",
  'Purple prose: prefer plain, exact words to ornate ones; trim stacked adjectives and strained metaphors.',
  'Flat or repetitive sentence patterns: vary sentence length and openings, and break up runs of sentences built the same way.',
  'Vague detail: swap general words for concrete ones the point-of-view character would actually notice.',
  'Odd word choice: fix words that are wrong, strained, repeated too closely or out of keeping with the voice.',
  'Tense or point-of-view slips: keep to one tense and one point of view throughout, as the style guide sets them.'
] as const

const POLISH_INTRO = `You are a careful line editor working on one scene of a novel. The scene below is a first draft. Read it closely, find what weakens it, and return the whole scene revised.

What to look for
${POLISH_CHECKS.map((c) => `- ${c}`).join('\n')}
- Anything that goes against the genre and feel, the content levels or the style guide below.

How to revise
- Change only what makes the scene better. Leave sentences that already work exactly as they are.
- Keep the story exactly as it is: the same events in the same order, the same characters, names, places and facts, and dialogue that says the same things. Don't add events, and don't cut any.
- Keep about the same length, and keep scene breaks (a line with * * *) where they are.
- Return only the revised scene, as plain text with *asterisks* for italics: no title, no notes, no list of changes and no comments before or after.`

/**
 * The messages for the polish pass: what to look for and how to revise, the style guide in effect (with its
 * sample passage, since the revision should sound like the author), the draft, and the closing reminder.
 */
export function polishMessages(style: StyleForPrompt, tone: string, draft: string): ChatMessage[] {
  const system = `${STYLE_MARKER} polish\n${instructionsText(style, { intro: POLISH_INTRO })}`
  const lines = [
    '- Return the whole revised scene, from its first line to its last, and nothing else.',
    keepLine(style, '- Keep the point of view and tense the draft uses, throughout.')
  ]
  const feel = feelLine(style, tone)
  if (feel) lines.push(feel)
  lines.push("- Never change what happens, or who says what.")
  return [
    { role: 'system', content: system },
    { role: 'user', content: `The draft to revise:\n\n"""\n${draft.trim()}\n"""\n\nRevise it now.\n${lines.join('\n')}` }
  ]
}

/** Room for the polish pass's reply: the draft's length again, with some to spare. */
export const polishReplyTokens = (draft: string): number => Math.ceil(estimateTokens(draft) * 1.25) + 300
