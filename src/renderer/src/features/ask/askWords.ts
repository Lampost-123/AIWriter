// The words Ask the world shows: its example questions, when a chat was last asked in, where answers
// are from, how an answer ended, and what saving a note did. Pure, so it is unit-tested.
import type { SavedNote } from '@shared/contracts/ask'
import { formatCost } from '@/features/generate/format'

/** The spec's examples: clicking one puts it in the box, to change or ask as it is. */
export const EXAMPLES = [
  'What would Mara do if Tobin lied to her?',
  'Give me ten tavern names that fit the north',
  'Did I already say how old the Duke is?'
]

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

/** The longer explanation, for its tooltip. */
export function asOfHint(o: { hasScene: boolean; storyTitle: string | null }): string {
  if (o.hasScene) return 'Answers come from your world as it stands at the open scene. Nothing later in the story is known.'
  if (o.storyTitle) return `Answers come from your world as it stands at the end of ${o.storyTitle} as written so far.`
  return 'No story is open, so answers come from your world as it was set up, before any story.'
}

/** The quiet line under an answer: how it ended, and what it cost ("Stopped · $0.002"). */
export function answerNote(t: { status: string; cutOff: boolean; cost: number | null; costEstimated: boolean; answer: string }): string[] {
  const parts: string[] = []
  if (t.status === 'stopped') parts.push('Stopped')
  else if (t.status === 'error' && t.answer.trim()) parts.push('Didn’t finish')
  else if (t.status === 'complete' && t.cutOff) parts.push('Cut short')
  if (t.status !== 'streaming' && t.cost != null) parts.push(`${t.costEstimated ? 'about ' : ''}${formatCost(t.cost)}`)
  return parts
}

/** What the toast says once a note is saved. */
export function savedMessage(note: Pick<SavedNote, 'name' | 'created' | 'onlyIn'>): string {
  if (note.created) return `Saved to your lore as “${note.name}”.`
  if (note.onlyIn) return `Saved to memory for ${note.name}, in ${note.onlyIn} only.`
  return `Saved to memory for ${note.name}, as your own note.`
}
