// Findings that stay current (2026-10-16): an accepted fix is followed in the page, so Ctrl+Z taking it back reopens its
// issue and Ctrl+Y bringing it back marks it fixed again; a fix Adam then edits by hand is no longer followed. Invented
// text throughout.
import { afterEach, describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import { closeHistory, history, redo, undo } from '@tiptap/pm/history'
import type { EditorView } from '@tiptap/pm/view'
import { sceneExtensions } from '@/features/editor/extensions'
import { setEditorBridge, type EditorBridge } from '@/lib/editorBridge'
import { fixHistoryKey, fixHistoryPlugin, issueFixes, noteIssueFix, onFixHistory, type FixHistory } from './fixHistory'

const schema = getSchema(sceneExtensions())
const BEFORE = 'Mara’s eyes were green in the lamplight.'

/** A page with the fix plugin, as the editor has it, standing in for the view (its update hook runs on each change). */
function openPage(texts: string[]) {
  const doc = schema.topNodeType.create(
    null,
    texts.map((t, i) => schema.nodes.paragraph.create({ pid: `p${i}` }, schema.text(t)))
  )
  let state = EditorState.create({ schema, doc, plugins: [history(), fixHistoryPlugin] })
  const view = {
    get state() {
      return state
    }
  } as unknown as EditorView & { dispatch: (tr: Transaction) => void }
  const hook = fixHistoryPlugin.spec.view!(view)
  view.dispatch = (tr: Transaction) => {
    const prev = state
    state = state.apply(tr)
    hook.update?.(view, prev)
  }
  setEditorBridge({ sceneId: 'sc1', editor: { view, state } } as unknown as EditorBridge)
  return {
    view,
    text: () => state.doc.textContent,
    run: (cmd: typeof undo) => cmd(state, view.dispatch)
  }
}

/** Accepts a fix as the page does: the words replaced in one step, typing after it a step of its own. */
function accept(p: ReturnType<typeof openPage>, find: string, put: string): { from: number; to: number; was: string } {
  const s = p.view.state
  const at = posOf(s, find)
  p.view.dispatch(closeHistory(s.tr))
  p.view.dispatch(p.view.state.tr.insertText(put, at, at + find.length))
  p.view.dispatch(closeHistory(p.view.state.tr))
  return { from: at, to: at + put.length, was: find }
}

/** Where some words start in the page. */
function posOf(s: EditorState, find: string): number {
  let at = -1
  s.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(find)) at = pos + node.text!.indexOf(find)
    return at < 0
  })
  return at
}

afterEach(() => setEditorBridge(null))

describe('an accepted fix in the page', () => {
  it('Ctrl+Z taking it back reopens its issue; Ctrl+Y bringing it back marks it fixed again', () => {
    const told: FixHistory[] = []
    const off = onFixHistory((h) => told.push(h))
    const p = openPage(['Rain came off the river.', BEFORE])
    const made = accept(p, 'green', 'blue')
    noteIssueFix({ id: 'i1', sceneId: 'sc1' }, made, made.was)
    expect(issueFixes(p.view.state).map((f) => [f.issueId, f.now, f.was])).toEqual([['i1', 'blue', 'green']])
    expect(p.run(undo)).toBe(true)
    expect(p.text()).toContain('eyes were green')
    expect(told.map((h) => [h.undone.map((f) => f.issueId), h.redone.map((f) => f.issueId)])).toEqual([[['i1'], []]])
    expect(p.run(redo)).toBe(true)
    expect(p.text()).toContain('eyes were blue')
    expect(told.map((h) => [h.undone.map((f) => f.issueId), h.redone.map((f) => f.issueId)])).toEqual([
      [['i1'], []],
      [[], ['i1']]
    ])
    off()
  })

  it('stops following a fix Adam edits by hand, and says nothing of typing elsewhere', () => {
    const told: FixHistory[] = []
    const off = onFixHistory((h) => told.push(h))
    const p = openPage(['Rain came off the river.', BEFORE])
    const made = accept(p, 'green', 'blue')
    noteIssueFix({ id: 'i1', sceneId: 'sc1' }, made, made.was)
    // Typing in the first paragraph, then undoing it: the fix is still followed, nothing said.
    p.view.dispatch(p.view.state.tr.insertText(' Cold.', 25))
    p.view.dispatch(closeHistory(p.view.state.tr))
    p.run(undo)
    expect(told).toEqual([])
    expect(issueFixes(p.view.state)).toHaveLength(1)
    // Typing inside the fix's own words: no longer followed.
    const f = issueFixes(p.view.state)[0]
    p.view.dispatch(p.view.state.tr.insertText('l', f.from + 2))
    expect(issueFixes(p.view.state)).toEqual([])
    expect(fixHistoryKey.getState(p.view.state)!.undone).toEqual([])
    off()
  })

  it('isn’t followed in a page showing another scene', () => {
    const p = openPage([BEFORE])
    const made = accept(p, 'green', 'blue')
    noteIssueFix({ id: 'i1', sceneId: 'sc2' }, made, made.was)
    expect(issueFixes(p.view.state)).toEqual([])
  })
})
