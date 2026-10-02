// What the chat and brainstorm model is told for Ask the world: how to answer (from the memory, naming
// what it used as [[Entry name]], plainly saying when the memory is silent), then the briefing, then the
// conversation so far and the question. The system prompt's first line carries the marker and the job,
// so the fake provider in tests/fake-provider/m4/ask.mjs can recognise these requests. Pure.

import type { ChatMessage, StyleGuide } from '@shared/types'
import { instructionsText } from '../ai/prompts'

/** The first words of every Ask the world system prompt, followed by the job. */
export const ASK_MARKER = '[AIWRITE-ASK v1]'

/** The one job: answering a question in a chat. */
export const ASK_JOB = 'answer'

const INTRO = `You help a novelist think about the world of their book. They ask about their characters, places and story, check what they have already established, and brainstorm ideas. You answer from the memory of their world given below: what is true at the point in the story they are working on.

How to answer
- Answer the question directly, in plain words, as a thoughtful collaborator would. Keep it short unless asked for more: a few sentences, or a short list when asked for ideas or names.
- When you use something from the memory, put its name in double square brackets the first time you mention it, exactly as the memory writes the name: [[Mara Venn]]. Bracket only names the memory gives; never bracket anything else, and never invent a name in brackets.
- When asked whether something is already established (an age, a date, who knows what), answer yes or no first, then what the memory says and where, if it says. When the memory doesn't say, say so plainly: never pass off a guess as an established fact.
- When asked for ideas (names, what someone would do, what could happen), make them fit: the world's rules, its tone, its places, and what each character is like, wants and knows at this point. Offer a few distinct options rather than one, and say briefly why each fits.
- Ideas are suggestions until the author writes them: don't present anything you invent as something that has already happened in the story.
- Never contradict the memory or break the world's rules. Nothing after this point in the story is known; don't treat guesses about it as facts.
- Write plain text. For a list, use a simple numbered or dashed list. No headings, no bold, no tables.`

/**
 * Block 1: how to answer, with the style guide in effect (its spelling and limits matter for any lines
 * or names suggested). The sample passage is always trimmed, and the short form leaves it out.
 */
export function askInstructions(style: StyleGuide, short = false): string {
  const shown = short ? { ...style, samplePassage: '' } : style
  return instructionsText(shown, { intro: INTRO, trimSample: true })
}

/** One earlier question and the answer that came back. */
export interface PastTurn {
  question: string
  answer: string
}

/** The conversation so far as one text, for "What the AI saw" (the turns themselves are sent as messages). */
export function conversationText(turns: PastTurn[]): string {
  return turns
    .map((t) => `The author asked:\n${t.question.trim()}\n\nYou answered:\n${t.answer.trim() || '(No answer came back.)'}`)
    .join('\n\n')
}

/**
 * The messages: the marker, the instructions and the briefing as the system message, then the earlier
 * turns as they happened (a turn with no answer is left out), then the question.
 */
export function askMessages(system: string, turns: PastTurn[], question: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: `${ASK_MARKER} ${ASK_JOB}\n${system}` }]
  for (const t of turns) {
    if (!t.question.trim() || !t.answer.trim()) continue
    messages.push({ role: 'user', content: t.question.trim() }, { role: 'assistant', content: t.answer.trim() })
  }
  messages.push({ role: 'user', content: question.trim() })
  return messages
}
