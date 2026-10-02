// What the writer model is told. These words decide prose quality, so they
// are kept here, stable and in one place. The instructions block always comes
// first and is the same for every scene in a story (the style guide is fixed
// for a story), so providers that cache repeated prompts can make repeat
// drafts cheaper and faster.

import type { StyleGuide } from '@shared/types'

const INTRO = `You are a skilled novelist drafting one scene of a longer work of fiction. The author plans each scene on a scene card and will edit your draft afterwards, so write a complete, polished scene that follows the plan closely and reads like a finished page of the book.

How to write the scene
- Write only the scene itself, as prose, from its first line to its last. No title, no headings, no notes, no comments before or after.
- Write plain text. To put words in italics (a character's thoughts, emphasis, the name of a ship or a book), wrap them in single *asterisks*. Use no other formatting: no bold, no underscores, no headings, no lists.
- Follow the scene card. Every beat happens on the page, in the order given. Dramatise the beats through action, dialogue and the point-of-view character's thoughts and senses; don't summarise them.`

/** The point-of-view rule, following the style guide (an omniscient narrator may move between minds). */
export function povRule(pov: string): string {
  if (!pov.trim()) {
    return '- Stay inside the point-of-view character. The reader knows only what they see, hear, notice, remember and feel. Show what other people think only through what they say and do.'
  }
  if (/omniscient|roving|head-?hop|multiple/i.test(pov)) {
    return "- Keep to the omniscient point of view the style guide sets. The narrator may move between characters and know what each thinks, but make each shift clear and don't jump between minds within a single exchange."
  }
  return "- Keep to the point of view the style guide sets. In a close third-person, first-person or second-person point of view, the reader knows only what the point-of-view character sees, hears, notices, remembers and feels, and other people's thoughts show only through what they say and do."
}

const REST = `- Be specific and concrete. Ground each moment in the place with a few telling sensory details rather than lists of them. Prefer the precise noun and the active verb.
- Let the characters want things and push against each other. Keep subtext in dialogue: people rarely say exactly what they mean.
- Give each character their own voice, as their profile describes. Use their sample lines as a guide to how they sound; don't repeat them word for word.
- Vary sentence length and paragraph rhythm. Trust the reader: don't explain feelings the scene already shows, and don't close on a summary or a moral. End on the scene's final beat.
- Avoid clichés and stock phrases, such as a breath someone didn't know they were holding, a shiver running down a spine, eyes that sparkle, a heart hammering against ribs, or anything described as "a testament to" something.
- Never contradict the facts you are given about the characters, places and world, or break the world's rules. Where the briefing is silent, stay consistent with what it implies, and don't invent major new facts (new powers, deaths, family ties, revelations) that the scene card doesn't call for.
- Keep every name, title and spelling exactly as given.`

/** The writer instructions, with the point-of-view rule that fits the style guide. */
export function writerInstructions(pov: string): string {
  return `${INTRO}\n${povRule(pov)}\n${REST}`
}

const SPELLING = {
  UK: 'UK English (colour, realise, grey, travelled)',
  US: 'US English (color, realize, gray, traveled)'
} as const

/** Block 1: the writer instructions, the style guide, one sample passage and the phrases to avoid. */
export function instructionsText(style: StyleGuide): string {
  const parts: string[] = [writerInstructions(style.pov)]

  const rules: string[] = []
  if (style.pov) rules.push(`- Point of view: ${style.pov}`)
  if (style.tense) rules.push(`- Tense: ${style.tense}`)
  if (style.spelling) rules.push(`- Spelling: ${SPELLING[style.spelling]}`)
  if (style.proseStyle) rules.push(`- Prose style: ${indentMore(style.proseStyle)}`)
  if (style.contentLimits) rules.push(`- Content limits (always respect these): ${indentMore(style.contentLimits)}`)
  if (style.notes) rules.push(`- Other notes from the author: ${indentMore(style.notes)}`)
  if (rules.length) parts.push(`Style guide\n${rules.join('\n')}`)

  if (style.samplePassage) {
    parts.push(
      `Sample passage\nThis passage is by the author. Match its voice, rhythm, sentence length and level of detail. It shows how the book should sound: don't copy its sentences or replay its events.\n\n"""\n${style.samplePassage.trim()}\n"""`
    )
  }

  if (style.avoidPhrases.length) {
    parts.push(`Words and phrases to avoid\nNever use any of these:\n${style.avoidPhrases.map((p) => `- ${p}`).join('\n')}`)
  }
  return parts.join('\n\n')
}

const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

/** The closing instruction at the end of the briefing. */
export function finalInstruction(o: {
  targetWords: number
  style: StyleGuide
  hasBeats: boolean
  hasGoal?: boolean
  hasOutcome?: boolean
  hasNotes?: boolean
  hasPrevious: boolean
  hasDirection: boolean
}): string {
  const lines: string[] = ['- Prose only, in plain text with *asterisks* only for italics: no title, no headings, no notes or comments before or after.']
  const plan = planLine(o)
  if (plan) lines.push(plan)
  lines.push(`- Aim for about ${o.targetWords.toLocaleString('en-GB')} words.`)
  const keep: string[] = []
  if (o.style.pov) keep.push(lowerFirst(o.style.pov))
  if (o.style.tense) keep.push(lowerFirst(o.style.tense))
  if (o.style.spelling) keep.push(`${o.style.spelling} spelling`)
  lines.push(keep.length ? `- Keep to ${joinAnd(keep)}.` : '- Keep the point of view and tense steady throughout.')
  if (o.hasPrevious) lines.push("- Continue seamlessly from where the previous scene ends. Don't repeat or recap it.")
  if (o.hasDirection) lines.push("- Follow the author's direction for this draft.")
  lines.push('- Never contradict the facts given above.')
  return `Write the scene now.\n${lines.join('\n')}`
}

/** What to aim the scene at, from whatever the scene card holds. */
function planLine(o: { hasBeats: boolean; hasGoal?: boolean; hasOutcome?: boolean; hasNotes?: boolean; hasDirection: boolean }): string | null {
  if (o.hasBeats) return '- Hit every beat on the scene card, in order.'
  if (o.hasGoal && o.hasOutcome) return '- Cover what the scene card describes, from its goal to its outcome.'
  if (o.hasGoal) return "- Build the scene around the scene card's goal."
  if (o.hasOutcome) return "- Write the scene so it arrives at the scene card's outcome."
  if (o.hasNotes) return "- Write the scene the author's notes on the scene card describe."
  // The direction line below covers it.
  if (o.hasDirection) return null
  return '- The scene card gives no plan beyond its title: write a scene that fits the title and follows on naturally from what came before.'
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Indents continuation lines so a multi-line value stays inside its list item. */
export function indentMore(value: string, pad = '  '): string {
  return value
    .trim()
    .split(/\r?\n/)
    .map((l, i) => (i === 0 ? l : `${pad}${l}`))
    .join('\n')
}
