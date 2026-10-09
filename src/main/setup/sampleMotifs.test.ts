// The desk's drawing library (src/shared/motifs.ts) on the sample world: each entry's drawing, picked from its words.
import { describe, expect, it } from 'vitest'
import { pickMotif, pickMotifs, pickStoryMotif } from '@shared/motifs'
import { SAMPLE_ENTRIES, SAMPLE_STORY } from './sampleContent'

const sample = (key: string): string => {
  const e = SAMPLE_ENTRIES.find((x) => x.key === key)!
  return pickMotif({ kind: e.kind, name: e.name, summary: e.summary, description: e.description, fields: e.fields })
}

describe('the sample world’s drawings', () => {
  it('Edric a lantern, Iska a letter', () => {
    expect(sample('edric')).toBe('lantern')
    expect(sample('iska')).toBe('letter')
  })

  it('its places, threads and cover too', () => {
    expect(sample('light')).toBe('lighthouse')
    expect(sample('steps')).toBe('stairs')
    expect(sample('gullhaven')).toBe('house')
    expect(sample('letter')).toBe('letter')
    expect(pickStoryMotif(SAMPLE_STORY)).toBe('lantern')
  })
})

describe('the sample world’s drawings side by side', () => {
  it('no two of its characters, places and the like share one: Wren keeps the lantern, Edric takes his boat', () => {
    const drawn = SAMPLE_ENTRIES.filter((e) => ['character', 'place', 'group', 'item', 'event', 'glossary'].includes(e.kind)).map((e) => ({
      id: e.key,
      kind: e.kind,
      name: e.name,
      summary: e.summary,
      description: e.description,
      fields: e.fields
    }))
    const picks = pickMotifs(drawn)
    expect(new Set(picks.values()).size).toBe(drawn.length)
    expect(picks.get('wren')).toBe('lantern')
    expect(picks.get('edric')).toBe('boat')
    expect(picks.get('iska')).toBe('letter')
    expect(picks.get('light')).toBe('lighthouse')
  })
})
