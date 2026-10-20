// What Write the whole chapter asks of the AI (reworked 2026-10-19, spec "Write the chapter, reworked"): the chapter
// plan (an agent with the look-up tools, ai/lookups/, and write_chapter_plan) and the targeted fix of one flagged passage
// (the writer model, with the writer's own instructions, style guide and sample, at the writer's temperature). The
// drafts, the state check (checks/) and the critic (critique/) have prompts of their own. Every system prompt starts with
// `[AIWRITE-CHAPTER v1] <job>`, so the fake provider can answer it in tests. Pure.

import type { StyleGuide, ToolSpec } from '@shared/types'
import { instructionsText } from '../ai/prompts'
import { LOOKUPS_MOST } from '../ai/lookups'
import { packList } from '../ai/packs'

export const CHAPTER_MARKER = '[AIWRITE-CHAPTER v1]'

export type ChapterJob = 'plan' | 'fix'

/** The planner judges and plans: low creativity. */
export const PLAN_TEMPERATURE = 0.3
/** Room for the planner's replies (the plan for a long chapter is its longest). */
export const PLAN_REPLY = 3200
/**
 * How many requests the chapter plan may take: a round or two of look-ups, then the plan (the last request goes without
 * tools and is asked for the plan as JSON). Every request sends the session so far again.
 */
export const PLAN_STEPS = 4
/** How many look-ups the chapter plan may make in all (at most LOOKUPS_MOST a round). */
export const PLAN_LOOKUPS = 16

/**
 * The instruction packs the planner may load (overhaul phase 2, ai/packs): the consistency checks' own words for what must
 * carry on from scene to scene. Listed in its system prompt, which stays the same, so a provider's cache keeps it.
 */
export const PLAN_PACKS: readonly string[] = ['check-continuity']

/** The most of each part of a scene's part of the plan. */
export const PLAN_PART_MOST = { threads: 4, changes: 6, keep: 4 }

const str = { type: 'string' } as const

export function planSystem(): string {
  return `${CHAPTER_MARKER} plan
You are the lead writer of a novel, planning one chapter before any of its scenes is written. Read the chapter card and each scene card below, look up what you need, then write the chapter plan with write_chapter_plan. Each scene is then written in order against its part of the plan, so the parts must fit together: each scene starts where the one before it ends.

Look-ups
The tools answer from the story so far, as it stands when this chapter begins: state_of (where someone is, what they wear and carry, injuries, what they know), last_seen, who_knows, open_threads, what_happened, who_was_there, timeline, get_entry (a codex entry), find_in_story and read_passage. Ask for everything you need at once: at most ${LOOKUPS_MOST} look-ups a round, ${PLAN_LOOKUPS} in all. Look up nothing you were already given below.

The plan
- overview: what the chapter does, in two or three sentences.
- lead: whose chapter it is, by name (usually the point of view).
- wants: what they want in this chapter, in one sentence.
- against: what stands in their way, in one sentence.
- turn: how the chapter turns, in one sentence.
- scenes: one item for each scene, in order:
  - scene: which scene ("Sc 1").
  - does: what the scene must do in the chapter, in one or two sentences, from its card.
  - ends: how the scene ends, in one short line: where it leaves the people in it ("Wren soaked to the knee, boots off by the fire"). The next scene starts from there.
  - threads: the plot threads it moves on, and how ("The forged letter: Mara learns who wrote it"). Only threads its card calls for, or open ones that fit what it is asked to do. At most ${PLAN_PART_MOST.threads}.
  - changes: what changes for each person in it by the scene's end: where they end up, what they learn, what they gain or lose, as {"who": "Mara", "change": "ends up at the inn; learns Tobin lied"}. Only what the cards call for, and the moves they need. At most ${PLAN_PART_MOST.changes}.
  - keep: facts the scene must keep to that its card doesn't say, from what you were given or looked up, each with where it comes from ("Mara's left arm is in a sling (since Ch 2, Sc 3)"). At most ${PLAN_PART_MOST.keep}.
- questions: anything in the cards that doesn't fit the story so far, for the author. The cards are never changed: plan the scene to stay true to the story instead, and say so.
- title: a name for this chapter, only when the brief asks for one. Titles are a few words, with no numbers, in the same style as the story's other chapter names (their length, form and tone) when they have names.

Rules
- The story so far and the author's cards are the truth. Never invent events, people or facts they don't give.
- A character knows only what they know by then. The dead stay dead. Things are where they were last left. Time moves forward.
- Nothing that has already happened is planned again.
- Notes, not prose: don't write the scenes.

${packList(PLAN_PACKS)}`
}

