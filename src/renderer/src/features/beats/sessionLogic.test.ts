import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import { history, redo, undo } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import { paragraphIdsPlugin, withParagraphIds } from '@/features/editor/paragraphIds'
import {
  activeStream,
  appendStream,
  commitStream,
  docFromText,
  finishStreamText,
  sceneText,
  startStream,
  streamPlugin
} from '@/features/editor/streamDoc'
import { newSplitState, splitChunk } from '@/features/editor/streamText'
import {
  beatsOnPage,
  filledParagraphs,
  isWholePage,
  nextBeat,
  pidsFrom,
  removeParagraphs,
  soFarText,
  withParagraphs,
  type BeatParagraphs
} from './sessionLogic'

const schema = getSchema(sceneExtensions())

const stateFrom = (text: string): EditorState =>
  EditorState.create({
    schema,
    doc: withParagraphIds(docFromText(schema, text)).doc,
    plugins: [history(), streamPlugin, paragraphIdsPlugin]
  })

const apply = (s: EditorState, tr: Transaction | null): EditorState => (tr ? s.apply(tr) : s)

function runUndo(s: EditorState): EditorState {
  let out = s
  undo(s, (tr) => (out = s.apply(tr)))
  return out
}

function runRedo(s: EditorState): EditorState {
  let out = s
  redo(s, (tr) => (out = s.apply(tr)))
  return out
}

/**
 * Writes one beat into the page as the bar does: a stream (carrying straight on after the first beat),
 * the paragraphs it wrote noted as it goes, then one undo step.
 */
function writeBeat(s: EditorState, beats: BeatParagraphs, n: number, text: string, o: { noBreak?: boolean } = {}) {
  let state = apply(s, startStream(s, `g${n}`, { noBreak: o.noBreak ?? n > 1 }))
  let split = newSplitState()
  let mine = beats
  for (const chunk of text.match(/.{1,12}/gs) ?? []) {
    const r = splitChunk(split, chunk)
    split = r.state
    state = apply(state, appendStream(state, r.ops))
    mine = withParagraphs(mine, n, pidsFrom(state.doc, activeStream(state)!.from))
  }
  state = commitStream(apply(state, finishStreamText(state)))
  return { state, beats: mine }
}

describe('beats on the page', () => {
  it('knows each beat by its paragraphs, so one Ctrl+Z takes the session back one beat', () => {
    let s = stateFrom('')
    let beats: BeatParagraphs = {}
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'Mara came in from the rain.\n\nThe Eel was loud.'))
    ;({ state: s, beats } = writeBeat(s, beats, 2, 'Tobin asked for the ledger.'))
    ;({ state: s, beats } = writeBeat(s, beats, 3, 'She said no.\n\nSomeone knocked.'))
    expect(beats[1]).toHaveLength(2)
    expect(beats[2]).toHaveLength(1)
    expect(beatsOnPage(s.doc, beats)).toBe(3)
    // The beats read as one piece: no scene breaks between them.
    expect(sceneText(s.doc)).toBe(
      'Mara came in from the rain.\n\nThe Eel was loud.\n\nTobin asked for the ledger.\n\nShe said no.\n\nSomeone knocked.'
    )

    const back = runUndo(s)
    expect(beatsOnPage(back.doc, beats)).toBe(2)
    expect(sceneText(back.doc)).toBe('Mara came in from the rain.\n\nThe Eel was loud.\n\nTobin asked for the ledger.')
    // Redo brings the same paragraphs (and their ids) back.
    expect(beatsOnPage(runRedo(back).doc, beats)).toBe(3)
    expect(beatsOnPage(runUndo(runUndo(back)).doc, beats)).toBe(0)
  })

  it("counts a beat while any of its words are there, Adam's edits and all", () => {
    let s = stateFrom('')
    let beats: BeatParagraphs = {}
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'One.'))
    ;({ state: s, beats } = writeBeat(s, beats, 2, 'Two.\n\nThree.'))
    // Adam empties the first paragraph of beat 2: its second is still there.
    const first = filledParagraphs(s.doc).find((p) => p.pid === beats[2][0])!
    s = s.apply(s.tr.delete(first.pos + 1, first.pos + first.node.nodeSize - 1))
    expect(beatsOnPage(s.doc, beats)).toBe(2)
    expect(nextBeat(2, 3)).toBe(3)
    expect(nextBeat(3, 3)).toBeNull()
  })
})

describe('the scene so far', () => {
  it('is the whole scene when the beats are the scene', () => {
    let s = stateFrom('')
    let beats: BeatParagraphs = {}
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'One.'))
    ;({ state: s, beats } = writeBeat(s, beats, 2, 'Two.'))
    // Adam's own words above the beats belong to the scene too.
    s = s.apply(s.tr.insertText('Adam: ', 1))
    expect(soFarText(s.doc, 'whole', beats)).toBe('Adam: One.\n\nTwo.')
    // Writing beat 2 again carries on from beat 1.
    expect(soFarText(s.doc, 'whole', beats, 2)).toBe('Adam: One.')
  })

  it('is what is below the scene break when the beats were added below the old text', () => {
    let s = stateFrom('The old draft.\n\nMore of it.')
    let beats: BeatParagraphs = {}
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'New one.', { noBreak: false }))
    ;({ state: s, beats } = writeBeat(s, beats, 2, 'New two.'))
    expect(sceneText(s.doc)).toBe('The old draft.\n\nMore of it.\n\n* * *\n\nNew one.\n\nNew two.')
    expect(soFarText(s.doc, 'below', beats)).toBe('New one.\n\nNew two.')
    expect(soFarText(s.doc, 'below', beats, 2)).toBe('New one.')
    expect(soFarText(stateFrom('Only old.').doc, 'below', {})).toBe('')
  })
})

describe('writing a beat again', () => {
  it('takes the beat out as one step that Ctrl+Z puts back', () => {
    let s = stateFrom('')
    let beats: BeatParagraphs = {}
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'One.'))
    ;({ state: s, beats } = writeBeat(s, beats, 2, 'Two.\n\nThree.'))
    const out = s.apply(removeParagraphs(s, beats[2])!)
    expect(sceneText(out.doc)).toBe('One.')
    expect(beatsOnPage(out.doc, beats)).toBe(1)
    expect(sceneText(runUndo(out).doc)).toBe('One.\n\nTwo.\n\nThree.')
    expect(removeParagraphs(out, beats[2])).toBeNull()
  })

  it('takes the page’s place when the beat is all there is on it', () => {
    let s = stateFrom('')
    let beats: BeatParagraphs = {}
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'One.\n\nOne more.'))
    expect(isWholePage(s.doc, beats[1])).toBe(true)
    ;({ state: s, beats } = writeBeat(s, beats, 2, 'Two.'))
    expect(isWholePage(s.doc, beats[2])).toBe(false)
    expect(isWholePage(stateFrom('').doc, [])).toBe(false)
  })

  it('remembers every version of a beat, so undoing a rewrite brings the beat back', () => {
    const all = withParagraphs(withParagraphs({}, 2, ['a', 'b']), 2, ['b', 'c'])
    expect(all[2]).toEqual(['a', 'b', 'c'])
    const same = withParagraphs(all, 2, ['a'])
    expect(same).toBe(all)
  })
})
