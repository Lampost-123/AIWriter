// What the writer model is told for the AI tools on selected words, and for Continue. Like the
// drafting instructions (ai/prompts.ts), these words decide the quality of what comes back, so they
// are kept here, in one place. Every system prompt starts with the marker line
// "[AIWRITE-EDIT v1] <tool>" (the fake provider in tests answers by it), then says what the job is
// and how to reply, then gives the style guide with Adam's preferences.

import type { EditTool, StyleGuide } from '@shared/types'
import { instructionsText } from '../ai/prompts'

export const EDIT_MARKER = '[AIWRITE-EDIT v1]'

/** How each version of Alternatives starts, on a line of its own. */
export const versionLine = (n: number): string => `=== Version ${n} ===`

/** About how many words Continue writes: a paragraph or two. */
export const CONTINUE_WORDS = { min: 120, max: 250 }

export interface PromptOptions {
  /** Rewrite: Adam's instruction. Change tone: the tone. */
  direction: string
  /** Continue: carry on the paragraph at the cursor, or start the next one. */
  continueAs: 'inline' | 'paragraph'
  /** Continue: there is text after the cursor to lead into. */
  hasAfter: boolean
}

const ROLE = `You are a skilled fiction editor working on a novel with its author. The author has selected some words in a scene and asked for one change to them.`

const REPLY = `How to reply
- Reply with only the new words that take the place of the selected ones: no title, no notes, no quotation marks around them, nothing before or after.
- Keep the paragraph breaks: separate paragraphs with a blank line, and keep the same number of paragraphs unless the change needs more or fewer.
- Write plain text. Wrap words in single *asterisks* for italics, as the author's text does; use no other formatting.
- The new words must fit seamlessly between the text before and after them: carry on the sentence that comes before, and lead into the one that comes after.
- Keep to the point of view, tense and spelling of the scene, and keep every name, title and spelling exactly as written.
- Keep what happens, and what each character knows, wants and says, unless the change asks for something different. Don't add new events or facts.
- Avoid clichés and stock phrases.`

/** What each tool asks for, in the system prompt. */
function task(tool: EditTool, o: PromptOptions): string {
  switch (tool) {
    case 'rewrite':
      return `The change: rewrite the selected words as the author asks:\n"""\n${o.direction}\n"""\nFollow the author's instruction closely, and keep everything it doesn't ask to change.`
    case 'expand':
      return `The change: expand the selected words to about one and a half to two times their length. Let the moment breathe: add sensory detail, action, the point-of-view character's thoughts and feelings, or a line of dialogue where it fits. Add no new plot events.`
    case 'condense':
      return `The change: condense the selected words to about half to two thirds of their length. Say the same thing in fewer words: cut repetition, filler and weak words, and merge sentences that cover the same ground. Keep every plot point, every line of dialogue that matters, and the voice.`
    case 'vivid':
      return `The change: make the selected words more vivid, at about the same length. Choose sharper, more concrete and sensory details, stronger verbs and precise nouns; show rather than tell. Keep what happens and keep the voice. Don't overwrite: no purple prose, no piled-up adjectives.`
    case 'tone':
      return `The change: give the selected words this tone: ${o.direction}. Shift the word choice, rhythm and detail so the passage reads that way, at about the same length. Keep what happens and who says what.`
    case 'voice':
      return `The change: fix the voice of the dialogue. Rewrite the words inside quotation marks so that each line sounds like the character who says it, as their voice profile describes: how they speak, their verbal tics, what they never say, and their sample lines (a guide to how they sound; don't copy them). The briefing says who says each line. Keep the narration, the speech tags and the actions exactly as they are, keep what each line means and the order of the lines, and leave any line whose speaker isn't known, or who has no voice profile, as it is.`
    case 'alternatives':
      return `The change: write three different versions of the selected words for the author to choose from. Each version must work in their place on its own and keep what happens. Make the three really differ in wording, rhythm and emphasis: for example, one close to the original but sharper, one bolder, one plainer.`
    case 'continue':
      return continueTask(o)
  }
}

