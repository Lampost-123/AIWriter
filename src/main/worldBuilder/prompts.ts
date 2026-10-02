// What the World builder model is told. Each job's system prompt starts with a marker and the job, so the
// fake provider in tests/fake-provider/m4/world.mjs can recognise these requests:
//   overview       lists everything a summary (or one part of a long one) names, by kind
//   character      one character's full profile, as Quick start writes it
//   places, groups, items, lore, events, threads, glossary
//                  profiles of several things of one kind at once
//   relationships  the relationships between the characters (and who belongs to which group)
//   themes         the world's themes and tone, when the world has none yet
//   check          where the summary disagrees with pages already in the world
// Everything is laid out as it stands at the start: what the summary says happens later becomes an event
// or a plot thread, never part of how things start. Pure.

import type { Entry, EntryKind } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { fieldList } from '../builder/prompts'
import { fieldLabel } from '../keeper/facts'
import { estimateTokens } from '../keeper/text'
import { asProfileKind, type PlanItem } from './parse'

/** In every World builder request's system prompt, followed by the job. */
export const WORLD_MARKER = '[AIWRITE-WORLD v1]'

export type WorldJob = 'overview' | 'character' | BatchJob | 'relationships' | 'themes' | 'check'
export type BatchJob = 'places' | 'groups' | 'items' | 'lore' | 'events' | 'threads' | 'glossary'

/** The job that lays out each kind (characters have one call each; the rest come several at a time). */
export const JOB_OF: Record<EntryKind, 'character' | BatchJob> = {
  character: 'character',
  place: 'places',
  group: 'groups',
  item: 'items',
  lore: 'lore',
  event: 'events',
  thread: 'threads',
  glossary: 'glossary'
}

/** Each kind as the model is told it: one, many. */
const NOUNS: Record<EntryKind, [string, string]> = {
  character: ['character', 'characters'],
  place: ['place', 'places'],
  group: ['group', 'groups'],
  item: ['item', 'items'],
  lore: ['piece of lore', 'pieces of lore'],
  event: ['event', 'events'],
  thread: ['plot thread', 'plot threads'],
  glossary: ['glossary word', 'glossary words']
}

const ROLE = 'You help an author lay out the world of a novel from their summary of it.'

const TIME = `- Describe everything as it stands at the start, before the story begins. Leave out what the summary says happens later: that is an event or a plot thread, not part of how things start.`

const OWN_WORDS = (one: string): string =>
  `- The author's own words come first. Copy every phrase from the summary about this ${one}, exactly as written, into the field it belongs to, under "fromNotes". Change nothing in them, not a word and not the spelling, and add nothing: a field under "fromNotes" holds only the author's words.
- Write everything else under "drafted": fill every field "fromNotes" leaves empty, building on the summary and never contradicting it.`

const FIT = `- Fit the world: keep to its rules, its tone and its style guide, and use the places, groups and people in it and in the summary where they fit.
- Write plain prose, specific and concrete, in the style guide's spelling. No headings, bullet points or markdown inside fields.`

// ---------- The first look: what the summary names ----------

