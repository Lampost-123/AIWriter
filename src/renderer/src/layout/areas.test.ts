import { describe, expect, it } from 'vitest'
import { AREA_OF, AREAS } from './areas'

describe('the New look’s areas', () => {
  it('puts every screen in exactly one area (Settings in none, at the rail’s foot)', () => {
    const ids = AREAS.map((a) => a.id)
    for (const [kind, area] of Object.entries(AREA_OF)) {
      if (kind === 'settings') expect(area).toBeNull()
      else expect(ids, kind).toContain(area)
    }
  })

  it('has four areas, each with something in it', () => {
    expect(AREAS.map((a) => a.label)).toEqual(['Write', 'Plan', 'World', 'Check'])
    for (const a of AREAS) expect(Object.values(AREA_OF)).toContain(a.id)
  })
})
