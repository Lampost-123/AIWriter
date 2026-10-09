import { describe, expect, it } from 'vitest'
import { MOTIF_IDS, MOTIFS, motifById, motifScores, pickMotif, pickMotifs, pickStoryMotif, wordsOf } from './motifs'

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

describe('drawings side by side', () => {
  const keeper = (id: string, name: string) => ({ id, kind: 'character' as const, name, summary: 'Keeps the lighthouse lamp' })

  it('gives the next entry another good drawing rather than the same one twice', () => {
    const picks = pickMotifs([keeper('a', 'Ansel'), keeper('b', 'Brin')])
    expect(picks.get('a')).toBe('lantern')
    expect(picks.get('b')).toBe('tower')
  })

  it('lets the entry whose words call for a drawing most keep it', () => {
    const lamplighter = { id: 'c', kind: 'character' as const, name: 'The Lamplighter', summary: 'Keeps the lighthouse lamp' }
    const picks = pickMotifs([keeper('a', 'Ansel'), lamplighter])
    expect(picks.get('c')).toBe('lantern')
    expect(picks.get('a')).not.toBe('lantern')
  })

  it('repeats one only when nothing else its words call for is good enough', () => {
    const one = { id: 'x', kind: 'item' as const, name: 'Sword' }
    const two = { id: 'y', kind: 'item' as const, name: 'Sword' }
    const picks = pickMotifs([one, two])
    expect(picks.get('x')).toBe('sword')
    expect(picks.get('y')).toBe('sword')
  })

  it('never changes a drawing Adam chose, and counts it as taken', () => {
    const top = pickMotif(keeper('a', 'Ansel'))
    const picks = pickMotifs([keeper('a', 'Ansel'), keeper('b', 'Brin')], { b: top })
    expect(picks.get('b')).toBe(top)
    expect(picks.get('a')).not.toBe(top)
  })

  it('gives entries no words call for different drawings of their kind’s own', () => {
    const picks = pickMotifs([
      { id: '1', kind: 'place', name: 'Vellamy' },
      { id: '2', kind: 'place', name: 'Vellamy' }
    ])
    expect(picks.get('1')).toBe(pickMotif({ kind: 'place', name: 'Vellamy' }))
    expect(picks.get('2')).not.toBe(picks.get('1'))
  })
})
