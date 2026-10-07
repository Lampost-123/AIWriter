import { describe, expect, it } from 'vitest'
import { saidLines, saidText, type SaidFact } from './said'

const names: Record<string, string> = { mara: 'Mara', tobin: 'Tobin', kell: 'Kell', ana: 'Ana' }
const nameOf = (id: string): string | null => names[id] ?? null
const said = (factId: string, by: string, words: string, order: number, kind: SaidFact['kind'] = 'promise'): [string, SaidFact] => [
  factId,
  { factId, kind, by, words, where: `Book 1, Ch 1, Sc ${order}`, order }
]

describe('what was said', () => {
  const facts = [
    { factId: 'f1', fact: 'Mara will come back for Tobin before the snow', knownBy: ['mara', 'tobin'] },
    { factId: 'f2', fact: 'Kell will drown Ana if she talks', knownBy: ['kell', 'ana'] },
    { factId: 'f3', fact: 'The heir is alive', knownBy: ['ana', 'tobin'] },
    { factId: 'f4', fact: 'An ordinary fact nobody said', knownBy: ['mara'] }
  ]
  const map = new Map([said('f1', 'mara', '“I will come back for you before the snow.”', 1), said('f2', 'kell', 'Talk and you drown.', 3, 'threat'), said('f3', 'ana', 'The heir lives.', 5, 'secret')])

  it('sends the lines said or heard by someone in the scene, newest first, with who heard them', () => {
    const lines = saidLines(facts, map, { nameOf, inScene: new Set(['tobin']) })
    expect(lines.map((l) => l.fact)).toEqual(['The heir is alive', 'Mara will come back for Tobin before the snow'])
    expect(lines[1]).toMatchObject({ kind: 'promise', by: 'Mara', heard: ['Tobin'], here: true, found: false })
  })

  it('adds lines a search found, after those of people here', () => {
    const lines = saidLines(facts, map, { nameOf, inScene: new Set(['mara']), found: ['f2'] })
    expect(lines.map((l) => l.kind)).toEqual(['promise', 'threat'])
    expect(lines[1]).toMatchObject({ here: false, found: true })
  })

  it('never sends a fact that was not said, or one not known here', () => {
    const lines = saidLines(facts.slice(3), map, { nameOf, inScene: new Set(['mara', 'tobin', 'kell', 'ana']) })
    expect(lines).toEqual([])
  })

  it('reads in plain words, with the exact line', () => {
    const [l] = saidLines(facts, map, { nameOf, inScene: new Set(['mara']) })
    expect(saidText(l)).toBe(
      '- Mara’s promise to Tobin (Book 1, Ch 1, Sc 1): “I will come back for you before the snow.” That is: Mara will come back for Tobin before the snow.'
    )
    const [t] = saidLines(facts, map, { nameOf, inScene: new Set(['kell']) })
    expect(saidText(t)).toBe('- Kell’s threat to Ana (Book 1, Ch 1, Sc 3): “Talk and you drown.” That is: Kell will drown Ana if she talks.')
  })
})
