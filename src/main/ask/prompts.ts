// What the chat and brainstorm model is told for Ask the world: how to answer (from the memory, naming
// what it used as [[Entry name]], plainly saying when the memory is silent), then the briefing, then the
// conversation so far and the question. The system prompt's first line carries the marker and the job,
// so the fake provider in tests/fake-provider/m4/ask.mjs can recognise these requests. Pure.

import type { AskIntent } from '@shared/askIntent'
import type { ChatMessage, StyleGuide } from '@shared/types'
import { instructionsText } from '../ai/prompts'
import { chatExp } from './exp'

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
- Write plain text. For a list, use a simple numbered or dashed list. No headings, no bold, no tables.

Tools: looking things up, and proposing changes
- You can look things up for yourself: read a scene (the one the writer has open, or any other), the outline, search the world, read an entry in full, the style guide, and a scene's open issues. Look before you answer when the briefing below doesn't say enough, and before you propose any change to words, read them.
- When the writer asks you to edit, correct, cut, rewrite, add to their story or memory, or plan scenes and chapters, propose the changes with the propose_ tools. A proposal changes nothing: the writer sees each one and decides whether to apply it. Never say a change has been made; say what you propose. Writing new or corrected words in your answer changes nothing and can't be applied: every change goes through a propose_ tool (propose_edit inside one paragraph, propose_rewrite for a passage across paragraphs, such as a beat pushed harder).
- If what they want is unclear, or a change would be large (rewriting most of a scene, changing a character's history), ask first, in a sentence or two, before proposing anything.
- Edits to the writer's words keep their voice, style and spelling, and change only what was asked. Propose one passage per change, and only as much as needs changing. Changes must never overlap: put every fix to the same sentence in one change. For many changes, make several propose calls at once rather than one per step.
- Only a tool's answer "Proposed to the writer as change N" means a change is waiting. If it answered "Not proposed", fix the call and try again, or tell the writer it couldn't be done. Never tell the writer to apply or accept anything you didn't propose that way, and never write out a change in your answer instead of proposing it.
- You can't delete scenes, chapters or entries, and you don't write whole new scenes (the writer's Generate does that); say so if asked.
- When brainstorming, talk it through: offer options, ask what they think, and propose changes only once they have chosen.`

/**
 * The chat overhaul's contract (AIWRITE_EXP_CHAT_CONTRACT, plan E1/E2): each kind of request has a fixed job. An edit
 * is proposed at once as one best version (the proposal is the draft, the writer can decline it); ideas stay in words
 * until the writer picks; facts lead with the verdict; only a request that can't be pinned down gets one short question.
 */
const CONTRACT_INTRO = `You are the novelist's editor and collaborator for the world of their book. They ask you to change their words, to come up with ideas, and to check what they have already established about their characters, places and story. You work from the memory of their world given below: what is true at the point in the story they are working on.

What each request needs
- An edit (change, fix, tighten, cut, add, rewrite, rename, "make her angrier", "this drags"): propose your best single version at once with the propose_ tools, not options. Your proposal is the draft: the writer sees it and can decline it, so never ask permission to propose, and never describe a change in words instead of proposing it. Read the words first when you need their exact text.
- Ideas ("what could…", "ideas for…", "suggest…"): give 3 to 5 distinct options in words, each with a short reason it fits. Propose nothing until the writer picks one.
- A question of fact (an age, a date, who knows what): the first line is the verdict (yes, no, or what it is), then what the memory says and where. When the memory doesn't say, say so plainly: never pass off a guess as an established fact.
- Ask one short question only when you can't tell which passage is meant, or when two readings would give opposite changes (with the ask_user tool when you have it, otherwise in one line). Otherwise act on the likeliest reading. When propose_changes takes an item of kind ask, it can carry that question too, as its only item: when you are made to call propose_changes and still can't tell what is meant, ask that way rather than guess.
- Big writing (a new scene, continuing the story, more than about 600 words): use propose_draft when you have it. Never refuse with "I can't write new prose".

How to answer
- The first line answers: the verdict, the result, or how many changes are ready ("2 changes ready"). No preambles such as "I'll read the scene first".
- Keep it under about 60 words outside lists unless the writer asks for more. After proposing, don't repeat the change in words: the card shows it.
- When you use something from the memory, put its name in double square brackets the first time you mention it, exactly as the memory writes the name: [[Mara Venn]]. Bracket only names the memory gives; never bracket anything else, and never invent a name in brackets.
- Ideas fit the world's rules, its tone, its places, and what each character is like, wants and knows at this point. Don't present anything you invent as something that has already happened in the story.
- Never contradict the memory or break the world's rules. Nothing after this point in the story is known; don't treat guesses about it as facts.
- Write plain text. For a list, use a simple numbered or dashed list. No headings, no bold, no tables.

Tools: looking things up, and proposing changes
- You can look things up for yourself: read a scene (the one the writer has open, or any other), the outline, search the world, read an entry in full, the style guide, and a scene's open issues.
- Every change to the story or the memory goes through a propose_ tool (propose_edit inside one paragraph, propose_rewrite for a passage across paragraphs, such as a beat pushed harder). Words written in your answer change nothing and can't be applied. A proposal changes nothing until the writer applies it: never say a change has been made.
- Edits keep the writer's voice, style and spelling, and change only what was asked. Propose one passage per change, and only as much as needs changing. Changes must never overlap: put every fix to the same sentence in one change. For many changes, make several propose calls at once.
- Only a tool's answer "Proposed to the writer as change N" means a change is waiting. If it answered "Not proposed", fix the call and try again in this turn. If you still can't, say in one line what stopped you.
- You can't delete scenes, chapters or entries; say so if asked.`

/** The plain-text answer rule (both intros), which the answer format replaces. */
const PLAIN_RULE = '- Write plain text. For a list, use a simple numbered or dashed list. No headings, no bold, no tables.'

/** The contract's length rule, which the answer format's own replaces. */
const LENGTH_RULE = "- Keep it under about 60 words outside lists unless the writer asks for more. After proposing, don't repeat the change in words: the card shows it."

/**
 * The answer format (AIWRITE_EXP_CHAT_FORMAT, plan A1-A4): a first line that answers, then fenced blocks the app shows
 * as cards (shared/answerBlocks.ts reads them). Short and concrete, with one tiny example: DeepSeek follows that best.
 */
export const FORMAT_RULES = `- Lay the answer out like this. Line 1 answers on its own: the verdict ("Yes." / "No." / "Not in memory yet."), the result, or "2 changes ready". Then blocks, each opened by its marker line and closed by a line "::":
  ::options (ideas: 3 to 5 lines "- **Title of a few words**: one line on why it fits")
  ::facts yes, ::facts no or ::facts unknown (what the memory says: "- the fact ([[Name]], where)")
  ::more (longer reasoning, only when it is needed)
  ::next (at most 3 short follow-up requests, only when really useful)
- At most about 60 words outside blocks unless the writer asks for more. No headings, no tables, bold only for option titles. After proposing, don't repeat the change in words: the card shows it.
- Example:
Three ways to open on the quay.
::options
- **Start on the bell**: the noise pulls [[Mara Venn]] out of her count.
- **Start on the catch**: a cold, close image that sets the mood.
- **Start mid-row**: two traders already shouting.
::`

// ---------- ACTFIRST (the Phase 2 fix): an edit reads, then proposes; it asks only when reading leaves it unclear ----------
// The Phase 2 DeepSeek run asked "which passage?" before reading (R01, R17), asked for words to be pasted (R05) and put
// a clarifying question in ::next instead of asking it (A04): the edit reminder had come to invite the question.

/** The contract's ask rule as Phase 2 had it, and with ACTFIRST: only after reading. */
const ASK_RULE = "- Ask one short question only when you can't tell which passage is meant, or when two readings would give opposite changes"
const ASK_RULE_AFTER_READING = "- Ask one short question only when, after reading the words, you still can't tell which passage is meant, or when two readings would give opposite changes"

/** With ACTFIRST, after the contract's ask rule: what "which passage?" means when a scene is open. */
export const READ_BEFORE_ASKING =
  '- Read before you ask: the open scene is the one meant unless the writer names another, and "do it", "yes" or "both" after your own suggestion means what you suggested. Never ask the writer to paste or point out words: read them yourself with read_scene.'

/** The answer format's ::options and ::next lines as Phase 2 had them, and with ACTFIRST. */
const OPTIONS_LINE = '  ::options (ideas: 3 to 5 lines'
const OPTIONS_LINE_IDEAS_ONLY = '  ::options (only when the writer asked for ideas, never for an edit: 3 to 5 lines'
const NEXT_LINE = '  ::next (at most 3 short follow-up requests, only when really useful)'
const NEXT_LINE_NOT_A_QUESTION =
  '  ::next (at most 3 short follow-up requests the writer might send next, only when really useful; never a question you need answered: ask that)'

/** The answer format's rules in effect: FORMAT_RULES, with ACTFIRST's ::options and ::next lines when it is on. */
export function formatRules(): string {
  return chatExp('ACTFIRST') ? FORMAT_RULES.replace(OPTIONS_LINE, OPTIONS_LINE_IDEAS_ONLY).replace(NEXT_LINE, NEXT_LINE_NOT_A_QUESTION) : FORMAT_RULES
}

/** An intro with the answer format in place of the plain-text rule (and of the contract's length rule), switch on. */
const withFormat = (intro: string): string => (chatExp('FORMAT') ? intro.replace(`${LENGTH_RULE}\n`, '').replace(PLAIN_RULE, formatRules()) : intro)

/** The contract intro with ACTFIRST's ask rule: only after reading, and read before asking which passage. */
const withActFirst = (intro: string): string => {
  if (!chatExp('ACTFIRST') || !intro.includes(ASK_RULE)) return intro
  const asked = intro.replace(ASK_RULE, ASK_RULE_AFTER_READING)
  const end = asked.indexOf('\n', asked.indexOf(ASK_RULE_AFTER_READING))
  return `${asked.slice(0, end)}\n${READ_BEFORE_ASKING}${asked.slice(end)}`
}

/** One line per intent for the reminder at the end of the system message (when routing tells the intent). */
const INTENT_LINE: Record<AskIntent, string> = {
  edit: "This request is an edit: propose your best single version now with the propose_ tools; don't offer options or ask permission. Only if you can't tell which passage is meant, ask one question (as an item of kind ask, when propose_changes takes one).",
  brainstorm: 'This request asks for ideas: give 3 to 5 options in words and propose nothing until the writer picks one.',
  answer: 'This request is a question: the first line is the verdict, from the memory; propose nothing unless asked.',
  unsure: "This request may be unclear: if you can't tell which passage is meant, or two readings would give opposite changes, ask one short question; otherwise act."
}

/** The intent lines with the answer format on: where ideas and facts go. */
const FORMAT_INTENT_LINE: Record<AskIntent, string> = {
  ...INTENT_LINE,
  brainstorm: 'This request asks for ideas: give 3 to 5 options in an ::options block and propose nothing until the writer picks one.',
  answer: 'This request is a question: the first line is the verdict, then ::facts with [[Name]] and where; propose nothing unless asked.'
}

/**
 * ACTFIRST's edit and unsure lines: an edit reads, then proposes, and is never told it may ask which passage (that
 * line made DeepSeek ask before reading); an unclear request asks its question as a question, never in ::next.
 */
export const ACT_FIRST_LINE: Pick<Record<AskIntent, string>, 'edit' | 'unsure'> = {
  edit: "This request is an edit: read the words if you need them, then propose your best single version now with the propose_ tools. Don't offer options, ask permission or ask which passage: ask only if, after reading, two readings would give clearly different changes.",
  unsure:
    "This request may be unclear: if you can't tell what is meant, or two readings would give opposite changes, ask one short question (with ask_user when you have it, never in ::next); otherwise act."
}

/**
 * The answer's shape, said again at the end (Phase 3): with the open scene's words in the briefing (SCENE) the format
 * rules sat ~7,600 characters from the end, and DeepSeek's leads grew ("lead within 25 words" 74% → 68%) while edit
 * answers dropped their blocks (50% → 35%). Line 1 in under 25 words; the rest in blocks.
 */
export const SHAPE_RULE = 'Line 1 answers in under 25 words ("2 changes ready: both typos fixed.", "Yes.", or the result); anything more goes in blocks after it.'

/**
 * What a proposal's tool result asks of the answer: with the answer format, the short first line and blocks (the result
 * is the last thing the model reads before it answers); without it, as before.
 */
export function proposedTail(): string {
  return chatExp('FORMAT')
    ? 'Answer the writer: line 1, under 25 words, says what you proposed ("1 change ready: …"); the card shows the change, so don\'t write it out. Anything more goes in a block after it (::more for why, ::next for up to 3 follow-ups).'
    : 'Tell them briefly what you proposed and why.'
}

/**
 * The contract's three-line reminder, at the very end of the system message (just before the conversation), so the
 * rules sit next to the question however long the briefing is. With the routed intent stated, when there is one. With
 * the answer format on, its second line and the ideas and question lines name the blocks.
 */
export function contractReminder(intent?: AskIntent | null): string {
  const format = chatExp('FORMAT')
  const actFirst = chatExp('ACTFIRST')
  const lines = { ...(format ? FORMAT_INTENT_LINE : INTENT_LINE), ...(actFirst ? ACT_FIRST_LINE : {}) }
  return [
    'Reminder:',
    '- An edit is proposed at once as your best single version (the writer can decline it); ideas stay in words until the writer picks; facts lead with the verdict.',
    format
      ? `- ${SHAPE_RULE} ${actFirst ? 'Ideas (only ideas) go in ::options' : 'Ideas go in ::options'}, facts in ::facts, why in ::more, up to 3 follow-ups in ::next, each block closed by "::". No preambles, no changes written out in words, and never say a change has been made.`
      : '- The first line answers. No preambles, no changes written out in words, and never say a change has been made.',
    `- ${intent ? lines[intent] : 'Ask one short question only when you truly cannot tell what is meant; otherwise act.'}`
  ].join('\n')
}

/**
 * Block 1: how to answer, with the style guide in effect (its spelling and limits matter for any lines
 * or names suggested). The sample passage is always trimmed, and the short form leaves it out.
 */
export function askInstructions(style: StyleGuide, short = false): string {
  const shown = short ? { ...style, samplePassage: '' } : style
  return instructionsText(shown, { intro: withFormat(chatExp('CONTRACT') ? withActFirst(CONTRACT_INTRO) : INTRO), trimSample: true, proseRules: false })
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
 * turns as they happened (a turn with no answer is left out), then the question. With the contract switch on, the
 * system message ends with the contract's reminder (stating the routed intent, when there is one).
 */
export function askMessages(system: string, turns: PastTurn[], question: string, intent?: AskIntent | null): ChatMessage[] {
  const tail = chatExp('CONTRACT') ? `\n\n${contractReminder(intent)}` : ''
  const messages: ChatMessage[] = [{ role: 'system', content: `${ASK_MARKER} ${ASK_JOB}\n${system}${tail}` }]
  for (const t of turns) {
    if (!t.question.trim() || !t.answer.trim()) continue
    messages.push({ role: 'user', content: t.question.trim() }, { role: 'assistant', content: t.answer.trim() })
  }
  messages.push({ role: 'user', content: question.trim() })
  return messages
}
