// Find and replace across the story (Writing by hand, Ctrl+Shift+F): the window's half. The main process finds
// and changes the stored scenes (src/main/find/); the open scene's change comes back to be made here, through
// the editor, so it is one Ctrl+Z step and nothing typed in it is lost. One message says what changed, with one
// Undo that puts every scene back (and the name, when an entry was renamed).
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import type { PageChange, PageForFind, StoryReplaceInput, StoryReplaceResult, StoryUndoResult } from '@shared/contracts/find'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { keptRanges, pageChangeTr } from './pageEdits'
import { BUSY_STORY_MESSAGE, times } from './words'
import { useOutlineStore } from '@/features/binder/outlineStore'

/** The open scene as the page shows it, with the AI suggestion waiting there (if any), and its document now. */
export function pageNow(): { page: PageForFind; doc: PMNode } | null {
  const bridge = editorBridge()
  const now = bridge?.current()
  const editor = bridge?.editor
  if (!now || !editor) return null
  return { page: { ...now, keep: keptRanges(editor.state) }, doc: editor.state.doc }
}

/** Makes a change worked out in the main process in the page, if it still shows what was sent. */
function applyToPage(change: PageChange, sent: PMNode | null): boolean {
  const bridge = editorBridge()
  const view = bridge?.editor?.view
  if (!bridge || !view || bridge.sceneId !== change.sceneId || bridge.busy() || !sent || !view.state.doc.eq(sent)) return false
  const tr = pageChangeTr(view.state, change)
  if (!tr) return false
  view.dispatch(tr)
  // Typing straight after is a step of its own.
  view.dispatch(closeHistory(view.state.tr))
  return true
}

const scenesWord = (n: number): string => (n === 1 ? 'one scene' : `${n.toLocaleString()} scenes`)

/** "“Night”", "“Night” and “Dawn”", "“Night”, “Dawn” and 2 more". */
function titles(list: { title: string }[]): string {
  const q = list.map((s) => `“${s.title}”`)
  if (q.length <= 2) return q.join(' and ')
  if (q.length === 3) return `${q[0]}, ${q[1]} and ${q[2]}`
  return `${q[0]}, ${q[1]} and ${q.length - 2} more`
}

/** What a replace says when it's done. */
export function replacedMessage(r: Pick<StoryReplaceResult, 'replaced' | 'scenes' | 'skipped' | 'renamed'>, pageLeft: boolean): string {
  const parts: string[] = []
  if (r.replaced) parts.push(`Replaced ${times(r.replaced)} in ${scenesWord(r.scenes)}.`)
  if (r.renamed) parts.push(`${r.renamed.from} is now ${r.renamed.to} in memory.`)
  if (r.skipped.length)
    parts.push(`${titles(r.skipped)} ${r.skipped.length === 1 ? 'was' : 'were'} left as ${r.skipped.length === 1 ? 'it is' : 'they are'}: a draft was being written into ${r.skipped.length === 1 ? 'it' : 'them'}.`)
  if (pageLeft) parts.push('The open scene changed meanwhile, so it was left as it is.')
  return parts.join(' ') || 'Nothing was replaced: those words aren’t there any more.'
}

/** What Undo says. */
export function undoneMessage(r: Pick<StoryUndoResult, 'scenes' | 'skipped' | 'rename'>): string {
  const parts: string[] = []
  if (r.scenes) parts.push(`Put the words back in ${scenesWord(r.scenes)}.`)
  if (r.rename === 'undone') parts.push('The old name is back in memory.')
  if (r.skipped.length)
    parts.push(`${titles(r.skipped)} changed since, so ${r.skipped.length === 1 ? 'it was' : 'they were'} left as ${r.skipped.length === 1 ? 'it is' : 'they are'}.`)
  if (r.rename === 'changed') parts.push('The name was changed since, so it stays as it is.')
  return parts.join(' ') || 'Nothing to put back.'
}

/**
 * Replaces the ticked matches across the story: saves the open scene first, then the main process changes the
 * stored scenes (each with a History snapshot first) and this makes the open scene's change in the page.
 * Resolves once the message shows; throws a plain-words error when nothing could be done.
 */
export async function replaceInStory(input: Omit<StoryReplaceInput, 'page'>): Promise<StoryReplaceResult | null> {
  const bridge = editorBridge()
  if (bridge?.busy()) {
    toast(BUSY_STORY_MESSAGE)
    return null
  }
  // The open scene's unsaved typing is saved first.
  await bridge?.flush()
  const now = pageNow()
  const res = await api.replaceInStory({ ...input, page: now?.page ?? null })
  const pageLeft = !!res.page && !applyToPage(res.page, now?.doc ?? null)
  const app = useApp.getState()
  if (res.replaced) app.bumpOutline()
  if (res.renamed) app.bumpEntries()
  const token = res.token
  toast(replacedMessage(res, pageLeft), token ? { action: { label: 'Undo', run: () => void undoReplace(token) } } : {})
  return res
}

/** Undo: every scene back that hasn't changed since (the open scene through the editor), and the name. */
export async function undoReplace(token: ID): Promise<void> {
  try {
    const bridge = editorBridge()
    await bridge?.flush()
    const now = pageNow()
    const res = await api.undoReplaceInStory(token, now?.page ?? null)
    if (res.page && !applyToPage(res.page, now?.doc ?? null)) {
      res.scenes--
      const id = res.page.sceneId
      res.skipped.push({ sceneId: id, title: useOutlineStore.getState().outline?.scenes.find((s) => s.id === id)?.title ?? 'The open scene' })
    }
    const app = useApp.getState()
    app.bumpOutline()
    if (res.rename === 'undone') app.bumpEntries()
    toast(undoneMessage(res))
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  }
}
