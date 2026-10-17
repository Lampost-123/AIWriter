// What the Story builder asks the AI (contracts/storyBuilder.ts). Every system prompt starts with
// "[AIWRITE-STORY v1] <job>", so the fake provider in tests (tests/fake-provider/story.mjs) knows each request:
//   codex         everything the story needs, as one JSON object of lists (the World builder's first-look shape, so
//                 its reader reads it), planned from the author's idea, inventing what the idea leaves open
//   codex chat    an answer, then "=== Revised list ===" and the whole list again, when anything changes
//   codex redo    one item of the list again, as one JSON object
//   outline       a premise (for a story with none) and the outline helper's own form
//   plan chat     an answer, then "=== Revised plan ===" and the whole plan again in the outline form
//   plan redo     one act, chapter or scene card again, in the outline form
//   recipe chat   an answer, then "=== Changed parts ===" and the changed parts under the recipe's headings
//   recipe redo   one part of a recipe again, as plain text
// What wins when they differ: the author's idea (and their own entries), then the recipe, then the AI's own ideas.
// No Electron imports.

import type { RecipePartId } from '@shared/contracts/recipes'
import { CHAPTER_CARD_FORM, CHAPTER_CARD_RULES, SCENE_FORM, THREAD_RULES } from '../outline/prompts'
import { PART_HEADINGS } from '../recipes/prompts'

export const MARKER = '[AIWRITE-STORY v1]'

/** The line between a talk-it-over answer and the plan it revised. */
export const PLAN_LINE = '=== Revised plan ==='
/** The line between a talk-it-over answer and the codex list it revised. */
export const LIST_LINE = '=== Revised list ==='
/** The line between a talk-it-over answer and the recipe parts it changed. */
export const PARTS_LINE = '=== Changed parts ==='

const ORDER = `What wins when they differ: the author's idea comes first, with every name, fact and moment in it kept exactly; then the recipe, when there is one; then your own ideas, which fill in everything else and never contradict either.`

// ---------- The codex ----------

const LIST_SHAPE = `{"characters": [{"name": "...", "aliases": [], "about": "who they are and what they want, in a sentence or two", "role": "the recipe's cast role they play, or \\"\\""}],
 "places": [{"name": "...", "aliases": [], "about": "...", "in": "the place it is inside, or \\"\\""}],
 "groups": [{"name": "...", "aliases": [], "about": "..."}],
 "items": [{"name": "...", "aliases": [], "about": "..."}],
 "lore": [{"name": "...", "about": "...", "rule": false}],
 "events": [{"name": "...", "about": "...", "when": "..."}],
 "threads": [{"name": "...", "about": "the question the reader waits to see answered"}],
 "glossary": [{"name": "the word", "about": "what it means"}]}`

const CODEX_RULES = `- ${ORDER}
- Plan a whole cast and world, not only what the idea names: the lead, the people who help and hinder them, the antagonist, family, rivals and the minor characters who matter, each with a name of their own; the places scenes will happen in; the groups, objects that matter, how the world works, what happened before the story and what will happen in it, and the open questions the story will answer.
- The author's own characters, places and other things are listed first, with exactly the names they gave.
- If something is already in the world, under a name listed below, use that exact name.
- With a recipe, every cast role is played by a character: one of the author's own where they fit it, else a new one. Put the role on that character's "role".
- Names: specific and fitting the setting and genre, never the obvious first choice, and no two alike.
- Each thing goes under one kind only, once. Characters are people and other beings who think and speak; places are lands, towns, buildings and rooms; groups are families, guilds, crews and nations; items are particular objects that matter; lore is how the world works (its magic, history, beliefs, customs and laws); events happen at a particular time; plot threads are the open questions the story will answer; glossary words are words the world uses that a reader wouldn't know.
- An event's "when": during the story, its day, counting the day the story opens as Day 1 ("Day 1", "Day 4, dusk"); before the story begins, the date in the world's own words ("in the year 312", "twenty years ago").
- Lore that is always so, with no exceptions, has "rule" true.
- A place inside another place says which, in "in".
- Keep to the story's style and content levels.`

export function codexSystem(): string {
  return `${MARKER} codex
You help a novelist plan everything their new story needs before it is outlined: its characters, places, groups, items, lore, events, plot threads and glossary words. You plan from their idea, inventing what it leaves open; you never write the story itself. Reply with one JSON object and nothing else.

Rules
${CODEX_RULES}
- About 6 to 20 characters, 4 to 12 places, 3 to 8 plot threads and 3 to 10 events, more for a long story and fewer for a short one, unless the idea asks for something else.

Reply with:
${LIST_SHAPE}
Leave a list empty when the story needs nothing of that kind.`
}

