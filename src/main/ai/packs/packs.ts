// The instruction packs' words (overhaul phase 2, "instruction packs"): each job's detailed instructions, said once,
// from the app's own prompts and rules (no new rules): the writer's craft rules (ai/prompts.ts), the rules against AI
// phrasing (shared/slop.ts), the consistency checks' own words (checks/prompts.ts), the scene and chapter planners'
// rules (plan/plan.ts, chapterWriter/prompts.ts), the targeted fix's (chapterWriter/prompts.ts) and how the memory works
// (docs/ARCHITECTURE.md, in Adam's words). An agent is told each pack's name and one line always (index.ts packList),
// and loads a pack's text with load_instructions only when it does that job. Pure.

import { SLOP_RULES } from '@shared/slop'
import { craftRules, SPOKEN_LINE } from '../prompts'
import { CHECK_WHAT } from '../../checks/prompts'

/** One instruction pack. */
export interface InstructionPack {
  /** Its name, as load_instructions takes it: "plan-a-scene". */
  name: string
  /** A few words, in the list every request carries: the job it is for ("writing or rewriting dialogue"). */
  description: string
  /** What it is for, in plain words, for the tool's row in the window ("Read the instructions for planning a scene"). */
  title: string
  /** The full instructions. */
  text: string
}

const lines = (xs: readonly string[]): string => xs.map((x) => (x.startsWith('- ') ? x : `- ${x}`)).join('\n')

/** The planners' rules (chapterWriter/prompts.ts planSystem, plan/plan.ts SYSTEM), said once. */
const STORY_TRUTH = [
  'The story so far and the author’s cards are the truth. Never invent events, people or facts they don’t give.',
  'A character knows only what they know by then. What is kept from someone stays kept: never have them learn, guess or be told it unless the card says so.',
  'The dead stay dead. Things are where they were last left. Time moves forward.',
  'Nothing that has already happened is planned or written again.'
]

const PLAN_A_SCENE: InstructionPack = {
  name: 'plan-a-scene',
  title: 'planning a scene',
  description: 'planning scenes or chapters: cards, beats, new scenes, chapter cards, plot threads.',
  text: `Planning a scene or a chapter
- A scene card says what the point-of-view character wants here (goal), what stands in the way (conflict) and how it turns by the end (outcome), one short sentence each. Its beats say what happens, in order, one short sentence each: what the author asked for made concrete, with the moves it needs.
- Each scene starts where the one before it ends: where each person is, what they wear and hold, how they are, what they know. Look these up (state_of, where_is, who_knows, last_seen, timeline) rather than guess.
- Plan only what is asked, with the moves it needs: no events of your own. Tension comes from what the characters want and how they push against each other within those events, not from new ones.
- Open plot threads stay open: plan no payoff for one unless the card or the author asks for it. One may come in only where it fits what is asked.
- A chapter's scenes must fit together: say what each scene must do in the chapter, the threads it moves on, and what changes for each person by its end (where they end up, what they learn, what they gain or lose).
${lines(STORY_TRUTH)}
- Notes, not prose: a plan never writes the scene.`
}

const CHECK_CONTINUITY: InstructionPack = {
  name: 'check-continuity',
  title: 'checking continuity',
  description: 'checking words against the story so far (who is where with what, who knows what, when).',
  text: `Checking continuity
Check the words against the story so far as it stands at that point, using the look-ups (state_of for each person there, where_is for a thing, who_knows for a fact, last_seen for someone who comes back, timeline for dates), never your own guesses. What to look for:
- ${CHECK_WHAT.facts}
- ${CHECK_WHAT.knowledge}
- ${CHECK_WHAT.timeline}
- ${CHECK_WHAT.continuity}
How to report it
- Lead with the verdict (no slips found, or how many), then each slip: the words, what the story says instead, and where it says it (as "Ch 2, Sc 3").
- Only a real clash is a slip: something the record doesn't mention is not one by itself, and a character may be mistaken or lying when the words show it.
- Don't fix anything unasked; when asked, change only the words the slip is in.`
}

