// Directed writing's stretches: how a draft is cut into stretches, how a stretch stops cleanly, and the writer's requests.
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import {
  lastParagraph,
  lastSentenceEnd,
  LEAST_STRETCH_WORDS,
  MOST_STRETCHES,
  planStretches,
  STRETCH_WORDS,
  StretchCutter,
  stretchAsk,
  stretchMessages,
  stretchTokens
} from './stretch'

const words = (n: number, w = 'word'): string => Array.from({ length: n }, () => w).join(' ')

describe('planStretches', () => {
  it('one beat a stretch, the length shared out', () => {
    const p = planStretches(['Mara finds the letter.', 'Tobin knocks.', 'She hides it.'], 600)
    expect(p.units.map((u) => u.beats)).toEqual([['Mara finds the letter.'], ['Tobin knocks.'], ['She hides it.']])
    expect(p.units.map((u) => u.words)).toEqual([200, 200, 200])
    expect(p.target).toBe(600)
  })

  it('short beats are written together, never under the least a stretch is asked for', () => {
    const p = planStretches(['A.', 'B.', 'C.', 'D.', 'E.', 'F.'], 300)
    expect(p.units).toHaveLength(Math.floor(300 / LEAST_STRETCH_WORDS))
    expect(p.units.flatMap((u) => u.beats)).toEqual(['A.', 'B.', 'C.', 'D.', 'E.', 'F.'])
    expect(p.units.every((u) => u.words >= LEAST_STRETCH_WORDS)).toBe(true)
  })

  it('never more than twelve stretches, every beat kept', () => {
    const beats = Array.from({ length: 20 }, (_, i) => `Beat number ${i + 1}.`)
    const p = planStretches(beats, 5000)
    expect(p.units).toHaveLength(MOST_STRETCHES)
    expect(p.units.flatMap((u) => u.beats)).toEqual(beats)
  })

  it('no beats: about 250 words a stretch', () => {
    const p = planStretches([], 1000)
    expect(p.units).toHaveLength(Math.round(1000 / STRETCH_WORDS))
    expect(p.units.every((u) => u.beats.length === 0 && u.words === 250)).toBe(true)
  })

  it('Auto: about 280 words a beat, within Auto’s bounds', () => {
    expect(planStretches(['One.', 'Two.', 'Three.', 'Four.'], null).target).toBe(1120)
    expect(planStretches(['One.'], null).target).toBe(800)
    expect(planStretches([], null).units).toHaveLength(8)
  })

  it('a stretch’s reply room is its words in tokens, with room to spare', () => {
    expect(stretchTokens(200)).toBeGreaterThan(200 * 1.35)
    expect(stretchTokens(200)).toBeLessThan(200 * 1.35 * 2)
  })
})

describe('StretchCutter', () => {
  it('lets the words through as they come until near the end', () => {
    const c = new StretchCutter({ stopAt: 100, holdAt: 80 })
    expect(c.push('The rain fell. ').out).toBe('The rain fell. ')
    expect(c.push('Mara wai').out).toBe('Mara wai')
  })

  it('stops at the first paragraph’s end past its words; what follows the break never goes', () => {
    const c = new StretchCutter({ stopAt: 10, holdAt: 8 })
    let out = c.push(`${words(6)}.\n\n${words(3)}`).out
    const r = c.push(` and more words here.\n\nThe next paragraph`)
    out += r.out
    expect(r.stop).toBe(true)
    expect(out).toBe(`${words(6)}.\n\n${words(3)} and more words here.`)
    expect(c.push('ignored').out).toBe('')
    expect(c.end(false)).toBe('')
  })

  it('past its words, a sentence still being written waits until it ends', () => {
    const c = new StretchCutter({ stopAt: 100, holdAt: 5 })
    expect(c.push(`${words(6)}. She looked`).out).toBe(`${words(6)}.`)
    expect(c.push(' up. Then').out).toBe(' She looked up.')
  })

  it('cut off by the reply limit, an unfinished sentence never reaches the page', () => {
    const c = new StretchCutter({ stopAt: 100, holdAt: 5 })
    const shown = c.push(`${words(6)}. She looked up and saw the`).out
    expect(shown).toBe(`${words(6)}.`)
    expect(c.end(true)).toBe('')
    expect(c.kept()).toBe(`${words(6)}.`)
  })

  it('a reply that ends of itself gives out all it held', () => {
    const c = new StretchCutter({ stopAt: 100, holdAt: 5 })
    c.push(`${words(6)}. She looked up`)
    expect(c.end(false)).toBe(' She looked up')
  })

  it('a closing quote after the mark stays with its sentence', () => {
    expect(lastSentenceEnd('"Go." She went')).toBe(5)
    expect(lastSentenceEnd('He said, "Go.')).toBe(0)
    expect(lastSentenceEnd('He said, "Go."', true)).toBe(14)
  })
})

