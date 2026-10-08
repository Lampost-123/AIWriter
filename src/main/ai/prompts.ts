// What the writer model is told. These words decide prose quality, so they
// are kept here, stable and in one place. The instructions block always comes
// first and is the same for every scene in a story (the style guide is fixed
// for a story), so providers that cache repeated prompts can make repeat
// drafts cheaper and faster.

import type { StyleGuide } from '@shared/types'
import { AUTO_LENGTH } from '@shared/defaults'
import { genresOf } from '@shared/genres'
import { intensityLines } from '@shared/intensity'
import { PROMPT_SLOP, SLOP_RULES } from '@shared/slop'

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

const REST = (end: string): string => `- Be specific and concrete. Ground each moment in the place with a few telling sensory details rather than lists of them. Prefer the precise noun and the active verb.
- Let the characters want things and push against each other. Keep subtext in dialogue: people rarely say exactly what they mean.
- Give each character their own voice, as their profile describes. Their sample lines show how they sound: never reuse a sample line word for word, or a line already said in the story.
- Vary sentence length and paragraph rhythm. Trust the reader: don't explain feelings the scene already shows, and don't close on a summary or a moral.${end}
- Avoid clichés and stock phrases, such as a breath someone didn't know they were holding, a shiver running down a spine, eyes that sparkle, a heart hammering against ribs, or anything described as "a testament to" something.
- The briefing gives the characters, places and world as they stand at this point in the story. Anything marked as an aim or a target (what this scene should bring about, what the story leads into) is where the story is heading, not something that has already happened.
- Never contradict the facts you are given about the characters, places and world, or break the world's rules. Where the briefing is silent, stay consistent with what it implies, and don't invent major new facts (new powers, deaths, family ties, revelations) that the scene card doesn't call for.
- Keep every name, title and spelling exactly as given.`

/**
 * Add below's own introduction (Adam, 2026-10-08): an audit of 122 real writer calls found Add below given Generate's
 * "write a complete, polished scene… End on the scene's final beat", so it invented action to reach its word count
 * (6 of the 7 remaining trap breaks), closed scenes off (sleep, silence) and wrote card beats already on the page again.
 */
const ADD_BELOW_INTRO = `You are a skilled novelist writing a longer work of fiction with its author, one stretch at a time. The scene so far is already on the page. Write only the next stretch: carry the scene on from exactly where it stands, as finished prose that reads like the page it continues.

How to carry the scene on
- Write only the new words, as prose, carrying straight on from the last words on the page. No title, no headings, no notes, no comments before or after.
- Write plain text. To put words in italics (a character's thoughts, emphasis, the name of a ship or a book), wrap them in single *asterisks*. Use no other formatting: no bold, no underscores, no headings, no lists.
- Write what the author asks for next (their direction, or with none the next beat on the scene card not on the page yet), and nothing beyond it. Invent no new events of your own: no arrivals, discoveries, news, decisions or turns the author didn't ask for.
- Once that has happened, stop, even part-way through the scene and in the middle of a movement. Don't wrap up, settle anyone down, have them fall asleep or fall silent, or close the scene, unless the author asks for it.
- The length given is a ceiling, not a target: if what is asked is done in fewer words, use fewer. Never pad, and never add events to reach a length.
- Beats on the scene card that are already on the page are done: never write them again.
- Dramatise what happens through action, dialogue and the point-of-view character's thoughts and senses; don't summarise it.`

/** The writer instructions, with the point-of-view rule that fits the style guide. `addBelow`: Add below's own (ADD_BELOW_INTRO). */
export function writerInstructions(pov: string, addBelow = false): string {
  return addBelow ? `${ADD_BELOW_INTRO}\n${povRule(pov)}\n${REST('')}` : `${INTRO}\n${povRule(pov)}\n${REST(" End on the scene's final beat.")}`
}

const SPELLING = {
  UK: 'UK English (colour, realise, grey, travelled)',
  US: 'US English (color, realize, gray, traveled)'
} as const

/** Words kept of the sample passage in block 1's short form. */
export const SHORT_SAMPLE_WORDS = 120

/**
 * The opening of a passage, about `words` words long: up to the last sentence end in that stretch
 * when one falls in its second half, otherwise cut mid-sentence with an ellipsis. Short passages
 * come back whole.
 */
