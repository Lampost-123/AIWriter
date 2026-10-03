import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import { history } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import { appendStream, commitStream, docFromText, finishStreamText, startStream, streamPlugin } from '@/features/editor/streamDoc'
import { newSplitState, splitChunk } from '@/features/editor/streamText'
import { liveChecksKey, livePlugin } from './liveDecorations'

// Made-up text only.
const schema = getSchema(sceneExtensions())
const stateFrom = (text: string): EditorState =>
  EditorState.create({ schema, doc: docFromText(schema, text), plugins: [history(), streamPlugin, livePlugin] })
const apply = (s: EditorState, tr: Transaction | null): EditorState => (tr ? s.apply(tr) : s)

/** Streams a draft in and ends it, as the editor does. */
function draft(s: EditorState, chunks: string[], opts: { replace?: boolean } = {}): EditorState {
  let state = apply(s, startStream(s, 'g1', opts))
  let split = newSplitState()
  for (const c of chunks) {
    const r = splitChunk(split, c)
    split = r.state
    state = apply(state, appendStream(state, r.ops))
  }
  return commitStream(apply(state, finishStreamText(state)))
}

const draftFrom = (s: EditorState): number | null => liveChecksKey.getState(s)?.draftFrom ?? null

describe('where a draft that landed begins, for the count of common AI phrases', () => {
  it('is where a draft added below begins', () => {
    const s0 = stateFrom('The ferry was late.')
    const s = draft(s0, ['Her breath hitched.'])
    const from = draftFrom(s)
    expect(from).not.toBeNull()
    expect(s.doc.textBetween(from!, s.doc.content.size, '\n')).toContain('Her breath hitched.')
    expect(s.doc.textBetween(0, from!, '\n')).toContain('The ferry was late.')
  })

  it('is the top of the scene when the draft replaced its text', () => {
    const s0 = stateFrom('The ferry was late.')
    const s = draft(s0, ['Her breath hitched.'], { replace: true })
    expect(s.doc.textContent).toBe('Her breath hitched.')
    expect(draftFrom(s)).toBe(0)
  })

  it('is nothing when no words arrived', () => {
    const s0 = stateFrom('The ferry was late.')
    expect(draftFrom(draft(s0, []))).toBeNull()
    expect(draftFrom(draft(s0, [], { replace: true }))).toBeNull()
  })
})
