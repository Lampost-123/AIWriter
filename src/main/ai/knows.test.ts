import { describe, expect, it } from 'vitest'
import { cleanKnows, isPlan, pastDeathNote } from './knows'
import { realSecrets } from './mustStay'

const person = (id: string, name: string, aliases: string[] = []) => ({ id, name, kind: 'character' as const, aliases })

describe('who knows what, cleaned up', () => {
  it('gives the same fact once, the newest', () => {
    const got = cleanKnows(
      [
        { fact: 'Wren will come back for Thistle', at: 1 },
        { fact: 'Wren will come back for Thistle.', at: 5 },
        { fact: 'The clerk knows the name Edric Rone', at: 2 }
      ],
      { happened: [] }
    )
    expect(got).toEqual([
      { fact: 'Wren will come back for Thistle.', at: 5 },
      { fact: 'The clerk knows the name Edric Rone', at: 2 }
    ])
    // One inside a longer one: the longer.
    expect(cleanKnows([{ fact: 'Gale has been to the Assay Office' }, { fact: 'Gale has been to the Assay Office in Carrow twice' }], { happened: [] })).toHaveLength(1)
    // Different numbers are different facts.
    expect(cleanKnows([{ fact: 'Secret 1' }, { fact: 'Secret 2' }], { happened: [] })).toHaveLength(2)
  })

  it('leaves out a plan that has happened, or whose time has passed', () => {
    const happened = [
      { note: 'The brass compass given by Wren to Pell at the ferry', at: 4 },
      { note: 'Ash walked to the coast', at: 7 }
    ]
    const facts = [
      { fact: 'Wren will give Pell the brass compass at the ferry', at: 3 },
      { fact: 'Gale will ask again in the morning', at: 2 },
      { fact: 'Gale will ask again in the morning', at: 6 },
      { fact: 'Wren will lay the survey before the Assize', at: 3 }
    ]
    expect(cleanKnows(facts, { happened }).map((f) => f.fact)).toEqual(['Gale will ask again in the morning', 'Wren will lay the survey before the Assize'])
    expect(isPlan('Wren will cross at the ferry')).toBe(true)
    expect(isPlan('Wren crossed at the ferry')).toBe(false)
    // No place on the line: never judged past.
    expect(cleanKnows([{ fact: 'Gale will ask again in the morning' }], { happened })).toHaveLength(1)
  })

  it('a death told later loses its "this afternoon"', () => {
    expect(pastDeathNote('died this afternoon in his chair in the survey room')).toBe('died in his chair in the survey room')
    expect(pastDeathNote('was killed just now, by the gate')).toBe('was killed, by the gate')
    expect(pastDeathNote('drowned in the Linn')).toBe('drowned in the Linn')
  })
})

describe('real secrets', () => {
  const wren = person('w', 'Wren Hollis')
  const ash = person('a', 'Ash Penrose')
  it('never kept from someone the fact is about, the same fact once, at most three', () => {
    const facts = [
      { factId: '1', fact: 'Wren will go up to the abbey in the morning', knownBy: ['a'] },
      { factId: '2', fact: 'Ash has a debt in Carrow', knownBy: ['w'] },
      { factId: '3', fact: 'The survey shows a coal seam', knownBy: ['w'], at: 3 },
      { factId: '4', fact: 'The survey shows a coal seam.', knownBy: ['w'], at: 5 },
      { factId: '5', fact: 'Gale works for the Warden', knownBy: ['w'] },
      { factId: '6', fact: 'The ferry runs at dawn', knownBy: ['w'] },
      { factId: '7', fact: 'The bridge is down', knownBy: ['w'] }
    ]
    const got = realSecrets([wren, ash], facts, { happened: [] })
    expect(got).toHaveLength(3)
    expect(got.map((s) => s.fact)).not.toContain('Wren will go up to the abbey in the morning')
    expect(got.map((s) => s.fact)).not.toContain('Ash has a debt in Carrow')
    expect(got.filter((s) => s.fact.startsWith('The survey shows'))).toHaveLength(1)
    expect(got.every((s) => s.keptFrom.join() === 'Ash Penrose')).toBe(true)
    // By a first name too.
    expect(realSecrets([wren, ash], [{ factId: 'x', fact: 'Ash owes Gale money', knownBy: ['w'] }], { happened: [] })).toEqual([])
  })

  it('only people know or are kept from a secret, never an animal (round G: "Kept from Cinder")', () => {
    const facts = [{ factId: '1', fact: 'The survey shows a coal seam', knownBy: ['w'] }]
    // An invented pony, by its summary, a tag, its pronouns, or another name.
    const animals = [
      { ...person('p', 'Bramble'), summary: "Tobin's brown pony, sure-footed on the fells", tags: [] as string[], fields: {} },
      { ...person('p', 'Bramble'), summary: 'Stubborn and old', tags: ['pony'], fields: {} },
      { ...person('p', 'Bramble'), summary: 'Stubborn and old', tags: [] as string[], fields: { pronouns: 'it' } },
      { ...person('p', 'Bramble', ['the old cob']), summary: '', tags: [] as string[], fields: {} }
    ]
    for (const pony of animals) {
      expect(realSecrets([wren, pony], facts, { happened: [] }), pony.summary || pony.aliases.join()).toEqual([])
      expect(realSecrets([wren, ash, pony], facts, { happened: [] })).toEqual([{ fact: 'The survey shows a coal seam', knownBy: ['Wren Hollis'], keptFrom: ['Ash Penrose'] }])
    }
    // A person (by summary or pronouns), or an animal that talks, still counts.
    const people = [
      { ...person('p', 'Bramble'), summary: 'A stable boy with a pony of his own', tags: [] as string[], fields: {} },
      { ...person('p', 'Bramble'), summary: 'Stubborn and old', tags: [] as string[], fields: { pronouns: 'he/him' } },
      { ...person('p', 'Bramble'), summary: 'A talking pony who serves the Warden', tags: [] as string[], fields: {} },
      { ...person('p', 'Bramble'), summary: '', tags: ['horse', 'servant'], fields: {} }
    ]
    for (const p of people)
      expect(realSecrets([wren, p], facts, { happened: [] }), p.summary || p.tags.join()).toEqual([{ fact: 'The survey shows a coal seam', knownBy: ['Wren Hollis'], keptFrom: ['Bramble'] }])
  })
})
