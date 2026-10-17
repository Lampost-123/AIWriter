import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { sceneExtensions } from '@/features/editor/extensions'

const calls = vi.hoisted(() => ({ ask: [] as unknown[][], edit: [] as unknown[][], tool: [] as unknown[][], listen: [] as unknown[][] }))
const app = vi.hoisted(() => ({ readAloud: true }))
const bridge = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/lib/store', () => ({ useApp: { getState: () => ({ settings: { speech: { readAloud: app.readAloud } } }) } }))
vi.mock('@/lib/editorBridge', () => ({ editorBridge: () => bridge.value }))
vi.mock('@/features/ask/open', () => ({
  askAbout: (...a: unknown[]) => calls.ask.push(a),
  editAbout: (...a: unknown[]) => calls.edit.push(a)
}))
vi.mock('@/features/edits/session', () => ({ startTool: async (...a: unknown[]) => calls.tool.push(a) }))
vi.mock('@/features/readAloud/control', () => ({ listenFrom: (...a: unknown[]) => calls.listen.push(a.slice(1)) }))

import { notePageMenu, placeOfClick, runPageAction } from './pageMenu'

const schema = getSchema(sceneExtensions())
const para = (text: string): PMNode => schema.nodes.paragraph.create(null, text ? schema.text(text) : null)
const docOf = (...texts: string[]): PMNode => schema.nodes.doc.create(null, texts.map(para))

/** A stand-in for the page: its words, what is selected, and where a click lands. */
function pageOf(doc: PMNode, sel: { from: number; to: number } | null, hit: number | null) {
  let state = EditorState.create({ doc, schema })
  if (sel) state = state.apply(state.tr.setSelection(TextSelection.create(doc, sel.from, sel.to)))
  const view = {
    get state() {
      return state
    },
    editable: true,
    isDestroyed: false,
    posAtCoords: () => (hit == null ? null : { pos: hit, inside: -1 }),
    dispatch: (tr: Transaction) => (state = state.apply(tr)),
    focus: () => undefined
  }
  bridge.value = { sceneId: 'sc1', editor: { view } }
  return view as unknown as EditorView
}

// "Mara" is 1–5 in the first paragraph; the second paragraph's words are 12–29.
const DOC = docOf('Mara ran.', '“Stop,” she said.')

beforeEach(() => {
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = []
  app.readAloud = true
})

describe('placeOfClick', () => {
  it('is the selected words when the click is on them', () => {
    expect(placeOfClick(pageOf(DOC, { from: 1, to: 5 }, 3), 0, 0)).toEqual({ from: 1, to: 5, selection: true })
  })

  it('is the place clicked when the click is off the selection, or nothing is selected', () => {
    expect(placeOfClick(pageOf(DOC, { from: 1, to: 5 }, 8), 0, 0)).toEqual({ from: 8, to: 8, selection: false })
    expect(placeOfClick(pageOf(DOC, null, 6), 0, 0)).toEqual({ from: 6, to: 6, selection: false })
  })
})

describe('notePageMenu', () => {
  it('offers nothing outside a scene, or in a page that can’t be edited', () => {
    const view = pageOf(DOC, null, 3)
    expect(notePageMenu(view, null, 0, 0)).toBeNull()
    ;(view as unknown as { editable: boolean }).editable = false
    expect(notePageMenu(view, 'sc1', 0, 0)).toBeNull()
  })

  it('says whether words are selected, whether they have dialogue, and whether read aloud is on', () => {
    expect(notePageMenu(pageOf(DOC, { from: 1, to: 5 }, 3), 'sc1', 0, 0)).toMatchObject({ selection: true, dialogue: false, listen: true })
    expect(notePageMenu(pageOf(DOC, { from: 12, to: 29 }, 15), 'sc1', 0, 0)).toMatchObject({ selection: true, dialogue: true })
    app.readAloud = false
    expect(notePageMenu(pageOf(DOC, null, 3), 'sc1', 0, 0)).toMatchObject({ selection: false, listen: false })
  })
})

describe('runPageAction', () => {
  it('asks about the selected words, or the paragraph clicked', () => {
    let token = notePageMenu(pageOf(DOC, { from: 1, to: 5 }, 3), 'sc1', 0, 0)!.token
    runPageAction(token, { kind: 'ask' })
    expect(calls.ask[0][0]).toBe('Mara')
    token = notePageMenu(pageOf(DOC, null, 15), 'sc1', 0, 0)!.token
    runPageAction(token, { kind: 'edit' })
    expect(calls.edit[0][0]).toBe('“Stop,” she said.')
  })

  it('listens from the place clicked', () => {
    const token = notePageMenu(pageOf(DOC, null, 6), 'sc1', 0, 0)!.token
    runPageAction(token, { kind: 'listen' })
    expect(calls.listen).toEqual([['sc1', 6]])
  })

  it('runs an AI tool on the words, selecting them again if the selection moved', () => {
    const view = pageOf(DOC, { from: 1, to: 5 }, 3)
    const token = notePageMenu(view, 'sc1', 0, 0)!.token
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)))
    runPageAction(token, { kind: 'tool', tool: 'tone', direction: 'Dark' })
    expect(view.state.selection.from).toBe(1)
    expect(view.state.selection.to).toBe(5)
    expect(calls.tool).toEqual([['tone', { direction: 'Dark' }]])
  })

  it('does nothing for an older right-click, or once the page shows another scene', () => {
    const first = notePageMenu(pageOf(DOC, null, 3), 'sc1', 0, 0)!.token
    const second = notePageMenu(pageOf(DOC, null, 3), 'sc1', 0, 0)!.token
    runPageAction(first, { kind: 'ask' })
    expect(calls.ask).toEqual([])
    ;(bridge.value as { sceneId: string }).sceneId = 'sc2'
    runPageAction(second, { kind: 'ask' })
    expect(calls.ask).toEqual([])
  })
})