export function overviewSystem(): string {
  return `${WORLD_MARKER} overview
${ROLE} Read the summary and list everything in it that the world should remember, by kind. Reply with one JSON object and nothing else.

Rules
- List only what the summary names or clearly describes. Invent nothing.
- Characters are people, and other beings who think and speak. Places are lands, towns, buildings and rooms. Groups are families, guilds, orders, crews and nations. Items are particular objects that matter. Lore is how the world works: its magic, history, beliefs, customs and laws. Events are things that happen at a particular time. Plot threads are the open questions the story will answer. Glossary words are words the world uses that a reader wouldn't know.
- Each thing goes under one kind only, once.
- Use each name exactly as the summary writes it. Something the summary describes without naming it ("a tavern by the docks") gets a short name that describes it ("The tavern by the docks").
- If something is already in the world, under a name listed below, use that exact name.
- Things are listed as they stand at the start, before the story begins. Something the summary says happens later ("in Book 2 she becomes queen") is an event or a plot thread, never part of how a character or place starts.
- A place inside another place says which, in "in".
- Lore the summary states as absolute, always so with no exceptions ("magic always costs blood"), has "rule" true.
- An event's "when" is the date or time the summary gives, in its own words, or "" when it gives none.

Reply with:
{"characters": [{"name": "...", "aliases": ["other names the summary uses"], "about": "who they are, in a few words"}],
 "places": [{"name": "...", "aliases": [], "about": "...", "in": "the place it is inside, or \\"\\""}],
 "groups": [{"name": "...", "aliases": [], "about": "..."}],
 "items": [{"name": "...", "aliases": [], "about": "..."}],
 "lore": [{"name": "...", "about": "...", "rule": false}],
 "events": [{"name": "...", "about": "...", "when": "..."}],
 "threads": [{"name": "...", "about": "the question the reader waits to see answered"}],
 "glossary": [{"name": "the word", "about": "what it means"}]}
Leave a list empty when the summary has nothing of that kind.`
}

/** `part`: [this part, of how many] for a summary read in parts. */
export function overviewUser(existing: string, summary: string, part: [number, number] | null): string {
  const which = part && part[1] > 1 ? ` (part ${part[0]} of ${part[1]}; the other parts are read separately)` : ''
  return `${existing}\n\nThe author's summary${which}:\n"""\n${summary.trim()}\n"""\n\nList everything now, as one JSON object.`
}

/** The world's entries by kind, names and other names only, for the first look to reuse; the longest lists are cut to fit `maxTokens`. */
export function existingText(entries: Pick<Entry, 'kind' | 'name' | 'aliases'>[], maxTokens = 2000): string {
  const byKind = (Object.keys(NOUNS) as EntryKind[])
    .map((kind): [EntryKind, string[]] => [
      kind,
      entries
        .filter((e) => e.kind === kind && e.name.trim())
        .map((e) => (e.aliases.length ? `${e.name.trim()} (also: ${e.aliases.slice(0, 4).join(', ')})` : e.name.trim()))
    ])
    .filter(([, names]) => names.length)
  if (!byKind.length) return 'Already in the world: nothing yet.'
  const render = (most: number): string =>
    byKind
      .map(([kind, names]) => {
        const more = names.length > most ? ` (and ${names.length - most} more)` : ''
        return `- ${KIND_LABELS[kind].many}: ${names.slice(0, most).join('; ')}${more}`
      })
      .join('\n')
  let most = Math.max(...byKind.map(([, names]) => names.length))
  let text = render(most)
  while (most > 5 && estimateTokens(text) > maxTokens) {
    most = Math.floor(most * 0.8)
    text = render(most)
  }
  return `Already in the world (use these names for anything the summary says about them):\n${text}`
}

// ---------- Profiles ----------

/** What the build is laying out, so profiles can link to each other; the longest lists are cut to fit `maxTokens`. */
export function planText(plan: PlanItem[], maxTokens = 1200): string {
  const byKind = (Object.keys(NOUNS) as EntryKind[])
    .map((kind): [EntryKind, string[]] => [kind, plan.filter((p) => p.kind === kind).map((p) => p.name)])
    .filter(([, names]) => names.length)
  if (!byKind.length) return ''
  const render = (most: number): string =>
    byKind.map(([kind, names]) => `- ${KIND_LABELS[kind].many}: ${names.slice(0, most).join('; ')}`).join('\n')
  let most = Math.max(...byKind.map(([, names]) => names.length))
  let text = render(most)
  while (most > 5 && estimateTokens(text) > maxTokens) {
    most = Math.floor(most * 0.8)
    text = render(most)
  }
  return `Being laid out from the same summary:\n${text}`
}

const itemLine = (p: PlanItem): string => {
  const also = p.aliases.length ? ` (also: ${p.aliases.join(', ')})` : ''
  const extra = [p.in ? `inside ${p.in}` : '', p.when ? `when: ${p.when}` : ''].filter(Boolean).join('; ')
  const about = p.about ? `: ${p.about}` : ''
  return `- ${p.name}${also}${extra ? ` [${extra}]` : ''}${about}`
}

