// What the consistency check model is told (milestone 5, AI checks). Every request about one scene opens the same way
// (2026-10-19, the checks' cost): the same instructions (CHECK_SYSTEM: what every check looks for, the rules and the
// reply's shape), then the same material and the scene's words (checks/context.ts checkOpening), and only then the
// request's own task ("## Your task": the checks it makes, or notes to rule on, checks/run.ts), so a provider that keeps
// the start of a prompt it has seen (DeepSeek, OpenAI) reads all of it but the task from its cache. The fake provider in
// tests/fake-provider/m5 reads the checks asked from the task's "[AIWRITE-CHECK-TASK v1] <checks>" line. Comparing two
// stories keeps its own instructions ("[AIWRITE-CHECK v1] story").

import type { CheckKind } from '@shared/contracts/checks'
import { ALL_CHECKS } from '@shared/contracts/checks'
import { fieldKeys } from '../keeper/prompts'
import { CHECK_CONTRACT_RULES } from '../repair/contract'

export const CHECK_MARKER = '[AIWRITE-CHECK v1]'
/** The first line of the instructions every request about one scene shares. */
export const SCENE_CHECK_MARKER = '[AIWRITE-CHECK v2] scene'
/** Starts the task of a request that makes checks, before the checks it makes: "[AIWRITE-CHECK-TASK v1] facts, timeline". */
export const CHECK_TASK_MARKER = '[AIWRITE-CHECK-TASK v1]'
/** The heading of each request's own task, after the scene. */
export const TASK_HEADING = '## Your task'

/** What each check looks for, in the model's instructions. */
const WHAT: Record<CheckKind, string> = {
  facts:
    "facts: the scene against each entry as the memory has it at the start of the scene: looks (eye and hair colour, scars, missing limbs, how many fingers), injuries, what someone carries or owns, where people and things are, and the world's rules. Above all, who is dead: a character who died earlier (in what has happened to them, or in the story so far) who speaks, acts or is treated as alive in this scene is a must-fix, unless the scene shows a ghost, a memory or a vision. Also what the scene says about the past, in the narration, a memory or a line of dialogue, against the memory and the story so far: names (of people, places, boats, animals), numbers and sums, which way a place lies, how long a journey took, how someone died, and who heard or saw what. Getting one of these wrong is a slip like any other, unless the scene shows the character is mistaken or lying.",
  knowledge:
    "knowledge: a character who acts on or mentions something they could not know yet: it happens in a later scene, or it happened where they were not and nothing (the story so far, the scenes before, this scene) shows them learning it. The memory's list of who knows what is far from complete: something it doesn't list is NOT a problem by itself, and things said or shown in the story so far or in this scene count as known by those who were there. Also a character who forgets something they clearly know, or who acts on the truth of something the memory says they believe wrongly, with nothing showing them learn it.",
  timeline:
    "timeline: where the characters were in the scenes before and when (the in-world dates and times), so someone is never in two places at once, travels further than the time allows, or has an age that doesn't add up.",
  continuity:
    'continuity: where things stood as the previous scene ended (where each character is, each piece of what they wear, what they hold, how they are placed, their condition, the things in the place such as a door barred or a case put down, the time, weather and light) and how the scene carries them on: a coat taken off earlier still worn, someone sitting who was standing with no move between, something in a hand that was put down, a barred door opened with no one unbarring it, a character who left still speaking, the light or the time of day changing for no reason.',
  voice:
    "voice: each character's dialogue against how they speak (their voice notes, verbal tics, what they never say). Flag only a line that clearly breaks them (someone who never swears swearing, a terse character making a speech); a line merely unlike their sample lines, or more emotional at an emotional moment, is not an issue.",
  style:
    "style: the scene against the style guide's point of view and tense (a slip into another point of view, or another tense, outside dialogue), the tone against the scene card's mood when it is far from it, and, when a genre or content levels are given, passages that clearly break the genre's feel or go further than a content level allows."
}

/** What each check looks for (the instruction packs, ai/packs/, give the chat and the planner the same words). */
export const CHECK_WHAT: Readonly<Record<CheckKind, string>> = WHAT

/** The check names a reply may use, for the instructions. */
const NAMES = ALL_CHECKS.join(', ')

/**
 * The instructions every request about one scene starts with, whatever its task (2026-10-19): what each check looks for,
 * the rules and the reply's shape. The same words every time, for every scene, so a provider's cache keeps them.
 */
