// What the chapter writer's agent is told: its three jobs (study the chapter before it is written, review and fix a
// scene or the whole chapter, proofread a scene) and the tools of its own. The look-up tools are the editor chat's
// (ask/agent.ts), described there. Every system prompt starts with `[AIWRITE-CHAPTER v1] <job>`, so the fake provider
// can answer it in tests. Pure.

import type { ToolSpec } from '@shared/types'

export const CHAPTER_MARKER = '[AIWRITE-CHAPTER v1]'

export type ChapterJob = 'study' | 'review' | 'chapter' | 'proofread'

/** Low creativity: the agent judges and mends; the writer writes. */
export const AGENT_TEMPERATURE = 0.3
/** Room for each of the agent's replies (its tool calls carry new passages, up to about 600 words). */
export const AGENT_REPLY = 2400

/** How many requests each session may take (each tool call is one more). Per session, never per run. */
export const STEPS: Record<ChapterJob, number> = { study: 16, review: 28, chapter: 28, proofread: 14 }

/** The most words one revise may carry (a longer reply risks being cut off). */
export const MAX_REVISE_WORDS = 600

const str = { type: 'string' } as const
const sceneArg = { type: 'string', description: 'Which scene: "Sc 2", "Ch 3, Sc 2", or its title.' } as const

const LOOKING = `You have tools to look things up: read_scene (a scene's words, its paragraphs numbered), get_entry (a character, place, item or other codex entry as of the scene you are working on), scene_state (Recall: where everyone and everything is, what they wear and hold, at a point in a scene), story_so_far, timeline (the canon timeline before a scene: what happened, when, who was there), search (the story so far by words), list_threads (plot threads), chapter_card, style_guide and outline. "The open scene" in their descriptions means the scene you are working on. Look things up before you decide: never guess what the memory says.`

const RULES = `Rules that never bend
- The memory (codex entries, Recall, the timeline, who knows what) and the author's own scene cards are the truth. When the words and the memory disagree, the words change, never the memory. You can't change the memory or the cards.
- Keep the story's point of view, tense, voice and style. Keep everything that already works word for word.
- Never invent events, people or facts the scene card, the brief or the memory don't give.
- A character knows only what the memory says they know by then. The dead stay dead. Things are where the memory last put them. Time moves forward as the timeline says.`

export function studySystem(): string {
  return `${CHAPTER_MARKER} study
You are the lead editor of a novel, about to have a chapter written from the author's scene cards. Before any prose is written, study the chapter against the story's memory, so every scene is written right the first time.

${LOOKING}

What to do
1. Read the chapter card and each scene card below.
2. Look up everyone and everything the cards name or need: who they are now, where they are, what they hold and wear, what they know and don't know, injuries, what they have lost or given away, their relationships.
3. Check the timeline and the story so far: when each scene happens, how much time has passed, what has already happened (so nothing is written again as new), which plot threads are open.
4. Call write_brief once, at the end: for each scene, the facts the writer must keep to (each with where it comes from), who knows what, where everyone and everything starts, when it happens, the threads to touch, and the traps to avoid. Under questions, list anything in the cards that doesn't fit the memory, and say in the scene's notes how the scene will stay true to the memory instead.

${RULES}

Be thorough but brief: notes, not prose. Don't write the scenes.`
}

export function reviewSystem(job: 'review' | 'chapter'): string {
  const what =
    job === 'review'
      ? 'one scene of a chapter you had written from the author\'s scene cards'
      : 'a whole chapter you had written from the author\'s scene cards, as one piece: how its scenes follow on from each other, the timeline across them, and anything the critic said about the chapter as a whole'
  return `${CHAPTER_MARKER} ${job}
You are the lead editor of a novel. You are revising ${what}. The app's consistency checks (facts, who knows what, timeline, continuity, voice, style) and a craft critic have read it; their findings are listed with ids (F1, F2...). Your job: make every finding right, so the chapter is consistent with the story's memory and reads well.

${LOOKING}

How to work
- For each finding, look up what you need, then decide: is it real?
- Real: fix it with revise, naming the findings it fixes in \`fixes\`. Fix the cause, not the symptom: a wrong time means checking the timeline, not rewording; someone knowing what they can't means changing what they say or think. Keep the change as small as does the job, and in the story's voice. A scene wrong at its core (it misses the card's goal, or the brief, or is built on a mistake) can be written again with rewrite_scene and a clear direction.
- Wrong (the check or the critic misread it): call not_a_problem with your reason, quoting the words of the scene or the memory that show it ("..." in your reason). Use it only when you can show it.
- Craft notes from the critic are real unless following them would break the memory, the card or the voice: then explain with not_a_problem.
- When every finding is fixed or answered, you may call check_again to have the checks and the critic read the scene again, then deal with anything new. Then call done with a short summary.

${RULES}

Never tell the author to do anything: you make the changes.`
}

