// SCENE (chat Phase 3): the open scene's words for the briefing, numbered as read_scene numbers them; a long scene as a
// window around the selection (or its quote), else its end. Invented text only.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import { chatSwitches, memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { EditorAgent } from './agent'
import { aboutTheWords, PAGE_SMALL_WORDS, PAGE_WINDOW_WORDS, pageText, quotedPassage } from './page'

afterEach(() => chatSwitches(null))

describe('a request about the words', () => {
  it('is an edit the page is enough for; one about the story’s records looks them up first', () => {
    for (const q of [
      'tighten this',
      'Push this beat harder',
      'make her angrier',
      'About this passage: “The open issue of the ledger.”\n\nfix this'
    ])
      expect(aboutTheWords(q), q).toBe(true)
    for (const q of [
      'Fix the open issue in this scene',
      'Change chapter 2’s POV to Corran',
      'Mark the ledger thread as paid off',
      'Update her memory entry'
    ])
      expect(aboutTheWords(q), q).toBe(false)
  })
})

type Node = { type: string; attrs?: { pid: string }; content?: { type: string; text: string; marks?: { type: string }[] }[] }

/** A scene of paragraphs with ids p1, p2...; `italic` puts the words between underscores in italics. */
function scene(paras: string[]) {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  const content: Node[] = paras.map((t, i) => ({
    type: 'paragraph',
    attrs: { pid: `p${i + 1}` },
    content: t
      .split(/(_[^_]+_)/)
      .filter(Boolean)
      .map((part) =>
        part.startsWith('_') ? { type: 'text', text: part.slice(1, -1), marks: [{ type: 'italic' }] } : { type: 'text', text: part }
      )
  }))
  const plain = paras.map((t) => t.replace(/_/g, '')).join('\n\n')
  repo.saveSceneText(db, sceneId, { type: 'doc', content }, plain)
  return { db, story, sceneId }
}

const SHORT = ['The lamp-keeper counted the gulls.', '“They’re _late_,” said Corran.', 'Nobody answered him.']

/** Paragraph i of a long scene: fifty words, its number spelt out at the start so it can be told apart. */
const longPara = (i: number): string => `Para${i} ${Array.from({ length: 49 }, (_, k) => `w${k}`).join(' ')}.`

describe('the page', () => {
  it('is the whole short scene, numbered exactly as read_scene numbers it, italics marked', () => {
    chatSwitches(null)
    const { db, story, sceneId } = scene(SHORT)
    const page = pageText(db, sceneId, { question: 'tighten this' })!
    expect(page.whole).toBe(true)
    const read = new EditorAgent(
      db,
      { storyId: story.id, sceneId, prefs: defaultWritingPrefs() },
      () => undefined,
      () => undefined
    ).run({
      id: 'c1',
      name: 'read_scene',
      arguments: '{}'
    }).result
    const body = '[1] The lamp-keeper counted the gulls.\n\n[2] “They’re *late*,” said Corran.\n\n[3] Nobody answered him.'
    expect(read).toContain(body)
    expect(page.forms[0]).toContain(body)
    expect(page.forms[0]).toContain('all 3 paragraphs')
    expect(page.forms[0]).toContain('*asterisks* mark italics')
    expect(page.forms).toHaveLength(1)
  })

  it('is nothing for a scene with no words', () => {
    const { db, sceneId } = scene([])
    expect(pageText(db, sceneId, { question: 'write the next bit' })).toBeNull()
  })

  it('shows a long scene’s end, saying which paragraphs are left out', () => {
    const { db, sceneId } = scene(Array.from({ length: 60 }, (_, i) => longPara(i + 1)))
    const page = pageText(db, sceneId, { question: 'the ending is flat' })!
    expect(page.whole).toBe(false)
    expect(page.anchored).toBe(false)
    const shown = PAGE_WINDOW_WORDS / 50
    expect(page.forms[0]).toContain(`paragraphs ${61 - shown}-60 of 60 shown`)
    expect(page.forms[0]).toContain(`[paragraphs 1-${60 - shown} not shown; read_scene for the rest]`)
    expect(page.forms[0]).toContain('[60] Para60 ')
    expect(page.forms[0]).not.toContain(`[${60 - shown}] `)
    // The smaller form: fewer paragraphs at the same place.
    expect(page.forms[1]).toContain(`[paragraphs 1-${60 - PAGE_SMALL_WORDS / 50} not shown; read_scene for the rest]`)
  })

  it('puts the window around the selection, by its paragraphs’ ids or by its words, or around the passage the question quotes', () => {
    const { db, sceneId } = scene(Array.from({ length: 60 }, (_, i) => longPara(i + 1)))
    const byPid = pageText(db, sceneId, { question: 'fix this', selection: { text: 'Para20 w0', pids: ['p20'] } })!
    expect(byPid.anchored).toBe(true)
    expect(byPid.forms[0]).toContain('[20] Para20 ')
    expect(byPid.forms[0]).toContain('[paragraphs 1-')
    expect(byPid.forms[0]).toMatch(/\[paragraphs \d+-60 not shown; read_scene for the rest\]$/)
    const byWords = pageText(db, sceneId, { question: 'fix this', selection: { text: `${longPara(12)}\n\n${longPara(13)}` } })!
    expect(byWords.anchored).toBe(true)
    expect(byWords.forms[0]).toContain('[12] Para12 ')
    expect(byWords.forms[0]).toContain('[13] Para13 ')
    const quote = `About this passage: “${longPara(33).slice(0, 60)}”\n\nthis drags`
    expect(quotedPassage(quote)).toBe(longPara(33).slice(0, 60))
    const byQuote = pageText(db, sceneId, { question: quote })!
    expect(byQuote.anchored).toBe(true)
    expect(byQuote.forms[0]).toContain('[33] Para33 ')
    // Words that aren't in the scene place nothing: the end, as with no selection.
    expect(pageText(db, sceneId, { question: 'About this passage: “Nothing like this is written.”\n\nfix' })!.anchored).toBe(false)
  })
})