export function trimPassage(text: string, words = SHORT_SAMPLE_WORDS): string {
  const t = text.trim()
  const ends = [...t.matchAll(/\S+/g)].map((m) => (m.index ?? 0) + m[0].length)
  if (ends.length <= words) return t
  const cut = t.slice(0, ends[words - 1])
  let best = -1
  for (const m of cut.matchAll(/[.!?…]["'”’)\]]*(?=\s|$)/g)) best = (m.index ?? 0) + m[0].length
  if (best > 0 && t.slice(0, best).split(/\s+/).length >= words / 2) return t.slice(0, best)
  return `${cut}…`
}

/**
 * Block 1: the writer instructions, the style guide, the genre and feel, how far content goes, one sample
 * passage, the phrases to avoid and the rules against common AI phrasing.
 * `intro` takes the place of the drafting introduction for jobs that aren't writing a whole scene
 * (milestone 4's AI edits, say); '' leaves the introduction out (the style guide alone).
 * The short form (`trimSample`) keeps only the opening of the sample passage, the leading genre without its
 * worn-out moves, and the rules without the list of phrases. `proseRules: false` leaves out the rules against
 * AI phrasing (for jobs that don't write prose, such as Ask the world).
 */
export function instructionsText(
  style: StyleGuide & { avoidAiPhrases?: boolean },
  opts: { trimSample?: boolean; intro?: string; proseRules?: boolean; addBelow?: boolean } = {}
): string {
  const short = !!opts.trimSample
  const intro = opts.intro ?? writerInstructions(style.pov, !!opts.addBelow)
  const parts: string[] = intro ? [intro] : []

  const rules: string[] = []
  if (style.pov) rules.push(`- Point of view: ${style.pov}`)
  if (style.tense) rules.push(`- Tense: ${style.tense}`)
  if (style.spelling) rules.push(`- Spelling: ${SPELLING[style.spelling]}`)
  if (style.proseStyle) rules.push(`- Prose style: ${indentMore(style.proseStyle)}`)
  if (style.contentLimits) rules.push(`- Content limits (always respect these): ${indentMore(style.contentLimits)}`)
  if (style.notes) rules.push(`- Other notes from the author: ${indentMore(style.notes)}`)
  if (rules.length) parts.push(`Style guide\n${rules.join('\n')}`)

  const feel = genreText(style, short)
  if (feel) parts.push(feel)
  const content = contentText(style)
  if (content) parts.push(content)
  // Ask the world sets proseRules false, so it does not get the sex-scene craft.
  if (opts.proseRules !== false) {
    const sex = sexSceneText(style)
    if (sex) parts.push(sex)
  }

  if (style.samplePassage.trim()) {
    const sample = short ? trimPassage(style.samplePassage) : style.samplePassage.trim()
    parts.push(
      `Sample passage\nThis passage is by the author. Match its voice, rhythm, sentence length and level of detail. It shows how the book should sound: don't copy its sentences or replay its events.\n\n"""\n${sample}\n"""`
    )
  }

  // Not in the short form, which a small model gets.
  if (opts.proseRules !== false && !short) parts.push(SPOKEN_LINE)
  if (style.avoidPhrases.length) {
    parts.push(`Words and phrases to avoid\nNever use any of these:\n${style.avoidPhrases.map((p) => `- ${p}`).join('\n')}`)
  }
  if (opts.proseRules !== false && style.avoidAiPhrases !== false) parts.push(aiPhrasesText(short))
  return parts.join('\n\n')
}

/**
 * "Genre and feel": what the genre picks mean for the prose, with the author's own take. A blend leads with
 * the first pick and brings in the feel of the second. The short form keeps the leading genre and the
 * author's take only. Empty when no genre is picked and there is no take.
 */
export function genreText(style: Pick<StyleGuide, 'genres' | 'genreNotes'>, short = false): string {
  const picks = genresOf(style.genres ?? [])
  const notes = (style.genreNotes ?? '').trim()
  if (!picks.length && !notes) return ''
  const lines: string[] = []
  const [lead, blend] = picks
  if (lead && blend && !short) {
    lines.push(`This story is mostly ${lead.label.toLocaleLowerCase()}, with the feel of ${blend.label.toLocaleLowerCase()}.`)
    lines.push(lead.guidance)
    lines.push(`From ${blend.label.toLocaleLowerCase()}, bring in its ${blend.feel}: ${lowerFirst(firstSentences(blend.guidance, 1))}`)
  } else if (lead) {
    lines.push(`This story is ${lead.label.toLocaleLowerCase()}.${blend ? ` It also has the feel of ${blend.label.toLocaleLowerCase()}.` : ''}`)
    lines.push(lead.guidance)
  }
  if (notes) lines.push(`The author's own take on it: ${indentMore(notes, '')}`)
  // The leading genre's worst four and the blend's worst two keep block 1 small.
  const cliches = short ? [] : [...(lead?.cliches.slice(0, 4) ?? []), ...(blend?.cliches.slice(0, 2) ?? [])]
  if (cliches.length) lines.push(`Steer clear of worn-out moves such as ${cliches.join('; ')}.`)
  return `Genre and feel\n${lines.join('\n')}`
}

/** The first `n` sentences of a passage. */
function firstSentences(text: string, n: number): string {
  const ends = [...text.matchAll(/[.!?](?=\s|$)/g)]
  return ends.length > n ? text.slice(0, (ends[n - 1].index ?? 0) + 1) : text
}

/**
 * Craft for Explicit romance, on jobs that write prose. Empty otherwise.
 * The content limits in the style guide still win: they are stated above this block.
 */
export function sexSceneText(style: Pick<StyleGuide, 'intensity'>): string {
  if (style.intensity?.romance !== 4) return ''
  return `Sex scenes
When anyone is having sex in this passage, write the sex as a physical scene, the way a porn page tags acts and the way people talk in one. Any passage that is not sexual, leave alone.
- Stage each act in order, on the page. Do not cut away, skip to afterwards, or summarise it ("they had sex", "they made love").
- When the scene card names acts (oral, anal, a position, finishing inside, and the like), give each named act its own stretch: who does it, the contact, a line of talk, and how that stretch ends.
- Use blunt words for bodies, acts and fluids: cock, cunt, clit, balls, tits, ass, fuck, suck, come. Never use coy stand-ins such as manhood, member, length, core, heat, centre, flower, nectar or velvet, or "their bodies moved as one".
- During the sex, dialogue is direct, and this overrides the rule about subtext: characters say what they want and what is happening, in short lines (a command, begging, praise, or the name of the act). Save longer speeches for afterwards.
- Stay in the body: pressure, wetness, stretch, taste, smell, breath, and where the hands and the mouth are. Clothes come off in the prose. Do not give anyone an extra hand.
- Adults only. Consent shows in what they do and say.`
}

/** "Content": one sentence for each intensity scale Adam set; the content limits still win. Empty when none is set. */
export function contentText(style: Pick<StyleGuide, 'intensity' | 'contentLimits'>): string {
  const lines = intensityLines(style.intensity ?? {})
  if (!lines.length) return ''
  const unset = lines.length < 3 ? ' For anything not covered here, judge by the genre.' : ''
  const limits = style.contentLimits?.trim() ? ' Where the content limits above say otherwise, follow the content limits.' : ''
  const after = (unset + limits).trim()
  return `Content\n${lines.map((l) => `- ${l}`).join('\n')}${after ? `\n${after}` : ''}`
}

/** The rules against common AI phrasing, with the worst offenders named (left out of the short form). */
export function aiPhrasesText(short = false): string {
  const rules = SLOP_RULES.map((r) => `- ${r}`)
  if (!short) rules.push(`- Never use stock phrases like these, or variants: ${PROMPT_SLOP.map((p) => `"${p}"`).join(', ')}.`)
  return `Write like a person, not like an AI\n${rules.join('\n')}`
}

const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

/**
 * Block 1's rule that everything said aloud goes in quote marks, whoever or whatever says it (Adam, 2026-10-04: a
 * ring that talks was written in italics, so reading aloud gave its lines to the narrator).
 */
export const SPOKEN_LINE =
  'Speech\nPut everything said aloud in quote marks, whoever or whatever says it: a person, an animal, a talking object, a voice heard in someone’s head. Never set speech in italics instead.'

/** The closing instruction at the end of the briefing. */
/** What the closing instruction of a draft's briefing is made from (milestone 4's own closings take it too). */
export type FinalOptions = Parameters<typeof finalInstruction>[0]

/**
 * The closing instruction's line about length: the words asked for, or with Auto (targetWords null),
 * the length the scene needs within Auto's range (autoMax: the ceiling for this model).
 */
export function lengthLine(o: { targetWords: number | null; autoMax?: number }): string {
  if (o.targetWords != null) return `- Aim for about ${o.targetWords.toLocaleString('en-GB')} words.`
  const min = AUTO_LENGTH.min.toLocaleString('en-GB')
  const max = Math.max(AUTO_LENGTH.min, o.autoMax ?? AUTO_LENGTH.max).toLocaleString('en-GB')
  return `- Make the scene as long as it needs to be, between ${min} and ${max} words: play out every beat in full, and don't pad it.`
}

export function finalInstruction(o: {
  /** The length to aim for; null for Auto. */
  targetWords: number | null
  /** With Auto: the longest scene this model may be asked for. */
  autoMax?: number
  style: StyleGuide
  hasBeats: boolean
  hasGoal?: boolean
  hasOutcome?: boolean
  hasNotes?: boolean
  hasPrevious: boolean
  /** The previous scene is from another story (this story's first scene): its title, whether it ended there, this story's time gap. */
  previousStory?: { title: string; ended: boolean; timeGap: string } | null
  hasDirection: boolean
  /** On a redraft: the scene card lists what this scene should bring about. */
  hasBringAbout?: boolean
  /** The tone in effect (the story's, else the series', else the world's), for the closing reminder. */
  tone?: string
  /** Add below: the briefing has the scene so far, and the draft carries on from its end rather than starting the scene. */
  addBelow?: boolean
  /** The briefing says where things stand at the end of the scene so far (block 3b). */
  hasStand?: boolean
  /**
   * Add below: Adam's direction for this stretch, said last, right before the writer starts (Adam, 2026-10-08: in the
   * middle of the scene card it was followed loosely). '' or left out: none.
   */
  direction?: string
  /** Add below: the scene card's beats (blank ones left out), and how many of them, from the first, are on the page already. */
  beats?: string[]
  beatsDone?: number
  /** Phrases the scene has used already (ai/repetition.ts), not to be used again; empty or left out: none. */
  repeated?: string[]
}): string {
  if (o.addBelow) return addBelowFinal(o)
  const lines: string[] = [
    '- Prose only, in plain text with *asterisks* only for italics: no title, no headings, no notes or comments before or after.'
  ]
  const plan = planLine(o)
  if (plan) lines.push(plan)
  lines.push(lengthLine(o))
  lines.push(keepLine(o.style))
  const feel = feelLine(o.style, o.tone)
  if (feel) lines.push(feel)
  if (o.style.intensity?.romance === 4) {
    lines.push('- If adults have sex in this scene, play every act on the page in blunt words and direct talk; do not fade out or euphemise.')
  }
  const avoid = avoidLine(o.style)
  if (avoid) lines.push(avoid)
  const repeated = repeatedLine(o.repeated)
  if (repeated) lines.push(repeated)
  if (o.hasStand) lines.push(STAND_LINE)
  const other = o.previousStory
  if (o.hasPrevious && other) {
    const gap = other.timeGap ? ` Time since then: ${other.timeGap.replace(/\.$/, '')}.` : ''
    const what = other.ended ? `is how ${other.title} ended` : `is where ${other.title} had got to`
    lines.push(
      `- The previous scene ${what}, not part of this story. Don't continue it seamlessly or recap it: open this story in its own right.${gap}`
    )
  } else if (o.hasPrevious) lines.push("- Continue seamlessly from where the previous scene ends. Don't repeat or recap it.")
  if (o.hasBringAbout) lines.push('- Make the scene bring about what the scene card says it should.')
  if (o.hasDirection) lines.push("- Follow the author's direction for this draft.")
  lines.push('- Never contradict the facts given above.')
  return `Write the scene now.\n${lines.join('\n')}`
}

const STAND_LINE =
  '- Keep to where things stand at the end of the scene so far: where each person is, what they wear and how it sits, how they are placed and what they hold. Anything that changes, changes on the page.'

/** "- Keep to close third person, past tense and UK spelling." */
function keepLine(style: StyleGuide): string {
  const keep: string[] = []
  if (style.pov) keep.push(lowerFirst(style.pov))
  if (style.tense) keep.push(lowerFirst(style.tense))
  if (style.spelling) keep.push(`${style.spelling} spelling`)
  return keep.length ? `- Keep to ${joinAnd(keep)}.` : '- Keep the point of view and tense steady throughout.'
}

/** The closing line listing phrases the scene has used already (ai/repetition.ts); null when there are none. */
export function repeatedLine(phrases: string[] | undefined): string | null {
  const list = (phrases ?? []).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!list.length) return null
  return `- This scene has used these already, so don't use them again, or close variations: ${list.map((p) => `“${p}”`).join(', ')}.`
}

/**
 * Add below's closing (Adam, 2026-10-08): carry on from the very end; the beats already on the page are done; the
 * length is a ceiling; stop once what is asked has happened, mid-motion, without closing the scene; no events of its
 * own; and last of all, right before the writer starts, what happens now: Adam's direction, or with none the next beat.
 */
function addBelowFinal(o: FinalOptions): string {
  const lines: string[] = [
    '- Prose only, in plain text with *asterisks* only for italics: no title, no headings, no notes or comments before or after.',
    "- The scene so far is already on the page. Carry on seamlessly from its very end, as if there had been no pause: don't repeat, recap or rewrite any of it, and don't start the scene again."
  ]
  const beats = (o.beats ?? []).map((b) => b.trim()).filter(Boolean)
  const done = Math.max(0, Math.min(beats.length, o.beatsDone ?? 0))
  if (done) {
    const which = done === 1 ? 'Beat 1 on the scene card is' : `Beats 1 to ${done} on the scene card are`
    lines.push(`- ${which} already on the page: done. Never write ${done === 1 ? 'it' : 'them'} again, in any words.`)
  }
  lines.push(addBelowLengthLine(o))
  lines.push(keepLine(o.style))
  const feel = feelLine(o.style, o.tone)
  if (feel) lines.push(feel)
  if (o.style.intensity?.romance === 4) {
    lines.push('- If adults have sex in this scene, play every act on the page in blunt words and direct talk; do not fade out or euphemise.')
  }
  const avoid = avoidLine(o.style)
  if (avoid) lines.push(avoid)
  const repeated = repeatedLine(o.repeated)
  if (repeated) lines.push(repeated)
  if (o.hasStand) lines.push(STAND_LINE)
  if (o.hasBringAbout) lines.push('- Bring about what the scene card says it should only where what happens now calls for it.')
  lines.push('- Never contradict the facts given above.')
  lines.push(
    "- Invent no events of your own. Once what happens now has happened, stop, mid-motion if need be: don't wrap up, settle anyone down, have them sleep or fall silent, or close the scene, unless that is what is asked."
  )
  const direction = (o.direction ?? '').trim()
  const next = beats[done]
  const now = direction
    ? `What happens now, as the author directs (write this, and nothing beyond it):\n${direction}`
    : next
      ? `What happens now: the next beat on the scene card, beat ${done + 1}${beats.length > 1 ? ` of ${beats.length}` : ''} (write this one only, and nothing beyond it):\n${next}`
      : o.hasGoal || o.hasOutcome || o.hasNotes
        ? 'What happens now: take the scene a short way on from where it has got to, towards what the scene card describes, and stop.'
        : 'What happens now: take the scene a short way on from where it has got to, and stop.'
  return `Carry the scene on now, from the end of the scene so far.\n${lines.join('\n')}\n\n${now}`
}

/** Add below's line about length: a ceiling, not a target (with Auto, within Auto's ceiling). */
function addBelowLengthLine(o: { targetWords: number | null; autoMax?: number }): string {
  if (o.targetWords != null) {
    return `- Write at most about ${o.targetWords.toLocaleString('en-GB')} words. That is a ceiling, not a target: stop as soon as what is asked has happened.`
  }
  const max = Math.max(AUTO_LENGTH.min, o.autoMax ?? AUTO_LENGTH.max).toLocaleString('en-GB')
  return `- Write only as much as what happens now needs, never more than ${max} words. Stop as soon as it has happened, and don't pad it.`
}

/**
 * The closing reminder of the genre and tone, since models follow what comes last most closely:
 * "Keep the slow-building dread of horror, and the story's tone: bleak and quiet." Null when neither is set.
 */
export function feelLine(style: Pick<StyleGuide, 'genres'>, tone?: string): string | null {
  const [lead, blend] = genresOf(style.genres ?? [])
  const t = (tone ?? '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '')
  const genre = lead
    ? `the ${lead.feel} of ${lead.label.toLocaleLowerCase()}${blend ? `, with the ${blend.feel} of ${blend.label.toLocaleLowerCase()}` : ''}`
    : ''
  const toneText = t ? `the story's tone: ${t.length > 160 ? `${t.slice(0, 159).trimEnd()}…` : t}` : ''
  if (!genre && !toneText) return null
  return `- Keep ${[genre, toneText].filter(Boolean).join(', and ')}.`
}

/**
 * The closing reminder of the author's phrases to avoid, since models follow what comes last most closely (and
 * skim a list given at the start): a short list is given again, a long one pointed to. Null when there are none.
 */
export function avoidLine(style: Pick<StyleGuide, 'avoidPhrases'>): string | null {
  const phrases = style.avoidPhrases.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!phrases.length) return null
  const listed = phrases.map((p) => `“${p}”`).join(', ')
  return listed.length <= 300
    ? `- Never use ${listed}, or any close variation of ${phrases.length === 1 ? 'it' : 'them'}.`
    : "- Never use any of the author's words and phrases to avoid, given above, or any close variation of them."
}

/** What to aim the scene at, from whatever the scene card holds. */
function planLine(o: {
  hasBeats: boolean
  hasGoal?: boolean
  hasOutcome?: boolean
  hasNotes?: boolean
  hasDirection: boolean
}): string | null {
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
