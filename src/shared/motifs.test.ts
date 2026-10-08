import { describe, expect, it } from 'vitest'
import { MOTIF_IDS, MOTIFS, motifById, motifScores, pickMotif, pickStoryMotif, wordsOf } from './motifs'

describe('the drawing library', () => {
  it('has about forty drawings, each with words that call for it', () => {
    expect(MOTIFS.length).toBeGreaterThanOrEqual(40)
    expect(new Set(MOTIF_IDS).size).toBe(MOTIF_IDS.length)
    for (const m of MOTIFS) {
      expect(m.words.length, m.id).toBeGreaterThan(3)
      expect(m.label).toMatch(/^[A-Z]/)
    }
    expect(motifById('lantern')?.label).toBe('A lantern')
    expect(motifById('no-such-drawing')).toBeNull()
  })

  it('reads possessives and plurals as the word', () => {
    expect(wordsOf('The Keeper’s keys, and the Board’s letters.')).toEqual(['the', 'keeper', 'keys', 'and', 'the', 'board', 'letters'])
  })
})

describe('picking a drawing for an entry', () => {
  it('weighs the name most, then the one-liner, the telling fields and the description', () => {
    const s = motifScores(
      [
        { text: 'The Harbourmaster', weight: 3 },
        { text: 'Keeps a sword under the counter', weight: 1 }
      ],
      'character'
    )
    expect(s.get('anchor')).toBe(3)
    // The sword suits a character: a point more.
    expect(s.get('sword')).toBe(2)
  })

  it('with nothing to go on, gives one of the kind’s own drawings, the same every time', () => {
    const a = pickMotif({ kind: 'place', name: 'Vellamy' })
    expect(['house', 'tower', 'mountain', 'forest', 'bridge', 'gate', 'tree']).toContain(a)
    expect(pickMotif({ kind: 'place', name: 'Vellamy' })).toBe(a)
    expect(['quill', 'rose', 'mask', 'star', 'eye', 'key', 'ring', 'compass']).toContain(pickMotif({ kind: 'character', name: 'Odo Brask' }))
  })
})

describe('a story’s cover', () => {
  it('takes its drawing from its title and premise', () => {
    expect(pickStoryMotif({ title: 'The Sunken Crown', premise: '' })).toBe('crown')
    expect(pickStoryMotif({ title: 'Untitled', premise: '' })).toBe('lantern')
  })
})
