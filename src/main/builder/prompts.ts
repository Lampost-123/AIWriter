// What the builder's model is told: the world it must fit (the style guide with Adam's preferences,
// the rules and lore, groups, and who and what is already there), and each job's instructions. The
// first line of every system prompt carries a marker and the job, so the fake provider in
// tests/fake-provider can recognise these requests. Pure.

import type { FieldDef } from '@shared/fields'
import type { ChatMessage, ID, StyleGuide } from '@shared/types'
import type { BuilderKind, BuilderValues, InterviewTurn, QuickAnswer } from '@shared/contracts/builder'
import { estimateTokens } from '../keeper/text'
import { profileFields } from './profile'

/** In every builder request's system prompt, followed by the job. */
export const BUILDER_MARKER = '[AIWRITE-BUILDER v1]'

export interface BriefEntry {
  id: ID
  name: string
  aliases: string[]
  summary: string
  /** Lore that must never be broken, with how it works. */
  hardRule?: boolean
  rule?: string
  updatedAt: string
}

/** The world a new entry must fit. */
export interface WorldBrief {
  world: { themes: string; tone: string }
  /** The story Adam is working in, if any. */
  story: { title: string; premise: string } | null
  /** The style guide in effect: Adam's preferences, the world's guide and the story's, merged. */
  style: StyleGuide
  /** Lore, rules never to break first. */
  lore: BriefEntry[]
  groups: BriefEntry[]
  characters: BriefEntry[]
  /** Entries of the kind being built, when it is a place or an item (so it doesn't copy one). */
  same: BriefEntry[]
}

const NOUN: Record<BuilderKind, string> = { character: 'character', place: 'place', group: 'group', item: 'item' }
const SAME_TITLE: Record<BuilderKind, string> = {
  character: 'Characters already in the world',
  place: 'Places already in the world',
  group: 'Groups already in the world',
  item: 'Items already in the world'
}

const SPELLING = {
  UK: 'UK English (colour, realise, grey, travelled)',
  US: 'US English (color, realize, gray, traveled)'
} as const

const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

const entryLine = (e: BriefEntry): string => {
  const also = e.aliases.length ? ` (also: ${clip(e.aliases.join(', '), 80)})` : ''
  const summary = e.summary.trim() ? `: ${clip(e.summary, 200)}` : ''
  const rule = e.rule?.trim() ? ` How it works: ${clip(e.rule, 300)}` : ''
  return `- ${clip(e.name, 80) || 'Unnamed'}${also}${summary}${rule}`
}

/** The world and its style guide, always sent whole. */
function aboutText(b: WorldBrief): string {
  const parts: string[] = []
  const about: string[] = []
  if (b.world.themes.trim()) about.push(`- Themes: ${clip(b.world.themes, 400)}`)
  if (b.world.tone.trim()) about.push(`- Tone: ${clip(b.world.tone, 400)}`)
  if (b.story?.title.trim()) {
    const premise = b.story.premise.trim() ? ` ${clip(b.story.premise, 600)}` : ''
    about.push(`- The story being written: ${clip(b.story.title, 120)}.${premise}`)
  }
  if (about.length) parts.push(`About the world\n${about.join('\n')}`)
  const style = styleText(b.style)
  if (style) parts.push(style)
  return parts.join('\n\n')
}

/** The style guide in effect, as the model is told it ('' when it says nothing). */
export function styleText(s: StyleGuide): string {
  const style: string[] = []
  if (s.spelling) style.push(`- Spelling: ${SPELLING[s.spelling]}`)
  if (s.proseStyle.trim()) style.push(`- Prose style: ${clip(s.proseStyle, 800)}`)
  if (s.contentLimits.trim()) style.push(`- Content limits (always respect these): ${clip(s.contentLimits, 800)}`)
  if (s.notes.trim()) style.push(`- Other notes from the author: ${clip(s.notes, 800)}`)
  if (s.avoidPhrases.length) style.push(`- Words and phrases never to use: ${clip(s.avoidPhrases.join('; '), 600)}`)
  return style.length ? `Style guide\n${style.join('\n')}` : ''
}

