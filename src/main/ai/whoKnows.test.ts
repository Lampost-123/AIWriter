// The writer's "Who knows what" (long story memory fix 9): everyone in the scene, what they don't know yet that someone
// here knows, what they believe wrongly, and what they know with since when and how; what matters most first, caps that
// grow with the model's room. Made-up people and facts.

import { describe, expect, it } from 'vitest'
import type { BeliefState, EntryState, FactState } from '@shared/types'
import { LEDGER_GAPS, LEDGER_LEAD, LEDGER_LINES, LEDGER_SHORT_LINES, ledgerPeople, ledgerText, type LedgerInput } from './whoKnows'

const person = (id: string, name: string, more: Partial<EntryState> = {}): EntryState =>
  ({
    id,
    name,
    kind: 'character',
    aliases: [],
    summary: '',
    description: '',
    tags: [],
    notes: '',
    fields: {},
    happened: [],
    changed: [],
    ...more
  }) as EntryState

const mara = person('m', 'Mara Venn')
const tobin = person('t', 'Tobin')
const ash = person('a', 'Ash')
const names: Record<string, string> = { m: 'Mara Venn', t: 'Tobin', a: 'Ash', g: 'Gale' }

const fact = (factId: string, text: string, knownBy: string[], at: number, since: FactState['since'] = {}, more: Partial<FactState> = {}): FactState => ({
  factId,
  fact: text,
  knownBy,
  at,
  since,
  ...more
})

const input = (more: Partial<LedgerInput> = {}): LedgerInput => ({
  people: [mara, tobin, ash],
  povId: 'm',
  facts: [],
  beliefs: [],
  happened: [],
  storyTitle: 'Book 1',
  nameOf: (id) => names[id] ?? null,
  scale: 1,
  ...more
})

const lines = (text: string | null): string[] => (text ?? '').split('\n').filter((l) => l.startsWith('- '))