function continueTask(o: PromptOptions): string {
  const where =
    o.continueAs === 'inline'
      ? "The text stops part-way through a paragraph: carry it on from exactly where it stops, starting mid-sentence if it stops mid-sentence. Don't repeat any of its words."
      : 'Start a new paragraph after the last one.'
  const after = o.hasAfter ? " The scene already has text after this point: lead into it, and don't repeat or contradict it." : ''
  return `The author wants the scene to carry on from where the text stops. Write the next part of the scene: about ${CONTINUE_WORDS.min} to ${CONTINUE_WORDS.max} words, a paragraph or two, following on naturally from the last words. ${where}${after} The scene card says where the scene is going; move towards its next beat at the scene's own pace rather than rushing through the rest of it.`
}

const CONTINUE_REPLY = `How to reply
- Reply with only the new words of the scene: no title, no notes, no quotation marks around them, nothing before or after.
- Separate paragraphs with a blank line. Write plain text, wrapping words in single *asterisks* for italics; use no other formatting.
- Match the voice, rhythm and level of detail of the text before, keep to its point of view, tense and spelling, and keep every name exactly as written.
- Never contradict the facts given about the characters and the scene. Don't end the scene or sum it up.
- Avoid clichés and stock phrases.`

const ALTERNATIVES_REPLY = `How to reply
- Start each version with a line of its own that reads exactly ${versionLine(1)}, ${versionLine(2)} and ${versionLine(3)}, then the version's words. Write nothing before the first of these lines and nothing after the third version: no notes or explanations.
- In each version, keep the paragraph breaks (a blank line between paragraphs). Write plain text, wrapping words in single *asterisks* for italics; use no other formatting, and no quotation marks around the version.
- Each version must fit seamlessly between the text before and after the selected words.
- Keep to the point of view, tense and spelling of the scene, and keep every name exactly as written. Don't add new events or facts.
- Avoid clichés and stock phrases.`

/** The system prompt: the marker line, the job, how to reply, and the style guide. */
export function systemPrompt(tool: EditTool, style: StyleGuide, o: PromptOptions): string {
  const reply = tool === 'continue' ? CONTINUE_REPLY : tool === 'alternatives' ? ALTERNATIVES_REPLY : REPLY
  const role = tool === 'continue' ? 'You are a skilled novelist writing a novel with its author.' : ROLE
  const guide = instructionsText(style, { intro: '', trimSample: true })
  return [`${EDIT_MARKER} ${tool}`, role, task(tool, o), reply, guide].filter(Boolean).join('\n\n')
}

/** The closing instruction, last in the briefing, so the model reads the job again just before it writes. */
export function finalAsk(tool: EditTool, o: PromptOptions): string {
  const only = 'Reply with only the new words that take the place of the selected ones.'
  switch (tool) {
    case 'rewrite':
      return `Rewrite the selected words as the author asked (“${oneLine(o.direction)}”). ${only}`
    case 'expand':
      return `Expand the selected words to about one and a half to two times their length. ${only}`
    case 'condense':
      return `Condense the selected words to about half to two thirds of their length. ${only}`
    case 'vivid':
      return `Make the selected words more vivid, at about the same length. ${only}`
    case 'tone':
      return `Give the selected words this tone: ${oneLine(o.direction)}. ${only}`
    case 'voice':
      return `Rewrite the dialogue in the selected words so each line sounds like the character who says it, leaving everything else as it is. ${only}`
    case 'alternatives':
      return `Write three versions of the selected words, each starting with its line (${versionLine(1)}, ${versionLine(2)}, ${versionLine(3)}). Nothing else.`
    case 'continue':
      return o.continueAs === 'inline'
        ? `Carry on from exactly where the text stops, for about ${CONTINUE_WORDS.min} to ${CONTINUE_WORDS.max} words. Reply with only the new words.`
        : `Write the next paragraph or two of the scene, about ${CONTINUE_WORDS.min} to ${CONTINUE_WORDS.max} words. Reply with only the new words.`
  }
}

/** Adam's words on one line, without a full stop at the end (the sentence around them has its own). */
const oneLine = (s: string): string =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,]+$/, '')
