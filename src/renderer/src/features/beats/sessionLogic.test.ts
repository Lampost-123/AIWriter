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
  endsPage,
  endsWithBeat,
  filledParagraphs,
  isWholePage,
  markPage,
  nextBeat,
  pidsFrom,
  recordOf,
  removeParagraphs,
  soFarText,
  startOf,
  unchangedSince,
  withOwner,
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
 * the paragraphs it wrote, and the record that wrote them, noted as it goes, then one undo step.
 */
function writeBeat(
  s: EditorState,
  beats: BeatParagraphs,
  n: number,
  text: string,
  o: { noBreak?: boolean; replace?: boolean; id?: string; owners?: Record<string, string> } = {}
) {
  const id = o.id ?? `g${n}`
  let state = apply(s, startStream(s, id, { noBreak: o.noBreak ?? n > 1, replace: o.replace }))
  let split = newSplitState()
  let mine = beats
  let owners = o.owners ?? {}
  for (const chunk of text.match(/.{1,12}/gs) ?? []) {
    const r = splitChunk(split, chunk)
    split = r.state
    state = apply(state, appendStream(state, r.ops))
    const info = activeStream(state)!
    if (info.replace && !info.before) continue
    const pids = pidsFrom(state.doc, info.from)
    mine = withParagraphs(mine, n, pids)
    owners = withOwner(owners, pids, id)
  }
  state = commitStream(apply(state, finishStreamText(state)))
  return { state, beats: mine, owners }
}

