import { describe, expect, it } from 'vitest'
import { blocksOfDoc, curlLike, docText, findInBlocks, findInText, replaceInDoc, snippetAround, tidyDoc, touches, type DocNode } from './findReplace'

const words = (text: string, query: string, opts = {}): string[] => findInText(text, query, opts).map((m) => text.slice(m.start, m.end))

const bold = { type: 'bold' }
const italic = { type: 'italic' }
const t = (text: string, ...marks: object[]): DocNode => (marks.length ? { type: 'text', text, marks } : { type: 'text', text })
const p = (pid: string, ...content: DocNode[]): DocNode => ({ type: 'paragraph', attrs: { pid }, ...(content.length ? { content } : {}) })
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content })

describe('matching words', () => {
  it('ignores case unless Match case is on', () => {
    expect(words('Mara saw mara and MARA.', 'mara')).toEqual(['Mara', 'mara', 'MARA'])
    expect(words('Mara saw mara and MARA.', 'Mara', { matchCase: true })).toEqual(['Mara'])
  })

  it('finds whole words only when asked, and an apostrophe or hyphen ends a word', () => {
    expect(words('rain, brain, rainy, rain’s, rain-soaked', 'rain')).toHaveLength(5)
    expect(words('rain, brain, rainy, rain’s, rain-soaked', 'rain', { wholeWord: true })).toEqual(['rain', 'rain', 'rain'])
    // Only the edges that are letters are checked.
    expect(words('a-ish, smallish', '-ish', { wholeWord: true })).toEqual(['-ish'])
    expect(words('Élan and élan', 'élan', { wholeWord: true })).toEqual(['Élan', 'élan'])
  })

  it('treats curly and straight quotes, and a no-break space, as the same', () => {
    expect(words('Don’t go. Don\'t stay.', "don't")).toEqual(['Don’t', "Don't"])
    expect(words('He said “wait” and "go".', '"wait"')).toEqual(['“wait”'])
    expect(words('Mr Hale arrived.', 'Mr Hale')).toEqual(['Mr Hale'])
  })

  it('never overlaps, and finds nothing for empty words', () => {
    expect(words('aaaa', 'aa')).toEqual(['aa', 'aa'])
    expect(findInText('some words', '   ')).toEqual([])
    expect(findInText('some words', '')).toEqual([])
  })
})

