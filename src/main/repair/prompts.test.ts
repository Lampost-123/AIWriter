// Check and repair's request sends what stays the same through a scene first (the cache order of 8 October 2026), and
// only the order changes. Invented story data only.
import { describe, expect, it } from 'vitest'
import { repairRequest, REPAIR_SEND_ORDER, stageLineText, type StageLine } from './prompts'

const stage: StageLine[] = [
  { code: 'W1', who: null, field: 'time', value: 'dusk', quote: 'the light going' },
  { code: 'W2', who: 'Wren', field: 'where', value: 'by the mill race', quote: 'Wren stood by the race' }
]
const section = (id: string, title: string, text: string) => ({ id, title, text, entryIds: id === 'memory' ? ['c-wren'] : [] })
const codex = {
  lines: [],
  sections: [
    section('memory', 'The memory as of the start of this scene (E ids)', '### [E1] Wren Abel\nA miller’s apprentice.'),
    section('knowledge', 'Who knows what at the start of this scene (K ids)', '- [K1] Hobb sold the ferry. Known by: none of them.'),
    section('owned', 'What people here no longer have, or have now (O ids)', '- [O1] the tin lantern: Wren gave it to Pell'),
    section('dead', 'Dead at the start of this scene (D ids)', '- [D1] Old Garrow: drowned at the weir'),
    section('earlier', 'The scenes just before this one (S ids)', '- [S1] Ch 1, Sc 1 "The weir". When: dawn')
  ]
}
const request = (newWords: string, leadIn = 'Wren waited.') =>
  repairRequest({ stage, codex, card: 'Wren asks Hobb about the ferry.', leadIn, newWords })

describe("check and repair's request, in an order a provider can reuse", () => {
  it('sends the scenes just before, the scene card, the dead and the memory first, and where things stand, the words just before and the new words last', () => {
    const r = request('Wren picked up the lantern.')
    expect(r.blocks.map((b) => b.id)).toEqual(['earlier', 'scene-card', 'dead', 'memory', 'knowledge', 'owned', 'stage', 'lead-in', 'new-words'])
    expect(r.blocks.map((b) => b.id)).toEqual(REPAIR_SEND_ORDER)
    const heads = r.messages[1].content.split('\n').filter((l) => l.startsWith('## '))
    expect(heads).toEqual(r.blocks.map((b) => `## ${b.title}`))
  })

  it('sends the same sections as before, each once, with the same words and priorities: only the order changes', () => {
    const r = request('Wren picked up the lantern.')
    // The order and priorities "What the AI saw" listed before (where things stand first).
    const before = ['stage', 'memory', 'knowledge', 'owned', 'dead', 'earlier', 'scene-card', 'lead-in', 'new-words']
    const byId = new Map(r.blocks.map((b) => [b.id, b]))
    expect([...byId.keys()].sort()).toEqual([...before].sort())
    before.forEach((id, i) => expect(byId.get(id)!.priority).toBe(Math.min(10, i + 1)))
    expect(byId.get('stage')!.text).toBe(stage.map(stageLineText).join('\n'))
    expect(byId.get('new-words')!.text).toBe('"""\nWren picked up the lantern.\n"""')
    const parts = r.messages[1].content.split('\n\n## ')
    expect(parts).toHaveLength(9)
    const old = before.map((id) => `## ${byId.get(id)!.title}\n${byId.get(id)!.text}`).join('\n\n')
    expect([...r.messages[1].content].sort().join('')).toBe([...old].sort().join(''))
    expect(r.entryIds).toEqual(['c-wren'])
  })

  it('two checks in the same scene share everything before where things stand', () => {
    const a = request('Wren picked up the lantern.').messages[1].content
    const b = request('Hobb shook his head.', 'Wren picked up the lantern.').messages[1].content
    const upTo = a.indexOf('## Where things stand')
    expect(upTo).toBeGreaterThan(200)
    expect(b.slice(0, upTo)).toBe(a.slice(0, upTo))
  })

  it('leaves out an empty scene card and lead-in, as before', () => {
    const r = repairRequest({ stage: [], codex: { lines: [], sections: [] }, card: ' ', leadIn: '', newWords: 'x' })
    expect(r.blocks.map((b) => b.id)).toEqual(['stage', 'new-words'])
    expect(r.blocks.map((b) => b.priority)).toEqual([1, 2])
  })
})
