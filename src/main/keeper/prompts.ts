// What the memory model is told: reading a scene's changed paragraphs (keep / update / remove the
// facts whose words changed, add new facts, report clashes with the memory) and writing summaries.
// Since 0.6.29 (story memory step 5) it also picks up what was said: promises, threats and secrets told, with the line
// itself and who heard it ("said" items, kept as facts the speaker and hearers know: keeper/apply.ts).
// Since 2026-10-07 it is told that a thing someone has or wants is an item, never a character (keeper/kinds.ts checks).
// Since 2026-10-08 (the AI manages plot threads) it opens a plot thread with its promise, adds clues, notes when one
// moves on, and resolves one only when the payoff is on the page (keeper/threads.ts applies these).
// Since 2026-10-08 (World Memory Overhaul A2) it may revise an entry's or event's one-line summary ("summary" items), and
// the facts whose words changed are told apart from the "nothing the memory already says" rule.
// The markers let the fake provider in tests/fake-provider recognise these requests.

import { FIELD_GROUPS } from '@shared/fields'
import type { EntryKind } from '@shared/types'

/** In every reading request's system prompt (the fake provider answers these with memory JSON). */
export const READING_MARKER = '[AIWRITE-MEMORY-KEEPER v1]'
/** In every summary request's system prompt. */
export const SUMMARY_MARKER = '[AIWRITE-MEMORY-SUMMARY v1]'

/** Field keys the memory model may set, by kind (sample lines come in as voice lines instead). */
export function fieldKeys(kind: EntryKind): string[] {
  return (FIELD_GROUPS[kind] ?? []).flatMap((g) => g.fields.map((f) => f.key)).filter((k) => k !== 'sampleLines')
}

const keysLine = (kind: EntryKind, label: string): string => `${label}: ${fieldKeys(kind).join(', ')}.`

/** The reading instructions. Stable, so providers that cache repeated prompts can reuse them. */
export const READING_SYSTEM = `${READING_MARKER}
You keep the memory of a novel's world up to date while the author writes. You are given what the memory holds at this point in the story, the facts already read from this scene, and the paragraphs of the scene that are new or changed. Reply with one JSON object and nothing else.

Rules
- Read only the paragraphs labelled P1, P2 and so on. Lines labelled "Context" are there to help you understand them; take nothing from them.
- Report only what the words show happens, is said to be true, or becomes true. No guesses, no reading between the lines, and nothing the memory already says, in any words (facts whose words changed excepted).
- Every fact needs "quote": words copied exactly, character for character, from one P paragraph: the shortest phrase or sentence that shows it.
- Refer to entries by their ids (E1, E2 ...). If someone or something is listed under "Elsewhere in the world", use that id: never make a new entry with a name or alias already listed. A new entry you add can be referred to in later items by the "ref" you give it (N1, N2 ...).
- A new entry's "kind": a character is a person, or an animal or creature in the story in its own right (a horse, a dog). A thing someone has, wants, carries, gives, buys or makes (a bead, a letter, a sword, a cart) is an item, however much it matters to them, and gets item fields. Give a new entry only fields the words show.
- Changes are what is now different: injuries, possessions, looks, where someone is, goals, someone's death. Write a "note" as a short phrase without the name, such as "lost her left hand" or "now carries the Duke's seal". When a change ends what one of their fields says (a bandage off for good, a hat lost), give that field's new value in the change's "fields" too, without it.
- Details are facts about an entry that don't change in the scene (a newcomer's eye colour, what a place smells like).
- What was said that later scenes must keep to: a promise or vow, a threat or warning of harm, or a secret told. Give each as a "said" item: who says it, everyone in the scene who hears it, and the spoken line itself as the quote, copied exactly. A secret told is something the hearers now know: give it as "said" only, not also as "knows".
- Plot threads: a promise, mystery, threat, goal, debt or secret the story must answer. "open" when the words set one up, with its "promise" (what the reader waits on); "clue" for a new hint; "developing" with a note when it moves on; "resolved" only when the payoff itself is on the page, never for a hint or a plan.
- Facts under "Facts whose words changed" need a verdict each: "keep" (the scene still says it; give the words that now show it), "update" (it now says something else; give the new value and words) or "remove" (the scene no longer says it).
- Don't repeat facts listed under "Facts from this scene".
- If the scene contradicts the memory without it happening in the story (a different eye colour, a dead character walking about), put it under "clashes" rather than changing anything. A clash is only something that can't be true alongside what the memory says. A detail the memory doesn't have, a fuller or vaguer description, or the same thing in other words ("redder" for "red", "about twelve" for "12") is never a clash.

Reply with:
{"facts": [verdicts], "add": [new facts], "clashes": [clashes]}

Verdicts:
{"id": "F1", "do": "keep", "quote": "..."}
{"id": "F2", "do": "update", "quote": "...", and the fields of its type below with the new value}
{"id": "F3", "do": "remove"}

New facts, by "type":
{"type": "entry", "ref": "N1", "kind": "character|place|group|item|lore|glossary", "name": "...", "aliases": ["..."], "summary": "one line", "fields": {"key": "value"}, "quote": "..."}
{"type": "change", "entry": "E1", "note": "lost her left hand", "fields": {"marks": "left hand missing"}, "quote": "..."}
{"type": "detail", "entry": "E1", "field": "eyes", "value": "grey", "quote": "..."}
{"type": "relationship", "entry": "E1", "other": "E2", "rel": "sister, rival, holds, member of...", "feels": "how E1 feels about E2", "otherFeels": "how E2 feels about E1", "ended": false, "quote": "..."}
{"type": "knows", "entry": "E2", "fact": "Mara is the heir", "factId": "K1 when it is a fact listed under Facts", "forgets": false, "quote": "..."}
{"type": "said", "kind": "promise|threat|secret", "entry": "E1 (who says it)", "heard": ["E2", "E3"], "fact": "what it amounts to, in a few words: Mara will come back for Tobin before the snow", "factId": "K1 when it is a fact listed under Facts", "quote": "the spoken line, copied exactly"}
{"type": "thread", "entry": "E5 (an open plot thread), or leave it out and give a name", "name": "the question or promise", "status": "open|clue|developing|resolved", "promise": "for open", "clue": "for clue", "note": "...", "quote": "..."}
{"type": "event", "name": "...", "summary": "what happened, in one line", "involved": ["E1", "E2"], "quote": "..."}
{"type": "summary", "entry": "E3", "summary": "a new one-line summary, when the scene now tells it otherwise", "quote": "..."}
{"type": "voice", "entry": "E1", "quote": "a line of their dialogue that is especially typical of how they speak"}

Clashes:
{"entry": "E1", "about": "eyes", "memory": "blue", "text": "green", "quote": "..."}

Field keys. ${keysLine('character', 'Characters')} ${keysLine('item', 'Items')} ${keysLine('place', 'Places')} ${keysLine('lore', 'Lore')} Any kind: summary, description.

If there is nothing to report, reply {"facts": [], "add": [], "clashes": []}.`

