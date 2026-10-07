// Story memory step 5 through the real database, memory engine and context assembly, with an index in memory and a
// stand-in search model. Every story and line here is made up for the test.
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { defaultWritingPrefs, emptySceneCard } from '@shared/defaults'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import { gatherContextInput } from '../ai/gather'
import { assembleContext } from '../ai/context'
import { countRaw } from '../ai/tokens'
import { memoryWorld } from '../../../tests/unit/helpers'
import { memorySearchIndex, type SearchIndex } from './store'
import { syncNow, readPassages } from './indexing'
import { factDocs, queryParts, recallFor, VectorCache, withoutNames } from './recall'
import { stubEmbedder } from './stub'
import { RECALL_WHY } from './briefing'

const save = (db: Database.Database, id: ID, text: string): void => {
  repo.saveSceneText(db, id, null, text)
}

const memoryIndex = (): SearchIndex => memorySearchIndex()

const FILLER = 'The rain kept on through the afternoon and nobody went out. The kettle sang, the fire settled, the clock ticked. '

/**
 * Book 1, one chapter: scenes 1-4 written, scene 5 being drafted, scene 6 later. A what-if story off the line repeats
 * the promise's words. Mara promised Tobin at the well in scene 1 (kept as something said); Tobin is her brother.
 */
function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const chapter = o.chapters[0].id
  const ids: ID[] = [o.scenes[0].id]
  for (let i = 2; i <= 6; i++) ids.push(repo.createScene(db, chapter, { title: `Scene ${i}`, afterId: ids[ids.length - 1] }).id)
  const person = (name: string, summary: string) => repo.createEntry(db, 'character', { name, summary })
  const mara = person('Mara', 'A smuggler with one hand.')
  const tobin = person('Tobin', 'A ferryman.')
  const kell = person('Kell', 'A dockhand.')
  const ana = person('Ana', 'A healer.')
  const well = repo.createEntry(db, 'place', { name: 'Old Well', summary: 'A dry well at the crossroads.' })
  const ring = repo.createEntry(db, 'item', { name: 'copper ring', summary: 'A cheap ring with a hidden catch.' })
  const at = (sceneId: ID) => ({ anchor: 'scene' as const, sceneId, origin: 'text' as const })
  mem.insertChange(db, { ...at(ids[0]), entryId: mara.id, kind: 'relationship', payload: { otherId: tobin.id, type: 'brother', feels: 'Guilt', otherFeels: 'Hope' } })
  const words = '“I swear I will come back for you before the snow.”'
  save(db, ids[0], `${FILLER}\n\nAt the old well Mara took his hands. ${words} Tobin said nothing.\n\n${FILLER}`)
  const factId = 'fact-promise'
  for (const who of [mara, tobin]) {
    const c = mem.insertChange(db, {
      ...at(ids[0]),
      entryId: who.id,
      kind: 'knowledge',
      payload: { factId, fact: 'Mara will come back for Tobin before the snow', said: { kind: 'promise', by: mara.id, words } }
    })
    hist.addLink(db, { factKind: 'change', factId: c.id, field: null, sceneId: ids[0], sceneVersion: 1, paragraphId: null, start: 0, end: words.length, quote: words })
  }
  save(db, ids[1], `${FILLER}\n\nAna boiled the bandages and said the fever would break by morning.`)
  save(db, ids[2], `${FILLER}\n\nKell slipped the copper ring into his coat when no one was looking.`)
  repo.updateSceneCard(db, ids[3], { ...emptySceneCard(), povId: kell.id, presentIds: [kell.id] })
  save(db, ids[3], `${FILLER}\n\nKell waited at the ferry steps until dark.`)
  save(db, ids[5], 'Much later, the promise at the well was broken, and the snow came.')
  repo.updateSceneCard(db, ids[4], {
    ...emptySceneCard(),
    povId: mara.id,
    presentIds: [mara.id],
    beats: ['Mara thinks of the vow she made at the well', 'She wonders where her sibling sleeps tonight']
  })
  // A what-if story, off this line, saying the same words.
  const whatIf = repo.createStory(db, { title: 'What if', startStoryId: null })
  const wc = repo.createChapter(db, whatIf.id, { title: 'One' })
  const ws = repo.createScene(db, wc.id, { title: 'Other' })
  save(db, ws.id, 'In this telling, the vow at the well was never sworn, and her sibling drowned.')
  return { db, ids, scene: ids[4], mara, tobin, kell, ana, well, ring, whatIfScene: ws.id }
}

const inputFor = (db: Database.Database, scene: ID, contextLength = 128_000) =>
  gatherContextInput(db, scene, undefined, { prefs: defaultWritingPrefs(), contextLength, creativity: 'balanced' })