/**
 * The world as the model is told it, fitted to `budget` tokens: the style guide whole, then lists of
 * what is already there. When they don't all fit, lines go from the end of the least important list
 * first: other lore, then the characters, the groups, entries of the same kind, and the rules last.
 */
export function worldText(b: WorldBrief, kind: BuilderKind, budget: number): { text: string; entryIds: ID[] } {
  const rules = b.lore.filter((e) => e.hardRule)
  const lore = b.lore.filter((e) => !e.hardRule)
  // Most important first; the same kind is what a new entry must not copy.
  const sections: { title: string; items: BriefEntry[] }[] = [
    { title: 'Rules of the world (never break these)', items: rules },
    { title: SAME_TITLE[kind], items: kind === 'character' ? b.characters : kind === 'group' ? b.groups : b.same },
    { title: 'Groups', items: kind === 'group' ? [] : b.groups },
    { title: 'Characters', items: kind === 'character' ? [] : b.characters },
    { title: 'Lore', items: lore }
  ]
  const about = aboutText(b)
  const lines = sections.map((s) => s.items.map(entryLine))
  let used = estimateTokens(about) + sections.length * 8 + lines.flat().reduce((n, l) => n + estimateTokens(l) + 1, 0)
  for (let s = sections.length - 1; s >= 0 && used > budget; ) {
    const l = lines[s].pop()
    if (l === undefined) {
      s--
      continue
    }
    used -= estimateTokens(l) + 1
  }
  const parts = about ? [about] : []
  const entryIds: ID[] = []
  sections.forEach((s, i) => {
    if (!lines[i].length) return
    parts.push(`${s.title}\n${lines[i].join('\n')}`)
    entryIds.push(...s.items.slice(0, lines[i].length).map((e) => e.id))
  })
  return { text: parts.join('\n\n') || 'Nothing has been written about the world yet.', entryIds }
}

const SHORT = 'one short phrase, a few words at most'

/** What a field holds, as the model is told it. One-line fields say they are short, so a reply fits on their one line. */
function hintOf(f: FieldDef): string | undefined {
  if (f.key === 'sampleLines') return '3 to 5 lines in their own voice, one per line'
  if (f.type !== 'line' || f.key === 'name' || f.key === 'aliases' || f.key === 'summary') return f.placeholder
  return f.placeholder ? `${f.placeholder}; ${SHORT}` : SHORT
}

/** The fields, with what each holds, for the model's reply. */
export function fieldList(kind: BuilderKind, only?: string[]): string {
  return profileFields(kind)
    .filter((f) => !only || only.includes(f.key))
    .map((f) => {
      const hint = hintOf(f)
      return `- ${f.key}: ${f.label}${hint ? ` (${hint})` : ''}`
    })
    .join('\n')
}

/** A profile as text, by label, for the model to build on. */
export function profileText(kind: BuilderKind, values: BuilderValues): string {
  const lines = profileFields(kind)
    .filter((f) => (values[f.key] ?? '').trim())
    .map((f) => `${f.label}: ${values[f.key].trim().includes('\n') ? `\n${values[f.key].trim()}` : values[f.key].trim()}`)
  return lines.length ? lines.join('\n') : '(Nothing yet.)'
}

const FIT = (noun: string, kind: BuilderKind): string =>
  `- Fit the world: keep to its rules, its tone and its style guide, and use its places, groups and people where they fit.
- Make the ${noun} ${kind === 'character' ? 'their own person' : 'its own'}: don't copy anything listed under "${SAME_TITLE[kind]}", and don't use a name that is the same as, or very close to, one already used.
- Write plain prose, specific and concrete, in the style guide's spelling. No headings, bullet points or markdown inside fields.`

