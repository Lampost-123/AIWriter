// The change box (2026-10-19, "Keep this, change that"): what Change it… is about and what Adam has said so far. It opens
// on the draft just written (JustWritten.tsx), on selected words (AiTools.tsx), on the AI's change waiting in the page
// (SuggestionLayer.tsx: Change it…, and Change again once a change has been made), and on a beat (BeatMarksLayer.tsx).
// In it he marks the sentences to keep word for word and says what to change; the passage then comes back revised as a
// tracked change of only what moved (session.ts changeWords and changeWaiting; for a beat, beats/redo.ts). The box itself
// is ChangeBox.tsx. Owned by the AI edits part.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { keepsIn } from '@shared/revise'
import { toast } from '@/components/ui'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { noteUsed } from '@/features/direction/store'
import { redoBeat } from '@/features/beats/redo'
import { changeWaiting, changeWords, markWords, waitingSuggestion } from './session'
import { textOf } from './text'

/** What Change it… works on. */
export type ChangeTarget =
  /** Words in the page: the draft just written, or selected words. */
  | { kind: 'words'; sceneId: ID; from: number; to: number; text: string; what: string }
  /** The AI's change waiting in the page (`again`: one made with Change it… already). */
  | { kind: 'change'; sceneId: ID; id: ID; text: string; what: string; again: boolean }
  /** A beat of Beat by beat on the page, written again with the version on the page sent. */
  | { kind: 'beat'; sceneId: ID; index: number; from: number; to: number; text: string; what: string }

export interface ChangeBoxState {
  target: ChangeTarget | null
  /** What Adam says to change. */
  note: string
  /** The sentences he marked Keep, each exactly as the passage has it, in its order. */
  keeps: string[]
  /** Goes up each time the box opens, so it starts afresh. */
  seq: number
}

export const useChangeBox = create<ChangeBoxState>(() => ({ target: null, note: '', keeps: [], seq: 0 }))

/** Words in the page this box is about (its target's range), to mark them softly while it is open. */
const rangeOf = (t: ChangeTarget): { from: number; to: number } | null => (t.kind === 'change' ? null : { from: t.from, to: t.to })

/**
 * Opens the box on `target`, with `note` and the sentences `keeps` already in it (Change again keeps those still there).
 * Says why instead when it can't be now (a draft being written; another change waiting, for words in the page).
 */
export function openChangeBox(target: ChangeTarget, o: { note?: string; keeps?: string[] } = {}): boolean {
  if (!target.text.trim()) return false
  const bridge = editorBridge()
  if (bridge?.busy()) {
    toast('A draft is being written into this scene. Wait for it to finish (or stop it), then try again.')
    return false
  }
  if (target.kind !== 'change' && waitingSuggestion()) {
    toast('Accept or reject the AI’s waiting change first.')
    return false
  }
  if (useApp.getState().view.kind !== 'write') useApp.getState().navigate({ kind: 'write' })
  useChangeBox.setState((s) => ({ target, note: o.note ?? '', keeps: keepsIn(target.text, o.keeps ?? []), seq: s.seq + 1 }))
  const range = rangeOf(target)
  markWords(range)
  return true
}

/** Closes the box (its words stay unmarked); `focusPage`: the keyboard goes back into the page. */
export function closeChangeBox(focusPage = true): void {
  if (!useChangeBox.getState().target) return
  useChangeBox.setState({ target: null })
  markWords(null)
  if (!focusPage) return
  const ed = editorBridge()?.editor
  if (ed && !ed.isDestroyed && useApp.getState().view.kind === 'write') ed.view.focus()
}

export const setChangeNote = (note: string): void => useChangeBox.setState({ note })

/** Marks a sentence Keep, or takes the mark off it. */
export function toggleKeep(sentence: string): void {
  const { target, keeps } = useChangeBox.getState()
  if (!target) return
  const on = keeps.includes(sentence)
  useChangeBox.setState({ keeps: on ? keeps.filter((k) => k !== sentence) : keepsIn(target.text, [...keeps, sentence]) })
}

export const clearKeeps = (): void => useChangeBox.setState({ keeps: [] })

/** True when the box can go ahead: a note (a beat can also be written again afresh, with no note). */
export function canSubmit(s: Pick<ChangeBoxState, 'target' | 'note' | 'keeps'>): boolean {
  if (!s.target) return false
  return !!s.note.trim() || s.target.kind === 'beat'
}

/** The box's main button: Change it, or (a beat with nothing said and nothing kept) Write it again. */
export const submitLabel = (s: Pick<ChangeBoxState, 'target' | 'note' | 'keeps'>): string =>
  s.target?.kind === 'beat' && !s.note.trim() && !s.keeps.length ? 'Write it again' : 'Change it'

/** Moves the box's words through a change to the page while it is open; null when the change was inside them. */
export function mapTarget(map: (pos: number, assoc: number) => number, edited: boolean): void {
  const t = useChangeBox.getState().target
  if (!t || t.kind === 'change') return
  if (edited) {
    useChangeBox.setState({ target: null })
    markWords(null)
    toast('The words changed while the change box was open, so it closed. Open it again to change them.')
    return
  }
  const from = map(t.from, 1)
  const to = map(t.to, -1)
  if (from !== t.from || to !== t.to) useChangeBox.setState({ target: { ...t, from, to } })
}

/** Change it: the box closes and the passage is revised as Adam said, the sentences he kept word for word. */
export async function submitChange(): Promise<boolean> {
  const s = useChangeBox.getState()
  const t = s.target
  if (!t || !canSubmit(s)) return false
  const note = s.note.trim()
  const keeps = keepsIn(t.text, s.keeps)
  closeChangeBox(false)
  if (t.kind === 'change') {
    if (note) noteUsed(note, 'rewrite')
    return changeWaiting(t.id, note, keeps)
  }
  const ed = editorBridge()?.sceneId === t.sceneId ? editorBridge()?.editor : null
  if (!ed || ed.isDestroyed || t.to > ed.state.doc.content.size || textOf(ed.state.doc, t.from, t.to) !== t.text) {
    toast('Those words have changed. Open Change it… on them again.')
    return false
  }
  if (t.kind === 'beat') {
    if (note) noteUsed(note, 'beat')
    // Shown as only what moved when something was said or kept; written afresh it is a new take, shown whole.
    return redoBeat(t.sceneId, t.index, note, { tracked: true, keeps, diff: !!note || keeps.length > 0 })
  }
  noteUsed(note, 'rewrite')
  return changeWords({ from: t.from, to: t.to }, note, keeps)
}

/** The keyboard to the open change box's note (after a menu that opened it has closed). False when no box is open. */
export function focusChangeBox(): boolean {
  if (!useChangeBox.getState().target) return false
  const box = document.querySelector<HTMLElement>('[data-change-box] textarea, [data-change-box] input')
  box?.focus()
  return !!box
}
