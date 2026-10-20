// The prompts of the interviews by topic (contracts/worldInterviews.ts): one to ask the next few questions of a topic,
// one to turn a topic's answers into codex pages, and one to turn the connections interview into links. Each opens
// with its marker line ("[AIWRITE-WORLD v1] topic-questions characters"), as the World builder's own requests do, so
// "What the AI saw" and the fake provider know them. Pure: no database, no Electron.

import type { EntryKind } from '@shared/types'
import type { InterviewTopic, TopicAsked } from '@shared/contracts/worldInterviews'
import { TOPIC_FIELDS } from '@shared/contracts/worldInterviews'
import { FIELD_GROUPS } from '@shared/fields'
import { WORLD_MARKER } from '../worldBuilder/prompts'

/** Questions a round: a few short ones at a time. */
export const ROUND_MOST = 3
/** After this many questions (answered or skipped) a topic has enough: its pages are suggested without asking more. */
export const MOST_QUESTIONS = 12
/** The most earlier questions told with each request (the latest). */
export const ASKED_MOST = 24
/** The most of each earlier answer told with a request for questions (the whole answer goes with the suggestions). */
export const ANSWER_MOST = 400

/** What each topic is about, in the words the prompts use. */
export const TOPIC_WORDS: Record<InterviewTopic, { name: string; covers: string[] }> = {
  characters: {
    name: 'the characters',
    covers: [
      'Who the main people are, and the part each plays in the story.',
      'What each one wants, and what stands in their way.',
      'What each one fears, hides or regrets.',
      'How each one talks: their words, their manner, what they would never say.',
      'How each one looks and dresses, briefly, and where they come from.'
    ]
  },
  places: {
    name: 'the places',
    covers: [
      'Where the story happens: the main places, and the smaller ones inside them.',
      'How each place looks, sounds and smells, and how it feels to be there.',
      'Who lives, rules or works there.',
      'How the places fit together: what lies inside what (a room in a house, a house in a town, a town in a land), and how far apart they are.',
      'What happened there before the story.'
    ]
  },
  lore: {
    name: 'the lore and history',
    covers: [
      "The world's rules: its magic, technology or powers, what they can do, what they cost and what they can never do.",
      'Its past: the wars, disasters, foundings and other events that still matter.',
      'What people believe, worship, fear or forbid; their customs and laws.',
      'Which of these are always true, with no exceptions.'
    ]
  },
  connections: {
    name: 'how it all connects',
    covers: [
      'Who lives where, and who works where.',
      'Who knows which lore, secret or piece of history, and who does not.',
      'Which past events shaped which characters and places.',
      'How the characters stand with each other: family, friends, rivals, debts, love, fear.',
      'Places not yet inside any other that belong inside one.'
    ]
  }
}

/** The fields a suggested page of each kind may fill (contracts/worldInterviews.ts). */
export { TOPIC_FIELDS }

/** Every field key a kind has (for a detail the connections add). */
export const fieldKeysOf = (kind: EntryKind): string[] => (FIELD_GROUPS[kind] ?? []).flatMap((g) => g.fields.map((f) => f.key))

/** A field's label, for the prompts and the screen ("What they want"). */
export function fieldLabel(kind: EntryKind, key: string): string {
  for (const g of FIELD_GROUPS[kind] ?? []) for (const f of g.fields) if (f.key === key) return f.label
  return key
}

const oneLine = (s: unknown): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()

/** What the story or world is, for the openings: "the author's story" or "the author's world". */
const whose = (story: boolean): string => (story ? 'story' : 'world')

export function questionsSystem(topic: InterviewTopic, story: boolean): string {
  const t = TOPIC_WORDS[topic]
  return `${WORLD_MARKER} topic-questions ${topic}
You help an author build ${t.name} of their ${whose(story)}, by interviewing them a few short questions at a time. Their answers become pages in their codex${topic === 'connections' ? ', and links between the pages it has' : ''}.

What to find out, most important first:
${t.covers.map((c) => `- ${c}`).join('\n')}

Rules
- Read what is already known: the author's idea, what the world already has, and this interview so far. Never ask about what they already answer.
- Ask about the most important gaps first, at most ${ROUND_MOST} questions this time. Fewer is fine.
- Each question asks one thing, in plain, friendly words, in one sentence of at most 25 words. No lists, no options to choose from.
- Use the names already known, so the author knows who or what you mean.
- Never ask again about anything already asked in this interview, answered or skipped, even in other words. A skipped question is one the author doesn't want to talk about now.
- Ask only about ${t.name}. The other parts of the world have interviews of their own.
- When you know enough to suggest the pages well, reply {"done": true} instead.

Reply with one JSON object and nothing else:
{"questions": ["...", "..."]}`
}