export const CHECK_SYSTEM = `${SCENE_CHECK_MARKER}
You check a scene of a novel for consistency, for its author. You are given the memory of the story's world as it stands at the START of the scene (before anything in the scene happens), the story so far, where things stood as the previous scene ended, the scenes just before it, the author's plan for the scene, the style guide and the scene's text. After the scene comes your task, under "Your task": the checks to make, or another editor's notes to rule on. Do that task alone, and reply with one JSON object in the format it asks for, and nothing else.

What each check looks for
${ALL_CHECKS.map((c) => `- ${WHAT[c]}`).join('\n')}

Rules for the checks
- The memory is what is true at the start of this scene. Something that changes during the scene (an injury, a new coat, a journey, someone learning a secret) is fine when the scene shows it happening. Flag only what the scene treats as already so that contradicts the memory, with nothing in the scene to explain it.
- Report only real problems a careful reader would notice. No comments on quality, no suggestions for improvement, nothing the memory doesn't say.
- Never list something you looked at and found fine as an issue (no "this fits", "no problem", "consistent"): that goes in "checked". Every issue's message says what is wrong.
- When unsure whether something is a problem, leave it out. "must-fix" only when it cannot be right.
- Only what CONTRADICTS the memory, the story so far or the scene itself is an issue. A detail the memory doesn't have (a coat's colour, extra watchmen, something a character knows that it doesn't list) is never an issue on its own.
- Clothing in a profile is what someone usually wears, not what they must wear: a change of clothes is not an issue (unless where things stood says otherwise and nothing in the scene explains it).
- Under "What the author has said is meant" are things a check raised in earlier scenes that the author said are intended. The same thing in this scene is not an issue either.
- Under "The author's plan for this scene" is what the author means the scene to do (its goal, beats, notes and outcome). What the plan asks for (someone lying, mistaken, hiding something or changing) is not a slip, even where it goes against the memory.
- The scene card's story date says how much time has passed since the scene before. When hours or days have passed, where things stood as that scene ended need not carry on: people may have slept, moved or changed clothes in between.
- Anyone listed under "Dead at the start of this scene" who speaks, acts, sleeps, breathes or is treated as alive is a must-fix, unless the scene shows a ghost, a memory, a dream or a vision.
- Anyone listed under "Orders and suggestions in force" who goes against one, where and when it applies (its cue met, its place), is a warning, unless the scene shows it lifted or replaced. Following it without knowing why is never an issue.
- "quote": words copied exactly, character for character, from the scene: the shortest phrase or sentence that shows the problem.
- "message": one plain sentence for the author saying what disagrees with what, such as "Mara's eyes are blue in the memory, but green here." Use names, never the ids.
- "severity": "must-fix" when it can't be right as written (a dead character acting or speaking, someone in two places at once, a character knowing what they can't know); "warning" when it is probably a slip (looks, ages, travel times, a line that doesn't sound like them); "minor" when it is small and easily missed (one sentence in another tense).
- "conflicts": what it disagrees with: {"entry": "E1", "field": "eyes"} for something in the memory (the field's key when it is one of the entry's fields; leave "field" out otherwise), or {"scene": "S2"} for one of the earlier scenes.
- "memory" and "text": when it is about one value (an eye colour, an age, a place), what the memory says and what the scene says, a few words each.
- "fix": the quote rewritten so the problem goes, changing as few words as possible, in the scene's own style. Give one whenever rewriting those words can fix it.
- "advice": when rewriting the quote alone can't fix it (or there are two good ways), one plain sentence for the author saying how to put it right, such as "Have Dov hear of Anselm's death earlier in the scene, or cut the line." Nothing is changed without the author.
- "check": one of ${NAMES}.

- "checked": one item for each check the task asks for, saying in one or two plain sentences what you compared and what agreed (or didn't), with names, such as "Mara's injured wrist and grey cloak match how the scene before ended." "ok": false when that check found an issue.

A check's reply:
{"issues": [{"check": "facts", "severity": "warning", "quote": "...", "message": "...", "conflicts": {"entry": "E1", "field": "eyes"}, "memory": "blue", "text": "green", "fix": "...", "advice": "..."}], "checked": [{"check": "facts", "ok": false, "note": "..."}]}

Field keys. Characters: ${fieldKeys('character').join(', ')}, sampleLines. Places: ${fieldKeys('place').join(', ')}. Any kind: summary, description.

If a check finds nothing to report, reply with an empty "issues" list, and still say what you checked in "checked".`

/** "facts, timeline and continuity". */
const andList = (xs: string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * The task of a request that makes these checks, after the scene. With `contract` (the scene's contract as its section
 * says it: "## The scene’s contract (C ids)" and its C lines), through the contract too (long story memory fix 13: the
 * chapter writer's checks, and Check this scene and Mark done through the scene's latest contract). The checks are named
 * in the order given: a request's own first, then those asked in both requests (checks/context.ts checkRequests).
 */
export function checkTask(checks: CheckKind[], contract: string | null = null): string {
  const list = [...new Set(checks)].filter((c) => ALL_CHECKS.includes(c))
  const one = list.length === 1
  const own = `Check the scene for ${andList(list)} only, as "What each check looks for" says: ${one ? 'its' : 'their'} issues, and "checked" for ${one ? 'it' : 'each of them'}.`
  return `${TASK_HEADING}\n${CHECK_TASK_MARKER} ${list.join(', ')}\n${own}${contract ? `\n\n${CHECK_CONTRACT_RULES}\n\n${contract}` : ''}`
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
    how === 'side'
      ? 'an event told differently in each'
      : "a character, place or thing at the end of the prequel that doesn't match how the book finds it"
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

/**
 * Said when a reply couldn't be read, at the end of the same request asked once more (2026-10-19, as the memory keeper
 * does): the failed reply isn't sent back, so a provider's cache serves all of the request but this line.
 */
export const retryMessage = (why: string): string =>
  `Your last reply to this couldn't be used: ${why}. Reply with only the JSON object, in exactly the format given, with every quote copied exactly from the scene.`