/** Said when a reply couldn't be read, before asking once more. */
export const retryMessage = (why: string): string =>
  `Your reply couldn't be used: ${why}. Reply again with only the JSON object, in exactly the format given, with every quote copied exactly from a P paragraph.`

// ---------- Summaries ----------

export const SUMMARY_SYSTEM = `${SUMMARY_MARKER}
You write short summaries of a novel's scenes, chapters and books, for the author's own notes and for the AI that drafts the next scenes. Write plain prose in the past tense and the third person, naming who does what. Say what happens and what changes, especially what later scenes depend on: who learns what, injuries, decisions, where people end up, promises made and questions left open. No headings, no lists, no comments on the writing, no quotes longer than a few words. Reply with the summary only.`

export type SummaryAsk =
  | { level: 'scene'; where: string; title: string; text: string; words: number }
  | { level: 'scene-part'; where: string; title: string; part: number; parts: number; text: string }
  | { level: 'scene-parts'; where: string; title: string; summaries: string[]; words: number }
  | { level: 'chapter'; where: string; title: string; summaries: { label: string; text: string }[] }
  | { level: 'story'; title: string; summaries: { label: string; text: string }[] }
  | { level: 'series'; name: string; summaries: { label: string; text: string }[] }

/** How long a scene summary should be: 100 to 250 words, less for a short scene. */
export function sceneSummaryLength(words: number): string {
  if (words < 300) return 'in two or three sentences'
  if (words < 900) return 'in about 100 words'
  return 'in 100 to 250 words'
}

export function summaryPrompt(a: SummaryAsk): string {
  const list = (items: { label: string; text: string }[]): string => items.map((s) => `${s.label}: ${s.text}`).join('\n\n')
  switch (a.level) {
    case 'scene':
      return `Summarise this scene ${sceneSummaryLength(a.words)}.\n\nScene: ${a.where}${a.title ? ` "${a.title}"` : ''}\n\n${a.text}`
    case 'scene-part':
      return `This is part ${a.part} of ${a.parts} of a long scene (${a.where}${a.title ? ` "${a.title}"` : ''}). Summarise this part in about 80 words.\n\n${a.text}`
    case 'scene-parts':
      return `These summarise the parts of one scene, in order (${a.where}${a.title ? ` "${a.title}"` : ''}). Join them into one summary of the scene ${sceneSummaryLength(a.words)}.\n\n${a.summaries.map((s, i) => `Part ${i + 1}: ${s}`).join('\n\n')}`
    case 'chapter':
      return `Summarise this chapter (${a.where}${a.title ? `, "${a.title}"` : ''}) from its scene summaries, in 100 to 250 words.\n\n${list(a.summaries)}`
    case 'story':
      return `Summarise the story "${a.title}" from its chapter summaries, in one paragraph of 150 to 300 words.\n\n${list(a.summaries)}`
    case 'series':
      return `Summarise the series "${a.name}" from the summaries of its books, in one paragraph of 150 to 300 words.\n\n${list(a.summaries)}`
  }
}

/** Tidies a summary reply: no "Summary:" label, no wrapping quotes, one paragraph, at most `maxWords` words. */
export function cleanSummary(reply: string, maxWords = 320): string {
  let t = reply.trim()
  t = t.replace(/^```[a-z]*\s*|```$/g, '').trim()
  t = t.replace(/^(here(?:'s| is) (?:the|a|my) summary[^:\n]*:|summary\s*:)\s*/i, '').trim()
  if (/^["“].*["”]$/s.test(t)) t = t.slice(1, -1).trim()
  t = t.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ')
  const ws = t.split(' ')
  if (ws.length > maxWords) {
    const cut = ws.slice(0, maxWords).join(' ')
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.'))
    t = end > cut.length / 2 ? cut.slice(0, end + 1) : `${cut}…`
  }
  return t
}
