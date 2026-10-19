// Directed writing in the page: a retake takes the draft's last paragraph back while it streams (streamDoc.ts
// takeBackStream), the paragraph written again lands where it was, the scene's own words are never touched, and the whole
// draft is still one Ctrl+Z when it ends. And the draft options' choice for one draft (store.ts withDirected).
import { describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import { appendStream, commitStream, docFromText, sceneText, startStream, streamPlugin, takeBackStream } from '@/features/editor/streamDoc'
import { newSplitState, splitChunk, type SplitState } from '@/features/editor/streamText'

vi.mock('@/lib/api', () => ({ api: {}, onEvent: () => () => undefined }))
vi.mock('@/components/ui', () => ({ toast: () => undefined }))

const schema = getSchema(sceneExtensions())
const apply = (s: EditorState, tr: Transaction | null): EditorState => (tr ? s.apply(tr) : s)

/** A draft streaming into the page as the editor does it, with take-backs as a directed draft sends them. */
function page(text: string) {
  let state = EditorState.create({ schema, doc: docFromText(schema, text), plugins: [history(), streamPlugin] })
  state = apply(state, startStream(state, 'g1'))
  let split: SplitState = newSplitState()
  return {
    write(chunk: string) {
      const r = splitChunk(split, chunk)
      split = r.state
      state = apply(state, appendStream(state, r.ops))
    },
    takeBack() {
      state = apply(state, takeBackStream(state))
      // As the editor's controller does: the next words go where the paragraph was.
      split = { started: true, pendingBreak: false, lineStart: true }
    },
    end() {
      state = commitStream(state)
    },
    get text() {
      return sceneText(state.doc)
    },
    get state() {
      return state
    }
  }
}

describe('taking the last paragraph back for a retake', () => {
  it('the paragraph goes, and the one written again lands where it was', () => {
    const p = page('')
    p.write('Mara waited by the door.\n\nShe pulled her coat ')
    p.write('tighter.')
    p.takeBack()
    expect(p.text).toBe('Mara waited by the door.')
    p.write('She held her hands to the fire.')
    p.write('\n\nTobin knocked.')
    expect(p.text).toBe('Mara waited by the door.\n\nShe held her hands to the fire.\n\nTobin knocked.')
  })

  it('never touches the scene’s own words above the draft, and the draft is one Ctrl+Z when it ends', () => {
    const p = page('Adam’s own opening.')
    p.write('The draft’s paragraph.')
    p.takeBack()
    p.takeBack()
    expect(p.text).toBe('Adam’s own opening.\n\n* * *')
    p.write('Written again.')
    p.end()
    expect(p.text).toBe('Adam’s own opening.\n\n* * *\n\nWritten again.')
    let back = p.state
    undo(p.state, (tr) => (back = p.state.apply(tr)))
    expect(sceneText(back.doc)).toBe('Adam’s own opening.')
  })

  it('nothing to take back when no draft is writing', () => {
    const s = EditorState.create({ schema, doc: docFromText(schema, 'Words.'), plugins: [history(), streamPlugin] })
    expect(takeBackStream(s)).toBeNull()
  })
})

describe('the draft options’ choice for one draft', () => {
  it('goes into the next draft’s options once, then the draft options follow Settings again', async () => {
    const { setOnce, withDirected, useDirector } = await import('./store')
    const opts = { direction: '', targetWords: 400, creativity: 'balanced' as const }
    expect(withDirected(opts, 's1')).toEqual(opts)
    setOnce('s1', true)
    expect(withDirected(opts, 's1')).toEqual({ ...opts, directed: true })
    expect(useDirector.getState().once.s1).toBeUndefined()
    expect(withDirected(opts, 's1')).toEqual(opts)
    setOnce('s1', false)
    expect(withDirected(opts, 's1').directed).toBe(false)
  })
})