/** What was asked before in this interview, and what the author said: the answers cut short for a question request. */
export function askedText(asked: TopicAsked[], answerMost = ANSWER_MOST): string {
  const list = asked.filter((a) => oneLine(a.question)).slice(-ASKED_MOST)
  if (!list.length) return 'Nothing yet: this is the first round.'
  return list
    .map((a) => {
      const words = oneLine(a.answer)
      if (a.skipped || !words) return `- ${oneLine(a.question)}\n  (skipped)`
      const cut = words.length > answerMost ? `${words.slice(0, answerMost).replace(/\s+\S*$/, '')}…` : words
      return `- ${oneLine(a.question)}\n  Answer: ${cut}`
    })
    .join('\n')
}

export function suggestSystem(topic: Exclude<InterviewTopic, 'connections'>, kind: EntryKind, story: boolean): string {
  const fields = (TOPIC_FIELDS[kind] ?? []).map((k) => `"${k}" (${fieldLabel(kind, k)})`).join(', ')
  const t = TOPIC_WORDS[topic]
  const extra =
    kind === 'place'
      ? '\n- "in": the place it lies inside, by name (a room inside its house, a house inside its town), or "" for none. Suggest the bigger place too when the answers name it.'
      : kind === 'lore'
        ? '\n- "rule": true only for something always so, with no exceptions (a law of magic, not a custom people sometimes break).'
        : ''
  return `${WORLD_MARKER} topic-suggest ${topic}
You turn an author's interview about ${t.name} of their ${whose(story)} into pages for their codex: one page for each ${kind === 'lore' ? 'piece of lore, rule or past event' : kind} the answers name or clearly need.

Rules
- The author's answers win. Use their own words wherever they gave them; invent only to fill small gaps, in keeping with their idea.
- A page the world already has (the same name): suggest it again only with what it is still missing, and only in parts that are empty now.
- Nothing from the other interviews: only ${t.name}.
- "summary": one line saying who or what it is.
- "fields": only these, and only those you have something for: ${fields}.${extra}
- At most 12 pages, the most important first.

Reply with one JSON object and nothing else:
{"entries": [{"name": "...", "aliases": [], "summary": "...", "fields": {}${kind === 'place' ? ', "in": ""' : kind === 'lore' ? ', "rule": false' : ''}}]}`
}

export function connectSystem(story: boolean): string {
  return `${WORLD_MARKER} topic-suggest connections
You turn an author's interview about how their ${whose(story)} connects into links between the pages their codex already has, and things to add to those pages.

Kinds of link
- A relationship: {"from": "...", "to": "...", "type": "...", "feels": "...", "otherFeels": "...", "why": "..."}. "type" in a few words, as said of "from" ("older sister of", "lives at", "works at", "knows about", "was shaped by", "rules"). Between two characters, "feels" is how "from" feels about "to" and "otherFeels" how "to" feels back ("" when the answers don't say).
- A place inside another: {"from": "...", "inside": "...", "why": "..."}, for a place that lies inside none yet.
- Something to add to one page: {"entry": "...", "field": "...", "text": "...", "why": "..."}, only for a part of the page that is empty now, using its field key as listed.

Rules
- Use only the names of pages listed below, exactly as written. Never invent a page.
- The author's answers win; use their words. Suggest only what the answers say or clearly imply.
- Never suggest a link the pages already have.
- "why": one short line saying what in the answers it comes from.
- At most 16 links, the most important first.

Reply with one JSON object and nothing else:
{"links": [ ... ]}`
}

/** Sent back once when every question in a reply was asked before. */
export const askedAlready =
  '[AI Write] Those repeat questions already asked in this interview. Ask about something not yet asked, as one JSON object, or reply {"done": true}.'

/** The last part of a question request. */
export const askNow = (topic: InterviewTopic): string =>
  `Ask the next questions about ${TOPIC_WORDS[topic].name} now, as one JSON object.`

/** The last part of a suggestion request. */
export const suggestNow = (topic: InterviewTopic): string =>
  topic === 'connections' ? 'Suggest the links now, as one JSON object.' : `Suggest the pages for ${TOPIC_WORDS[topic].name} now, as one JSON object.`
