import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { sceneExtensions } from '@/features/editor/extensions'
import { docFromText } from '@/features/editor/streamDoc'
import { keepsLineBreaks } from '@shared/contracts/edits'
import { BREAK, cleanReply, continuePlace, joinSpaces, newParagraphs, parseAlternatives, sameWords, selectedWords, textOf, wordsIn } from './text'

const schema = getSchema(sceneExtensions())
const { paragraph: p, horizontalRule: hr, hardBreak } = schema.nodes
const t = (text: string, marks: string[] = []) =>
  schema.text(
    text,
    marks.map((m) => schema.marks[m].create())
  )
const docOf = (...blocks: PMNode[]): PMNode => schema.nodes.doc.create(null, blocks)

/** Where some words are in the page. */
function rangeOf(doc: PMNode, words: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isTextblock) return true
    const i = node.textContent.indexOf(words)
    if (i >= 0) found = { from: pos + 1 + i, to: pos + 1 + i + words.length }
    return false
  })
  if (!found) throw new Error(`Not in the page: ${words}`)
  return found
}

const selecting = (doc: PMNode, from: number, to: number): EditorState =>
  EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to) })

describe('the page’s words, as the AI is sent them', () => {
  const doc = docOf(
    p.create(null, [t('He knows, ', ['italic']), t('she thought. It was '), t('late', ['bold']), t('.')]),
    hr.create(),
    p.create(null, [t('First line'), hardBreak.create(), t('second line')])
  )

  it('marks italics and bold with asterisks, keeping spaces outside them, and shows scene breaks and line breaks', () => {
    expect(textOf(doc, 0, doc.content.size)).toBe('*He knows,* she thought. It was **late**.\n\n* * *\n\nFirst line\nsecond line')
  })

  it('counts a paragraph it only touches as an empty one, so the text before a paragraph’s start ends with a blank line', () => {
    const second = rangeOf(doc, 'First line').from
    expect(textOf(doc, 0, second)).toBe('*He knows,* she thought. It was **late**.\n\n* * *\n\n')
    const late = rangeOf(doc, 'late')
    expect(textOf(doc, late.from, late.to)).toBe('**late**')
    expect(textOf(doc, late.to, doc.content.size)).toBe('.\n\n* * *\n\nFirst line\nsecond line')
  })
})

describe('the selected words', () => {
  const doc = docOf(
    p.create(null, t('Mara pushed the door open.  ')),
    p.create(null, t('The tavern was warm.')),
    hr.create(),
    p.create(null, t('Morning came.'))
  )

  it('leaves out the spaces and paragraph ends at the edges of the selection', () => {
    const start = rangeOf(doc, 'open.').from
    const end = rangeOf(doc, 'The tavern').from
    expect(selectedWords(selecting(doc, start, end))).toEqual({ from: start, to: start + 5 })
    const all = rangeOf(doc, 'The tavern was warm.')
    expect(selectedWords(selecting(doc, rangeOf(doc, 'open.').to + 1, all.to))).toEqual(all)
  })

  it('needs words, all on one side of a scene break', () => {
    const r = rangeOf(doc, 'open.')
    expect(selectedWords(selecting(doc, r.to, r.to + 2))).toEqual({ problem: 'Select some words first.' })
    expect(selectedWords(EditorState.create({ schema, doc }))).toEqual({ problem: 'Select some words first.' })
    const across = selectedWords(selecting(doc, rangeOf(doc, 'warm').from, rangeOf(doc, 'Morning').to))
    expect(across).toEqual({ problem: 'Select words on one side of the scene break: the AI tools work on one part of a scene at a time.' })
  })
})