export const WRITE_CHAPTER_PLAN: ToolSpec = {
  name: 'write_chapter_plan',
  description:
    'Write the chapter plan, once, when you have what you need. `overview`: what the chapter does; `lead`, `wants`, `against` and `turn`: whose chapter it is, what they want, what is against them and how it turns. `scenes`: one item per scene, in order, each with `scene` ("Sc 1"), `does`, `ends`, `threads`, `changes` ({who, change}) and `keep`. `questions`: what in the cards does not fit the story so far, for the author. `title`: a name for the chapter, only when the brief asks for one.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          "A name for this chapter, only when the brief asks for one: a few words, no number, in the same style as the story's other chapter titles (length, form, tone) when they have names."
      },
      overview: str,
      lead: str,
      wants: str,
      against: str,
      turn: str,
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            scene: { type: 'string', description: 'Which scene: "Sc 2".' },
            does: str,
            ends: str,
            threads: { type: 'array', items: str },
            changes: { type: 'array', items: { type: 'object', properties: { who: str, change: str }, required: ['who', 'change'] } },
            keep: { type: 'array', items: str }
          },
          required: ['scene', 'does']
        }
      },
      questions: { type: 'array', items: str }
    },
    required: ['overview', 'scenes']
  }
}

/** The plan's JSON, as the last request (without tools) is asked for it. */
const PLAN_SHAPE =
  '{"overview": "", "lead": "", "wants": "", "against": "", "turn": "", "scenes": [{"scene": "Sc 1", "does": "", "ends": "", "threads": [""], "changes": [{"who": "", "change": ""}], "keep": [""]}], "questions": [""], "title": ""}'

/** Said before the planner's last request, which has no tools. */
export const PLAN_LAST_WORDS = `[AI Write] No more look-ups. Write the chapter plan now, every scene in order, as one JSON object and nothing else:\n${PLAN_SHAPE}`

/** Sent back when the planner answers in words that aren't the plan. */
export const PLAN_NUDGE = '[AI Write] Use the tools: look up what you still need, all at once, then call write_chapter_plan with every scene. Words written here are not kept.'

/** A look-up asked for past the plan's look-ups. */
export const NO_MORE_LOOKUPS = 'No more look-ups for this plan: you have what you need. Call write_chapter_plan now, with every scene.'

// ---------- The targeted fix ----------

/** The fix's reply room: the passage's length, about twice over, and a little more (MAX_FIX_WORDS caps the passage). */
export const fixReply = (passageWords: number): number => Math.min(3000, Math.max(400, Math.ceil(passageWords * 1.4 * 2.2 + 200)))

/** The longest passage a fix rewrites, in words (a longer quote is fixed in the paragraph where it starts). */
export const MAX_FIX_WORDS = 450

const FIX_JOB = `You are the novelist writing this book. A scene you wrote has been checked, and one problem was found in a passage of it. Rewrite only that passage so the problem is gone, in the book's own voice. The rest of the scene stays as it is.

How to reply
- Reply with only the new passage that takes the place of the old one: no title, no notes, no quotation marks around it, nothing before or after.
- Keep the paragraph breaks (a blank line between paragraphs) and about the same length, unless putting the problem right needs a little more or less.
- Keep everything in the passage the problem doesn't touch: what happens, who says what, and every name, as written, wherever it works.
- The new passage must fit between the text before and after it: carry on from the one, and lead into the other.
- Never add events, people or facts that the scene card, the chapter plan or the story so far don't give.
- Write plain text, wrapping words in single *asterisks* for italics, as the scene does.`

/** The fix's system prompt: the job, then the writer's own instructions, style guide and sample passage. */
export function fixSystem(style: StyleGuide): string {
  return [`${CHAPTER_MARKER} fix`, FIX_JOB, instructionsText(style)].filter(Boolean).join('\n\n')
}

/** The fix's closing ask. */
export const FIX_ASK = 'Rewrite the passage so this is put right. Reply with only the new passage.'

/** What the direction says when a scene is written again because it missed its part of the plan. */
export function missedDirection(misses: string[]): string {
  return `The scene as first written missed its part of the chapter plan. Write it again so that it does all of its part, above all: ${misses
    .map((m) => m.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, ''))
    .join('; ')}.`
}
