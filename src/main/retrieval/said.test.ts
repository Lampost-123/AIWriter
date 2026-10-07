import { describe, expect, it } from 'vitest'
import { SAID_LINE_WORDS, saidLines, saidText, shortLine, type SaidTime } from './said'

const names: Record<string, string> = { mara: 'Mara', tobin: 'Tobin', kell: 'Kell', ana: 'Ana', wen: 'Wen' }
const nameOf = (id: string): string | null => names[id] ?? null
const time = (factId: string, by: string, heard: string[], words: string, order: number, kind: SaidTime['kind'] = 'promise'): SaidTime => ({
  factId,
  kind,
  by,
  heard,
  words,
  where: `Book 1, Ch 1, Sc ${order}`,
  order
})

describe('what was said', () => {
  const facts = [
    { factId: 'f1', fact: 'Mara will come back for Tobin before the snow', knownBy: ['mara', 'tobin', 'ana'] },
    { factId: 'f2', fact: 'Kell will drown Ana if she talks', knownBy: ['kell', 'ana'] },
    { factId: 'f3', fact: 'The heir is alive', knownBy: ['ana', 'tobin'] },
    { factId: 'f4', fact: 'An ordinary fact nobody said', knownBy: ['mara'] }
  ]
  const times = [
    time('f1', 'mara', ['tobin'], '“I will come back for you before the snow.”', 1),
    time('f2', 'kell', ['ana'], 'Talk and you drown.', 3, 'threat'),
    time('f3', 'ana', ['tobin'], 'The heir lives.', 5, 'secret')
  ]

  it('sends the lines said or heard by someone in the scene, newest first, with who heard them there', () => {
    const lines = saidLines(facts, times, { nameOf, inScene: new Set(['tobin']) })
    expect(lines.map((l) => l.fact)).toEqual(['The heir is alive', 'Mara will come back for Tobin before the snow'])
    expect(lines[1]).toMatchObject({ kind: 'promise', by: 'Mara', heard: ['Tobin'], here: true, found: false })
  })

  it('counts who heard it there, not everyone who knows it now', () => {
    // Ana learned of the promise later; in a scene with only her, it isn't a line she heard.
    expect(saidLines(facts, times, { nameOf, inScene: new Set(['ana']) }).map((l) => l.fact)).not.toContain('Mara will come back for Tobin before the snow')
  })

  it('gives each time something was said a line of its own', () => {
    const retold = [...times, time('f1', 'tobin', ['wen'], '“She swore she would come back before the snow.”', 7)]
    const lines = saidLines(facts, retold, { nameOf, inScene: new Set(['tobin']) })
    expect(lines.filter((l) => l.fact.startsWith('Mara will come back'))).toHaveLength(2)
    expect(lines[0]).toMatchObject({ by: 'Tobin', heard: ['Wen'], where: 'Book 1, Ch 1, Sc 7' })
  })

  it('adds lines a search found, after those of people here', () => {
    const lines = saidLines(facts, times, { nameOf, inScene: new Set(['mara']), found: ['f2'] })
    expect(lines.map((l) => l.kind)).toEqual(['promise', 'threat'])
    expect(lines[1]).toMatchObject({ here: false, found: true })
  })

  it('never sends a fact that was not said, or one not known here', () => {
    expect(saidLines(facts.slice(3), times, { nameOf, inScene: new Set(['mara', 'tobin', 'kell', 'ana']) })).toEqual([])
  })

  it('keeps each line, and the whole list, short', () => {
    const speech = `“${Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')}.”`
    const many = Array.from({ length: 12 }, (_, i) => time('f1', 'mara', ['tobin'], speech, i))
    const lines = saidLines(facts, many, { nameOf, inScene: new Set(['mara']) })
    expect(lines.length).toBeLessThan(12)
    for (const l of lines) expect(l.words.split(/\s+/).length).toBeLessThanOrEqual(SAID_LINE_WORDS)
    expect(lines[0].words.endsWith('…”')).toBe(true)
    const total = lines.reduce((n, l) => n + l.words.split(/\s+/).length, 0)
    expect(total).toBeLessThanOrEqual(320)
    expect(shortLine('Talk and you drown.')).toBe('Talk and you drown.')
  })

  it('reads in plain words, with the exact line', () => {
    const [l] = saidLines(facts, times, { nameOf, inScene: new Set(['mara']) })
    expect(saidText(l)).toBe(
      '- Mara’s promise to Tobin (Book 1, Ch 1, Sc 1): “I will come back for you before the snow.” That is: Mara will come back for Tobin before the snow.'
    )
    const [t] = saidLines(facts, times, { nameOf, inScene: new Set(['kell']) })
    expect(saidText(t)).toBe('- Kell’s threat to Ana (Book 1, Ch 1, Sc 3): “Talk and you drown.” That is: Kell will drown Ana if she talks.')
  })
})