// ---------- Quick start ----------

export function quickStartSystem(kind: BuilderKind): string {
  const noun = NOUN[kind]
  return `${BUILDER_MARKER} quick-start
You help an author build the ${noun}s of a novel's world. From the author's notes, write a full, consistent profile of one ${noun} that fits the world described below. Reply with one JSON object and nothing else.

Rules
- The author's own words come first. Copy every phrase from the notes about this ${noun}, exactly as written, into the field it belongs to, under "fromNotes". Change nothing in them, not a word and not the spelling, and add nothing: a field under "fromNotes" holds only the author's words.
- Write everything else under "drafted": fill every field "fromNotes" leaves empty, building on the notes and never contradicting them.
- If the notes don't give a name, choose one that suits the world.
${FIT(noun, kind)}

Fields (key: what it holds)
${fieldList(kind)}

Reply with:
{"fromNotes": {"key": "the author's words", ...}, "drafted": {"key": "...", ...}}
Put "name" first in whichever of the two holds it.`
}

/**
 * `sofar`: finishing a profile an earlier reply stopped part way through, the fields it saved (as
 * profileText gives them), which the model leaves out. `answers`: Adam's answers to the follow-up questions, which
 * count as his notes too (a question he left to the AI, it decides).
 */
export function quickStartUser(
  kind: BuilderKind,
  notes: string,
  world: string,
  passage: boolean,
  sofar = '',
  answers: QuickAnswer[] = []
): string {
  const noun = NOUN[kind]
  const intro = passage
    ? `The author selected this passage from the story. It is about a ${noun} the world doesn't have yet: build the ${noun} from it. The passage counts as the author's notes.`
    : `The author's notes on the ${noun}:`
  const saved = sofar.trim()
    ? `\n\nAn earlier reply stopped part way. These fields are saved already: leave them out, write only the others, and fit them to these:\n${sofar.trim()}`
    : ''
  const asked = answersText(answers)
  const followUp = asked
    ? `\n\nThe author's answers to a few follow-up questions. They count as the author's notes too: copy their words under "fromNotes" where they say something about the ${noun}. Where the author left a question to you, decide it yourself and write it under "drafted".\n"""\n${asked}\n"""`
    : ''
  return `${world}\n\n${intro}\n"""\n${notes.trim()}\n"""${followUp}${saved}\n\nWrite the profile now, as one JSON object.`
}

/** Adam's answers to the follow-up questions, a question and its answer to a pair ('' when there are none). */
export function answersText(answers: QuickAnswer[]): string {
  return answers
    .filter((a) => a && typeof a.question === 'string' && a.question.trim())
    .map((a) => {
      const said = typeof a.answer === 'string' ? a.answer.trim().replace(/\s*\n\s*/g, ' ') : ''
      return `Q: ${a.question.trim().replace(/\s+/g, ' ')}\nA: ${said || '(left to you: decide it)'}`
    })
    .join('\n')
}

// ---------- Follow-up questions ----------

/** How many follow-up questions are asked, at most. */
export const MAX_QUESTIONS = 5

export function questionsSystem(kind: BuilderKind): string {
  const noun = NOUN[kind]
  return `${BUILDER_MARKER} questions
You help an author build the ${noun}s of a novel's world. The author has jotted a few notes about one ${noun}. Before its profile is written, ask a short round of follow-up questions: the ones whose answers would help most, about what the notes leave open that matters to the story. Reply with one JSON object and nothing else.

Rules
- Ask 3 to ${MAX_QUESTIONS} questions, the most useful first. Each is one short, plain question the author can answer in a line.
- Never ask about something the notes already say. One thing per question.
- Ask the author, not the ${noun} ("What does she want most?", not "What do you want?").

Reply with {"questions": ["first question?", "second question?", ...]}`
}

