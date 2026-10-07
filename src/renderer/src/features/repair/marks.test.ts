// Check and repair's marks in the page: the paragraphs Adam types in while a draft streams in are noted (nothing in
// them is ever mended), and undo and redo keep each fix and its issue straight: Ctrl+Z taking a fix back says so,
// Ctrl+Y bringing it back says so and shows it in amber again, Ctrl+Z after the message's Undo brings it back too, and
// a quiet change (Beat by beat writing a beat again) says nothing. Invented text throughout.
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { closeHistory, history, redo, undo } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import { paragraphIdsPlugin, withParagraphIds } from '@/features/editor/paragraphIds'
import { appendStream, commitStream, docFromText, finishStreamText, startStream, streamPlugin } from '@/features/editor/streamDoc'
import { newSplitState, splitChunk } from '@/features/editor/streamText'
import type { RepairFix } from '@shared/contracts/repair'
import { fixesTr, landedParts, undoFixesTr } from './apply'
import { addRepairMarks, quietRepairs, removeRepairMarks, repairKey, repairMarks, repairPluginForTests, typedWhileStreaming } from './marks'

const schema = getSchema(sceneExtensions())
const ADAMS = 'Mara took off her hood.'
const AI = 'Mara kept her hood low and watched the door.'

function stateFrom(text: string): EditorState {
  const doc = withParagraphIds(docFromText(schema, text)).doc
  return EditorState.create({ schema, doc, plugins: [history(), streamPlugin, paragraphIdsPlugin, repairPluginForTests] })
}
const apply = (s: EditorState, tr: Transaction | null): EditorState => (tr ? s.apply(tr) : s)
const text = (s: EditorState): string => s.doc.textBetween(0, s.doc.content.size, '\n\n')
const history_ = (s: EditorState) => repairKey.getState(s)!.history
function run(s: EditorState, cmd: typeof undo): EditorState {
  let out = s
  cmd(s, (tr) => (out = s.apply(tr)))
  return out
}

/** A draft streamed in below Adam's words, the way the editor does it; `during` runs part-way (Adam typing). */
function streamed(during?: (s: EditorState) => EditorState): { s: EditorState } {
  let s = stateFrom(ADAMS)
  s = apply(s, startStream(s, 'g1', { noBreak: true }))
  let split = newSplitState()
  for (const chunk of ['\n\nMara kept her hood low', ' and watched the door.']) {
    const r = splitChunk(split, chunk)
    split = r.state
    s = apply(s, appendStream(s, r.ops))
    if (during && chunk.startsWith('\n')) s = during(s)
  }
  return { s: commitStream(apply(s, finishStreamText(s))) }
}

describe('while a draft streams in', () => {
  it("notes the paragraphs Adam types in, and marks them so nothing in them is mended; the AI's own are left unmarked", () => {
    const untouched = streamed()
    expect(typedWhileStreaming(untouched.s).size).toBe(0)
    const parts = landedParts(untouched.s.doc, 0, untouched.s.doc.content.size, typedWhileStreaming(untouched.s))
    expect(parts.map((p) => p.edited ?? false)).toEqual([false, false])

    // Adam types in the draft's first paragraph while it is still coming.
    const typed = streamed((s) => {
      const at = s.doc.content.size - 1
      return s.apply(s.tr.setSelection(TextSelection.create(s.doc, at)).insertText(' Her hood was up.'))
    })
    const marked = landedParts(typed.s.doc, 0, typed.s.doc.content.size, typedWhileStreaming(typed.s))
    expect(marked.map((p) => [p.text.startsWith('Mara kept') ? 'draft' : 'adam', p.edited ?? false])).toEqual([
      ['adam', false],
      ['draft', true]
    ])
  })
})

describe('undo and redo of a fix', () => {
  function mended(): { s: EditorState; id: string } {
    const s = stateFrom(`${ADAMS}\n\n${AI}`)
    let from = 0
    s.doc.forEach((n, pos) => {
      if (n.textContent === AI) from = pos
    })
    const parts = landedParts(s.doc, from, s.doc.content.size)
    const start = AI.indexOf('kept her hood low')
    const fix: RepairFix = { id: 'f1', para: 0, start, end: start + 'kept her hood low'.length, was: 'kept her hood low', now: 'kept her hood down', why: '' }
    const got = fixesTr(s, parts, [fix])!
    // As the page makes them: an undo step of its own.
    return { s: s.apply(addRepairMarks(closeHistory(got.tr), got.made.map((m) => ({ ...m, landing: 'l1' })))), id: 'f1' }
  }

  it('Ctrl+Z takes the fix back and says so; Ctrl+Y brings it back in amber and says so', () => {
    const { s, id } = mended()
    expect(repairMarks(s)).toHaveLength(1)
    const undone = run(s, undo)
    expect(text(undone)).toContain('kept her hood low')
    expect(repairMarks(undone)).toEqual([])
    expect(history_(undone)).toMatchObject({ undone: [id], redone: [] })
    const redone = run(undone, redo)
    expect(text(redone)).toContain('kept her hood down')
    expect(repairMarks(redone).map((m) => redone.doc.textBetween(m.from, m.to))).toEqual(['kept her hood down'])
    expect(history_(redone)).toMatchObject({ undone: [], redone: [id] })
  })

  it("the message's Undo takes it back quietly, and Ctrl+Z then brings the fix back and says so", () => {
    const { s, id } = mended()
    const back = s.apply(removeRepairMarks(closeHistory(undoFixesTr(s, repairMarks(s))!), [id]))
    expect(text(back)).toContain('kept her hood low')
    expect(repairMarks(back)).toEqual([])
    expect(history_(back)).toBeNull()
    const again = run(back, undo)
    expect(text(again)).toContain('kept her hood down')
    expect(repairMarks(again)).toHaveLength(1)
    expect(history_(again)).toMatchObject({ redone: [id] })
  })

  it('a quiet change takes fixes away without a word', () => {
    const { s } = mended()
    let out = s
    undo(s, (tr) => (out = s.apply(quietRepairs(tr))))
    expect(repairMarks(out)).toEqual([])
    expect(history_(out)).toBeNull()
  })
})
