import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { sceneExtensions } from './extensions'
import { fixParagraphIds, newParagraphId, paragraphIdsPlugin, withParagraphIds, withoutParagraphIds } from './paragraphIds'

const schema = getSchema(sceneExtensions())
const p = (text: string, pid: string | null = null): PMNode => schema.nodes.paragraph.create({ pid }, text ? schema.text(text) : null)
const docOf = (...paras: PMNode[]): PMNode => schema.nodes.doc.create(null, paras)

const stateOf = (doc: PMNode): EditorState => EditorState.create({ doc, plugins: [history(), paragraphIdsPlugin] })
const apply = (s: EditorState, tr: Transaction): EditorState => s.apply(tr)

const ids = (doc: PMNode): (string | null)[] => {
  const out: (string | null)[] = []
  doc.descendants((n) => {
    if (n.type.name === 'paragraph') {
      out.push(n.attrs.pid as string | null)
      return false
    }
    return true
  })
  return out
}
const texts = (doc: PMNode): string[] => {
  const out: string[] = []
  doc.descendants((n) => {
    if (n.type.name === 'paragraph') {
      out.push(n.textContent)
      return false
    }
    return true
  })
  return out
}
const allUnique = (list: (string | null)[]): boolean => list.every((x) => !!x) && new Set(list).size === list.length

/** Position just inside paragraph `i`, plus `offset` characters. */
function posIn(doc: PMNode, i: number, offset = 0): number {
  let n = -1
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name === 'paragraph' && ++n === i) {
      found = pos + 1 + offset
      return false
    }
    return true
  })
  return found
}

describe('newParagraphId', () => {
  it('makes short ids that are not already taken', () => {
    const taken = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const id = newParagraphId(taken)
      expect(id).toMatch(/^[a-z0-9]{8}$/)
      expect(taken.has(id)).toBe(false)
      taken.add(id)
    }
  })
})

describe('withParagraphIds (opening a scene)', () => {
  it('gives every paragraph an id, inside quotes too, and says so', () => {
    const quote = schema.nodes.blockquote.create(null, [p('Quoted one'), p('Quoted two')])
    const doc = schema.nodes.doc.create(null, [p('One'), quote, schema.nodes.horizontalRule.create(), p('Two')])
    const { doc: out, filled } = withParagraphIds(doc)
    expect(filled).toBe(true)
    expect(ids(out)).toHaveLength(4)
    expect(allUnique(ids(out))).toBe(true)
    expect(texts(out)).toEqual(['One', 'Quoted one', 'Quoted two', 'Two'])
  })

  it('leaves a document that already has its ids alone', () => {
    const doc = docOf(p('One', 'aaaa1111'), p('Two', 'bbbb2222'))
    const { doc: out, filled } = withParagraphIds(doc)
    expect(filled).toBe(false)
    expect(out).toBe(doc)
  })

  it('mends ids that are shared, keeping the first', () => {
    const { doc: out } = withParagraphIds(docOf(p('One', 'same0000'), p('Two', 'same0000'), p('Three', 'other000')))
    const list = ids(out)
    expect(list[0]).toBe('same0000')
    expect(list[1]).not.toBe('same0000')
    expect(list[2]).toBe('other000')
    expect(allUnique(list)).toBe(true)
  })

  it('keeps ids through a save and load (JSON round trip)', () => {
    const { doc } = withParagraphIds(docOf(p('One'), p('Two')))
    const back = schema.nodeFromJSON(JSON.parse(JSON.stringify(doc.toJSON())))
    expect(ids(back)).toEqual(ids(doc))
    expect(withParagraphIds(back).filled).toBe(false)
  })
})

