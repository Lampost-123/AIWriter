import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import { history } from '@tiptap/pm/history'
import type { Decoration } from '@tiptap/pm/view'
import { sceneExtensions } from './extensions'
import { appendStream, commitStream, docFromText, finishStreamText, startStream, streamPlugin } from './streamDoc'
import type { StreamOp } from './streamText'
import { arrivalKey, arrivalPlugin, PRUNE_MS, regionTextLength, settleWords, type ArrivalOptions } from './arrival'

const schema = getSchema(sceneExtensions())

/** A page with the lamp, on a clock the test moves by hand. */
function setup(text: string, o: Omit<ArrivalOptions, 'now'> = {}) {
  const clock = { t: 1000 }
  const state = EditorState.create({
    schema,
    doc: docFromText(schema, text),
    plugins: [history(), streamPlugin, arrivalPlugin({ now: () => clock.t, look: () => true, motion: () => true, ...o })]
  })
  return { clock, state }
}

const apply = (s: EditorState, tr: Transaction | null): EditorState => (tr ? s.apply(tr) : s)
const words = (text: string): StreamOp[] => [{ kind: 'text', text }]
const para: StreamOp[] = [{ kind: 'paragraph' }]
const chunk = (s: EditorState, ops: StreamOp[]): EditorState => apply(s, appendStream(s, ops))
const finish = (s: EditorState): EditorState => commitStream(apply(s, finishStreamText(s)))

const decos = (s: EditorState, kind: string): Decoration[] =>
  (arrivalKey.getState(s)?.set.find(undefined, undefined, (spec: { aw?: string }) => spec.aw === kind) ?? []).sort((a, b) => a.from - b.from)
/** The words each fade mark covers. */
const fading = (s: EditorState): string[] => decos(s, 'arrive').map((d) => s.doc.textBetween(d.from, d.to))
/** The text of each paragraph a node decoration of this kind is on. */
const marked = (s: EditorState, kind: string): string[] => decos(s, kind).map((d) => s.doc.nodeAt(d.from)?.textContent ?? '')

describe('the lamp: words arriving', () => {
  it('fades in only the new tail of the draft, chunk by chunk', () => {
    const { clock, state } = setup('Adam wrote this.')
    let s = apply(state, startStream(state, 'g1'))
    s = chunk(s, words('The tide '))
    expect(fading(s)).toEqual(['The tide '])
    clock.t += 30
    s = chunk(s, words('came in.'))
    // The earlier words keep their own mark (still fading); only the new ones get a new one.
    expect(fading(s)).toEqual(['The tide ', 'came in.'])
    // Adam's own text never fades.
    expect(fading(s).join('')).not.toContain('Adam')
  })

  it('a new paragraph in the chunk: the tail is counted back across it', () => {
    const { clock, state } = setup('')
    let s = apply(state, startStream(state, 'g1'))
    s = chunk(s, words('One.'))
    clock.t += 30
    s = chunk(s, [...words(' Two.'), ...para, ...words('Three')])
    expect(fading(s)).toEqual(['One.', ' Two.', 'Three'])
  })

  it('turning *asterisks* into italics fades nothing again', () => {
    const { clock, state } = setup('')
    let s = apply(state, startStream(state, 'g1'))
    s = chunk(s, words('She said *hello'))
    clock.t += 30
    s = chunk(s, words('* and left'))
    expect(s.doc.textContent).toBe('She said hello and left')
    // Two asterisks went: the five characters that are new on the page fade, and nothing before them again.
    expect(fading(s)).toEqual(['and left'])
    expect(fading(s).join('')).not.toContain('She said')
  })

  it('lets go of marks older than 200 ms on the next chunk, or when asked a moment later', () => {
    const { clock, state } = setup('')
    let s = apply(state, startStream(state, 'g1'))
    s = chunk(s, words('First '))
    clock.t += PRUNE_MS + 10
    s = chunk(s, words('second '))
    expect(fading(s)).toEqual(['second '])
    expect(arrivalKey.getState(s)?.arriving).toBe(true)
    clock.t += PRUNE_MS + 10
    s = s.apply(s.tr.setMeta(arrivalKey, { type: 'prune' }))
    expect(fading(s)).toEqual([])
    expect(arrivalKey.getState(s)?.arriving).toBe(false)
  })

  it('replacing the scene: the old text going is not counted against the new words', () => {
    const { state } = setup('A long old paragraph that is about to go.')
    let s = apply(state, startStream(state, 'g1', { replace: true }))
    s = chunk(s, words('New'))
    expect(s.doc.textContent).toBe('New')
    expect(fading(s)).toEqual(['New'])
  })

  it('counts the region from the draft’s start', () => {
    const doc = docFromText(schema, 'Ab.\n\nCde.')
    expect(regionTextLength(doc, 0)).toBe(7)
    expect(regionTextLength(doc, doc.child(0).nodeSize)).toBe(4)
    expect(regionTextLength(doc, doc.content.size)).toBe(0)
  })
})