describe('recall for a briefing', () => {
  it('searches only what comes before the scene on its line, by keyword and by meaning', async () => {
    const w = world()
    const index = memoryIndex()
    syncNow(w.db, index)
    const embedder = stubEmbedder()
    await readPassages(index, embedder, (t) => embedder.embed(t, 'passage'), { signal: new AbortController().signal })
    const r = await recallFor({ db: w.db, index, embedder, cache: new VectorCache() }, w.scene, inputFor(w.db, w.scene))
    const all = r.passages.map((p) => p.text).join('\n')
    expect(all).toContain('I swear I will come back for you before the snow')
    // Never a later scene, never another story's line.
    expect(all).not.toContain('Much later')
    expect(all).not.toContain('In this telling')
    expect(r.passages[0].where).toBe('Book 1, Ch 1, Sc 1')
    // "her sibling" finds her brother through the codex.
    expect(r.found).toContain(w.tobin.id)
  })

  it('finds the promise by its words alone when the search model is not there', async () => {
    const w = world()
    const index = memoryIndex()
    syncNow(w.db, index)
    const r = await recallFor({ db: w.db, index, embedder: null }, w.scene, inputFor(w.db, w.scene))
    expect(r.passages.map((p) => p.text).join('\n')).toContain('At the old well Mara took his hands.')
    expect(r.passages.map((p) => p.text).join('\n')).not.toContain('Much later')
    // "Her sibling" has no word in common with "brother": only meaning finds him.
    expect(r.found).not.toContain(w.tobin.id)
  })

  it('keeps entries of the last two scenes, and sends what was said word for word', async () => {
    const w = world()
    const r = await recallFor({ db: w.db, index: null, embedder: null }, w.scene, inputFor(w.db, w.scene))
    // Scene 4 (Kell on the card) and scene 3 (the copper ring named); scene 2 (Ana) is three back.
    expect(r.sticky).toEqual([w.kell.id, w.ring.id])
    expect(r.said).toHaveLength(1)
    expect(r.said[0]).toMatchObject({ kind: 'promise', by: 'Mara', heard: ['Tobin'], words: '“I swear I will come back for you before the snow.”', here: true })
  })

  it('goes into the briefing as candidates, and the budget still decides', async () => {
    const w = world()
    const index = memoryIndex()
    syncNow(w.db, index)
    const input = inputFor(w.db, w.scene)
    input.recall = await recallFor({ db: w.db, index, embedder: stubEmbedder() }, w.scene, input)
    const roomy = assembleContext(input, countRaw)
    const said = roomy.blocks.find((b) => b.id === 'said')!
    expect(said).toMatchObject({ priority: 6, dropped: false })
    expect(said.text).toContain('Mara’s promise to Tobin (Book 1, Ch 1, Sc 1): “I swear I will come back for you before the snow.”')
    const recalled = roomy.blocks.find((b) => b.id === 'recalled')!
    expect(recalled).toMatchObject({ priority: 9, dropped: false })
    expect(roomy.messages[1].content).toContain('## Earlier passages that may matter')
    // Kell is named at the end of the previous scene (as before); the ring, three scenes back in the words, stays.
    expect(roomy.entries!.find((e) => e.entryId === w.kell.id)?.why).toBe('Named at the end of the previous scene')
    expect(roomy.entries!.find((e) => e.entryId === w.ring.id)).toMatchObject({ why: RECALL_WHY.sticky, blockId: 'mentioned' })
    expect(roomy.entries!.find((e) => e.entryId === w.tobin.id)?.why).toBe(RECALL_WHY.found)

    // A small model: the passages give way first, and the briefing never goes past what fits.
    const small = { ...input, contextLength: 7_000 }
    const tight = assembleContext(small, countRaw)
    expect(tight.budget.used).toBeLessThanOrEqual(tight.budget.available)
    const r2 = tight.blocks.find((b) => b.id === 'recalled')!
    const m2 = tight.blocks.find((b) => b.id === 'mentioned')
    expect(r2.dropped || r2.short).toBe(true)
    if (m2 && !m2.dropped) expect(r2.dropped || r2.short).toBe(true)
  })

  it('adds nothing without its input (switched off), so the briefing is as before', () => {
    const w = world()
    const before = assembleContext(inputFor(w.db, w.scene), countRaw)
    expect(before.blocks.some((b) => b.id === 'said' || b.id === 'recalled')).toBe(false)
    expect(before.entries!.some((e) => e.why === RECALL_WHY.sticky)).toBe(false)
  })
})

describe('what is searched for and searched', () => {
  it('asks each part of the card on its own, and the end of the scene so far', () => {
    const w = world()
    const input = inputFor(w.db, w.scene)
    // The title alone ("Scene 5") says nothing to search for.
    expect(queryParts(input)).toEqual([
      'Mara thinks of the vow she made at the well',
      'She wonders where her sibling sleeps tonight',
      'The rain kept on through the afternoon and nobody went out. The kettle sang, the fire settled, the clock ticked. Kell waited at the ferry steps until dark.'
    ])
    expect(queryParts(input, 'She ran to the boat.').at(-1)).toBe('She ran to the boat.')
  })

  it('leaves out entries on the card, except in what was said', () => {
    const w = world()
    const input = inputFor(w.db, w.scene)
    const docs = factDocs(input.memory, new Set([w.mara.id]), new Set(['fact-promise']))
    expect(docs.some((d) => d.key === `entry:${w.mara.id}`)).toBe(false)
    expect(docs.find((d) => d.key.startsWith('rel:'))).toMatchObject({ entryIds: [w.tobin.id] })
    expect(docs.find((d) => d.saidFactId === 'fact-promise')).toBeTruthy()
  })
})

describe('names left out of the codex search', () => {
  it('takes out whole names and their possessives, nothing else', () => {
    expect(withoutNames("Mara's vow to Kell at the well; Marangel stays", ['Mara', 'Kell'])).toBe('vow to at the well; Marangel stays')
    expect(withoutNames('The Old Mill burned', ['old mill'])).toBe('The burned')
  })
})