describe('editing keeps ids stable', () => {
  const start = (): EditorState => stateOf(docOf(p('First paragraph here', 'first000'), p('Second', 'second00')))

  it('keeps the id while typing in a paragraph', () => {
    let s = start()
    s = apply(s, s.tr.insertText(' more', posIn(s.doc, 0, 5)))
    expect(ids(s.doc)).toEqual(['first000', 'second00'])
  })

  it('splitting in the middle keeps the first half’s id and gives the second half a new one', () => {
    let s = start()
    s = apply(s, s.tr.split(posIn(s.doc, 0, 5)))
    expect(texts(s.doc)).toEqual(['First', ' paragraph here', 'Second'])
    const list = ids(s.doc)
    expect(list[0]).toBe('first000')
    expect(list[2]).toBe('second00')
    expect(allUnique(list)).toBe(true)
  })

  it('Enter at the very start leaves the words with their id', () => {
    let s = start()
    s = apply(s, s.tr.split(posIn(s.doc, 0, 0)))
    expect(texts(s.doc)).toEqual(['', 'First paragraph here', 'Second'])
    const list = ids(s.doc)
    expect(list[1]).toBe('first000')
    expect(allUnique(list)).toBe(true)
  })

  it('Enter at the end makes a new paragraph with its own id', () => {
    let s = start()
    s = apply(s, s.tr.split(posIn(s.doc, 0, 'First paragraph here'.length), 1, [{ type: schema.nodes.paragraph }]))
    const list = ids(s.doc)
    expect(list[0]).toBe('first000')
    expect(list[2]).toBe('second00')
    expect(allUnique(list)).toBe(true)
  })

  it('a paragraph added anywhere gets an id', () => {
    let s = start()
    s = apply(s, s.tr.insert(s.doc.content.size, p('Added')))
    s = apply(s, s.tr.insert(0, p('At the top')))
    const list = ids(s.doc)
    expect(list).toHaveLength(4)
    expect(list.slice(1, 3)).toEqual(['first000', 'second00'])
    expect(allUnique(list)).toBe(true)
  })

  it('joining two paragraphs keeps the first one’s id', () => {
    let s = start()
    const end = posIn(s.doc, 0, 'First paragraph here'.length)
    s = apply(s, s.tr.join(end + 1))
    expect(ids(s.doc)).toEqual(['first000'])
  })

  it('undo after a split brings back the paragraph with its id and no duplicates', () => {
    let s = start()
    s = apply(s, s.tr.split(posIn(s.doc, 0, 5)))
    undo(s, (tr) => (s = s.apply(tr)))
    expect(texts(s.doc)).toEqual(['First paragraph here', 'Second'])
    expect(ids(s.doc)).toEqual(['first000', 'second00'])
  })
})

describe('pasting', () => {
  it('pasted paragraphs get fresh ids, never the copied ones', () => {
    let s = stateOf(docOf(p('Alpha', 'alpha000'), p('Beta', 'beta0000')))
    const copied = new Slice(Fragment.from([p('Alpha', 'alpha000'), p('Beta', 'beta0000')]), 0, 0)
    const pasted = new Slice(withoutParagraphIds(copied.content), copied.openStart, copied.openEnd)
    expect(ids(schema.nodes.doc.create(null, pasted.content))).toEqual([null, null])
    // Pasted at the top, before the originals: the originals still keep their ids.
    s = apply(s, s.tr.replaceRange(0, 0, pasted))
    const list = ids(s.doc)
    expect(list).toHaveLength(4)
    expect(list.slice(2)).toEqual(['alpha000', 'beta0000'])
    expect(allUnique(list)).toBe(true)
  })

  it('strips ids inside quotes as well', () => {
    const quote = schema.nodes.blockquote.create(null, [p('In a quote', 'quote000')])
    const out = withoutParagraphIds(Fragment.from([quote, schema.nodes.horizontalRule.create()]))
    expect(ids(schema.nodes.doc.create(null, out))).toEqual([null])
  })
})

describe('fixParagraphIds', () => {
  it('returns nothing to do when every id is fine', () => {
    const s = stateOf(docOf(p('One', 'one00000')))
    expect(fixParagraphIds(s.tr)).toBeNull()
  })
})

describe('HTML', () => {
  it('writes the id as data-pid and reads it back', () => {
    const spec = schema.nodes.paragraph.spec
    const out = spec.toDOM!(p('One', 'abcd1234')) as unknown as [string, Record<string, string>, ...unknown[]]
    expect(out[1]['data-pid']).toBe('abcd1234')
    const rule = spec.parseDOM!.find((r) => r.tag === 'p')!
    const el = { getAttribute: (name: string) => (name === 'data-pid' ? 'abcd1234' : null) } as unknown as HTMLElement
    const attrs = typeof rule.getAttrs === 'function' ? rule.getAttrs(el) : null
    expect(attrs && attrs.pid).toBe('abcd1234')
  })
})