export const codexAsk = (): string => 'Plan everything the story needs now, as one JSON object.'

export function codexChatSystem(): string {
  return `${MARKER} codex chat
You help a novelist with the list of characters, places and everything else their new story needs, before any of it is made. They tell you what they want changed, or ask about it. Answer in a few plain sentences. When they ask for a change (or agree to one you suggested), make it: after your answer, put a line with exactly "${LIST_LINE}" and then the whole list, changed, as one JSON object in this shape:
${LIST_SHAPE}
Items marked "off" in the list are ones the author has unticked: keep them out of the revised list unless they ask for them back. Items marked "mine" are the author's own: never rename or change them unless they ask.
When they only ask a question, answer it and give no list.

Rules
${CODEX_RULES}
- Change only what they ask for, and what has to change with it (a renamed character's name everywhere it appears). Keep everything else as it is, word for word.`
}

export function codexRedoSystem(): string {
  return `${MARKER} codex redo
You help a novelist with the list of characters, places and everything else their new story needs. Write one item of the list again, as they ask (or as a fresh take on it when they don't say), fitting everything else on the list. Reply with one JSON object and nothing else:
{"kind": "character | place | group | item | lore | event | thread | glossary", "name": "...", "aliases": [], "about": "...", "in": "", "rule": false, "when": "", "role": ""}

Rules
- ${ORDER}
- Keep its kind. Keep its name unless they ask for a new one or the note says it should change; a new name must not match another on the list.
- "in" only for a place, "rule" only for lore, "when" only for an event, "role" only for a character.`
}

// ---------- The outline ----------

const CHAPTER_FORM = `## Chapter: <the chapter's title>
Goal: <one sentence: what this chapter achieves>
${CHAPTER_CARD_FORM}`

/** The outline form: acts (or not), chapters with their cards, and scene cards. */
export function outlineForm(withActs: boolean): string {
  return withActs
    ? `# Act: <the act's title>
Purpose: <one sentence: what this act does for the story>

${CHAPTER_FORM}

${SCENE_FORM}`
    : `${CHAPTER_FORM}

${SCENE_FORM}`
}

const OUTLINE_RULES = (withActs: boolean): string => `${withActs ? '- Every chapter belongs to the act above it, and every scene to the chapter above it.' : '- Every scene belongs to the chapter above it. No acts.'}
- Each scene has 3 to 6 beats, in order, each a short line.
- Each scene has a When: "Day" and the day's number, counting the day the story opens as Day 1, then a comma and the time of day ("Day 1, morning", "Day 3, dusk"). Days carry on from the story's scenes before and never go back.
${CHAPTER_CARD_RULES}
- Titles are a few words, with no numbers.
- Continue from what the story already has. Never repeat or retell it.
${THREAD_RULES}`

export function storyOutlineSystem(o: { withActs: boolean; withPremise: boolean; recipe: boolean }): string {
  return `${MARKER} outline
You help a novelist plan their new story: ${o.withActs ? 'acts, chapters and scene cards' : 'chapters and scene cards'}${o.withPremise ? ', after a premise' : ''}. You plan from their idea, the story's style${o.recipe ? ', the recipe' : ''} and the characters, places, events and plot threads already made for it; you never write the story itself.

Answer in exactly this form and nothing else: no introduction, no notes at the end, no bold or other formatting.
${o.withPremise ? '\nPremise: <two or three sentences: what the story is about>\n' : ''}
${outlineForm(o.withActs)}

Rules
- ${ORDER}
- Use the characters, places, groups and items given, by their exact names: they were made for this story. Bring in someone new only when the story truly needs it.
- Place each event given at the scene where it happens, on the day it gives. Give each plot thread its "Sets up" scene and the scene that pays it off (or leave it open for later when the story needs it).
- Everything that must happen happens; nothing that must never happen does.${o.recipe ? "\n- Follow the recipe's shape, beats and pacing: put its turning points at about the same share of the way through, and its devices where they fall." : ''}
${OUTLINE_RULES(o.withActs)}`
}

// ---------- Talking a plan over ----------

