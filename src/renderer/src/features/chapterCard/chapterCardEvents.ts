// Chapter cards in the window: telling the open cards a chapter card changed what scene cards say, and the one Undo
// for a chapter card change ("Updated 3 scenes · Undo"). Changes made while that toast shows add to it, and its Undo
// puts the chapter card back as it was before the first of them, with every scene card it wrote into.
import type { ChapterCardSaved, ChapterCardUpdate } from '@shared/contracts/chapterCards'
import type { ChapterCard, ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui/Toast'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

export const scenesWord = (n: number): string => `${n} ${n === 1 ? 'scene' : 'scenes'}`

/** The chapter card forms on screen, so an Undo shows on the card at once. */
const liveCards = new Map<ID, (card: ChapterCard) => void>()

export function registerChapterCardForm(chapterId: ID, onRestored: (card: ChapterCard) => void): () => void {
  liveCards.set(chapterId, onRestored)
  return () => {
    if (liveCards.get(chapterId) === onRestored) liveCards.delete(chapterId)
  }
}

/** Scene cards changed because of a chapter card: the scene card on screen reloads what it follows, and the briefing too. */
export function notifyChapterCard(): void {
  useApp.getState().bumpChapterCards()
  useApp.getState().bumpBriefing()
}

interface Batch {
  toastId: number
  chapterId: ID
  /** The chapter card before the first change in the batch. */
  before: ChapterCard
  /** Each scene card changed, with its parts before the first change that touched it. */
  scenes: Map<ID, ChapterCardUpdate>
}

let batch: Batch | null = null

const live = (): Batch | null => {
  if (batch && !useToasts.getState().items.some((t) => t.id === batch!.toastId)) batch = null
  return batch
}

const messageFor = (n: number): string => `Updated ${scenesWord(n)} that follow this chapter card.`

/** After a chapter card is saved: "Updated 3 scenes" with Undo, when it changed any scene card. */
export function announceChapterCard(chapterId: ID, before: ChapterCard, saved: ChapterCardSaved): void {
  if (saved.updated.length) notifyChapterCard()
  const b = live()
  if (b && b.chapterId === chapterId) {
    for (const u of saved.updated) if (!b.scenes.has(u.sceneId)) b.scenes.set(u.sceneId, u)
    if (saved.updated.length) useToasts.getState().update(b.toastId, { message: messageFor(b.scenes.size) })
    return
  }
  if (!saved.updated.length) return
  const next: Batch = { toastId: 0, chapterId, before, scenes: new Map(saved.updated.map((u) => [u.sceneId, u])) }
  next.toastId = toast(messageFor(next.scenes.size), {
    action: {
      label: 'Undo',
      run: () => {
        if (batch === next) batch = null
        void undo(next)
      }
    }
  })
  batch = next
}

async function undo(b: Batch): Promise<void> {
  try {
    await api.restoreChapterCard(b.chapterId, b.before, [...b.scenes.values()])
  } catch (e) {
    toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })
    return
  }
  liveCards.get(b.chapterId)?.(b.before)
  notifyChapterCard()
}

/** The chapter card closed (its last change written): the next change, even to the same card, starts a new toast. */
export function endChapterCardBatch(chapterId: ID): void {
  if (batch?.chapterId === chapterId) batch = null
}

/** Opened from the keyboard (the chapter's menu): the card takes the keyboard once it shows. */
let focusNext = false
export const requestChapterCardFocus = (): void => {
  focusNext = true
}
/** Whether the card about to show should take the keyboard (asked once). */
export function takeChapterCardFocus(): boolean {
  const out = focusNext
  focusNext = false
  return out
}
