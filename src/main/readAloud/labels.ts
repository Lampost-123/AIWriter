// "Show speakers and tone": the few words shown faintly above a paragraph, made from the clips reading aloud would
// play for it ("Mara · sharp, quickly", "Narrator"). Never part of the text. Pure, so it is tested on its own.
import type { PlannedClip } from '@shared/contracts/readAloud'
import { unmarkedIn } from './speakers'
import type { ParagraphMarks } from './types'

/** At most this many voices are named for one paragraph; the rest is "…". */
const MAX_PARTS = 3

/**
 * A paragraph's label from its clips, in reading order: each voice once, with how it is said when that is known.
 * Plain narration with nothing to say about it is left out beside a character's line, so "Mara · sharp" isn't
 * followed by "Narrator" for the dialogue tag.
 */
export function labelOf(clips: readonly Pick<PlannedClip, 'who' | 'how'>[]): string {
  const shown = labelParts(clips).map((p) => p.text)
  return shown.length > MAX_PARTS ? `${shown.slice(0, MAX_PARTS).join('; ')}; …` : shown.join('; ')
}

/** The parts a label names, in order, each with whose voice it is. */
function labelParts(clips: readonly Pick<PlannedClip, 'who' | 'how'>[]): { who: string; text: string }[] {
  const parts: { who: string; text: string }[] = []
  for (const c of clips) {
    const how = c.how.trim()
    const text = how ? `${c.who} · ${how}` : c.who
    if (!parts.some((p) => p.text === text)) parts.push({ who: c.who, text })
  }
  return parts.length > 1 ? parts.filter((p) => p.text !== 'Narrator') : parts
}

/** Who a paragraph's label (labelOf) starts with: the first voice it names, or null for none. */
export function labelSpeaker(clips: readonly Pick<PlannedClip, 'who' | 'how'>[]): string | null {
  return labelParts(clips)[0]?.who ?? null
}

/**
 * True when a paragraph's marks are all in: with Mark who says what, every line has its note (and every quote its
 * speaker); without it, the rules or the AI can say who speaks every quote (`unplaced`: the paragraph has quotes
 * nobody can place yet).
 */
export function markedEnough(text: string, marks: ParagraphMarks | undefined, o: { tone: boolean; unplaced: boolean }): boolean {
  if (o.tone) return !!marks && unmarkedIn(text, marks.speakers, marks.delivery).length === 0
  return !o.unplaced
}
