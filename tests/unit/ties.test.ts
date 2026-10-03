// Milestone 5's acceptance check for block 11 (spec, Build plan 5): "A character in a scene without the
// other person can bring up their fight from many chapters earlier." Built through the real database,
// memory engine and context assembly.
import { describe, expect, it } from 'vitest'
import { defaultWritingPrefs, emptySceneCard } from '@shared/defaults'
import * as repo from '../../src/main/db/repo'
import * as mem from '../../src/main/db/memory'
import { gatherContextInput } from '../../src/main/ai/gather'
import { assembleContext } from '../../src/main/ai/context'
import { countRaw } from '../../src/main/ai/tokens'
import { memoryWorld } from './helpers'

function fightWorld() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const first = outline.chapters[0]
  const scenes = [outline.scenes[0].id]
  let after = first.id
  for (let i = 2; i <= 20; i++) {
    const ch = repo.createChapter(db, story.id, { title: `Chapter ${i}`, afterId: after })
    after = ch.id
    scenes.push(repo.createScene(db, ch.id, { title: `Scene ${i}` }).id)
  }
  const person = (name: string, summary: string) => repo.createEntry(db, 'character', { name, summary })
  const mara = person('Mara', 'A smuggler with one hand.')
  const tobin = person('Tobin', "Mara's older brother, a ferryman.")
  const kell = person('Kell', 'A dockhand.')
  const fight = repo.createEntry(db, 'event', { name: 'The fight at the ferry', summary: 'Mara and Tobin came to blows over the debt.' })
  const at = { anchor: 'scene' as const, sceneId: scenes[0], origin: 'text' as const }
  mem.insertChange(db, {
    ...at,
    entryId: mara.id,
    kind: 'relationship',
    payload: { otherId: tobin.id, type: 'brother, estranged', feels: 'Guilt', otherFeels: 'Betrayed' }
  })
  for (const who of [mara, tobin]) {
    mem.insertChange(db, { ...at, entryId: who.id, kind: 'relationship', payload: { otherId: fight.id, type: 'involved in', feels: '', otherFeels: '' } })
  }
  mem.insertChange(db, { ...at, entryId: mara.id, kind: 'update', payload: { note: 'Broke Tobin’s oar in the fight' } })
  // Later, an acquaintance she has no history with.
  mem.insertChange(db, {
    anchor: 'scene',
    sceneId: scenes[17],
    origin: 'text',
    entryId: mara.id,
    kind: 'relationship',
    payload: { otherId: kell.id, type: 'new acquaintance', feels: '', otherFeels: '' }
  })
  const scene = scenes[19]
  repo.updateSceneCard(db, scene, { ...emptySceneCard(), povId: mara.id, presentIds: [mara.id] })
  return { db, scene, mara, tobin, kell }
}

const briefing = (contextLength: number) => {
  const w = fightWorld()
  const input = gatherContextInput(w.db, w.scene, undefined, { prefs: defaultWritingPrefs(), contextLength, creativity: 'balanced' })
  return { ...w, preview: assembleContext(input, countRaw) }
}

describe('ties to people not in this scene (block 11)', () => {
  it('lets a character alone in Ch 20 bring up the fight with her brother from Ch 1', () => {
    const { preview } = briefing(128_000)
    const ties = preview.blocks.find((b) => b.id === 'ties')!
    expect(ties).toMatchObject({ priority: 11, dropped: false, short: false })
    expect(ties.text).toContain('### Mara')
    expect(ties.text).toContain("Tobin: Mara's older brother, a ferryman. Brother, estranged. Mara feels: Guilt. Tobin feels: Betrayed.")
    expect(ties.text).toContain('The fight at the ferry: Mara and Tobin came to blows over the debt.')
    expect(ties.text).toContain('Mara: Broke Tobin’s oar in the fight (Book 1, Ch 1, Sc 1).')
    // Kell is a newer tie with no history; the brother, with a shared past, still comes first.
    expect(ties.text.indexOf('Tobin')).toBeLessThan(ties.text.indexOf('Kell'))
    expect(preview.messages[1].content).toContain('## Ties to people not in this scene')
    expect(preview.entries!.find((e) => e.name === 'Tobin')).toMatchObject({ blockId: 'ties', why: 'Tied to someone in the scene' })
  })

  it('leaves out people Adam kept out of the scene', () => {
    const w = fightWorld()
    mem.setPin(w.db, w.tobin.id, 'scene', w.scene, 'hide')
    const input = gatherContextInput(w.db, w.scene, undefined, { prefs: defaultWritingPrefs(), contextLength: 128_000, creativity: 'balanced' })
    const ties = assembleContext(input, countRaw).blocks.find((b) => b.id === 'ties')!
    expect(ties.text).not.toContain('Tobin')
    expect(ties.text).toContain('Kell')
  })
})