describe('stored documents', () => {
  const scene = doc(
    p('a', t('The '), t('Ma', bold), t('ra', italic), t(' rode on.')),
    { type: 'horizontalRule' },
    p('b'),
    { type: 'blockquote', content: [p('c', t('Mara'), { type: 'hardBreak' }, t('Mara wept.'))] }
  )

  it('reads paragraphs with the positions the editor gives them', () => {
    const blocks = blocksOfDoc(scene)
    expect(blocks.map((b) => b.text)).toEqual(['The Mara rode on.', '', 'Mara\nMara wept.'])
    // Paragraph a: 1..18 (17 letters + its ends = 19), the rule 19, empty b 20-21, the blockquote opens at 22.
    expect(blocks.map((b) => b.pos)).toEqual([1, 21, 24])
  })

  it('finds words across bold and italic, never across a line break', () => {
    const found = findInBlocks(blocksOfDoc(scene), 'mara')
    expect(found).toEqual([
      { from: 5, to: 9, block: 0 },
      { from: 24, to: 28, block: 2 },
      { from: 29, to: 33, block: 2 }
    ])
    expect(findInBlocks(blocksOfDoc(scene), 'Mara Mara')).toEqual([])
  })

  it('replaces with the formatting of the first letter, keeping paragraph ids and everything else', () => {
    const found = findInBlocks(blocksOfDoc(scene), 'mara')
    const { doc: next, ranges } = replaceInDoc(
      scene,
      found.map((m) => ({ ...m, text: 'Maren' }))
    )
    expect(next.content?.[0]).toEqual(p('a', t('The '), t('Maren', bold), t(' rode on.')))
    expect(next.content?.[1]).toEqual({ type: 'horizontalRule' })
    expect(next.content?.[2]).toEqual(p('b'))
    expect(next.content?.[3]).toEqual({ type: 'blockquote', content: [p('c', t('Maren'), { type: 'hardBreak' }, t('Maren wept.'))] })
    expect(ranges).toEqual([
      { from: 5, to: 9, newFrom: 5, newTo: 10 },
      { from: 24, to: 28, newFrom: 25, newTo: 30 },
      { from: 29, to: 33, newFrom: 31, newTo: 36 }
    ])
    expect(docText(next)).toBe('The Maren rode on.\n\n* * *\n\nMaren\nMaren wept.')
    // The new document's positions agree with the ranges.
    expect(findInBlocks(blocksOfDoc(next), 'maren').map((m) => [m.from, m.to])).toEqual(ranges.map((r) => [r.newFrom, r.newTo]))
  })

  it('takes words out with an empty replacement, joining text of the same formatting', () => {
    const d = doc(p('a', t('one '), t('two', bold), t(' three')))
    const [m] = findInBlocks(blocksOfDoc(d), 'two')
    expect(replaceInDoc(d, [{ ...m, text: '' }]).doc).toEqual(doc(p('a', t('one  three'))))
    const all = findInBlocks(blocksOfDoc(d), 'one two three')
    expect(replaceInDoc(d, all.map((x) => ({ ...x, text: '' }))).doc).toEqual(doc(p('a')))
  })

  it('leaves the stored document as it was', () => {
    const before = JSON.stringify(scene)
    replaceInDoc(scene, [{ from: 5, to: 9, text: 'X' }])
    expect(JSON.stringify(scene)).toBe(before)
  })

  it('tidies documents so ones that show the same compare the same', () => {
    expect(tidyDoc(doc(p('a', t('ab'), t('cd'), t('', bold))))).toEqual(doc(p('a', t('abcd'))))
    // The same, whatever order a node's keys come in.
    const a = doc(p('a', { type: 'text', text: 'x', marks: [bold] }))
    const b = doc(p('a', { marks: [bold], type: 'text', text: 'x' }))
    expect(JSON.stringify(tidyDoc(a))).toBe(JSON.stringify(tidyDoc(b)))
    // An empty paragraph counts (it moves every position after it), however it is written down.
    expect(JSON.stringify(tidyDoc(doc(p('a'), p('b', t('x')))))).not.toBe(JSON.stringify(tidyDoc(doc(p('b', t('x'))))))
    expect(JSON.stringify(tidyDoc(doc({ type: 'paragraph', attrs: { pid: 'a' }, content: [] })))).toBe(JSON.stringify(tidyDoc(doc(p('a')))))
  })
})

describe('the words that go in', () => {
  it('follows the quote style of the words it replaces', () => {
    expect(curlLike("isn't", 'wasn’t')).toBe('isn’t')
    expect(curlLike('"Go"', '“Stay”')).toBe('“Go”')
    expect(curlLike("'tis", '‘twas', ' ')).toBe('‘tis')
    expect(curlLike("isn't", "wasn't")).toBe("isn't")
    expect(curlLike('plain', 'wasn’t')).toBe('plain')
  })

  it('shows a little text around a match, cut at whole words', () => {
    const text = 'Long before the river rose, the village of Hale had stood on the bank where the old mill turned.'
    const i = text.indexOf('Hale')
    const s = snippetAround(text, i, i + 4, 20)
    expect(s.match).toBe('Hale')
    expect(s.before.startsWith('…')).toBe(true)
    expect(s.after.endsWith('…')).toBe(true)
    expect(text.includes(s.before.slice(1) + 'Hale' + s.after.slice(0, -1))).toBe(true)
  })

  it('knows when a change would touch words held back', () => {
    expect(touches({ from: 5, to: 9 }, { from: 8, to: 20 })).toBe(true)
    expect(touches({ from: 5, to: 8 }, { from: 8, to: 20 })).toBe(false)
    // A point (new words waiting to go in there) is touched only from inside.
    expect(touches({ from: 5, to: 9 }, { from: 7, to: 7 })).toBe(true)
    expect(touches({ from: 5, to: 9 }, { from: 9, to: 9 })).toBe(false)
  })
})
