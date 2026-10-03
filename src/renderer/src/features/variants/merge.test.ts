import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import { history } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import {
  appendStream,
  commitStream,
  docFromStored,
  docFromText,
  finishStreamText,
  sceneText,
  startStream,
  streamPlugin
} from '@/features/editor/streamDoc'
import { newSplitState, splitChunk } from '@/features/editor/streamText'
import { withParagraphIds } from '@/features/editor/paragraphIds'
import {
  blocksToNodes,
  blocksWords,
  docText,
  paragraphText,
  pickedBlocks,
  pickNumber,
  sceneWith,
  togglePick,
  variantBlocks,
  type Pick,
  type VariantBlock
} from './merge'

const schema = getSchema(sceneExtensions())

/** The page Generate would make by streaming this text into an empty scene. */
function generated(text: string): ReturnType<typeof docFromText> {
  let s = EditorState.create({ schema, doc: docFromText(schema, ''), plugins: [history(), streamPlugin] })
  const apply = (tr: Transaction | null): void => {
    if (tr) s = s.apply(tr)
  }
  apply(startStream(s, 'g1'))
  let split = newSplitState()
  // In uneven pieces, as a stream would bring it.
  for (let i = 0; i < text.length; i += 7) {
    const r = splitChunk(split, text.slice(i, i + 7))
    split = r.state
    apply(appendStream(s, r.ops))
  }
  apply(finishStreamText(s))
  return commitStream(s).doc
}

/** The page a stored document (as sceneWith makes it) loads as in the editor, with its paragraph ids. */
const loaded = (doc: unknown, text: string) => withParagraphIds(docFromStored(schema, doc, text)).doc

const words = (blocks: VariantBlock[]): string[] => blocks.map((b) => (b.kind === 'break' ? '***' : paragraphText(b)))

const VARIANT_A = 'Mara waited by the door.\n\nThe knock came *twice*, then **once more**.\n\nShe opened it.'
const VARIANT_B = "Here's the scene:\n\nTobin stood in the rain.\n\n* * *\n\nLater, the lamps went out.\n\nNobody spoke."

describe('a variant as page blocks', () => {
  it('splits paragraphs, keeps italics and bold, and makes scene breaks', () => {
    const blocks = variantBlocks(VARIANT_A)
    expect(words(blocks)).toEqual(['Mara waited by the door.', 'The knock came twice, then once more.', 'She opened it.'])
    expect(blocks[1]).toEqual({
      kind: 'paragraph',
      pieces: [
        { text: 'The knock came ' },
        { text: 'twice', italic: true },
        { text: ', then ' },
        { text: 'once more', bold: true },
        { text: '.' }
      ]
    })
    expect(words(variantBlocks('One.\n***\nTwo.'))).toEqual(['One.', '***', 'Two.'])
  })

  it('leaves out a lead-in or heading once the scene follows it, as Generate does', () => {
    expect(words(variantBlocks(VARIANT_B))[0]).toBe('Tobin stood in the rain.')
    expect(words(variantBlocks('# The Gilded Eel\nThe tavern was full.'))).toEqual(['The tavern was full.'])
    // While it is the only line so far, it shows (more may still come).
    expect(words(variantBlocks("Here's the scene:"))).toEqual(["Here's the scene:"])
  })

  it('ignores spaces and empty lines', () => {
    expect(words(variantBlocks('\n\n  One.  \n\n\n   \nTwo.\n\n'))).toEqual(['One.', 'Two.'])
    expect(variantBlocks('')).toEqual([])
    expect(variantBlocks('   \n\n ')).toEqual([])
  })

  it('counts words without the markup', () => {
    expect(blocksWords(variantBlocks(VARIANT_A))).toBe(15)
    expect(blocksWords(variantBlocks('* * *'))).toBe(0)
  })

  it('makes the same page Generate would make from the same text', () => {
    for (const text of [VARIANT_A, VARIANT_B, 'A *lone* line.', 'One.\n\n***\n\nTwo with **bold** and *italic* words.']) {
      const { doc, text: plain } = sceneWith('replace', variantBlocks(text), null)
      const page = loaded(doc, plain)
      const draft = generated(text)
      expect(sceneText(page)).toBe(sceneText(draft))
      expect(plain).toBe(sceneText(draft))
      // Block for block, marks and all (only the paragraph ids differ).
      expect(page.childCount).toBe(draft.childCount)
      page.forEach((node, _offset, i) => {
        const other = draft.child(i)
        expect(node.type.name).toBe(other.type.name)
        expect(node.content.eq(other.content)).toBe(true)
      })
    }
  })
})