describe('lastParagraph', () => {
  it('is what follows the last line break, as the page splits paragraphs', () => {
    expect(lastParagraph('One.\n\nTwo.\n\nThree.')).toBe('Three.')
    expect(lastParagraph('One.\nTwo.')).toBe('Two.')
    expect(lastParagraph('Only.\n\n')).toBe('Only.')
    expect(lastParagraph('')).toBe('')
  })
})

describe('the writer’s requests', () => {
  const base: ChatMessage[] = [
    { role: 'system', content: 'You are a novelist.' },
    { role: 'user', content: 'The briefing.\n\nNow the prose itself:', cacheUpTo: 13 }
  ]

  it('the first stretch: the ask after the briefing’s closing words, the start of the request untouched', () => {
    const m = stretchMessages(base, '', 'Write only stretch 1 of 3 now.')
    expect(m).toHaveLength(2)
    expect(m[0]).toEqual(base[0])
    expect(m[1].content.startsWith(base[1].content)).toBe(true)
    expect(m[1].cacheUpTo).toBe(13)
    expect(m[1].content.endsWith('Write only stretch 1 of 3 now.')).toBe(true)
  })

  it('later stretches: the briefing exactly as it was, the draft so far as the writer’s own words, then the ask', () => {
    const m = stretchMessages(base, 'Mara waited.\n\n', 'Carry on.')
    expect(m.slice(0, 2)).toEqual(base)
    expect(m[2]).toEqual({ role: 'assistant', content: 'Mara waited.' })
    expect(m[3]).toEqual({ role: 'user', content: 'Carry on.' })
  })

  it('asks for the stretch’s beat and length, with the notes first', () => {
    const ask = stretchAsk({
      stretch: 2,
      of: 3,
      unit: { beats: ['Someone knocks at the door'], words: 220 },
      note: 'Slow down here',
      adam: ['slower'],
      last: false,
      closing: '',
      first: false
    })
    expect(ask).toContain('The author’s note, just now: “slower”')
    expect(ask).toContain('Director’s note: Slow down here.')
    expect(ask).toContain('Write stretch 2 of 3, about 220 words: “Someone knocks at the door.”')
    expect(ask.indexOf('Director’s note')).toBeLessThan(ask.indexOf('Write stretch'))
  })

  it('the first stretch says how directed writing goes; the last ends on the closing image', () => {
    const first = stretchAsk({ stretch: 1, of: 2, unit: { beats: ['A.'], words: 200 }, note: '', adam: [], last: false, closing: '', first: true })
    expect(first).toContain('Write only stretch 1 of 2 now, about 200 words: “A.”')
    expect(first).toContain('a director reads each stretch')
    const last = stretchAsk({ stretch: 2, of: 2, unit: { beats: ['B.'], words: 200 }, note: '', adam: [], last: true, closing: 'the lamp going out', first: false })
    expect(last).toContain('This is the last stretch: end the scene on its closing image, “the lamp going out.”')
  })

  it('a retake quotes the paragraph and says what is wrong', () => {
    const ask = stretchAsk({
      stretch: 1,
      of: 2,
      unit: { beats: [], words: 200 },
      note: 'Keep her coat on the peg.',
      adam: [],
      last: false,
      closing: '',
      first: false,
      retake: { paragraph: 'Mara pulled her coat tighter.', reason: 'Her coat is off' }
    })
    expect(ask).toContain('Take your last paragraph again. It read:\n“Mara pulled her coat tighter.”')
    expect(ask).toContain('What’s wrong: Her coat is off.')
    expect(ask).toContain('one paragraph only, then stop')
  })
})