export function questionsUser(kind: BuilderKind, notes: string, world: string, passage: boolean): string {
  const noun = NOUN[kind]
  const intro = passage ? `The author selected this passage from the story, about a ${noun} the world doesn't have yet:` : `The author's notes on the ${noun}:`
  return `${world}\n\n${intro}\n"""\n${notes.trim()}\n"""\n\nAsk your questions now, as one JSON object.`
}

// ---------- Flesh out ----------

export function fleshOutSystem(kind: BuilderKind): string {
  const noun = NOUN[kind]
  return `${BUILDER_MARKER} flesh-out
You help an author build the ${noun}s of a novel's world. You are given a ${noun}'s profile as it stands and some of its fields that are still empty. Suggest something for each empty field, building on the profile, and reply with one JSON object and nothing else.

Rules
- Build on what the profile says and never contradict it. The author wrote much of it: it is right.
- Make each suggestion something the author could keep as it is: specific, concrete and in keeping with the rest.
${FIT(noun, kind)}

Reply with {"key": "suggestion", ...}, one for each empty field you are asked about and no others.`
}

export function fleshOutUser(kind: BuilderKind, values: BuilderValues, targets: string[], world: string): string {
  return `${world}\n\nThe ${NOUN[kind]}'s profile so far:\n${profileText(kind, values)}\n\nEmpty fields to fill in (key: what it holds):\n${fieldList(kind, targets)}\n\nReply now, as one JSON object.`
}

// ---------- Give me options ----------

export function optionsSystem(kind: BuilderKind): string {
  const noun = NOUN[kind]
  return `${BUILDER_MARKER} options
You help an author build the ${noun}s of a novel's world. You are given a ${noun}'s profile and one of its fields. Offer three possibilities for that field, and reply with one JSON object and nothing else.

Rules
- Each option is complete on its own, so the author could keep it as it is, and each is clearly different from the other two (and from what the field says now, if it says anything).
- Every option fits the rest of the profile and never contradicts it.
${FIT(noun, kind)}

Reply with {"options": ["first", "second", "third"]}: exactly three.`
}

export function optionsUser(kind: BuilderKind, values: BuilderValues, key: string, world: string): string {
  const def = profileFields(kind).find((f) => f.key === key)
  const now = (values[key] ?? '').trim()
  const hint = def ? hintOf(def) : undefined
  const field = `${def?.label ?? key}${hint ? ` (${hint})` : ''}`
  const others: BuilderValues = { ...values, [key]: '' }
  return `${world}\n\nThe ${NOUN[kind]}'s profile:\n${profileText(kind, others)}\n\nThe field: ${field}\n${now ? `It says now: ${now}` : 'It is empty.'}\n\nGive three options now, as one JSON object.`
}

// ---------- Interview ----------

export function interviewSystem(values: BuilderValues, world: string): string {
  const name = (values.name ?? '').trim() || 'this character'
  return `${BUILDER_MARKER} interview
You are ${name}, a character in a novel. The author is interviewing you to find your voice. Answer each question in character, as ${name} would say it out loud: in the first person, in your own words, rhythm and manner of speech, in a few sentences at most.

Rules
- Reply with only what ${name} says. No narration, no stage directions, no quotation marks around the reply, no name in front of it.
- Stay true to your profile and to the world below. You know only what ${name} would know.
- Never mention being an AI, a character or a story. If asked something ${name} wouldn't answer, answer the way ${name} would dodge it.

${world}

Your profile:
${profileText('character', values)}`
}

/** The interview so far, then Adam's question. */
export function interviewMessages(system: string, turns: InterviewTurn[], question: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: system }]
  for (const t of turns.slice(-20)) {
    if (t.text.trim()) messages.push({ role: t.from === 'adam' ? 'user' : 'assistant', content: t.text.trim() })
  }
  messages.push({ role: 'user', content: question.trim() })
  return messages
}

// ---------- Filling in what is missing ----------

