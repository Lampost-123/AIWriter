import { describe, expect, it } from 'vitest'
import type { Outline } from '@shared/types'
import { appearsBands, dossierGroups, factDefs, factsOf, kickerOf, numeral, relationLine, voiceOf } from './dossierLogic'

describe('the dossier’s sections', () => {
  it('puts a kind’s short fields along the top, and leaves them out of the sections below', () => {
    expect(factDefs('character').map((f) => f.key)).toEqual(['pronouns', 'age', 'role'])
    expect(factDefs('group').map((f) => f.key)).toEqual(['category'])
    expect(factDefs('event').map((f) => f.key)).toEqual(['when'])
    expect(factDefs('place')).toEqual([])
    const wren = { kind: 'character' as const, fields: { age: '19', role: 'protagonist', eyes: 'grey', speech: 'Short, plain sentences.' } }
    expect(factsOf(wren)).toEqual([
      { key: 'pronouns', label: 'Pronouns', value: '' },
      { key: 'age', label: 'Age', value: '19' },
      { key: 'role', label: 'Role', value: 'Protagonist' }
    ])
    const groups = dossierGroups(wren)
    // Basics is all facts, so it has no section of its own.
    expect(groups.map((g) => g.group.id)).toEqual(['looks', 'personality', 'backstory', 'arc', 'voice'])
    expect(groups[0].filled.map((f) => [f.def.key, f.value])).toEqual([['eyes', 'grey']])
    expect(groups.find((g) => g.group.id === 'voice')!.filled).toHaveLength(1)
    expect(groups.find((g) => g.group.id === 'arc')!.filled).toHaveLength(0)
  })

  it('reads a character’s sample lines as quotes, one a row', () => {
    expect(voiceOf({ speech: ' Plain. ', sampleLines: '“Right, then.”\n- "Wick first."\n\n  glass after  ', tics: 'hums' })).toEqual({
      speech: 'Plain.',
      lines: ['Right, then.', 'Wick first.', 'glass after'],
      rest: [{ key: 'tics', value: 'hums' }]
    })
    expect(voiceOf({})).toEqual({ speech: '', lines: [], rest: [] })
  })

  it('says over the name what it is and how often it appears', () => {
    expect(kickerOf({ kind: 'character', fields: {}, hardRule: false }, 4)).toBe('Character · in 4 scenes')
    expect(kickerOf({ kind: 'lore', fields: {}, hardRule: true }, 1)).toBe('Lore · Hard rule · in 1 scene')
    expect(kickerOf({ kind: 'place', fields: {}, hardRule: false }, 0)).toBe('Place · not in a scene yet')
    expect(kickerOf({ kind: 'place', fields: {}, hardRule: false }, null)).toBe('Place')
  })

  it('draws "Appears in" as the story’s chapters with a dot for each scene', () => {
    const scene = (id: string, chapterId: string, position: number, status: 'planned' | 'drafted' = 'drafted') =>
      ({ id, chapterId, position, status, title: id.toUpperCase() }) as Outline['scenes'][number]
    const outline = {
      chapters: [
        { id: 'c2', title: 'The Drowned Steps', position: 1 },
        { id: 'c1', title: 'The Night Ferry', position: 0 },
        { id: 'c3', title: '', position: 2 }
      ] as Outline['chapters'],
      scenes: [scene('s2', 'c1', 1), scene('s1', 'c1', 0), scene('s3', 'c2', 0), scene('s4', 'c2', 1, 'planned'), scene('s5', 'c3', 0)]
    }
    const bands = appearsBands(outline, [{ sceneId: 's1' }, { sceneId: 's3' }], 's3')
    expect(
      bands.map((b) => [
        b.numeral,
        b.title,
        b.dots.map((d) => `${d.sceneId}${d.on ? '+' : ''}${d.current ? '*' : ''}${d.planned ? '?' : ''}`)
      ])
    ).toEqual([
      ['I', 'The Night Ferry', ['s1+', 's2']],
      ['II', 'The Drowned Steps', ['s3+*', 's4?']]
    ])
    // Every chapter, when asked (a short story), the untitled one named by its number.
    expect(appearsBands(outline, [], null, true).map((b) => b.title)).toEqual(['The Night Ferry', 'The Drowned Steps', 'Chapter 3'])
    expect(appearsBands(null, [], null)).toEqual([])
    expect([1, 4, 9, 14, 39, 40].map(numeral)).toEqual(['I', 'IV', 'IX', 'XIV', 'XXXIX', '40'])
  })

  it('reads a relationship from this entry’s side', () => {
    const self = { id: 'ansel', name: 'Ansel Crane' }
    expect(
      relationLine(
        { fromId: 'ansel', otherId: 'board', type: 'member (harbourmaster)', selfFeels: 'loyal, uneasily' },
        self,
        'The Harbour Board'
      )
    ).toBe('Member of The Harbour Board (harbourmaster) · loyal, uneasily')
    expect(relationLine({ fromId: 'wren', otherId: 'wren', type: 'goddaughter', selfFeels: '' }, self, 'Wren Halloway')).toBe(
      'Wren: goddaughter of Ansel Crane'
    )
  })
})