/** The new version of a beat waits after it until its first words arrive; ended before any did, the page is as it was. */
function waitAndEnd(s: EditorState, id: string, o: { replace?: boolean } = {}): EditorState {
  return commitStream(apply(s, startStream(s, id, { noBreak: true, replace: o.replace })))
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

describe('Write it again', () => {
  it('undoes the beat and writes it afresh, so one Ctrl+Z takes the new version out and the next the beat before', () => {
    let s = stateFrom('')
    let beats: BeatParagraphs = {}
    let owners: Record<string, string> = {}
    ;({ state: s, beats, owners } = writeBeat(s, beats, 1, 'One.', { owners }))
    ;({ state: s, beats, owners } = writeBeat(s, beats, 2, 'Two.\n\nThree.', { owners }))
    const mark = markPage(s)
    expect(recordOf(s.doc, beats[2], owners)).toBe('g2')
    expect(endsPage(s.doc, beats[2])).toBe(true)

    // Nothing changed since beat 2 was written, and the new version waiting after it changes nothing either.
    s = waitAndEnd(s, 'g2b')
    expect(unchangedSince(s, mark)).toBe(true)
    s = runUndo(s)
    expect(sceneText(s.doc)).toBe('One.')
    ;({ state: s, beats, owners } = writeBeat(s, beats, 2, 'Two again.', { owners, id: 'g2b' }))
    expect(sceneText(s.doc)).toBe('One.\n\nTwo again.')
    expect(beatsOnPage(s.doc, beats)).toBe(2)
    expect(recordOf(s.doc, beats[2], owners)).toBe('g2b')

    // One Ctrl+Z takes the new version out, the next takes beat 1: no flip back to the old beat 2.
    const back = runUndo(s)
    expect(sceneText(back.doc)).toBe('One.')
    expect(beatsOnPage(back.doc, beats)).toBe(1)
    expect(recordOf(back.doc, beats[1], owners)).toBe('g1')
    const backTwo = runUndo(back)
    expect(sceneText(backTwo.doc)).toBe('')
    expect(beatsOnPage(backTwo.doc, beats)).toBe(0)
    // Redo brings them back in order.
    expect(sceneText(runRedo(runRedo(backTwo)).doc)).toBe('One.\n\nTwo again.')
  })

  it('knows when the page has changed since a beat was written, so it is not simply undone', () => {
    let s = stateFrom('')
    let beats: BeatParagraphs = {}
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'One.'))
    ;({ state: s, beats } = writeBeat(s, beats, 2, 'Two.'))
    const mark = markPage(s)
    expect(unchangedSince(s, mark)).toBe(true)
    // Undone and redone back to it: still the newest step.
    expect(unchangedSince(runRedo(runUndo(s)), mark)).toBe(true)
    // Adam's typing (even put back as it was) is a step of its own after it.
    const typed = s.apply(s.tr.insertText('Adam ', 1))
    expect(unchangedSince(typed, mark)).toBe(false)
    const putBack = typed.apply(typed.tr.delete(1, 6))
    expect(putBack.doc.eq(s.doc)).toBe(true)
    expect(unchangedSince(putBack, mark)).toBe(false)
    expect(unchangedSince(s, null)).toBe(false)
  })

  it("after Adam's own change, takes the beat out as a step of its own, so his change is never undone with it", () => {
    let s = stateFrom('')
    let beats: BeatParagraphs = {}
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'One.'))
    ;({ state: s, beats } = writeBeat(s, beats, 2, 'Two.'))
    s = s.apply(s.tr.insertText('Adam: ', 1))
    // The new version waits at the end; its first words take the old beat out, then follow.
    s = apply(s, startStream(s, 'g2b', { noBreak: true }))
    s = s.apply(removeParagraphs(s, beats[2])!)
    let split = newSplitState()
    const r = splitChunk(split, 'Two again.')
    split = r.state
    s = apply(s, appendStream(s, r.ops))
    s = commitStream(apply(s, finishStreamText(s)))
    expect(sceneText(s.doc)).toBe('Adam: One.\n\nTwo again.')
    // Ctrl+Z takes the new version out, again puts the old one back, and Adam's change stays throughout.
    const back = runUndo(s)
    expect(sceneText(back.doc)).toBe('Adam: One.')
    expect(sceneText(runUndo(back).doc)).toBe('Adam: One.\n\nTwo.')
  })

  it('puts a first beat that replaced the scene back in its place again, so one Ctrl+Z brings the old text back', () => {
    let s = stateFrom('The old draft.')
    let beats: BeatParagraphs = {}
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'One.', { replace: true }))
    expect(sceneText(s.doc)).toBe('One.')
    expect(isWholePage(s.doc, beats[1])).toBe(true)
    const mark = markPage(s)
    // Held while it waits, then undone: the old text is back, and the new version takes its place again.
    s = waitAndEnd(s, 'g1b', { replace: true })
    expect(unchangedSince(s, mark)).toBe(true)
    s = runUndo(s)
    expect(sceneText(s.doc)).toBe('The old draft.')
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'One again.', { replace: true, id: 'g1b' }))
    expect(sceneText(s.doc)).toBe('One again.')
    expect(sceneText(runUndo(s).doc)).toBe('The old draft.')
  })

  it("is only written again while it ends the scene; the scene so far says when Adam's own words come after the beat before", () => {
    let s = stateFrom('')
    let beats: BeatParagraphs = {}
    ;({ state: s, beats } = writeBeat(s, beats, 1, 'One.'))
    ;({ state: s, beats } = writeBeat(s, beats, 2, 'Two.\n\nThree.'))
    expect(endsPage(s.doc, beats[2])).toBe(true)
    expect(endsPage(s.doc, beats[1])).toBe(false)
    expect(endsWithBeat(s.doc, beats, 3)).toBe(true)
    // Writing beat 2 again carries on from beat 1.
    expect(endsWithBeat(s.doc, beats, 2, 2)).toBe(true)
    expect(startOf(s.doc, beats[2])).toBe(filledParagraphs(s.doc)[1].pos)
    // Adam adds a paragraph of his own at the end.
    const end = s.doc.content.size
    s = s.apply(s.tr.insert(end, s.schema.nodes.paragraph.create(null, s.schema.text('Adam adds this.'))))
    expect(endsPage(s.doc, beats[2])).toBe(false)
    expect(endsWithBeat(s.doc, beats, 3)).toBe(false)
    expect(startOf(stateFrom('').doc, beats[2])).toBeNull()
  })

  it('notes which record wrote each paragraph, once', () => {
    const owners = withOwner({}, ['a', 'b'], 'g1')
    expect(owners).toEqual({ a: 'g1', b: 'g1' })
    expect(withOwner(owners, ['a'], 'g1')).toBe(owners)
    expect(withOwner(owners, ['b', 'c'], 'g2')).toEqual({ a: 'g1', b: 'g2', c: 'g2' })
  })
})