const FIX_A_SLIP: InstructionPack = {
  name: 'fix-a-slip',
  title: 'fixing a slip',
  description: 'fixing a slip the checks found, or a name or word wrong all through.',
  text: `Fixing a slip
- First decide which side is wrong: the words (fix the text) or the memory (it missed or misread something: set it to what the words say). Look up what is so at that point (state_of, where_is, who_knows, timeline) before you decide.
- Rewrite only the words the slip is in, in the book's own voice, keeping about the same length. Keep everything the problem doesn't touch: what happens, who says what, and every name, as written.
- The new words must fit between the text before and after them: carry on from the one, and lead into the other.
- Never add events, people or facts the scene card, the plan or the story so far don't give.
- A name or a word wrong all through (a misspelt name, a place renamed) is changed everywhere at once, not one place at a time.`
}

const WRITE_DIALOGUE: InstructionPack = {
  name: 'write-dialogue',
  title: 'writing dialogue',
  description: 'writing or rewriting dialogue.',
  text: `Writing dialogue
- Give each character their own voice, as their profile describes (get_entry gives how they speak: their voice notes, their tics, what they never say), with subtext: people rarely say exactly what they mean.
- Never reuse a sample line word for word, or any line already said in the story.
- Play a talk out moment by moment, in action and dialogue, slowing down at the turn; never summarise it or explain what it meant.
- Show feeling through what someone does or says, in fresh terms, never the body reactions any story would use.
- A character says only what they know by then (who_knows when in doubt).
- ${SPOKEN_LINE.replace(/^Speech\n/, '')}
- Keep the writer's voice, spelling and the way the book already sets out its dialogue (its tags and its punctuation).`
}

/**
 * The writer's craft rules with the rules against AI phrasing merged in, each meaning said once (ai/prompts.ts
 * craftRules), without the briefing's rule; and the ending rule of SLOP_RULES, for a passage that ends something.
 */
const VOICE_RULES = [
  ...craftRules({ aiPhrases: true, plain: true, end: false }).filter((r) => !r.startsWith('- Keep to the briefing')),
  ...SLOP_RULES.filter((r) => r.startsWith('End on'))
]

const REVISE_FOR_VOICE: InstructionPack = {
  name: 'revise-for-voice',
  title: 'revising for voice',
  description: 'revising, tightening or polishing prose in the book’s voice.',
  text: `Revising for voice
- Where the style guide or the sample passage asks for a style, follow it over these rules. Keep the writer's voice, style and spelling, and change only what was asked.
${lines(VOICE_RULES)}
- One passage per change, and only as much as needs changing: the writer's words that work stay as they are.`
}

const EXPLAIN_MEMORY: InstructionPack = {
  name: 'explain-memory',
  title: 'explaining the memory',
  description: 'explaining how AI Write’s memory works, and how to put it right.',
  text: `How AI Write's memory works (explain it in plain words: never name files, code or internal parts)
- The codex holds the world's entries: characters, places, groups, items, lore, events, plot threads and glossary words. Each entry says what it is; the memory adds what happens to it scene by scene, what each person knows, and the ties between people.
- Memory over time: everything is as of a point in the story. The chat answers as things stand at the open scene; a later scene is marked later, and nobody in the story knows its events yet. Another story's events count only where this story follows on from it.
- It keeps up by itself: when a scene's words change, the memory reads that scene again and notes what changed (who learned what, who was hurt, who has what, who died, where people went), and writes the summaries. A new draft always waits for the memory to catch up first.
- Where things stand: for each scene, where each person is, what they wear and carry, how they are placed and how they are. Recall shows it at the cursor or as the scene ends, and the writer can put it right there.
- The story index: a scene-by-scene record of who is where, with what, who knows what and which plot threads are open, built from the scene cards, the words and the memory with no AI call. The chat's look-ups (state_of, where_is, who_knows, last_seen, timeline) read it, so they cost nothing. "Fill in the whole story" reads older scenes for what people wear, carry and suffer.
- When the memory is wrong: correct the entry by hand, put where things stand right in Recall, or ask here and a change to the entry is proposed for the writer to apply. The checks find clashes between the words and the memory; each open issue is fixed in the words or in the memory.
- Pins: the writer can keep an entry out of a scene, a story or every scene (it is then never sent to the AI there), or always send it.
- The AI never changes the memory on its own here: every change is a proposal the writer applies, or not.`
}

/** Every pack, in the order they are listed. */
export const PACKS: readonly InstructionPack[] = [PLAN_A_SCENE, WRITE_DIALOGUE, REVISE_FOR_VOICE, FIX_A_SLIP, CHECK_CONTINUITY, EXPLAIN_MEMORY]
