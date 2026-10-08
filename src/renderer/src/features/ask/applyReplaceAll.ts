// The editor chat's replace_all (chat Phase 4, lab switch EXTRATOOLS): every place some words stand in a story (or one
// scene of it) replaced through the app's own Find and replace (features/find/storyReplace.ts), so it lands as if Adam
// had done it there: the open scene's unsaved typing is saved first, every scene that changes gets a History snapshot
// ("Before find and replace"), the open scene changes through the editor (one Ctrl+Z step), and Undo puts back every
// scene not changed since (and the entry's name, when it was renamed too). Never across stories: only the chat's own.
import type { Proposal } from '@shared/contracts/ask'
import type { StoryReplaceResult } from '@shared/contracts/find'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { applyToPage, pageNow, replacedMessage, undoneMessage } from '@/features/find/storyReplace'
import { useOutlineStore } from '@/features/binder/outlineStore'
import type { Applied, ApplyPlace, Undone } from './applyProposal'

type ReplaceAll = Extract<Proposal, { kind: 'replaceAll' }>

export const REPLACE_BUSY = 'A draft is being written into the open scene. Wait for it to finish, then apply.'
export const REPLACE_OTHER_STORY = 'This change is for another story, so nothing was replaced.'
export const REPLACE_GONE = 'Those words aren’t there any more, so nothing was replaced. Ask again for a fresh change.'
export const REPLACE_UNDO_BUSY = 'A draft is being written into the open scene, so the change was left in. Wait for it to finish, then undo it.'

/** Whether a replace left anything out (a scene a draft was being written into, the open scene changed meanwhile). */
const leftOut = (r: Pick<StoryReplaceResult, 'skipped'>, pageLeft: boolean): boolean => !!r.skipped.length || pageLeft

/**
 * Replaces the words everywhere the proposal names, found again as the story is now (the open scene as the page shows
 * it): the picks are every match, in the one scene when the proposal is for one scene. Says what was left out, if
 * anything; nothing at all replaced is a failure in plain words.
 */
export async function applyReplaceAll(p: ReplaceAll, place: ApplyPlace = {}): Promise<Applied> {
  if (place.storyId !== undefined && place.storyId !== p.storyId) return { ok: false, why: REPLACE_OTHER_STORY }
  const bridge = editorBridge()
  if (bridge?.busy()) return { ok: false, why: REPLACE_BUSY }
  // The open scene's unsaved typing is saved first.
  await bridge?.flush()
  const now = pageNow()
  const page = now?.page ?? null
  const query = { storyId: p.storyId, query: p.find, matchCase: p.matchCase, wholeWord: p.wholeWord, page }
  const found = await api.findInStory(query)
  const scenes = found.scenes.filter((s) => !p.sceneId || s.sceneId === p.sceneId)
  if (!scenes.some((s) => s.matches.length)) return { ok: false, why: REPLACE_GONE }
  const res = await api.replaceInStory({
    ...query,
    replacement: p.replace,
    picks: scenes.map((s) => ({ sceneId: s.sceneId, matchIds: s.matches.map((m) => m.id) })),
    rename: p.renameEntry && p.rename && p.replace.trim() ? { entryId: p.rename.entryId, name: p.rename.name } : null
  })
  const pageLeft = !!res.page && !applyToPage(res.page, now?.doc ?? null)
  const app = useApp.getState()
  if (res.replaced) app.bumpOutline()
  if (res.renamed) app.bumpEntries()
  const token = res.token
  if (!token || (!res.replaced && !res.renamed)) return { ok: false, why: REPLACE_GONE }
  if (leftOut(res, pageLeft)) toast(replacedMessage(res, pageLeft))
  return { ok: true, undo: () => undoReplaceAll(token) }
}

/**
 * Undo: every scene back that hasn't changed since (the open scene through the editor), and the entry's old name.
 * What was left as it is comes back in plain words; an Undo that can't be done any more (the app was restarted, or
 * many replaces since) says so.
 */
export async function undoReplaceAll(token: string): Promise<Undone> {
  const bridge = editorBridge()
  if (bridge?.busy()) return { ok: false, why: REPLACE_UNDO_BUSY }
  await bridge?.flush()
  const now = pageNow()
  let res
  try {
    res = await api.undoReplaceInStory(token, now?.page ?? null)
  } catch (e) {
    return { ok: false, why: (e as Error)?.message || 'That can’t be undone any more.' }
  }
  if (res.page && !applyToPage(res.page, now?.doc ?? null)) {
    res.scenes--
    const id = res.page.sceneId
    res.skipped.push({ sceneId: id, title: useOutlineStore.getState().outline?.scenes.find((s) => s.id === id)?.title ?? 'The open scene' })
  }
  const app = useApp.getState()
  app.bumpOutline()
  if (res.rename === 'undone') app.bumpEntries()
  if (res.skipped.length || res.rename === 'changed') return { ok: false, why: undoneMessage(res), ...(res.skipped[0] ? { sceneId: res.skipped[0].sceneId } : {}) }
  return { ok: true }
}