describe('picking paragraphs', () => {
  const a = variantBlocks(VARIANT_A)
  const c = variantBlocks('First of three.\n\nSecond of three.\n\nThird of three.')
  const blocksOf = (id: string): VariantBlock[] | undefined => ({ a, c })[id]

  it('keeps them in the order they were picked, from any variant', () => {
    let picks: Pick[] = []
    picks = togglePick(picks, { generationId: 'a', block: 1 })
    picks = togglePick(picks, { generationId: 'c', block: 0 })
    picks = togglePick(picks, { generationId: 'a', block: 2 })
    expect(words(pickedBlocks(picks, blocksOf))).toEqual(['The knock came twice, then once more.', 'First of three.', 'She opened it.'])
    expect(pickNumber(picks, { generationId: 'c', block: 0 })).toBe(2)
    expect(pickNumber(picks, { generationId: 'c', block: 1 })).toBe(0)
  })

  it('unpicks a paragraph picked again, and the rest close up in their order', () => {
    let picks: Pick[] = []
    for (const p of [
      { generationId: 'a', block: 0 },
      { generationId: 'c', block: 1 },
      { generationId: 'c', block: 2 }
    ])
      picks = togglePick(picks, p)
    picks = togglePick(picks, { generationId: 'c', block: 1 })
    expect(picks).toEqual([
      { generationId: 'a', block: 0 },
      { generationId: 'c', block: 2 }
    ])
    expect(pickNumber(picks, { generationId: 'c', block: 2 })).toBe(2)
    // Picked again, it goes last.
    picks = togglePick(picks, { generationId: 'c', block: 1 })
    expect(pickNumber(picks, { generationId: 'c', block: 1 })).toBe(3)
  })

  it('leaves out picks whose paragraph is gone, and never takes a scene break', () => {
    const b = variantBlocks('One.\n\n***\n\nTwo.')
    const picks: Pick[] = [
      { generationId: 'b', block: 1 },
      { generationId: 'b', block: 9 },
      { generationId: 'gone', block: 0 },
      { generationId: 'b', block: 2 }
    ]
    expect(words(pickedBlocks(picks, (id) => (id === 'b' ? b : undefined)))).toEqual(['Two.'])
  })

  it('counts the words picked so far', () => {
    const picks: Pick[] = [
      { generationId: 'c', block: 2 },
      { generationId: 'a', block: 0 }
    ]
    expect(blocksWords(pickedBlocks(picks, blocksOf))).toBe(8)
  })
})

describe("the scene's new text", () => {
  const picked = variantBlocks('New one.\n\nNew *two*.')
  const current = (text: string) => {
    const doc = withParagraphIds(docFromText(schema, text)).doc
    return { doc: doc.toJSON(), text: sceneText(doc) }
  }

  it('Replace it: only the new text', () => {
    const r = sceneWith('replace', picked, current('Old text.\n\nMore old text.'))
    expect(r.text).toBe('New one.\n\nNew two.')
    expect(sceneText(loaded(r.doc, r.text))).toBe(r.text)
  })

  it('Add below: the scene as it is, a scene break, then the new text', () => {
    const now = current('Old text.\n\nMore old text.')
    const r = sceneWith('add', picked, now)
    expect(r.text).toBe('Old text.\n\nMore old text.\n\n* * *\n\nNew one.\n\nNew two.')
    const page = loaded(r.doc, r.text)
    expect(page.child(2).type.name).toBe('horizontalRule')
    expect(
      page
        .child(4)
        .child(1)
        .marks.map((m) => m.type.name)
    ).toEqual(['italic'])
    // Adam's paragraphs keep their ids (the memory links facts to them).
    const before = loaded(now.doc, now.text)
    expect(page.child(0).attrs.pid).toBe(before.child(0).attrs.pid)
    expect(page.child(1).attrs.pid).toBe(before.child(1).attrs.pid)
    // The current page is left as it was.
    expect((now.doc as { content: unknown[] }).content).toHaveLength(2)
  })

  it('Add below: no empty lines left before the break, and no second break after one', () => {
    let doc = docFromText(schema, 'Old text.')
    doc = doc.type.create(null, [...doc.content.content, schema.nodes.paragraph.create(), schema.nodes.paragraph.create()])
    const trailing = sceneWith('add', picked, { doc: doc.toJSON(), text: sceneText(doc) })
    expect(trailing.doc.content.map((n) => n.type)).toEqual(['paragraph', 'horizontalRule', 'paragraph', 'paragraph'])

    const endsInBreak = sceneWith('add', picked, current('Old text.\n\n***'))
    expect(endsInBreak.text).toBe('Old text.\n\n* * *\n\nNew one.\n\nNew two.')
    expect(endsInBreak.doc.content.filter((n) => n.type === 'horizontalRule')).toHaveLength(1)

    const startsWithBreak = sceneWith('add', variantBlocks('***\n\nAfter.'), current('Old text.'))
    expect(startsWithBreak.text).toBe('Old text.\n\n* * *\n\nAfter.')
  })

  it('Add below in a scene with no words is the new text alone', () => {
    expect(sceneWith('add', picked, current('')).text).toBe('New one.\n\nNew two.')
    expect(sceneWith('add', picked, null).text).toBe('New one.\n\nNew two.')
  })

  it("Add below reads the scene's plain text when its document can't be read", () => {
    const r = sceneWith('add', picked, { doc: { type: 'nonsense' }, text: 'Old one.\n\n***\n\nOld two.' })
    expect(r.text).toBe('Old one.\n\n* * *\n\nOld two.\n\n* * *\n\nNew one.\n\nNew two.')
    expect(sceneText(loaded(r.doc, r.text))).toBe(r.text)
  })

  it('writes blocks as the stored document the editor reads', () => {
    expect(blocksToNodes(variantBlocks('A **b** c.\n\n***'))).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'A ' },
          { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' c.' }
        ]
      },
      { type: 'horizontalRule' }
    ])
    expect(
      docText([{ type: 'paragraph' }, { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Q.' }] }] }])
    ).toBe('Q.')
  })
})
