import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { sceneExtensions } from '@/features/editor/extensions'
import { forPlan, hasWords, pageParagraphs, placeOf, posIn, wordStart } from './pageText'

const schema = getSchema(sceneExtensions())
const italic = schema.marks.italic.create()
const para = (pid: string | null, ...content: PMNode[]): PMNode => schema.nodes.paragraph.create({ pid }, content)
const text = (words: string, ...marks: ReturnType<typeof schema.marks.italic.create>[]): PMNode => schema.text(words, marks)
const br = (): PMNode => schema.nodes.hardBreak.create()

const doc = schema.nodes.doc.create(null, [
  para('p1', text('She '), text('never', italic), text(' said it.')),
  para('p2', text('Line one'), br(), text('line two.')),
  para(null, text('No id yet.')),
  schema.nodes.blockquote.create(null, [para('p3', text('“A sign,” it read.'))]),
  para('p4')
])

describe('the page as reading aloud sees it', () => {
  it('gives each paragraph with an id its words, a line break as a new line, and its italics', () => {
    const list = pageParagraphs(doc)
    expect(list.map((p) => p.pid)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(list[0]).toMatchObject({ text: 'She never said it.', italics: [[4, 9]] })
    expect(list[1].text).toBe('Line one\nline two.')
    expect(list[2].text).toBe('“A sign,” it read.')
    expect(forPlan(list[0])).toEqual({ pid: 'p1', text: 'She never said it.', italics: [[4, 9]] })
    expect(forPlan(list[1])).toEqual({ pid: 'p2', text: 'Line one\nline two.' })
  })

  it('turns a place in the words into a place on the page and back', () => {
    const list = pageParagraphs(doc)
    for (const [index, p] of list.entries()) {
      for (let offset = 0; offset <= p.text.length; offset++) {
        const pos = posIn(p, offset)
        expect(doc.textBetween(posIn(p, 0), pos, '\n', '\n')).toBe(p.text.slice(0, offset))
        expect(placeOf(list, pos)).toEqual({ index, offset })
      }
    }
  })

  it('takes a place between paragraphs as the start of the next, and nothing past the last', () => {
    const list = pageParagraphs(doc)
    // Just before the second paragraph opens.
    expect(placeOf(list, list[1].pos)).toEqual({ index: 1, offset: 0 })
    expect(placeOf(list, doc.content.size)).toBeNull()
  })

  it('starts Listen from here at the start of a word selected only in part', () => {
    const words = 'Tobin’s collar, up. Then'
    expect(wordStart(words, 3)).toBe(0)
    expect(wordStart(words, 6)).toBe(0)
    expect(wordStart(words, 8)).toBe(8)
    expect(wordStart(words, 11)).toBe(8)
    // Between words, or at the end: where it is.
    expect(wordStart(words, 14)).toBe(14)
    expect(wordStart(words, 18)).toBe(18)
    expect(wordStart(words, 99)).toBe(words.length)
  })

  it('knows a paragraph with nothing to say', () => {
    expect(hasWords({ text: '  … — ' })).toBe(false)
    expect(hasWords({ text: '“No.”' })).toBe(true)
    expect(hasWords({ text: '42' })).toBe(true)
  })
})
