// How long it takes between places (free rules, 2026-10-19): journeys read from words, routes between codex places, the
// least time a route can take, and the writer's line. Controls: a length that is no journey ("a day's work", "three days
// since"), a sentence naming three places, a journey "from the coast" (no codex place). Invented text.
import { describe, expect, it } from 'vitest'
import { lengthWords, readJourneys, routeLine, routeOfFact, routeSlot, routesIn, routeWords, travelNeeds, type Route } from './routes'

const PLACES = [
  { id: 'lin', name: 'Linmouth' },
  { id: 'car', name: 'Carrow' },
  { id: 'whe', name: 'The Wheatsheaf' },
  { id: 'fal', name: 'Fallow Cross' }
]

const journeys = (t: string) => readJourneys(t).map((j) => [j.words, j.hours, j.mode, j.how, j.hedged])

describe('journeys in words', () => {
  it('reads how long and how', () => {
    expect(journeys('Carrow is a day’s ride from Linmouth.')).toEqual([['a day’s ride', 24, 'horse', 'on horseback', false]])
    expect(journeys('It is three days by cart.')).toEqual([['three days by cart', 72, 'wheels', 'by cart', false]])
    expect(journeys('Half a day’s walk brought them there.')).toEqual([['Half a day’s walk', 12, 'foot', 'on foot', false]])
    expect(journeys('It took them four days to reach Carrow.')).toEqual([['took them four days to reach', 96, null, '', false]])
    expect(journeys('The ride from Linmouth to Carrow took three days.')).toEqual([['ride from Linmouth to Carrow took three days', 72, 'horse', 'on horseback', false]])
    expect(journeys('Fallow Cross lies a day east of Linmouth.')).toEqual([['a day east of', 24, null, '', false]])
    expect(journeys('Nearly two hours’ sail.')).toEqual([['Nearly two hours’ sail', 2, 'boat', 'by boat', true]])
    expect(journeys('A week by sea.')).toEqual([['A week by sea', 168, 'boat', 'by sea', false]])
  })

  it('reads no journey in a length that isn’t one', () => {
    for (const t of ['A day’s work, and a day’s wages.', 'Three days since the fire.', 'Three days later she came.', 'The road was long.'])
      expect(journeys(t), t).toEqual([])
  })
})

describe('routes between codex places', () => {
  const routes = (t: string, self: string | null = null) => routesIn(t, PLACES, self).map((r) => [r.a, r.b, r.hours, r.how])

  it('joins the two places named, or the one named and the place the words are about', () => {
    expect(routes('The ride from Linmouth to Carrow took three days.')).toEqual([['lin', 'car', 72, 'on horseback']])
    expect(routes('It is a day’s ride from Linmouth.', 'car')).toEqual([['lin', 'car', 24, 'on horseback']])
    expect(routes('Carrow was three days by cart.', 'lin')).toEqual([['car', 'lin', 72, 'by cart']])
    // "the Wheatsheaf" is The Wheatsheaf.
    expect(routes('From the Wheatsheaf it was half a day’s walk to Linmouth.')).toEqual([['whe', 'lin', 12, 'on foot']])
  })

  it('says nothing of a journey from somewhere not in the codex, three places, or the place itself', () => {
    expect(routes('Carrow is a day’s ride from the coast.', 'lin')).toEqual([])
    expect(routes('From Linmouth to Carrow by Fallow Cross was three days by cart.')).toEqual([])
    expect(routes('Carrow is a day’s ride.', 'car')).toEqual([])
    expect(routes('It is a day’s ride.', null)).toEqual([])
  })
})

describe('what a route needs, and how it is said', () => {
  const r = (hours: number, unit: 'hour' | 'day' = 'day', hedged = false): Route => ({ a: 'lin', b: 'car', hours, unit, hedged, mode: 'wheels', how: 'by cart', words: '' })

  it('takes a day’s journey as a morning to an evening, and more days as nights between', () => {
    expect(travelNeeds(r(24))).toBe(8)
    expect(travelNeeds(r(72))).toBe(56)
    expect(travelNeeds(r(12))).toBe(4)
    expect(travelNeeds(r(2, 'hour'))).toBe(1.5)
    expect(travelNeeds(r(72, 'day', true))).toBe(42)
  })

  it('says it plainly, and keeps it as a fact that reads back', () => {
    expect(lengthWords(72, 'day')).toBe('3 days')
    expect(lengthWords(24, 'day')).toBe('a day')
    expect(lengthWords(168, 'day')).toBe('a week')
    expect(lengthWords(0.5, 'hour')).toBe('half an hour')
    expect(routeWords(r(72))).toBe('about 3 days by cart')
    expect(routeLine('Linmouth', 'Carrow', r(72))).toBe('Getting here: Linmouth to Carrow is about 3 days by cart.')
    const back = routeOfFact({ kind: 'route', entryId: 'lin', slot: routeSlot(r(72)), value: routeWords(r(72)), quote: 'three days by cart' })
    expect(back).toEqual({ ...r(72), words: 'three days by cart' })
    expect(routeOfFact({ kind: 'where', entryId: 'lin', slot: '', value: 'x', quote: '' })).toBeNull()
  })
})
