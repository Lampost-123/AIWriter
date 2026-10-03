import { describe, expect, it } from 'vitest'
import { findSlop, PROMPT_SLOP, SLOP_GROUPS, SLOP_PHRASES, slopById } from './slop'

// Made-up sentences only.
const ids = (text: string): string[] => findSlop(text).map((m) => m.id)
const words = (text: string): string[] => findSlop(text).map((m) => m.text)

describe('common AI phrases', () => {
  it('finds stock body reactions, in their common forms', () => {
    expect(ids('She let out a breath she didn’t know she was holding.')).toEqual(['breath-holding'])
    expect(ids('He let go of a breath he hadn’t realised he’d been holding.')).toEqual(['breath-holding'])
    expect(ids('A shiver ran down her spine.')).toEqual(['spine-shiver'])
    expect(ids('Her heart hammered against her ribs.')).toEqual(['heart-ribs'])
    expect(ids('A muscle ticked in his jaw.')).toEqual(['jaw-muscle'])
    expect(ids('A smile tugged at the corner of her mouth. A grin played on his lips.')).toEqual(['smile-tug', 'smile-tug'])
    expect(ids('Her breath hitched.')).toEqual(['breath-hitch'])
    expect(ids('His voice was barely above a whisper.')).toEqual(['whisper'])
    expect(ids('Something flickered in his eyes.')).toEqual(['flicker'])
    expect(ids('A wave of relief washed over her.')).toEqual(['wave-washed'])
    expect(ids('She steeled herself and knocked.')).toEqual(['steeled'])
  })

  it('finds grand abstractions', () => {
    expect(ids('The bridge was a testament to their stubbornness.')).toEqual(['testament'])
    expect(ids('The market was a rich tapestry of colours and smells.')).toEqual(['tapestry'])
    expect(ids('A symphony of birdsong rose from the hedges.')).toEqual(['symphony'])
    expect(ids('The words hung in the air. The air was thick with tension.')).toEqual(['hung-air', 'air-thick'])
    expect(ids('The room held its breath.')).toEqual(['world-breath'])
    expect(ids('They sat in companionable silence.')).toEqual(['comfortable-silence'])
  })

  it('finds stock sentence patterns', () => {
    expect(ids('It wasn’t fear. It was something colder.')).toEqual(['not-x-but-y'])
    expect(ids('It wasn’t anger — it was grief.')).toEqual(['not-x-but-y'])
    expect(ids('She felt a strange mix of dread and excitement.')).toEqual(['mix-of'])
    expect(ids('He couldn’t help but laugh.')).toEqual(['help-but'])
    expect(ids('Something shifted between them.')).toEqual(['something-shifted'])
    expect(ids('In that moment, she knew.')).toEqual(['in-that-moment'])
    expect(ids('Little did she know, the ferry had already gone.')).toEqual(['little-know'])
  })

  it('finds summing-up lines and overused words', () => {
    expect(ids('And somehow, that was enough.')).toEqual(['was-enough'])
    expect(ids('Whatever came next, they would face it together.')).toEqual(['face-together'])
    expect(ids('This was only the beginning.')).toEqual(['only-beginning'])
    expect(ids('They delved into the archive. Her green orbs widened. He smirked.')).toEqual(['delve', 'orbs', 'smirk'])
  })

  it('gives offsets and the words as written, in order, whatever their case', () => {
    const text = 'Rain fell. HER BLOOD RAN COLD, and a pang of guilt followed.'
    const found = findSlop(text)
    expect(found.map((m) => [m.id, m.group, m.text])).toEqual([
      ['blood-cold', 'body', 'HER BLOOD RAN COLD'.slice(4)],
      ['pang', 'body', 'a pang of']
    ])
    for (const m of found) expect(text.slice(m.from, m.to)).toBe(m.text)
  })

  it('never overlaps: the earliest and then the longest wins', () => {
    // "smirk" is an overused word on its own, and part of "a smirk tugged at his lips".
    const found = findSlop('A smirk tugged at his lips.')
    expect(found.map((m) => m.id)).toEqual(['smile-tug'])
    expect(found[0].text).toBe('smirk tugged at his lips')
  })

  it('leaves near misses in ordinary prose alone', () => {
    const plain = [
      'The mage raised an orb of light above the crowd.',
      'Three glowing orbs of light drifted over the marsh.',
      'She clenched her fist and waited.',
      'Firelight flickered across his face.',
      'The air was thick with smoke from the forge.',
      'A tapestry of the old king’s hunt hung behind the throne.',
      'The dance of the harvest moon began at dusk.',
      'The lighthouse was a beacon of light on the cliff.',
      'Mix of flour and water, then knead it for ten minutes. She stirred a mix of flour and water.',
      'Something shifted in the undergrowth.',
      'It wasn’t late, but the streets were already empty.',
      'The lamp was dim, but it was enough to read by.',
      'His heart was in the right place.',
      'She kept her breath steady and her voice low.',
      'The steel blade caught the light.',
      'He spun the steering wheel and the car swung left.'
    ]
    for (const text of plain) expect(words(text), text).toEqual([])
  })

  it('knows every phrase by id and every group by name', () => {
    const seen = new Set<string>()
    for (const p of SLOP_PHRASES) {
      expect(seen.has(p.id), p.id).toBe(false)
      seen.add(p.id)
      expect(SLOP_GROUPS[p.group]).toBeTruthy()
      expect(slopById(p.id)).toBe(p)
      expect(p.pattern.flags).toContain('g')
    }
    expect(slopById('nothing-like-this')).toBeNull()
    expect(PROMPT_SLOP.length).toBeGreaterThan(0)
    expect(PROMPT_SLOP.length).toBeLessThan(SLOP_PHRASES.length)
  })

  it('finds the same phrases when run twice (no regular expression left part-way)', () => {
    const text = 'Her breath hitched. In that moment, her breath hitched again.'
    expect(ids(text)).toEqual(['breath-hitch', 'in-that-moment', 'breath-hitch'])
    expect(ids(text)).toEqual(['breath-hitch', 'in-that-moment', 'breath-hitch'])
  })
})