export function proofreadSystem(): string {
  return `${CHAPTER_MARKER} proofread
You are a careful proofreader of a novel. Proofread one scene: spelling (in the author's spelling, UK or US as the style guide says), grammar, punctuation, a word left out or doubled, a sentence that doesn't parse, the wrong tense or point of view for a moment, a name spelt two ways, the same word or phrase used twice close together, and any common AI phrase listed below. Fix each with revise, the smallest change that does it. Don't rewrite style, don't change meaning, don't touch what is right. When the scene is clean, call done.

The scene's words are below, each paragraph numbered.`
}

// ---------- The tools of its own ----------

export const WRITE_BRIEF: ToolSpec = {
  name: 'write_brief',
  description:
    'Write the brief the chapter is written to, once, when you have studied the chapter. `overview`: a few lines on the chapter. `scenes`: one item per scene, in order, with its notes for the writer (facts to keep to with where they come from, who knows what, where everyone and everything starts, when it happens, threads to touch, traps to avoid). `questions`: anything in the scene cards that doesn\'t fit the memory, for the author.',
  parameters: {
    type: 'object',
    properties: {
      overview: str,
      scenes: {
        type: 'array',
        items: { type: 'object', properties: { scene: sceneArg, notes: str }, required: ['scene', 'notes'] }
      },
      questions: { type: 'array', items: str }
    },
    required: ['overview', 'scenes']
  }
}

export const TIMELINE: ToolSpec = {
  name: 'timeline',
  description:
    "The canon timeline before a scene: what has already happened in the story, oldest first, with when, where and who was there, and deaths, departures and things changing hands marked. Left out: the scene you are working on.",
  parameters: { type: 'object', properties: { scene: sceneArg } }
}

export const CHAPTER_BRIEF: ToolSpec = {
  name: 'chapter_brief',
  description: "The brief the chapter was written to: what each scene must keep to, from the study done before it was written.",
  parameters: { type: 'object', properties: {} }
}

export const REVISE: ToolSpec = {
  name: 'revise',
  description: `Change a passage of a scene, straight away: the passage from its \`start\` words to its \`end\` words (copied exactly from read_scene, without the [n] numbers; a few words each, enough to be found once) becomes \`new_words\`. To change a single sentence, start and end inside it. \`new_words\` is the whole new passage (paragraphs a blank line apart, *asterisks* for italics), at most about ${MAX_REVISE_WORDS} words: split a longer change into several. \`fixes\`: the ids of the findings it fixes (F1...). \`why\`: a few plain words.`,
  parameters: {
    type: 'object',
    properties: {
      scene: sceneArg,
      start: str,
      end: str,
      new_words: str,
      fixes: { type: 'array', items: str },
      why: str
    },
    required: ['scene', 'start', 'end', 'new_words', 'why']
  }
}

export const REWRITE_SCENE: ToolSpec = {
  name: 'rewrite_scene',
  description:
    'Have the writer write a scene again from its card, the brief and the memory, with your `direction` (what must be different, and why). Only for a scene wrong at its core: for anything smaller, use revise. `fixes`: the findings it is for.',
  parameters: { type: 'object', properties: { scene: sceneArg, direction: str, fixes: { type: 'array', items: str } }, required: ['scene', 'direction'] }
}

export const NOT_A_PROBLEM = {
  name: 'not_a_problem',
  description:
    'Set a finding aside as not a real problem, with your reason. The reason must quote, in "double quotes", the words of the scene or the memory that show it is wrong. The author sees every finding set aside, with your reason.',
  parameters: { type: 'object', properties: { finding: { type: 'string', description: 'Its id: "F3".' }, why: str }, required: ['finding', 'why'] }
} satisfies ToolSpec

export const CHECK_AGAIN: ToolSpec = {
  name: 'check_again',
  description:
    "Have the consistency checks and the critic read a scene again now (after your changes), and list what they find. Each new finding gets a new id.",
  parameters: { type: 'object', properties: { scene: sceneArg } }
}

export const DONE: ToolSpec = {
  name: 'done',
  description: 'Finish: every finding is fixed or set aside. `summary`: two or three sentences on what you changed.',
  parameters: { type: 'object', properties: { summary: str }, required: ['summary'] }
}

/** The tools of its own each job offers (beside the look-ups, which study and review get). */
export function ownTools(job: ChapterJob): ToolSpec[] {
  switch (job) {
    case 'study':
      return [TIMELINE, WRITE_BRIEF]
    case 'review':
    case 'chapter':
      return [TIMELINE, CHAPTER_BRIEF, REVISE, REWRITE_SCENE, NOT_A_PROBLEM, CHECK_AGAIN, DONE]
    case 'proofread':
      return [REVISE, DONE]
  }
}

/** Said before the last request of a session, which has no tools. */
export const LAST_WORDS = '[AI Write] No more tools in this session. In two or three sentences, say what you changed and anything left.'

/** Sent back when the agent answers in words instead of using its tools. */
export function nudgeFor(job: ChapterJob): string {
  if (job === 'study') return '[AI Write] Use the tools: look up what you need, then call write_brief. Nothing is kept until write_brief is called.'
  if (job === 'proofread') return '[AI Write] Use the tools: fix each slip with revise, then call done. Words written here change nothing.'
  return '[AI Write] Use the tools: fix each finding with revise (naming it in `fixes`) or set it aside with not_a_problem, then call done. Words written here change nothing.'
}
