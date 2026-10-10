// Beat markers (2026-10-08): which beats show on the page and which version of each, the note on a beat written
// before an earlier one changed, a split paragraph joining its beat, and the bands drawn on the page.
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import { paragraphIdsPlugin, withParagraphIds } from '@/features/editor/paragraphIds'
import { docFromText } from '@/features/editor/streamDoc'
import { decorateBeats } from './beatMarks'
import {
  adoptSplits,
  beatsInWords,
  beatSig,
  beatsShown,
  currentVersion,
  fingerprint,
  keptAsIs,
  newMarks,
  paragraphsOf,
  resumePoint,
  withMended,
  withPids,
  withVersion,
  writtenBefore,
  type SceneBeatMarks
} from './marks'
import { filledParagraphs } from './sessionLogic'

const schema = getSchema(sceneExtensions())

const stateFrom = (text: string): EditorState =>
  EditorState.create({ schema, doc: withParagraphIds(docFromText(schema, text)).doc, plugins: [history(), paragraphIdsPlugin] })

const pids = (s: EditorState): string[] => filledParagraphs(s.doc).map((p) => p.pid)

/** Three beats on the page: paragraphs 1-2 beat 1, 3 beat 2, 4-5 beat 3, each written in turn. */
function threeBeats(): { s: EditorState; marks: SceneBeatMarks; ids: string[] } {
  const s = stateFrom('One.\n\nOne more.\n\nTwo.\n\nThree.\n\nThree more.')
  const ids = pids(s)
  let marks = newMarks('s1', 'sess', 3, 'whole')
  const beats: [number, string[]][] = [
    [1, ids.slice(0, 2)],
    [2, ids.slice(2, 3)],
    [3, ids.slice(3)]
  ]
  for (const [i, p] of beats) {
    marks = withPids(marks, i, p)
    marks = withVersion(marks, i, { recordId: `g${i}`, at: i * 10, sig: beatSig(s.doc, p) })
  }
  return { s, marks, ids }
}

