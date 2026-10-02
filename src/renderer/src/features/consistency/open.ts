// Going from the Consistency page to where something is: a scene at the words (with its Issues tab for
// an issue), a plot thread's page, an entry's page.
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { requestReveal } from '@/features/editor/reveal'

/**
 * Opens a scene with the words selected (or the caret in the page when there are none to show).
 * `wholeWord`: a repeated word or phrase, never found inside a longer word ("rain" in "brain").
 */
export function openWords(sceneId: ID, storyId: ID, words: string, opts: { wholeWord?: boolean } = {}): void {
  if (words.trim()) requestReveal(sceneId, words, opts)
  else requestEditorFocus(sceneId)
  useApp.getState().selectScene(sceneId, storyId)
}

/** Opens an issue's scene at its words, with the scene panel on its Issues tab. */
export function openIssue(issue: { sceneId: ID | null; quote: string }, storyId: ID): void {
  if (!issue.sceneId) return
  const a = useApp.getState()
  a.setInspectorTab('issues')
  a.peekEntry(null)
  if (a.askOpen) a.setAskOpen(false)
  if (a.settings && !a.settings.layout.inspectorOpen) void a.updateSettings({ layout: { inspectorOpen: true } })
  openWords(issue.sceneId, storyId, issue.quote)
}

export const openThread = (entryId: ID): void => useApp.getState().navigate({ kind: 'entries', entryKind: 'thread', entryId })

/** Opens an entry's page (its kind is looked up first). */
export async function openEntry(entryId: ID): Promise<void> {
  try {
    const entry = await api.getEntry(entryId)
    useApp.getState().navigate({ kind: 'entries', entryKind: entry.kind, entryId })
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
  }
}
