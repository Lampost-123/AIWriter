import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { sceneExtensions } from '@/features/editor/extensions'
import { setHoveredSound, setSoundMarks, soundMarksKey, soundMarksPlugin } from './soundMarks'
import type { SoundWords } from './soundsLogic'

const schema = getSchema(sceneExtensions())
const para = (pid: string, words: string) => schema.nodes.paragraph.create({ pid }, schema.text(words))
const start = (): EditorState =>
  EditorState.create({
    doc: schema.nodes.doc.create(null, [para('p1', 'Rain hammered the tin roof.'), para('p2', 'Then the door slammed shut.')]),
    plugins: [soundMarksPlugin]
  })

const WORDS: SoundWords[] = [
  { cueId: 'rain', kind: 'ambience', role: 'at', anchor: { pid: 'p1', from: 0, to: 4, words: 'Rain' } },
  { cueId: 'rain', kind: 'ambience', role: 'until', anchor: { pid: 'p2', from: 22, to: 26, words: 'shut' } },
  { cueId: 'door', kind: 'effect', role: 'at', anchor: { pid: 'p2', from: 14, to: 21, words: 'slammed' } }
]

function run(state: EditorState, fn: (view: { state: EditorState; dispatch: (tr: EditorState['tr']) => void }) => void): EditorState {
  let next = state
  fn({ state, dispatch: (tr) => (next = state.apply(tr)) })
  return next
}

/** The marked words and their classes, in order. */
const marked = (state: EditorState): [string, string][] =>
  (soundMarksKey.getState(state)?.decorations.find() ?? []).map((d) => {
    const attrs = (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs
    return [state.doc.textBetween(d.from, d.to), attrs.class]
  })

describe('the sounds’ words marked in the page', () => {
  it('marks each sound’s words, without changing the words or the undo history', () => {
    const s = start()
    const next = run(s, (v) => setSoundMarks(v, WORDS))
    expect(next.doc.eq(s.doc)).toBe(true)
    expect(marked(next)).toEqual([
      ['Rain', 'aw-sound aw-sound-ambience'],
      ['slammed', 'aw-sound aw-sound-effect'],
      ['shut', 'aw-sound aw-sound-until']
    ])
  })

  it('marks the sound a row is hovered over more clearly, and clears', () => {
    let s = run(start(), (v) => setSoundMarks(v, WORDS))
    s = run(s, (v) => setHoveredSound(v, 'door'))
    expect(marked(s).find(([w]) => w === 'slammed')?.[1]).toBe('aw-sound aw-sound-effect aw-sound-hover')
    expect(marked(s).find(([w]) => w === 'Rain')?.[1]).toBe('aw-sound aw-sound-ambience')
    s = run(s, (v) => setSoundMarks(v, null))
    expect(marked(s)).toEqual([])
  })

  it('marks a muted sound’s words more faintly', () => {
    const s = run(start(), (v) => setSoundMarks(v, [{ ...WORDS[2], muted: true }]))
    expect(marked(s)).toEqual([['slammed', 'aw-sound aw-sound-effect aw-sound-muted']])
  })

  it('moves with the words as Adam types', () => {
    let s = run(start(), (v) => setSoundMarks(v, WORDS))
    // "And " typed at the start of the second paragraph.
    const p2 = s.doc.child(0).nodeSize + 1
    s = s.apply(s.tr.insertText('And ', p2))
    expect(marked(s).map(([w]) => w)).toEqual(['Rain', 'slammed', 'shut'])
  })
})