export function characterSystem(): string {
  return `${WORLD_MARKER} character
${ROLE} From the summary, write a full, consistent profile of one character that fits the world described below. Reply with one JSON object and nothing else.

Rules
${OWN_WORDS('character')}
${TIME}
- Keep to the name the summary gives them. If it gives none, choose one that suits the world.
${FIT}

Fields (key: what it holds)
${fieldList('character')}

Reply with:
{"fromNotes": {"key": "the author's words", ...}, "drafted": {"key": "...", ...}}
Put "name" first in whichever of the two holds it.`
}

export function characterUser(world: string, plan: string, summary: string, who: PlanItem): string {
  return `${world}${plan ? `\n\n${plan}` : ''}\n\nThe author's summary:\n"""\n${summary.trim()}\n"""\n\nThe character to lay out:\n${itemLine(who)}\n\nWrite the profile now, as one JSON object.`
}

/** What each kind's profiles say beside their fields. */
const EXTRAS: Partial<Record<EntryKind, { rule: string; shape: string }>> = {
  place: {
    rule: '- "in" names the place it is inside, when the summary says so (one of the places listed), else "".',
    shape: '"in": "the place it is inside, or \\"\\"", '
  },
  lore: {
    rule: '- "rule" is true only when the summary states it as absolute, always so with no exceptions ("magic always costs blood"). Then "rules" says exactly how it works.',
    shape: '"rule": false, '
  },
  event: {
    rule: `- "when" holds the date or time the summary gives, in its own words. For something the summary says happens after the story starts, "when" says so ("in Book 2").
- "involved" lists the characters who take part, by name.`,
    shape: '"involved": ["..."], '
  },
  thread: {
    rule: '- A plot thread is open at the start: set up before the story begins and not yet paid off. "promise" is the question the reader waits to see answered.',
    shape: ''
  },
  glossary: {
    rule: '- The name is the word itself, spelled as the summary spells it. "pronunciation" only when the summary gives it or the word is hard to say.',
    shape: ''
  }
}

const listKey = (kind: EntryKind): string => JOB_OF[kind]

export function batchSystem(kind: EntryKind): string {
  const [one, many] = NOUNS[kind]
  const extra = EXTRAS[kind]
  return `${WORLD_MARKER} ${JOB_OF[kind]}
${ROLE} From the summary, write a full, consistent profile of each of the ${many} listed, that fits the world described below. Reply with one JSON object and nothing else.

Rules
${OWN_WORDS(one)}
${TIME}
- Keep to the names given, one profile each, in the order given.${extra ? `\n${extra.rule}` : ''}
${FIT}

Fields (key: what it holds)
${fieldList(asProfileKind(kind))}

Reply with:
{"${listKey(kind)}": [{"name": "the name given", ${extra?.shape ?? ''}"fromNotes": {"key": "the author's words", ...}, "drafted": {"key": "...", ...}}, ...]}`
}

export function batchUser(kind: EntryKind, world: string, plan: string, summary: string, items: PlanItem[]): string {
  const many = NOUNS[kind][1]
  return `${world}${plan ? `\n\n${plan}` : ''}\n\nThe author's summary:\n"""\n${summary.trim()}\n"""\n\nThe ${many} to lay out:\n${items.map(itemLine).join('\n')}\n\nWrite the profiles now, as one JSON object.`
}

/** The shape asked for again when a reply couldn't be used. */
export const SHAPES = {
  overview:
    '{"characters": [{"name": "...", "aliases": [], "about": "..."}], "places": [...], "groups": [...], "items": [...], "lore": [...], "events": [...], "threads": [...], "glossary": [...]}',
  character: '{"fromNotes": {"key": "the author\'s words", ...}, "drafted": {"name": "...", "key": "...", ...}}',
  batch: (kind: EntryKind): string => `{"${listKey(kind)}": [{"name": "...", "fromNotes": {...}, "drafted": {...}}, ...]}`,
  relationships: '{"relationships": [{"from": "...", "to": "...", "type": "...", "feels": "...", "otherFeels": "..."}]}',
  themes: '{"themes": "...", "tone": "..."}',
  check: '{"conflicts": [{"name": "...", "field": "...", "summary": "...", "quote": "..."}]}'
}