export function planChatSystem(): string {
  return `${MARKER} plan chat
You help a novelist with the plan of their story: suggested acts, chapters and scene cards they haven't kept yet, given below in a fixed form. They tell you what they want changed, or ask about it. Answer in a few plain sentences. When they ask for a change (or agree to one you suggested), make it: after your answer, put a line with exactly "${PLAN_LINE}" and then the whole plan, changed, in exactly the same form (headings "# Act:", "## Chapter:", "### Scene:" and the same lines under them), with no bold or other formatting.
When they only ask a question, answer it and give no plan.

The form:
${outlineForm(true)}
(Leave out "# Act:" headings when the plan has none.)

Rules
- ${ORDER}
- Change only what they ask for, and what has to change with it so the plan still holds together (later scenes that depended on a changed one). Keep everything else as it is, word for word.
- Use the characters, places and plot threads given, by their names.
${OUTLINE_RULES(true).split('\n').slice(1).join('\n')}`
}

export function planRedoSystem(kind: 'act' | 'chapter' | 'scene'): string {
  const what = kind === 'act' ? 'one act, with its chapters and their scene cards' : kind === 'chapter' ? 'one chapter, with its scene cards' : 'one scene card'
  return `${MARKER} plan redo
You help a novelist with the plan of their story. Write ${what} again, as they ask (or as a fresh take on it when they don't say), so it fits the plan around it: what comes before leads into it, and it leads into what comes after. Answer in exactly the form below and nothing else: no introduction, no notes, no bold or other formatting, and only the ${kind} asked for.

The form:
${kind === 'scene' ? SCENE_FORM : kind === 'chapter' ? `${CHAPTER_FORM}\n\n${SCENE_FORM}` : outlineForm(true)}

Rules
- ${ORDER}
- Keep what the note doesn't ask to change: its place in the story, what it must set up for later and what it pays off.
- Use the characters, places and plot threads given, by their names.
${OUTLINE_RULES(true).split('\n').slice(1).join('\n')}`
}

// ---------- Talking a recipe over ----------

const partList = (): string => (Object.values(PART_HEADINGS) as string[]).map((h) => `## ${h}`).join('\n')

export function recipeChatSystem(): string {
  return `${MARKER} recipe chat
You help a novelist with a story recipe: the themes, tone, writing style, shape, beats, cast roles, pacing and devices of a story they admire, given below under its headings, which they will use for a new story of their own. They tell you what they want changed, or ask about it. Answer in a few plain sentences. When they ask for a change (or agree to one you suggested), make it: after your answer, put a line with exactly "${PARTS_LINE}" and then only the parts you changed, each whole, under its heading. The headings:
${partList()}
When they only ask a question, answer it and give no parts.

Rules
- Change only what they ask for, and what has to change with it. Keep everything else as it is.
- A recipe never names people or places: call characters by the part they play ("the mentor") and places by what they are ("a port city").
- Under "Genre and content", keep its form: "Genres: Horror, Mystery. Romance: Fade to black. Violence: Vivid. Language: Mild."`
}

export function recipeRedoSystem(part: RecipePartId): string {
  return `${MARKER} recipe redo
You help a novelist with a story recipe, given below under its headings. Write its "${PART_HEADINGS[part]}" part again, as they ask (or as a fresh take on it when they don't say), so it fits the rest of the recipe. Reply with the part's new text only: no heading, no introduction, no notes.

Rules
- A recipe never names people or places: call characters by the part they play ("the mentor") and places by what they are ("a port city").${part === 'feel' ? '\n- Keep its form: "Genres: Horror, Mystery. Romance: Fade to black. Violence: Vivid. Language: Mild."' : ''}`
}

/** A recipe's parts under their headings, for the recipe chat and redo. */
export function partsText(parts: Partial<Record<RecipePartId, string>>): string {
  return (Object.keys(PART_HEADINGS) as RecipePartId[])
    .filter((k) => parts[k]?.trim())
    .map((k) => `## ${PART_HEADINGS[k]}\n${parts[k]!.trim()}`)
    .join('\n\n')
}

/** Splits a talk-it-over answer at its line: the answer, and what follows (null when there is no line). */
export function splitAnswer(text: string, mark: string): { answer: string; rest: string | null } {
  const at = text.indexOf(mark)
  if (at < 0) {
    // A model may bold or hash the line: "**=== Revised plan ===**", "### Revised plan".
    const loose = new RegExp(`^[#*\\s=]*${mark.replace(/=/g, '').trim()}[*\\s=:]*$`, 'im').exec(text)
    if (!loose) return { answer: text.trim(), rest: null }
    return { answer: text.slice(0, loose.index).trim(), rest: text.slice(loose.index + loose[0].length) }
  }
  return { answer: text.slice(0, at).trim(), rest: text.slice(at + mark.length) }
}
