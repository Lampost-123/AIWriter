import { describe, expect, it } from 'vitest'
import { parseLenient, readingReply } from './json'
import { diffParagraphs, findNearQuote, locateQuote, mentionAt, onlyTypos, sceneParagraphs, textParas } from './text'
import { planChunks, readingBudget } from './request'
import { cleanSummary } from './prompts'

describe('reading the memory model’s reply', () => {
  it('forgives code fences, words around the object, comments and trailing commas', () => {
    const r = parseLenient(
      'Sure, here it is:\n```json\n{"facts": [], "add": [{"type": "entry", "name": "Mara",},], // done\n "clashes": []}\n```\nHope that helps!'
    )
    expect(r.ok).toBe(true)
    const reply = readingReply((r as { value: unknown }).value)
    expect(reply.ok && reply.reply.add[0]).toEqual({ type: 'entry', name: 'Mara' })
  })

  it('says what was wrong, in a few words', () => {
    expect(parseLenient('')).toEqual({ ok: false, why: 'it was empty' })
    expect(parseLenient('No facts here.')).toEqual({ ok: false, why: 'there was no JSON object in it' })
    expect(parseLenient('{"facts": [ {"id": ')).toEqual({ ok: false, why: 'it stopped before the JSON object was finished' })
    expect(readingReply({ hello: 1 })).toEqual({ ok: false, why: 'it had none of the "facts", "add" and "clashes" lists' })
    expect(readingReply({ add: 'x' })).toEqual({ ok: false, why: 'its "add" was not a list' })
  })
})

describe('paragraphs and what changed', () => {
  it('uses the editor’s paragraph ids, or the plain text when a paragraph has none', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { pid: 'a' }, content: [{ type: 'text', text: 'One.' }] },
        { type: 'blockquote', content: [{ type: 'paragraph', attrs: { pid: 'b' }, content: [{ type: 'text', text: 'Two.' }] }] }
      ]
    }
    expect(sceneParagraphs(doc, 'One.\n\nTwo.').map((p) => [p.id, p.text])).toEqual([
      ['a', 'One.'],
      ['b', 'Two.']
    ])
    const noIds = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One.' }] }] }
    expect(sceneParagraphs(noIds, 'One.\n\nTwo.').map((p) => [p.id, p.offset])).toEqual([
      ['#0', 0],
      ['#1', 6]
    ])
  })

  it('a moved paragraph is not a change; an edited one is, with what it said before', () => {
    const before = textParas('First.\n\nSecond.').map((p, i) => ({ ...p, id: ['a', 'b'][i] }))
    const now = [
      { ...before[1], id: 'b', pid: 'b' },
      { id: 'a', pid: 'a', text: 'First, changed.', hash: 'x', offset: null }
    ]
    const d = diffParagraphs(before, now)
    expect(d.changed.map((p) => p.text)).toEqual(['First, changed.'])
    expect(d.gone.map((p) => p.text)).toEqual(['First.'])
    expect(d.before.get('a')).toBe('First.')
  })

  it('knows a typo fix from a real change', () => {
    expect(onlyTypos('Mara lost her left hand.', 'Mara lost her left  hand!')).toBe(true)
    expect(onlyTypos('She crossed the river.', 'She crosed the river.')).toBe(true)
    expect(onlyTypos('Mara lost her left hand.', 'Mara lost her right hand.')).toBe(false)
    expect(findNearQuote('Then Mara lost her left hand in the rivr.', 'lost her left hand in the river')).toEqual({ start: 10, end: 40 })
  })
})

describe('the words a fact rests on', () => {
  const text = 'The rain had not let up. Mara kept her hood low and her left sleeve pinned, the way she always did now.'

  it('finds them exactly, allowing for curly quotes, case and spacing', () => {
    expect(locateQuote(text, '“Mara kept her hood low”')).toBe('Mara kept her hood low')
    expect(locateQuote(text, 'mara  kept her HOOD low')).toBe('Mara kept her hood low')
  })

  it('takes the closest sentence when the quote is a near miss, and nothing when nothing is close', () => {
    expect(locateQuote(text, 'Mara kept her hood down and her left sleeve pinned')).toBe(
      'Mara kept her hood low and her left sleeve pinned, the way she always did now.'
    )
    expect(locateQuote(text, 'Tobin sold the boat to a stranger')).toBeNull()
  })

  it('matches a name as a whole word, and a one-word name only with its capital', () => {
    expect(mentionAt('Will you come?', 'Will')).toEqual({ start: 0, end: 4 })
    expect(mentionAt('I will come.', 'Will')).toBeNull()
    expect(mentionAt('Marama came.', 'Mara')).toBeNull()
    expect(mentionAt('the old woman laughed', 'The Old Woman')).toEqual({ start: 0, end: 13 })
  })
})

describe('fitting the model', () => {
  it('splits the paragraphs to read into chunks that fit a small model', () => {
    const budget = readingBudget({ contextLength: 3000, maxOutput: null })!
    expect(budget.reply).toBeGreaterThanOrEqual(400)
    expect(budget.available).toBeLessThan(3000)
    const paras = textParas(Array.from({ length: 10 }, (_, i) => `Paragraph ${i}. ${'Words go on and on. '.repeat(40)}`).join('\n\n'))
    const chunks = planChunks(paras, paras, [], budget)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap((c) => c.paras)).toHaveLength(10)
  })

  it('says when a model is too small to read anything', () => {
    expect(readingBudget({ contextLength: 900, maxOutput: null })).toBeNull()
  })
})

describe('summaries', () => {
  it('tidies a summary reply', () => {
    expect(cleanSummary('Summary: "Mara crossed the river.\n\nShe was alone."')).toBe('Mara crossed the river. She was alone.')
  })
})