// ---------- Relationships ----------

export function relationshipsSystem(): string {
  return `${WORLD_MARKER} relationships
${ROLE} List the relationships between the characters below that the summary states or clearly implies, as they stand at the start, before the story begins, and which group each character belongs to. Reply with one JSON object and nothing else.

Rules
- Only relationships the summary gives. Invent none, and leave out any the summary says only begin later.
- "from" and "to" are names from the lists below, exactly as written there.
- "type" says what "from" is to "to", in a few plain words: "sister", "rival", "owes money to", "apprentice".
- Between two characters, "feels" says how "from" feels about "to", and "otherFeels" how "to" feels about "from", in a few words each, or "" when the summary doesn't say.
- For a character who belongs to a group, "from" is the character, "to" the group, and "type" their place in it: "member", "leader", "member (lieutenant)".
- One relationship for each pair.

Reply with:
${SHAPES.relationships}
or {"relationships": []} when the summary gives none.`
}

export function relationshipsUser(summary: string, characters: string[], groups: string[]): string {
  const groupLine = groups.length ? `\nGroups: ${groups.join('; ')}` : ''
  return `Characters: ${characters.join('; ')}${groupLine}\n\nThe author's summary:\n"""\n${summary.trim()}\n"""\n\nList the relationships now, as one JSON object.`
}

// ---------- Themes and tone ----------

export function themesSystem(want: ('themes' | 'tone')[]): string {
  const shape = `{${want.map((k) => `"${k}": "..."`).join(', ')}}`
  const what =
    want.length === 2
      ? 'its themes (what its stories are about, underneath) and its tone (how they feel to read)'
      : want[0] === 'themes'
        ? 'its themes (what its stories are about, underneath)'
        : 'its tone (how its stories feel to read)'
  return `${WORLD_MARKER} themes
${ROLE} From the summary, describe the world's ${what}. Reply with one JSON object and nothing else.

Rules
- Where the summary says it, copy the author's words exactly.
- Otherwise write a sentence or two that fits the summary, in plain words.

Reply with:
${shape}`
}

export function themesUser(summary: string): string {
  return `The author's summary:\n"""\n${summary.trim()}\n"""\n\nDescribe it now, as one JSON object.`
}

// ---------- Disagreements with pages already in the world ----------

export function checkSystem(): string {
  return `${WORLD_MARKER} check
You help an author keep the world of a novel consistent. Below are pages already in the world, then the author's new summary. Find each place where the summary says something different from what a page says. Reply with one JSON object and nothing else.

Rules
- Only real disagreements, where the summary and the page can't both be true. Something a page leaves out, or a detail the summary adds, isn't one.
- "name" is the page's name and "field" the key of its field, as given in brackets. "summary" is what the summary says, in a few of its own words, and "quote" the summary's sentence, copied exactly.

Reply with:
${SHAPES.check}
or {"conflicts": []} when there are none.`
}

/** A page as the check is told it: each field with words in it, by key and label. */
export function pageText(e: Pick<Entry, 'kind' | 'name'>, values: Record<string, string>): string {
  const lines = Object.entries(values)
    .filter(([k, v]) => k !== 'name' && v.trim())
    .map(([k, v]) => `- [${k}] ${fieldLabel(e, k)}: ${v.replace(/\s+/g, ' ').trim().slice(0, 400)}`)
  return `${e.name} (${KIND_LABELS[e.kind].one.toLowerCase()})\n${lines.join('\n')}`
}

export function checkUser(pages: string[], summary: string): string {
  return `Pages already in the world:\n\n${pages.join('\n\n')}\n\nThe author's summary:\n"""\n${summary.trim()}\n"""\n\nList the disagreements now, as one JSON object.`
}
