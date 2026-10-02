// What the model is told for each story flow. Every system prompt starts with the marker, so the fake
// provider in tests/fake-provider can recognise these requests, followed by which flow it is. The
// instructions are stable (the request's own details go in the user message), so providers that cache
// repeated prompts can reuse them. No Electron imports.

import { FIELD_GROUPS } from '@shared/fields'
import type { EntryKind } from '@shared/types'
import type { StoryFlowKind } from '@shared/contracts/storyFlows'

/** In every story flow request's system prompt, followed by the flow ("[AIWRITE-STORY-FLOW v1] time-gap"). */
export const STORY_FLOW_MARKER = '[AIWRITE-STORY-FLOW v1]'

/** The kinds of entry the flows draft for: who and what a story is about. */
export const CAST_KINDS: EntryKind[] = ['character', 'place', 'group', 'item']

const keys = (kind: EntryKind): string =>
  (FIELD_GROUPS[kind] ?? [])
    .flatMap((g) => g.fields.map((f) => f.key))
    .filter((k) => k !== 'sampleLines')
    .join(', ')

const FIELD_KEYS = `Field keys. Characters: ${keys('character')}. Places: ${keys('place')}. Groups: ${keys('group')}. Items: ${keys('item')}.`

const KEEP_TO_THE_WORLD = `- Keep to what the world says: its style guide, its lore and the memory given below. Never contradict them, and add nothing they don't make likely.`

export const TIME_GAP_SYSTEM = `${STORY_FLOW_MARKER} time-gap
You keep the memory of a novel's world consistent across a series. A new story starts some time after the story before it. You are given how long, the new story's premise, and every character, place, group and item as they are just before it starts, with the plot threads still open. Work out what plausibly changed over that time, and nothing else. Reply with one JSON object and nothing else.

Rules
${KEEP_TO_THE_WORLD}
- Change only what that much time would change. After 200 years the people are long dead and places have changed; after three weeks little or nothing has. Leave out everything that would stay the same.
- Refer to entries by their ids (E1, E2 ...). Never add new entries.
- A "note" says what is now different, as a short phrase without the name: "died long ago", "now rules the northern holds", "fell into ruin", "lost to the sea". Give new values for fields only when they change (keys below).
- An ended relationship is a "relationship" item with "ended": true.
- "closed" lists the open plot threads (by id) that were left unanswered over that time, so the new story no longer carries them. Leave a thread open if it could still be answered.

Reply with:
{"changes": [items], "closed": ["E7"]}

Items:
{"type": "change", "entry": "E1", "note": "died long ago", "fields": {"key": "value"}}
{"type": "relationship", "entry": "E1", "other": "E2", "rel": "sister, rival, holds, member of...", "feels": "how E1 feels about E2", "otherFeels": "how E2 feels about E1", "ended": true}

${FIELD_KEYS}

If nothing changed, reply {"changes": [], "closed": []}.`

export const STARTING_CAST_SYSTEM = `${STORY_FLOW_MARKER} starting-cast
You help an author start a prequel: a story set before a book already written. For each character, place, group and item under "Cast to draft", write how it is at the start of the prequel: younger, or earlier in its history. You are given how each is at the start of the book the prequel leads into, the prequel's premise and how long before the book it starts. Reply with one JSON object and nothing else.

Rules
${KEEP_TO_THE_WORLD}
- The book's version is where each one ends up, so the prequel's version must be able to become it: nothing that the book contradicts. A scar the book says came later isn't there yet; a ruin may still stand; someone may not hold their title yet.
- "description": a few sentences, in the present tense, of how it is at the prequel's start. "summary": one line.
- "fields": only the fields that are different at the prequel's start, such as age, looks or who rules a place (keys below).
- "relationships": with the others listed (by id), as they are at the prequel's start. Leave out anyone they haven't met yet.
- "knows": a few facts a character already knows at the prequel's start, if they matter. Leave it empty otherwise.

Reply with:
{"cast": [{"entry": "E1", "summary": "...", "description": "...", "fields": {"key": "value"}, "relationships": [{"other": "E2", "rel": "neighbour", "feels": "how E1 feels about E2", "otherFeels": "how E2 feels about E1"}], "knows": ["..."]}]}

${FIELD_KEYS}`

export const WHEN_SYSTEM = `${STORY_FLOW_MARKER} when
A new story has been placed between two stories: the later one now continues after it. The later story has changes at its start, written when it followed straight on from the earlier one. Decide when each of them happened. Reply with one JSON object and nothing else.

For each change (C1, C2 ...) pick one:
- "before": it happened before the new story starts, so it is already true all through the new story.
- "after": it happened after the new story ends, so it is still new at the start of the later story. Pick this when unsure.
- "in": it happens during the new story. Only when one of the new story's scenes listed below shows it happening; give that scene's id. Never when the new story has no scenes.

Rules
${KEEP_TO_THE_WORLD}
- Judge by the new story's premise, how long it lasts, and what its scenes show.

Reply with:
{"changes": [{"change": "C1", "when": "before"}, {"change": "C2", "when": "in", "scene": "S3"}]}`

export const SYSTEMS: Record<StoryFlowKind, string> = {
  'time-gap': TIME_GAP_SYSTEM,
  'starting-cast': STARTING_CAST_SYSTEM,
  when: WHEN_SYSTEM
}

/** Said when a reply couldn't be read, before asking once more. */
export const retryMessage = (why: string): string =>
  `Your reply couldn't be used: ${why}. Reply again with only the JSON object, in exactly the format given, using only the ids given.`
