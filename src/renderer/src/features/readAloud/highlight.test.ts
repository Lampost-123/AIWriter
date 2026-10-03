import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { sceneExtensions } from '@/features/editor/extensions'
import { readingKey, readingPlace, readingPlugin, setReadingPlace } from './highlight'

const schema = getSchema(sceneExtensions())
const para = (pid: string, words: string) => schema.nodes.paragraph.create({ pid }, schema.text(words))

// One paragraph, read as one clip; the second sentence is words 20 to 32 (on the page, one more: the paragraph opens
// at 0).
const WORDS = 'The ferry was late. Mara waited.'
const start = (): EditorState => EditorState.create({ doc: schema.nodes.doc.create(null, [para('p1', WORDS)]), plugins: [readingPlugin] })
const at = (offset: number): number => 1 + offset

/** The words under the highlight. */
const highlighted = (state: EditorState): string[] =>
  (readingKey.getState(state)?.decorations.find() ?? []).map((d) => state.doc.textBetween(d.from, d.to))

function reading(): EditorState {
  const s = start()
  return s.apply(setReadingPlace(s.tr, { clip: { from: at(0), to: at(WORDS.length) }, sentence: { from: at(20), to: at(WORDS.length) } }))
}

describe('the sentence being read', () => {
  it('is highlighted, and kept out of the undo history', () => {
    const s = start()
    const tr = setReadingPlace(s.tr, { clip: { from: at(0), to: at(WORDS.length) }, sentence: { from: at(20), to: at(WORDS.length) } })
    expect(tr.getMeta('addToHistory')).toBe(false)
    expect(tr.docChanged).toBe(false)
    const next = s.apply(tr)
    expect(highlighted(next)).toEqual(['Mara waited.'])
    expect(readingPlace(next).clip).toEqual({ from: at(0), to: at(WORDS.length) })
  })

  it('moves with the words when Adam types before it, and keeps what he types at its edges outside', () => {
    let s = reading()
    // A word typed at the start of the paragraph (the clip's start): it isn't part of the clip.
    s = s.apply(s.tr.insertText('Again, ', at(0)))
    expect(highlighted(s)).toEqual(['Mara waited.'])
    expect(s.doc.textBetween(readingPlace(s).clip!.from, readingPlace(s).clip!.to)).toBe(WORDS)
    // Words added at the clip's end come after it, so the next clip starts with them.
    const end = readingPlace(s).clip!.to
    s = s.apply(s.tr.insertText(' Then she left.', end))
    expect(s.doc.textBetween(readingPlace(s).clip!.from, readingPlace(s).clip!.to)).toBe(WORDS)
    expect(readingPlace(s).clip!.to).toBe(end)
  })

  it('loses the highlight when the sentence is typed over, but keeps the clip’s place', () => {
    let s = reading()
    const { from, to } = readingPlace(s).sentence!
    s = s.apply(s.tr.delete(from, to))
    expect(highlighted(s)).toEqual([])
    expect(readingPlace(s).clip).toEqual({ from: at(0), to: at(20) })
  })

  it('clears when reading stops', () => {
    let s = reading()
    s = s.apply(setReadingPlace(s.tr, { sentence: null, clip: null }))
    expect(highlighted(s)).toEqual([])
    expect(readingPlace(s)).toEqual({ sentence: null, clip: null })
  })

  it('ignores a place that is no longer in the page', () => {
    let s = reading()
    s = s.apply(setReadingPlace(s.tr, { sentence: { from: at(20), to: 500 } }))
    expect(highlighted(s)).toEqual([])
    expect(readingPlace(s).clip).toEqual({ from: at(0), to: at(WORDS.length) })
  })
})