describe('where Continue carries on', () => {
  it('carries on a paragraph that stops mid-sentence, has words after the cursor, or is empty', () => {
    const doc = docFromText(schema, 'Mara pushed the door and\n\nShe waited. Then')
    expect(continuePlace(doc, rangeOf(doc, 'door and').to)).toEqual({ at: rangeOf(doc, 'door and').to, mode: 'inline' })
    const mid = rangeOf(doc, 'She waited.').to
    expect(continuePlace(doc, mid)).toEqual({ at: mid, mode: 'inline' })
    const empty = docOf(p.create(null, t('She waited.')), p.create())
    expect(continuePlace(empty, empty.content.size - 1)).toEqual({ at: empty.content.size - 1, mode: 'inline' })
  })

  it('adds paragraphs after one that is finished', () => {
    const doc = docFromText(schema, 'Mara pushed the door open.\n\n“Late again,” he said.”')
    const end = rangeOf(doc, 'open.').to
    expect(continuePlace(doc, end)).toEqual({ at: end, mode: 'paragraph' })
    const said = rangeOf(doc, 'he said.”')
    expect(continuePlace(doc, said.to)).toEqual({ at: said.to, mode: 'paragraph' })
  })

  it('puts new paragraphs ahead of a paragraph when the cursor is at its start (after a scene break too)', () => {
    const doc = docFromText(schema, 'Mara pushed the door open.\n\nNobody looked up.')
    const start = rangeOf(doc, 'Nobody').from
    expect(continuePlace(doc, start)).toEqual({ at: start, mode: 'before' })
    // Only spaces before the cursor count as its start.
    const spaced = docOf(p.create(null, t('She waited.')), p.create(null, t('  Nobody looked up.')))
    const at = rangeOf(spaced, '  Nobody').from
    expect(continuePlace(spaced, at + 2)).toEqual({ at, mode: 'before' })
    const broken = docOf(p.create(null, t('She waited.')), hr.create(), p.create(null, t('Morning came.')))
    const morning = rangeOf(broken, 'Morning').from
    expect(continuePlace(broken, morning)).toEqual({ at: morning, mode: 'before' })
  })

  it('carries on after the last selected word, not where a selection dragged on to the next paragraph ends', () => {
    const doc = docFromText(schema, 'She waited.\n\nHe came.')
    const end = rangeOf(doc, 'He came.').from
    const words = wordsIn(doc, rangeOf(doc, 'She waited.').from, end)
    expect(words).toEqual(rangeOf(doc, 'She waited.'))
    expect(continuePlace(doc, words!.to)).toEqual({ at: words!.to, mode: 'paragraph' })
    expect(wordsIn(doc, end - 1, end)).toBeNull()
  })

  it('carries on after the whole word when the cursor is inside one', () => {
    const doc = docFromText(schema, 'She watched the door. I don’t know, said the well-known man')
    const door = rangeOf(doc, 'door')
    expect(continuePlace(doc, door.from + 2)).toEqual({ at: door.to, mode: 'inline' })
    // Right at a word's end, or between words, it stays where it is.
    expect(continuePlace(doc, door.to)).toEqual({ at: door.to, mode: 'inline' })
    expect(continuePlace(doc, door.from - 1)).toEqual({ at: door.from - 1, mode: 'inline' })
    const dont = rangeOf(doc, 'don’t')
    expect(continuePlace(doc, dont.from + 3)).toEqual({ at: dont.to, mode: 'inline' })
    const known = rangeOf(doc, 'well-known')
    expect(continuePlace(doc, known.from + 4)).toEqual({ at: known.to, mode: 'inline' })
    // The last word of a paragraph: after it, at the paragraph's end.
    const man = rangeOf(doc, 'man')
    expect(continuePlace(doc, man.from + 1)).toEqual({ at: man.to, mode: 'inline' })
    const done = docFromText(schema, 'She sat down.\n\nNobody moved.')
    expect(continuePlace(done, rangeOf(done, 'down.').from + 2)).toEqual({ at: rangeOf(done, 'down').to, mode: 'inline' })
  })

  it('needs words before the cursor', () => {
    const doc = docFromText(schema, '')
    expect(continuePlace(doc, 1)).toEqual({
      problem: 'There’s nothing to carry on from yet. Write a line or two first, or press Generate to draft the scene.'
    })
    // At the very start of a scene with words, it says where to put the cursor instead.
    const scene = docFromText(schema, 'Mara pushed the door open.\n\nNobody looked up.')
    expect(continuePlace(scene, 1)).toEqual({
      problem: 'Continue carries on from the words before the cursor. Put the cursor after some words, such as at the end of the scene.'
    })
  })

  it('joins a continuation with a space between words, and none before punctuation', () => {
    expect(joinSpaces('the door and', 'stepped in', '')).toEqual({ lead: ' ', trail: '' })
    expect(joinSpaces('the door and ', 'stepped in', '')).toEqual({ lead: '', trail: '' })
    expect(joinSpaces('the door', ', slowly,', ' and went in.')).toEqual({ lead: '', trail: '' })
    expect(joinSpaces('the door', 'slowly', 'and went in.')).toEqual({ lead: ' ', trail: ' ' })
  })
})

