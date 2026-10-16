// Undo and redo keep an accepted fix's issue right (findings that stay current, 2026-10-16). Fix the text's change
// accepted, or the editor chat's fix applied, marks its issue fixed; Ctrl+Z taking those words back reopens it, and
// Ctrl+Y bringing them back marks it fixed again. Kept in this plugin's state, never in the document (as the repair
// marks are, features/repair/marks.ts): each fix is mapped through every change, and one Adam edits by hand is no
// longer followed. Opening another scene builds a new editor state, so they go then too.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { isHistoryTransaction } from '@tiptap/pm/history'
import type { ID } from '@shared/types'
import { editorBridge } from '@/lib/editorBridge'
import { mapRange } from '@/features/edits/suggestions'

/** An accepted fix: its issue, and where its new words (`now`) stand in place of the old (`was`). */
export interface IssueFix {
  issueId: ID
  sceneId: ID
  from: number
  to: number
  now: string
  was: string
}

/** What the last undo or redo did to fixes: taken back (`undone`) or brought back (`redone`). */
export interface FixHistory {
  seq: number
  undone: IssueFix[]
  redone: IssueFix[]
}

interface FixState {
  fixes: IssueFix[]
  /** Fixes taken back by Ctrl+Z, their places holding the old words again, until a redo brings them back. */
  undone: IssueFix[]
  history: FixHistory | null
}

type Meta = { type: 'add'; fix: IssueFix }

export const fixHistoryKey = new PluginKey<FixState>('aiwriteIssueFixes')

const MOST = 50
let seq = 0

/** The plugin's step, on its own for tests. */
export function applyFixes(tr: Transaction, value: FixState): FixState {
  const meta = tr.getMeta(fixHistoryKey) as Meta | undefined
  let { fixes, undone, history } = value
  if (tr.docChanged && (fixes.length || undone.length)) {
    const doc = tr.doc
    const holds = (from: number, text: string): boolean =>
      !!text && from >= 0 && from + text.length <= doc.content.size && doc.textBetween(from, from + text.length, '\n', '\n') === text
    const byHistory = isHistoryTransaction(tr)
    const nextFixes: IssueFix[] = []
    const nextUndone: IssueFix[] = []
    const taken: IssueFix[] = []
    const back: IssueFix[] = []
    for (const f of fixes) {
      const r = mapRange(f, tr)
      if (typeof r !== 'string' && r.to > r.from) {
        nextFixes.push({ ...f, ...r })
        continue
      }
      // Ctrl+Z took the fix back: the old words are where the new ones were.
      const from = tr.mapping.map(f.from, -1)
      if (byHistory && holds(from, f.was)) {
        const u = { ...f, from, to: from + f.was.length }
        nextUndone.push(u)
        taken.push(u)
      }
    }
    for (const u of undone) {
      const r = mapRange(u, tr)
      if (typeof r !== 'string' && r.to > r.from) {
        nextUndone.push({ ...u, ...r })
        continue
      }
      // Ctrl+Y brought it back.
      const from = tr.mapping.map(u.from, -1)
      if (byHistory && holds(from, u.now)) {
        const f = { ...u, from, to: from + u.now.length }
        nextFixes.push(f)
        back.push(f)
      }
    }
    fixes = nextFixes
    undone = nextUndone.slice(-MOST)
    if (taken.length || back.length) history = { seq: ++seq, undone: taken, redone: back }
  }
  if (meta?.type === 'add') fixes = [...fixes.filter((f) => f.issueId !== meta.fix.issueId), meta.fix].slice(-MOST)
  return fixes === value.fixes && undone === value.undone && history === value.history ? value : { fixes, undone, history }
}

/** Who hears what an undo or redo did to fixes (actions.ts reopens the issue, or marks it fixed again). */
const listeners = new Set<(h: FixHistory) => void>()
export function onFixHistory(fn: (h: FixHistory) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const fixHistoryPlugin = new Plugin<FixState>({
  key: fixHistoryKey,
  state: {
    init: () => ({ fixes: [], undone: [], history: null }),
    apply: (tr, value) => applyFixes(tr, value)
  },
  view: () => ({
    update(view, prev) {
      const now = fixHistoryKey.getState(view.state)?.history
      if (!now || now === fixHistoryKey.getState(prev)?.history) return
      for (const fn of listeners) {
        try {
          fn(now)
        } catch (e) {
          console.warn('A fix’s undo could not be noted', e)
        }
      }
    }
  })
})

/** True when Ctrl+Z took this issue's accepted fix back in the page showing now (it waits for a redo). */
export function fixUndone(issueId: ID): boolean {
  const state = editorBridge()?.editor?.state
  return !!state && (fixHistoryKey.getState(state)?.undone ?? []).some((f) => f.issueId === issueId)
}

/** The fixes followed in the page now (for tests). */
export const issueFixes = (state: EditorState): IssueFix[] => fixHistoryKey.getState(state)?.fixes ?? []

/**
 * Follows an accepted fix in the page showing its scene: its new words at `words` (in the page as it is now), in place
 * of `was`. Nothing when another scene shows, or the old words are unknown.
 */
export function noteIssueFix(issue: { id: ID; sceneId: ID | null }, words: { from: number; to: number }, was: string): void {
  const bridge = editorBridge()
  const view = bridge?.editor?.view
  if (!issue.sceneId || !view || bridge?.sceneId !== issue.sceneId || !was || words.to <= words.from) return
  const doc = view.state.doc
  if (words.to > doc.content.size) return
  const now = doc.textBetween(words.from, words.to, '\n', '\n')
  if (!now || now === was) return
  view.dispatch(view.state.tr.setMeta(fixHistoryKey, { type: 'add', fix: { issueId: issue.id, sceneId: issue.sceneId, ...words, now, was } } satisfies Meta))
}

export const IssueFixHistory = Extension.create({
  name: 'aiwriteIssueFixHistory',
  addProseMirrorPlugins: () => [fixHistoryPlugin]
})
