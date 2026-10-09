// The words Ask the world shows: its example questions, when a chat was last asked in, where answers
// are from, how an answer ended, and what saving a note did. Pure, so it is unit-tested.
import type { SavedNote } from '@shared/contracts/ask'
import { formatCost } from '@/features/generate/format'

/**
 * The spec's examples, with the open world's own characters in them (`people`: the open scene's point of view and
 * cast first, then the world's other characters), never names from somewhere else. With no characters yet they
 * speak of "my main character". Clicking one puts it in the box, to change or ask as it is.
 */
export function examples(people: string[]): string[] {
  const [a, b, c] = people.map((p) => p.trim()).filter((p, i, all) => p !== '' && all.indexOf(p) === i)
  return [
    a ? `What would ${a} do if ${b ?? 'a friend'} lied?` : 'What would my main character do if a friend lied?',
    `Did I already say how old ${c ?? b ?? a ?? 'my main character'} is?`,
    'Fix the spelling and grammar in this scene',
    'Tighten the opening paragraph, keeping my voice'
  ]
}

/**
 * The examples with no one named (the starter cards' fallback when the open scene has no cast, features/ask/answerView.ts):
 * never names that aren't in Adam's world (Phase 0).
 */
export const EXAMPLES: readonly string[] = examples([])

/** When a chat was last asked in, short enough for a list: "14:05", "Yesterday", "3 Oct", "3 Oct 2025". */
export function chatWhen(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  const now = new Date(nowMs)
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(nowMs)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(
    undefined,
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }
  )
}

/**
 * Where answers are from, under the box: the open scene ("As of Book 1, Ch 2, Sc 3"), the end of the
 * open story when no scene is open, or the world as it was set up when no story is.
 */
export function asOfText(o: { sceneLabel: string | null; storyTitle: string | null; hasScene: boolean }): string {
  if (o.hasScene) return o.sceneLabel ? `As of ${o.sceneLabel}` : 'As of this scene'
  if (o.storyTitle) return `As of the end of ${o.storyTitle}`
  return 'Your world as it was set up'
}

/**
 * The longer explanation, for its tooltip. With a scene open it also says why the chip has no ✕ (chat Phase 4): the
 * open scene decides what the chat may know and which words an edit is about, so taking it off for one question
 * would let later events into the answer and leave an edit without its scene.
 */
export function asOfHint(o: { hasScene: boolean; storyTitle: string | null }): string {
  if (o.hasScene)
    return 'Answers come from your world as it stands at the open scene. Nothing later in the story is known. This can’t be taken off for a question: it keeps later events out of the answer, and tells an edit which scene it’s for.'
  if (o.storyTitle) return `Answers come from your world as it stands at the end of ${o.storyTitle} as written so far.`
  return 'No story is open, so answers come from your world as it was set up, before any story.'
}

/**
 * The quiet words after "What the AI saw" under an answer: how it ended, and what it cost ("Stopped",
 * "about $0.002"). They come once the answer has ended, after the link, so the link never moves.
 */
export function answerNote(t: { status: string; cutOff: boolean; cost: number | null; costEstimated: boolean; answer: string }): string[] {
  const parts: string[] = []
  if (t.status === 'stopped') parts.push('Stopped')
  else if (t.status === 'error' && t.answer.trim()) parts.push('Didn’t finish')
  else if (t.status === 'complete' && t.cutOff) parts.push('Cut short')
  if (t.status !== 'streaming' && t.cost != null) parts.push(`${t.costEstimated ? 'about ' : ''}${formatCost(t.cost)}`)
  return parts
}

/** Before "What the AI saw", for a question the AI was asked that got no answer, once the notice saying why has gone. */
export const NO_ANSWER = 'Didn’t get an answer'

/** What the toast says once a note is saved. */
export function savedMessage(note: Pick<SavedNote, 'name' | 'created' | 'onlyIn' | 'asOf'>): string {
  if (note.created) return `Saved to your lore as “${note.name}”${note.onlyIn ? `, in ${note.onlyIn} only` : ''}.`
  if (note.asOf) return `Saved to memory for ${note.name}, as of ${note.asOf}.`
  if (note.onlyIn) return `Saved to memory for ${note.name}, in ${note.onlyIn} only.`
  return `Saved to memory for ${note.name}, as your own note.`
}

/** Said under an answer that talks of changes to apply when none came with it (the model claimed what it didn't do). */
export const NO_CHANGES_CAME = 'No changes came with this answer, so there’s nothing to apply. Ask again to have them proposed.'

/** True when an answer clearly says it made or proposed changes (shared/askChanges.ts): "apply pressure" doesn't count. */
export { claimsChanges as speaksOfChanges } from '@shared/askChanges'

/**
 * What to ask next, under the last answer on the desk: up to three questions about the pages it named (the people first,
 * then a place, then what comes next). Clicking one puts it in the box, to change or ask as it is.
 */
export function followUps(cited: { kind: string; name: string }[]): string[] {
  const out: string[] = []
  const people = cited.filter((t) => t.kind === 'character')
  const place = cited.find((t) => t.kind === 'place')
  if (people[0]) out.push(`What does ${people[0].name} want most right now?`)
  if (people[1]) out.push(`How does ${people[1].name} feel about ${people[0].name}?`)
  if (place) out.push(`What could happen at ${place.name} next?`)
  if (out.length < 3 && people[0] && !people[1]) out.push(`What is ${people[0].name} hiding?`)
  if (out.length < 3) out.push('What could go wrong next?')
  return out.slice(0, 3)
}
