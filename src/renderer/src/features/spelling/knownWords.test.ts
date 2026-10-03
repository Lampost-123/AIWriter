import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { sceneExtensions } from '@/features/editor/extensions'
import { docFromText } from '@/features/editor/streamDoc'
import type { Plugin } from '@tiptap/pm/state'
import { KNOWN_WORD_CLASS, KnownWords, knownWordMarks, knownWordsForTests, knownWordsKey } from './knownWords'

const schema = getSchema(sceneExtensions())

const marked = (doc: ReturnType<typeof docFromText>): string[] =>
  knownWordMarks(doc)
    .find()
    .filter((d) => (d.spec as unknown) !== undefined)
    .map((d) => doc.textBetween(d.from, d.to))

describe('words that count as correct in the page', () => {
  it('marks the world’s names and Adam’s own words, and nothing else', () => {
    knownWordsForTests(['Teshra', 'Quellmoor', 'grimdark'])
    const doc = docFromText(schema, 'Teshra waited for Quellmoor’s boat.\n\nA grimdark night; nobody came.')
    expect(marked(doc)).toEqual(['Teshra', 'Quellmoor’s', 'grimdark'])
    const deco = knownWordMarks(doc).find()[0] as unknown as { type: { attrs: { class: string } } }
    expect(deco.type.attrs.class).toBe(KNOWN_WORD_CLASS)
  })

  it('marks again as the page changes, only where it changed', () => {
    knownWordsForTests(['Teshra'])
    const plugins = (KnownWords.config.addProseMirrorPlugins as () => Plugin[])()
    let state = EditorState.create({ schema, doc: docFromText(schema, 'Teshra slept.\n\nNobody here.'), plugins })
    const shown = (): string[] => (knownWordsKey.getState(state)?.find() ?? []).map((d) => state.doc.textBetween(d.from, d.to))
    expect(shown()).toEqual(['Teshra'])
    const end = state.doc.content.size - 1
    state = state.apply(state.tr.insertText(' Teshra came.', end))
    expect(shown()).toEqual(['Teshra', 'Teshra'])
    // Typing inside a marked name: it isn't the name any more.
    state = state.apply(state.tr.insertText('x', 3))
    expect(shown()).toEqual(['Teshra'])
  })
})