describe('beats on the page', () => {
  it('shows each beat with words on the page, in order, with the version showing', () => {
    const { s, marks, ids } = threeBeats()
    const shown = beatsShown(s.doc, marks)
    expect(shown.map((b) => [b.index, b.pids, b.recordId, b.staleBy])).toEqual([
      [1, ids.slice(0, 2), 'g1', null],
      [2, [ids[2]], 'g2', null],
      [3, ids.slice(3), 'g3', null]
    ])
    expect(shown[1].pos).toBe(filledParagraphs(s.doc)[2].pos)
    expect(paragraphsOf(marks)).toEqual({ 1: ids.slice(0, 2), 2: [ids[2]], 3: ids.slice(3) })
    expect(beatsShown(s.doc, null)).toEqual([])
  })

  it('leaves out a beat with none of its words on the page', () => {
    const { s, marks, ids } = threeBeats()
    const p = filledParagraphs(s.doc).find((x) => x.pid === ids[2])!
    const out = s.apply(s.tr.delete(p.pos, p.pos + p.node.nodeSize))
    expect(beatsShown(out.doc, marks).map((b) => b.index)).toEqual([1, 3])
  })

  it('knows which version shows by its words: an earlier one put back by undo is shown again', () => {
    let { s, marks, ids } = threeBeats()
    // Beat 2 written again, as an accepted change keeps its paragraph's id.
    const p = filledParagraphs(s.doc).find((x) => x.pid === ids[2])!
    s = s.apply(s.tr.insertText('Two, written again.', p.pos + 1, p.pos + p.node.nodeSize - 1))
    marks = withVersion(marks, 2, { recordId: 'g2b', at: 100, sig: beatSig(s.doc, [ids[2]]) })
    let shown = beatsShown(s.doc, marks)
    expect(shown[1].recordId).toBe('g2b')
    // Beat 3 was written before beat 2 changed: its note says so, and beat 2 offers to redo it.
    expect(shown[2].staleBy).toBe(2)
    expect(shown[0].staleBy).toBeNull()
    expect(writtenBefore(shown, 2)).toEqual([3])
    expect(writtenBefore(shown, 3)).toEqual([])
    // Undone, beat 2's first version is back, and the note goes.
    let back = s
    undo(s, (tr) => (back = s.apply(tr)))
    shown = beatsShown(back.doc, marks)
    expect(shown[1].recordId).toBe('g2')
    expect(shown[2].staleBy).toBeNull()
    // Edited by Adam (no version has these words): the newest version.
    const q = filledParagraphs(back.doc).find((x) => x.pid === ids[2])!
    const edited = back.apply(back.tr.insertText('Adam: ', q.pos + 1))
    expect(currentVersion(edited.doc, marks.beats[1])?.recordId).toBe('g2b')
  })

  it('keeps a later beat as it is: the note goes until an earlier beat changes again', () => {
    let { s, marks, ids } = threeBeats()
    marks = withVersion(marks, 1, { recordId: 'g1b', at: 50, sig: beatSig(s.doc, ids.slice(0, 2)) })
    expect(beatsShown(s.doc, marks).map((b) => b.staleBy)).toEqual([null, 1, 1])
    marks = keptAsIs(marks, 3, 60)
    expect(beatsShown(s.doc, marks).map((b) => b.staleBy)).toEqual([null, 1, null])
    marks = withVersion(marks, 2, { recordId: 'g2b', at: 70, sig: beatSig(s.doc, [ids[2]]) })
    expect(beatsShown(s.doc, marks).map((b) => b.staleBy)).toEqual([null, null, 2])
  })

  it('a version mended by check and repair as it landed takes the mended words as its own', () => {
    let { s, marks, ids } = threeBeats()
    const p = filledParagraphs(s.doc).find((x) => x.pid === ids[2])!
    s = s.apply(s.tr.insertText('Mended ', p.pos + 1))
    expect(withMended(marks, 'nobody', s.doc)).toBe(marks)
    marks = withMended(marks, 'g2', s.doc)
    expect(marks.beats[1].versions[0]).toEqual({ recordId: 'g2', at: 20, sig: beatSig(s.doc, [ids[2]]) })
    expect(marks.beats[1].versions[0].sig).not.toBe(fingerprint('Two.'))
  })

  it('adds paragraphs and versions once', () => {
    const { marks, ids } = threeBeats()
    expect(withPids(marks, 2, [ids[2]])).toBe(marks)
    expect(withVersion(marks, 2, marks.beats[1].versions[0])).toBe(marks)
    // The same record with other words (put back by Ctrl+Y after more came): one version, brought up to date.
    const again = withVersion(marks, 2, { recordId: 'g2', at: 25, sig: 'other' })
    expect(again.beats[1].versions).toEqual([{ recordId: 'g2', at: 25, sig: 'other' }])
    // A beat not seen before goes in its place in order.
    expect(withPids(newMarks('s1', 'x', 3, 'whole'), 2, ['a']).beats).toEqual([{ index: 2, pids: ['a'], versions: [] }])
  })
})

describe('a beat paragraph split in two', () => {
  it('takes the new half into the beat; a paragraph Adam adds stays his own', () => {
    const { s, marks, ids } = threeBeats()
    // Enter in the middle of beat 2's paragraph.
    const p = filledParagraphs(s.doc).find((x) => x.pid === ids[2])!
    const split = s.apply(s.tr.split(p.pos + 3))
    const now = pids(split)
    expect(now).toHaveLength(6)
    const fresh = now.find((x) => !ids.includes(x))!
    const adopted = adoptSplits(s.doc, split.doc, marks)
    expect(adopted.beats[1].pids).toEqual([ids[2], fresh])
    expect(beatsShown(split.doc, adopted)[1].pids).toEqual([ids[2], fresh])
    // A new paragraph typed after beat 3 is Adam's.
    const end = split.doc.content.size
    const typed = split.apply(split.tr.insert(end, schema.nodes.paragraph.create(null, schema.text('Adam adds this.'))))
    expect(adoptSplits(split.doc, typed.doc, adopted)).toBe(adopted)
  })
})

describe('the bands on the page', () => {
  it('marks each beat paragraph, its first and last, odd and even, and a stale or hot beat', () => {
    const { s, ids } = threeBeats()
    const set = decorateBeats(s.doc, {
      beats: [
        { index: 1, pids: ids.slice(0, 2), stale: false },
        { index: 2, pids: [ids[2]], stale: true }
      ],
      hot: 1
    })
    const found = set.find().map((d) => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs)
    expect(found.map((a) => a['data-beat'])).toEqual(['1', '1', '2'])
    expect(found[0].class).toBe('aw-beat aw-beat-odd aw-beat-first aw-beat-hot')
    expect(found[1].class).toBe('aw-beat aw-beat-odd aw-beat-last aw-beat-hot')
    expect(found[2].class).toBe('aw-beat aw-beat-even aw-beat-first aw-beat-last aw-beat-stale')
    expect(decorateBeats(s.doc, null).find()).toEqual([])
  })
})

