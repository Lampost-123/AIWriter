// What the consistency check model is told (milestone 5, AI checks). Every system prompt starts with
// "[AIWRITE-CHECK v1] <checks>", so the fake provider in tests/fake-provider/m5 recognises it. The
// instructions are stable for each set of checks, so providers that cache repeated prompts can reuse them.

import type { CheckKind } from '@shared/contracts/checks'
import { ALL_CHECKS } from '@shared/contracts/checks'
import { fieldKeys } from '../keeper/prompts'

export const CHECK_MARKER = '[AIWRITE-CHECK v1]'

/** What each check looks for, in the model's instructions. */
const WHAT: Record<CheckKind, string> = {
  facts:
    'facts: the scene against each entry as the memory has it at the start of the scene: looks (eye and hair colour, scars, missing limbs, how many fingers), injuries, what someone carries or owns, where people and things are, and the world\'s rules. Above all, who is dead: a character who died earlier (in what has happened to them, or in the story so far) who speaks, acts or is treated as alive in this scene is a must-fix, unless the scene shows a ghost, a memory or a vision.',
  knowledge:
    "knowledge: a character who acts on or mentions something they could not know yet: it happens in a later scene, or it happened where they were not and nothing (the story so far, the scenes before, this scene) shows them learning it. The memory's list of who knows what is far from complete: something it doesn't list is NOT a problem by itself, and things said or shown in the story so far or in this scene count as known by those who were there. Also a character who forgets something they clearly know.",
  timeline:
    "timeline: where the characters were in the scenes before and when (the in-world dates and times), so someone is never in two places at once, travels further than the time allows, or has an age that doesn't add up.",
  continuity:
    "continuity: where things stood as the previous scene ended (where each character is, what they wear and hold, how they are placed, their condition, the time, weather and light) and how the scene carries them on: a coat taken off earlier still worn, someone sitting who was standing with no move between, something in a hand that was put down, a character who left still speaking, the light or the time of day changing for no reason.",
  voice:
    "voice: each character's dialogue against how they speak (their voice notes, verbal tics, what they never say, and their sample lines). Flag only lines that clearly don't sound like them.",
  style:
    "style: the scene against the style guide's point of view and tense (a slip into another point of view, or another tense, outside dialogue), the tone against the scene card's mood when it is far from it, and, when a genre or content levels are given, passages that clearly break the genre's feel or go further than a content level allows."
}

/** The check names a reply may use, for the instructions. */
const NAMES = ALL_CHECKS.join(', ')

/** The instructions for checking a scene with these checks. */
export function sceneSystem(checks: CheckKind[]): string {
  const list = ALL_CHECKS.filter((c) => checks.includes(c))
  return `${CHECK_MARKER} ${list.join(', ')}
You check a scene of a novel for consistency, for its author. You are given the memory of the story's world as it stands at the START of the scene (before anything in the scene happens), the story so far, where things stood as the previous scene ended, the scenes just before it, the style guide and the scene's text. Reply with one JSON object and nothing else.

What to check
${list.map((c) => `- ${WHAT[c]}`).join('\n')}

Rules
- The memory is what is true at the start of this scene. Something that changes during the scene (an injury, a new coat, a journey, someone learning a secret) is fine when the scene shows it happening. Flag only what the scene treats as already so that contradicts the memory, with nothing in the scene to explain it.
- Report only real problems a careful reader would notice. No comments on quality, no suggestions for improvement, nothing the memory doesn't say.
- Never list something you looked at and found fine as an issue (no "this fits", "no problem", "consistent"): that goes in "checked". Every issue's message says what is wrong.
- When unsure whether something is a problem, leave it out. "must-fix" only when it cannot be right.
- "quote": words copied exactly, character for character, from the scene: the shortest phrase or sentence that shows the problem.
- "message": one plain sentence for the author saying what disagrees with what, such as "Mara's eyes are blue in the memory, but green here." Use names, never the ids.
- "severity": "must-fix" when it can't be right as written (a dead character acting or speaking, someone in two places at once, a character knowing what they can't know); "warning" when it is probably a slip (looks, ages, travel times, a line that doesn't sound like them); "minor" when it is small and easily missed (one sentence in another tense).
- "conflicts": what it disagrees with: {"entry": "E1", "field": "eyes"} for something in the memory (the field's key when it is one of the entry's fields; leave "field" out otherwise), or {"scene": "S2"} for one of the earlier scenes.
- "memory" and "text": when it is about one value (an eye colour, an age, a place), what the memory says and what the scene says, a few words each.
- "fix": the quote rewritten so the problem goes, changing as few words as possible, in the scene's own style. Leave it out when rewriting those words alone can't fix it.
- "check": one of ${NAMES}.

- "checked": one item for each check above, saying in one or two plain sentences what you compared and what agreed (or didn't), with names, such as "Mara's injured wrist and grey cloak match how the scene before ended." "ok": false when that check found an issue.

Reply with:
{"issues": [{"check": "facts", "severity": "warning", "quote": "...", "message": "...", "conflicts": {"entry": "E1", "field": "eyes"}, "memory": "blue", "text": "green", "fix": "..."}], "checked": [{"check": "facts", "ok": false, "note": "..."}]}

Field keys. Characters: ${fieldKeys('character').join(', ')}, sampleLines. Places: ${fieldKeys('place').join(', ')}. Any kind: summary, description.

If there is nothing to report, reply with an empty "issues" list, and still say what you checked in "checked".`
}

/** The instructions for comparing a story with the story it runs alongside, or a prequel's ending with the book it leads into. */
export function storySystem(how: 'side' | 'prequel'): string {
  return `${CHECK_MARKER} story
You compare two stories set in the same world, for their author, and find where they contradict each other. ${
    how === 'side'
      ? 'The first is a side story that runs alongside the second: you are given what happens in each over the stretch they share.'
      : 'The first is a prequel: you are given how it ends, and how the book it leads into begins.'
  } Reply with one JSON object and nothing else.

Rules
- Report only real contradictions: someone in two places at once, someone dead in one and alive in the other, ${
    how === 'side' ? 'an event told differently in each' : 'a character, place or thing at the end of the prequel that doesn\'t match how the book finds it'
  }, a relationship that can't be both. Nothing about quality, nothing either story leaves open.
- Leave out anything listed under "Already asked" (the author is asked about those separately).
- "quote": words copied exactly from the first story's text when it is given and shows the problem; otherwise "".
- "message": one plain sentence for the author naming both stories, such as "Tobin is in the north in Kell's Road, but at the ferry in Book 1 at the same time."
- "severity": "must-fix" when both can't be true, "warning" when it is probably a slip.
- "entry": the id (E1...) of the character, place or thing it is about, when there is one; "field": its field key, when it is one.

Reply with:
{"issues": [{"severity": "warning", "quote": "...", "message": "...", "entry": "E1", "field": "eyes"}]}

If there is nothing to report, reply {"issues": []}.`
}

/** Said when a reply couldn't be read, before asking once more. */
export const retryMessage = (why: string): string =>
  `Your reply couldn't be used: ${why}. Reply again with only the JSON object, in exactly the format given, with every quote copied exactly from the scene.`