describe('the lamp: the line, the warm ink and the settle', () => {
  it('the paragraph being written has the lamp line; the draft’s paragraphs are in warm ink, Adam’s are not', () => {
    const { state } = setup('Adam wrote this.')
    let s = apply(state, startStream(state, 'g1'))
    s = chunk(s, [...words('One.'), ...para, ...words('Two')])
    expect(marked(s, 'writing')).toEqual(['Two'])
    expect(marked(s, 'drafting')).toEqual(['One.', 'Two'])
  })

  it('settles every landed paragraph into ink when the draft ends, then takes the class away', () => {
    const { clock, state } = setup('Adam wrote this.')
    let s = apply(state, startStream(state, 'g1'))
    s = chunk(s, [...words('One.'), ...para, ...words('Two.')])
    clock.t += 50
    s = finish(s)
    expect(s.doc.textContent).toBe('Adam wrote this.One.Two.')
    expect(marked(s, 'settle')).toEqual(['One.', 'Two.'])
    expect(decos(s, 'writing')).toEqual([])
    expect(decos(s, 'drafting')).toEqual([])
    // The fade marks went with the draft being put back as one undo step.
    expect(fading(s)).toEqual([])
    s = s.apply(s.tr.setMeta(arrivalKey, { type: 'unsettle' }))
    expect(decos(s, 'settle')).toEqual([])
    expect(arrivalKey.getState(s)?.settle).toBeNull()
  })

  it('settles a draft that replaced the scene', () => {
    const { state } = setup('Old words.')
    let s = apply(state, startStream(state, 'g1', { replace: true }))
    s = chunk(s, [...words('New one.'), ...para, ...words('New two.')])
    s = finish(s)
    expect(marked(s, 'settle')).toEqual(['New one.', 'New two.'])
  })

  it('accepted words settle as a stretch of their own', () => {
    const { state } = setup('Adam wrote this.')
    const tr = state.tr.insertText(' More.', state.doc.content.size - 1)
    const s = state.apply(settleWords(tr, 17, 23))
    const d = decos(s, 'settle')
    expect(d.map((x) => s.doc.textBetween(x.from, x.to))).toEqual([' More.'])
  })

  it('less motion: no fade and no settle, but the lamp line still shows', () => {
    const { state } = setup('Adam wrote this.', { motion: () => false })
    let s = apply(state, startStream(state, 'g1'))
    s = chunk(s, words('One.'))
    expect(fading(s)).toEqual([])
    expect(marked(s, 'writing')).toEqual(['One.'])
    s = finish(s)
    expect(decos(s, 'settle')).toEqual([])
  })

  it('Classic: nothing at all', () => {
    const { state } = setup('Adam wrote this.', { look: () => false })
    let s = apply(state, startStream(state, 'g1'))
    s = chunk(s, words('One.'))
    expect(arrivalKey.getState(s)?.set.find()).toEqual([])
    s = finish(s)
    expect(arrivalKey.getState(s)?.set.find()).toEqual([])
  })
})