describe('who knows what in the scene', () => {
  it('says, for each person, what they don’t know yet that someone here knows, with since when for one who knows', () => {
    const text = ledgerText(
      input({
        facts: [fact('will', 'The will was burned', ['t'], 4, { t: { at: 4, where: 'Book 1, Ch 2, Sc 1', how: 'saw' } })]
      })
    )
    expect(text).toBe(
      [
        LEDGER_LEAD,
        "Mara Venn (point of view):\n- Doesn't know yet: The will was burned (Tobin knows it, since Ch 2, Sc 1; saw it).",
        "Ash:\n- Doesn't know yet: The will was burned (Tobin knows it, since Ch 2, Sc 1; saw it)."
      ].join('\n\n')
    )
  })

  it('never keeps from someone what is about them, nor tells a secret who knows it doesn’t rest on who was there', () => {
    const text = ledgerText(
      input({
        facts: [
          fact('debt', 'Ash owes Gale money', ['t'], 3),
          fact('guess', 'The ferry was sold', ['m'], 5, {}, { backed: false })
        ]
      })
    )
    expect(text).toContain("Mara Venn (point of view):\n- Doesn't know yet: Ash owes Gale money (Tobin knows it).")
    expect(text).not.toMatch(/Ash:\n- Doesn't know yet: Ash owes/)
    expect(text).not.toContain('The ferry was sold (Mara')
    // Tobin knows it and Mara doesn't, so it is told as hers to not know, never again as his to know.
    expect(text).not.toContain('Knows: Ash owes Gale money')
  })

  it('says what someone believes that isn’t true, and what they know with since when and how', () => {
    const beliefs: BeliefState[] = [
      { factId: 'letter', fact: 'The letter is genuine.', believedBy: ['t'], since: { t: { at: 2, where: 'Book 1, Ch 1, Sc 2', how: 'told', from: 'a' } }, at: 2 }
    ]
    const from = {
      beliefs,
      facts: [fact('ferry', 'The ferry leaks', ['m', 't', 'a'], 6, { t: { at: 6, where: 'Book 2, Ch 1, Sc 1', how: 'overheard', from: 'g' }, a: { at: -1, where: '' } })],
      // What they know comes with more room than the smallest model's.
      scale: 2
    }
    const text = ledgerText(input(from))!
    expect(text).toContain(
      "Tobin:\n- Wrongly believes: The letter is genuine (since Ch 1, Sc 2; heard it from Ash). It isn't true.\n- Knows: The ferry leaks (since Book 2, Ch 1, Sc 1; overheard Gale)."
    )
    expect(text).toContain('Ash:\n- Knows: The ferry leaks (from the start).')
    // The point of view's own list is block 4's: only what she learned during the story, and she has no since here.
    expect(text).not.toContain('Mara Venn (point of view)')
    // The smallest model: only what someone doesn't know yet or believes wrongly.
    expect(lines(ledgerText(input({ ...from, scale: 1 })))).toEqual(["- Wrongly believes: The letter is genuine (since Ch 1, Sc 2; heard it from Ash). It isn't true."])
  })

  it('gives the point of view only what she learned during the story, the most lately first', () => {
    const facts = [
      fact('f0', 'The Binding holds', ['m', 't', 'a'], -1, { m: { at: -1, where: '' } }),
      fact('f1', 'The toll doubled', ['m', 't', 'a'], 2, { m: { at: 2, where: 'Book 1, Ch 1, Sc 2' } }),
      fact('f2', 'The bridge is out', ['m', 't', 'a'], 5, { m: { at: 5, where: 'Book 1, Ch 2, Sc 1', how: 'read' } }),
      fact('f3', 'The guild is watching', ['m', 't', 'a'], 7, { m: { at: 7, where: 'Book 1, Ch 2, Sc 3', how: 'guessed' } })
    ]
    const text = ledgerText(input({ facts, people: [mara], scale: 2 }))!
    expect(lines(text)).toEqual([
      '- Knows: The guild is watching (since Ch 2, Sc 3; guessed it).',
      '- Knows: The bridge is out (since Ch 2, Sc 1; read it).'
    ])
  })

  it('what matters most first, within caps that grow with the room: secrets, then false beliefs, then what they know', () => {
    const many = Array.from({ length: 20 }, (_, i) => fact(`s${i}`, `Secret number ${i + 1}`, ['t'], i, { t: { at: i, where: `Book 1, Ch 1, Sc ${i + 1}` } }))
    const gaps = (text: string | null): string[] => lines(text).filter((l) => l.startsWith("- Doesn't know yet:"))
    const small = gaps(ledgerText(input({ facts: many, people: [mara, tobin] })))
    expect(small).toHaveLength(LEDGER_GAPS)
    // The most lately learned first.
    expect(small[0]).toContain('Secret number 20')
    expect(gaps(ledgerText(input({ facts: many, people: [mara, tobin], scale: 3.6 })))).toHaveLength(LEDGER_GAPS * 2)

    // Everyone's secrets come before anyone's knowing, within the block's cap.
    const crowd = [mara, tobin, ash, person('g', 'Gale'), person('r', 'Rook')]
    const shared = Array.from({ length: 12 }, (_, i) => fact(`k${i}`, `Known fact ${i + 1}`, ['t'], 20 + i))
    const out = lines(ledgerText(input({ facts: [...many, ...shared], people: crowd, scale: 2 })))
    expect(out).toHaveLength(LEDGER_LINES * 2)
    expect(out.every((l) => l.startsWith("- Doesn't know yet:"))).toBe(true)
  })

  it('short: only what they don’t know yet or believe wrongly, without since when; nothing to say is no block', () => {
    const beliefs: BeliefState[] = [{ factId: 'letter', fact: 'The letter is genuine', believedBy: ['t'], since: { t: { at: 2, where: 'Book 1, Ch 1, Sc 2' } }, at: 2 }]
    const facts = [fact('will', 'The will was burned', ['t'], 4, { t: { at: 4, where: 'Book 1, Ch 2, Sc 1' } }), fact('ferry', 'The ferry leaks', ['m', 't', 'a'], 6)]
    const short = ledgerText(input({ facts, beliefs }), true)!
    expect(lines(short)).toEqual([
      "- Doesn't know yet: The will was burned (Tobin knows it).",
      "- Wrongly believes: The letter is genuine. It isn't true.",
      "- Doesn't know yet: The will was burned (Tobin knows it)."
    ])
    const lots = Array.from({ length: 20 }, (_, i) => fact(`s${i}`, `Secret number ${i + 1}`, ['t'], i))
    expect(lines(ledgerText(input({ facts: lots }), true))).toHaveLength(LEDGER_SHORT_LINES)
    expect(ledgerText(input({ facts: [fact('ferry', 'The ferry leaks', ['m', 't', 'a'], 6)] }), true)).toBeNull()
    expect(ledgerText(input({ people: [] }))).toBeNull()
  })

  it('leaves out the dead and animals', () => {
    const dead = person('a', 'Ash', { happened: [{ note: 'died in the flood', where: 'Book 1, Ch 1, Sc 1', changeId: 'x' }] })
    const horse = person('h', 'Cinder', { summary: 'A grey mare.', tags: ['horse'] })
    const text = ledgerText(input({ people: [mara, tobin, dead, horse], facts: [fact('will', 'The will was burned', ['t'], 4)] }))!
    expect(text).not.toContain('Ash:')
    expect(text).not.toContain('Cinder')
    expect(text).toContain("Mara Venn (point of view):\n- Doesn't know yet: The will was burned (Tobin knows it).")
  })
})

describe('a belief keeps its seat (fix 9 review)', () => {
  const crowd = [mara, tobin, ash, person('g', 'Gale'), person('r', 'Rook')]
  const secrets = Array.from({ length: 6 }, (_, i) => fact(`s${i}`, `Secret number ${i + 1}`, ['m'], 10 + i))
  const beliefs: BeliefState[] = [{ factId: 'letter', fact: 'The letter is genuine', believedBy: ['r'], since: { r: { at: 1, where: 'Book 1, Ch 1, Sc 1' } }, at: 1 }]

  it('with four others in the scene and many secrets kept from them, in the full form and the short one', () => {
    const full = lines(ledgerText(input({ people: crowd, facts: secrets, beliefs })))
    expect(full).toHaveLength(LEDGER_LINES)
    expect(full).toContain("- Wrongly believes: The letter is genuine (since Ch 1, Sc 1). It isn't true.")
    const short = lines(ledgerText(input({ people: crowd, facts: secrets, beliefs }), true))
    expect(short).toHaveLength(LEDGER_SHORT_LINES)
    expect(short).toContain("- Wrongly believes: The letter is genuine. It isn't true.")
  })

  it('names a crowd only so far, and covers the people the must-stay list is given', () => {
    const many = [mara, ...Array.from({ length: 9 }, (_, i) => person(`p${i}`, `Person ${i}`))]
    const known = fact('x', 'The bridge is out', many.slice(1, 7).map((p) => p.id), 3)
    const text = ledgerText(input({ people: many, facts: [known] }))!
    expect(text).toContain("Mara Venn (point of view):\n- Doesn't know yet: The bridge is out (Person 0, Person 1, Person 2 and 2 more know it).")
    expect(ledgerPeople(many, 1).map((p) => p.name)).toEqual(['Mara Venn', 'Person 0', 'Person 1', 'Person 2', 'Person 3', 'Person 4'])
    expect(ledgerPeople(many, 3.6)).toHaveLength(10)
    // No one the block doesn't cover is named in it.
    expect(text).not.toContain('Person 5:')
  })
})