/**
 * Fill in the gaps: a profile that was made with little in it (a character the memory found in a scene, a
 * place the World builder made from one line) gets its empty fields filled from what the story and the
 * world say about it. Nothing on the profile is changed; the reply holds only the empty fields.
 */
export function fillGapsSystem(kind: BuilderKind): string {
  const noun = NOUN[kind]
  return `${BUILDER_MARKER} fill-gaps
You help an author keep the ${noun}s of a novel's world complete. A ${noun} is in the story, but its profile has empty fields. From what the story and the world say about it, fill in each empty field, and reply with one JSON object and nothing else.

Rules
- Build on the profile and on what the story says about the ${noun}, and never contradict them: they are right.
- Where the story says nothing about a field, choose what fits the ${noun} and the story best, so the author could keep it as it is.
- Fit the world: keep to its rules, its tone and its style guide.
- Write plain prose, specific and concrete, in the style guide's spelling. No headings, bullet points or markdown inside fields.

Reply with {"key": "what goes in it", ...}, one for each empty field you are asked about and no others.`
}

/** `said`: what the story (or the author's summary) says about it, word for word; '' for nothing. */
export function fillGapsUser(kind: BuilderKind, values: BuilderValues, targets: string[], world: string, said: string): string {
  const story = said.trim() ? `\n\nWhat the story says about the ${NOUN[kind]}:\n"""\n${said.trim()}\n"""` : ''
  return `${world}${story}\n\nThe ${NOUN[kind]}'s profile so far:\n${profileText(kind, values)}\n\nEmpty fields to fill in (key: what it holds):\n${fieldList(kind, targets)}\n\nReply now, as one JSON object.`
}

/**
 * The memory keeper's follow-on (Adam, 2026-10-07): someone or something just found in the story gets only what the
 * story's words say about it, up to where it was found, each with the words that show it (builder/fill.ts keeps a
 * value only when its words are in the story and it rests on them). No world, no plan of the story: nothing to guess
 * from, and nothing about what comes later. A field the words don't fill stays empty.
 */
export function fillFoundSystem(kind: BuilderKind): string {
  const noun = NOUN[kind]
  return `${BUILDER_MARKER} fill-found
You help an author keep the memory of a novel's world. A ${noun} has just been found in the story, and its page has empty fields. Fill in only what the story's words below say about the ${noun}, and reply with one JSON object and nothing else.

Rules
- Use only the story's words below. Nothing from anywhere else, no guesses, no reading between the lines, and nothing about what might happen later in the story.
- Every field you fill needs "quote": words copied exactly, character for character, from the story's words below, that show it.
- Where the words say nothing about a field, leave that field out. An empty field is right: never write "none", "unknown" or a guess.
- Never contradict the page so far.
- Write plain words in the style guide's spelling, as short as the field allows. No headings, bullet points or markdown.

Reply with {"key": {"value": "what goes in it", "quote": "the story's words that show it"}, ...}: only the fields the story's words fill, from those you are asked about.`
}

/** `said`: the story's words about it, word for word (never ''); `style`: the style guide (styleText), or ''. */
export function fillFoundUser(kind: BuilderKind, values: BuilderValues, targets: string[], style: string, said: string): string {
  const noun = NOUN[kind]
  const guide = style.trim() ? `${style.trim()}\n\n` : ''
  return `${guide}What the story says about the ${noun}, word for word:\n"""\n${said.trim()}\n"""\n\nThe ${noun}'s profile so far:\n${profileText(kind, values)}\n\nEmpty fields (key: what it holds):\n${fieldList(kind, targets)}\n\nReply now, as one JSON object.`
}

// ---------- Asking again ----------

/** Asked once more when a reply couldn't be used, saying why. */
export function retryMessage(why: string, shape: string): string {
  return `That reply couldn't be used, because ${why}. Reply again with only the JSON object, in this shape: ${shape}`
}
