// The writer's tags on a draft's paragraphs: each line's speaker and how, and the narrator's mood carried on from the
// writer's last tilde tag, so a draft it tagged in full needs no AI call.
import { describe, expect, it } from 'vitest'
import { castOf } from './cast'
import { unmarkedIn } from './speakers'
import { writerBlocks } from './writerBlocks'

const cast = castOf([
  { id: 'mara', name: 'Mara', aliases: [], about: '' },
  { id: 'tobin', name: 'Tobin', aliases: [], about: '' }
])
const paragraphs = [
  { pid: 'a', text: 'The rain had not let up.' },
  { pid: 'b', text: '“You came,” he said, as if he had laid money on the opposite.' },
  { pid: 'c', text: '“I said I would.” She did not sit.' }
]
const given = [
  { key: '~the rain had not let up', who: '', tone: 'low and watchful' },
  { key: 'you came', who: 'Tobin', tone: 'dry, a little amused' },
  { key: 'i said i would', who: 'mara', tone: 'flat and certain', pace: 'slow' as const, sound: '(sigh)' }
]

describe('the writer’s tags on a draft', () => {
  it('carry the narrator’s mood into paragraphs it didn’t tag, dialogue tags included, so nothing is left to mark', () => {
    const { blocks, left } = writerBlocks({ paragraphs, given, cast, kept: new Map(), tone: true })
    expect(left).toEqual([])
    for (const b of blocks) expect(unmarkedIn(b.text, b.speakers, b.delivery), b.id).toEqual([])
    const b = blocks.find((x) => x.id === 'b')!
    expect(b.speakers).toEqual({ 'you came': 'Tobin' })
    expect(b.delivery?.['~he said as if he had laid money on the opposite']).toEqual({ tone: 'low and watchful' })
    // A listed character's name as the page has it, and the pace and sound the tag gave.
    const c = blocks.find((x) => x.id === 'c')!
    expect(c.speakers).toEqual({ 'i said i would': 'Mara' })
    expect(c.delivery?.['i said i would']).toEqual({ tone: 'flat and certain', pace: 'slow', sound: '(sigh)' })
  })

  it('carry no mood before the writer’s first tilde tag, nor without Mark who says what', () => {
    const noMood = given.slice(1)
    const { blocks } = writerBlocks({ paragraphs, given: noMood, cast, kept: new Map(), tone: true })
    expect(blocks.find((x) => x.id === 'b')?.delivery?.['~he said as if he had laid money on the opposite']).toBeUndefined()
    const off = writerBlocks({ paragraphs, given, cast, kept: new Map(), tone: false }).blocks
    expect(off.find((x) => x.id === 'b')?.delivery?.['~he said as if he had laid money on the opposite']).toBeUndefined()
  })

  it('give a line split by an action, and tagged once, to the same speaker, said the same way', () => {
    const wen = castOf([
      { id: 'wen', name: 'Old Wen', aliases: [], about: '' },
      { id: 'mara', name: 'Mara', aliases: [], about: '' }
    ])
    const split = [{ pid: 's', text: '“The lamp.” He laughed. “Thirty years I’ve kept it.” Mara waited. “Well?”' }]
    const tags = [{ key: 'the lamp', who: 'Wen', tone: 'gleeful', sound: '(laughing)' }, { key: 'well', who: 'Mara', tone: 'impatient' }]
    const [s] = writerBlocks({ paragraphs: split, given: tags, cast: wen, kept: new Map(), tone: true }).blocks
    // "Wen" is Old Wen, the only character whose name has it.
    expect(s.speakers).toEqual({ 'the lamp': 'Old Wen', 'thirty years i ve kept it': 'Old Wen', well: 'Mara' })
    expect(s.delivery?.['thirty years i ve kept it']).toEqual({ tone: 'gleeful' })
  })

  it('leave what is kept already, and the tags nobody took for later', () => {
    const kept = new Map([['b', { speakers: { 'you came': 'Mara' } }]])
    const { blocks, left } = writerBlocks({ paragraphs, given, cast, kept, tone: true, only: new Set(['a', 'b']) })
    expect(blocks.find((x) => x.id === 'b')?.speakers).toEqual({ 'you came': 'Mara' })
    expect(left.map((g) => g.key)).toEqual(['you came', 'i said i would'])
  })
})