describe('the AI’s reply', () => {
  it('leaves out a lead-in line, a heading or fences around the words', () => {
    expect(cleanReply("Here's the condensed version:\n\nThe tavern was warm.", true)).toBe('The tavern was warm.')
    expect(cleanReply('Sure! Here is the rewrite:\nThe tavern was warm.', true)).toBe('The tavern was warm.')
    expect(cleanReply('```\nThe tavern was warm.\n```', true)).toBe('The tavern was warm.')
    expect(cleanReply('**Rewritten:**\nThe tavern was warm.', true)).toBe('The tavern was warm.')
    expect(cleanReply('# The Gilded Eel\n\nThe tavern was warm.', true)).toBe('The tavern was warm.')
    expect(cleanReply('The tavern was warm.\n\nIt was loud.', true)).toBe('The tavern was warm.\n\nIt was loud.')
  })

  it('holds back a first line that may be a lead-in until it ends, and shows other words as they come', () => {
    expect(cleanReply("Here's the", false)).toBe('')
    expect(cleanReply("Here's the rewrite:\nThe tav", false)).toBe('The tav')
    expect(cleanReply('Here', false)).toBe('')
    expect(cleanReply('Here the road narrowed', false)).toBe('Here the road narrowed')
    expect(cleanReply('Here the road narrowed.\nIt', false)).toBe('Here the road narrowed.\nIt')
    expect(cleanReply('The tavern was', false)).toBe('The tavern was')
    expect(cleanReply('Warm.', true)).toBe('Warm.')
  })

  it('takes away quotation marks around the whole reply when the words had none, once it has all arrived', () => {
    expect(cleanReply('"The tavern was warm."', true, { selection: 'The tavern was hot.' })).toBe('The tavern was warm.')
    expect(cleanReply('“The tavern was warm.”', false, { selection: 'The tavern was hot.' })).toBe('“The tavern was warm.”')
    expect(cleanReply('“Go,” she said.', true, { selection: '“Leave,” she said.' })).toBe('“Go,” she said.')
    expect(cleanReply('“Go,” she said. “Now.”', true, { selection: 'She told him to go.' })).toBe('“Go,” she said. “Now.”')
  })

  it('never takes the first quotation mark of a reply that starts with dialogue away while it arrives', () => {
    const reply = '“Go now and never come back,” she said, and turned back to the fire.'
    const sel = { selection: 'She told him to leave.' }
    let shown = ''
    for (let n = 1; n <= reply.length; n++) {
      const next = cleanReply(reply.slice(0, n), false, sel)
      // The words only ever grow: nothing shown goes again.
      expect(next.startsWith(shown)).toBe(true)
      if (next) expect(next.startsWith('“Go')).toBe(true)
      shown = next
    }
    expect(cleanReply(reply, true, sel)).toBe(reply)
  })

  it('reads Alternatives’ three versions, in the asked-for shape or close to it, as they arrive', () => {
    const reply = '=== Version 1 ===\nThe tavern was warm.\n\n=== Version 2 ===\nWarmth, and noise.\n=== Version 3 ===\nIt was loud and'
    expect(parseAlternatives(reply, false)).toEqual({
      versions: ['The tavern was warm.', 'Warmth, and noise.', 'It was loud and'],
      complete: 2
    })
    expect(parseAlternatives(`${reply} warm.`, true)).toEqual({
      versions: ['The tavern was warm.', 'Warmth, and noise.', 'It was loud and warm.'],
      complete: 3
    })
    const loose = 'Here are three versions:\n\n**Version 1**\nOne.\n\n### Version 2\nTwo.\n\nVersion 3:\nThree.'
    expect(parseAlternatives(loose, true)).toEqual({ versions: ['One.', 'Two.', 'Three.'], complete: 3 })
    expect(
      parseAlternatives('=== Version 1 ===\nOne.\n=== Version 2 ===\nTwo.\n=== Version 3 ===\nThree.\n=== Version 4 ===\nFour.', true)
        .versions
    ).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('never shows the next version’s heading, still arriving, as the end of the one before', () => {
    const two = '=== Version 1 ===\nThe tavern was warm.\n\n'
    for (const part of ['=', '=== ', '=== Ver', '=== Version', '=== Version 2', '=== Version 2 ==', '**Option', 'Alternative 2:']) {
      expect(parseAlternatives(`${two}${part}`, false)).toEqual({ versions: ['The tavern was warm.'], complete: 0 })
    }
    expect(parseAlternatives('=== Vers', false)).toEqual({ versions: [], complete: 0 })
    // Words that only start like one show as they come.
    expect(parseAlternatives(`${two}A quiet`, false).versions).toEqual(['The tavern was warm.\n\nA quiet'])
    expect(parseAlternatives('=== Version 1 ===\nVersions of the', false).versions).toEqual(['Versions of the'])
  })

  it('takes a reply without the versions’ lines as one version, once it has all arrived', () => {
    expect(parseAlternatives('The tavern was warm.', false)).toEqual({ versions: [], complete: 0 })
    expect(parseAlternatives('The tavern was warm.', true)).toEqual({ versions: ['The tavern was warm.'], complete: 1 })
    expect(parseAlternatives('', true)).toEqual({ versions: [], complete: 0 })
  })

  it('splits the new words into paragraphs, with scene breaks only between them', () => {
    expect(newParagraphs('One.\nTwo.\n\n* * *\n\nThree.')).toEqual(['One.', 'Two.', BREAK, 'Three.'])
    expect(newParagraphs('***\n\nOne.\n\n***')).toEqual(['One.'])
    expect(newParagraphs('')).toEqual([])
  })

  it('keeps line breaks inside a paragraph when the words sent had them', () => {
    const verse = 'Roses are red,  \nviolets are blue.\n\n* * *\n\nThe end.'
    expect(newParagraphs(verse, true)).toEqual(['Roses are red,\nviolets are blue.', BREAK, 'The end.'])
    expect(newParagraphs(verse, false)).toEqual(['Roses are red,', 'violets are blue.', BREAK, 'The end.'])
    // A newline still arriving at the end shows nothing yet.
    expect(newParagraphs('Roses are red,\n', true)).toEqual(['Roses are red,'])
    expect(newParagraphs('\n\nOne.\n\n\n\nTwo.\n\n', true)).toEqual(['One.', 'Two.'])
  })

  it('tells words with a line break inside a paragraph (the selection, or for Continue the paragraph it carries on)', () => {
    const doc = docOf(p.create(null, [t('Dear Tobin,'), hardBreak.create(), t('I am well.')]), p.create(null, t('She sealed it.')))
    const letter = textOf(doc, 0, doc.content.size)
    expect(keepsLineBreaks({ tool: 'condense', selection: letter, before: '', after: '' })).toBe(true)
    expect(keepsLineBreaks({ tool: 'condense', selection: 'One.\n\nTwo.', before: letter, after: '' })).toBe(false)
    expect(keepsLineBreaks({ tool: 'continue', selection: '', before: 'Dear Tobin,\nI am', after: ' well.\n\nShe sealed it.' })).toBe(true)
    expect(keepsLineBreaks({ tool: 'continue', selection: '', before: `${letter}\n\n`, after: 'Rain.' })).toBe(false)
  })
})

describe('sameWords', () => {
  it('is true for the same words with other spacing, quotation marks, italics marks or case', () => {
    expect(sameWords('“You came,” said Tobin.', '"You came," said Tobin.')).toBe(true)
    expect(sameWords('It was *late*  now.', ' it was late now.\n')).toBe(true)
    expect(sameWords('Ten—no, eleven.', 'Ten-no, eleven.')).toBe(true)
    expect(sameWords('She’d gone…', "She'd gone...")).toBe(true)
  })
  it('is false once any word changes', () => {
    expect(sameWords('“You came,” said Tobin.', '“You came,” said Mara.')).toBe(false)
    expect(sameWords('It was late.', 'It was late again.')).toBe(false)
  })
})