describe('carrying on a session from its kept marks', () => {
  it('starts after the last beat on the page, with each paragraph owned by its version showing', () => {
    const { s, marks, ids } = threeBeats()
    // Beat 3 taken out (Ctrl+Z, say): the session stopped at beat 2 of the 4 on the card.
    const two = s.apply(s.tr.delete(filledParagraphs(s.doc)[3].pos, s.doc.content.size))
    const at = resumePoint(two.doc, marks, 4)
    expect(at).toMatchObject({ written: 2, of: 4, last: 'g2' })
    expect(at?.paragraphs).toEqual(paragraphsOf(marks))
    expect(at?.owners[ids[0]]).toBe('g1')
    expect(at?.owners[ids[2]]).toBe('g2')
    // All three on the page, with four on the card: beat 4 is next.
    expect(resumePoint(s.doc, marks, 4)?.written).toBe(3)
  })

  it('has nothing to carry on when every beat on the card is written, none is on the page, or none was kept', () => {
    const { s, marks } = threeBeats()
    expect(resumePoint(s.doc, marks, 3)).toBeNull()
    expect(resumePoint(stateFrom('Adam wrote all of this himself.').doc, marks, 4)).toBeNull()
    expect(resumePoint(s.doc, null, 4)).toBeNull()
  })

  it('carries on a session that is still on wherever it got to: every beat written, or none yet', () => {
    const { s, marks } = threeBeats()
    const open = { ...marks, open: true }
    // Every beat on the card written, but not finished: the bar comes back with Write it again and Finish.
    expect(resumePoint(s.doc, open, 3)).toMatchObject({ written: 3, of: 3, last: 'g3' })
    // Started, but its first beat hadn't put words on the page yet (the app closed while it got ready).
    const fresh = { ...newMarks('s1', 'sess', 5, 'below'), open: true }
    expect(resumePoint(stateFrom('Adam wrote all of this himself.').doc, fresh, 5)).toMatchObject({ written: 0, of: 5, last: null })
    // Its words have all gone from the page (other text in their place), or the card has no beats: nothing to carry on.
    expect(resumePoint(stateFrom('Adam wrote all of this himself.').doc, open, 4)).toBeNull()
    expect(resumePoint(s.doc, open, 0)).toBeNull()
  })
})

describe('carrying on from beats already in the scene’s words', () => {
  const CARD = ['Wren climbs to the lamp room', 'Edric watches the ferry come in', 'The bell rings over the harbour', 'Iska arrives soaked']
  const PAGE = 'Wren climbed the steps to the lamp room.\n\nBelow, Edric watched the ferry come in through the rain.'

  it('counts the card’s beats the words tell, from the first, as the desk’s next-beat chip does', () => {
    expect(beatsInWords(stateFrom(PAGE).doc, CARD)).toBe(2)
    expect(beatsInWords(stateFrom('Rain on the harbour.').doc, CARD)).toBe(0)
  })

  it('counts a session’s beats carried on from the words while the words still tell them', () => {
    const doc = stateFrom(PAGE).doc
    const left: SceneBeatMarks = { ...newMarks('s1', 'sess', 4, 'whole'), left: true, from: 2 }
    expect(resumePoint(doc, left, 4, 2)).toMatchObject({ written: 2, of: 4, from: 2, last: null })
    // The words no longer tell them (rewritten since): nothing to carry on.
    expect(resumePoint(doc, left, 4, 0)).toBeNull()
    // Still on, with only the first beat told now: it carries on from there.
    expect(resumePoint(doc, { ...left, left: undefined, open: true }, 4, 1)).toMatchObject({ written: 1, from: 1 })
    // A session that wrote its own beats doesn't count the words at all.
    const { s, marks } = threeBeats()
    expect(resumePoint(s.doc, marks, 4, 4)).toMatchObject({ written: 3, from: 0 })
  })
})
