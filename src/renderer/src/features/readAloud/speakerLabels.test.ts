import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { sceneExtensions } from '@/features/editor/extensions'
import { setSpeakerLabels, speakerLabelsKey, speakerLabelsPlugin, type ShownLabel } from './speakerLabels'

const schema = getSchema(sceneExtensions())
const para = (pid: string, words: string) => schema.nodes.paragraph.create({ pid }, schema.text(words))

const P1 = 'The ferry was late.'
const P2 = '“You came,” he said.'
const start = (): EditorState =>
  EditorState.create({ doc: schema.nodes.doc.create(null, [para('p1', P1), para('p2', P2)]), plugins: [speakerLabelsPlugin] })

/** Applies setSpeakerLabels to a state, as the page's view would. */
function withLabels(state: EditorState, labels: ReadonlyMap<string, ShownLabel> | null): EditorState {
  let next = state
  setSpeakerLabels({ state, dispatch: (tr) => (next = state.apply(tr)) }, labels)
  return next
}

/** Each labelled paragraph's id and label. */
const shown = (state: EditorState): [string, string][] =>
  (speakerLabelsKey.getState(state)?.decorations.find() ?? []).map((d) => {
    const spec = (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs
    return [state.doc.nodeAt(d.from)!.attrs.pid as string, spec['data-speaker-label']]
  })

const LABELS = new Map<string, ShownLabel>([
  ['p1', { text: P1, label: 'Narrator · hushed, slowly' }],
  ['p2', { text: P2, label: 'Tobin · quiet and wary' }]
])

describe('Show speakers and tone on the page', () => {
  it('labels each paragraph whose words the label was made for, without changing the words or the undo history', () => {
    const s = start()
    const next = withLabels(s, LABELS)
    expect(shown(next)).toEqual([
      ['p1', 'Narrator · hushed, slowly'],
      ['p2', 'Tobin · quiet and wary']
    ])
    expect(next.doc.eq(s.doc)).toBe(true)
    expect(next.doc.textContent).toBe(P1 + P2)
  })

  it('drops the label of a paragraph Adam edits, and keeps the others', () => {
    let s = withLabels(start(), LABELS)
    s = s.apply(s.tr.insertText(' Again', 1 + P1.length - 1))
    expect(shown(s)).toEqual([['p2', 'Tobin · quiet and wary']])
  })

  it('hides them all when turned off', () => {
    const s = withLabels(withLabels(start(), LABELS), null)
    expect(shown(s)).toEqual([])
  })
})
