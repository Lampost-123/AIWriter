// The look-up tools (overhaul, "Plan before writing, done properly"): each answered on this computer from the story index,
// the memory as it stands at the scene, the search and the scenes' own words; compact, short unless more is asked; only
// what comes before the scene; nothing Adam kept out; and a look-up that finds nothing says what to try next. Worlds are
// made in memory with invented words.
import { describe, expect, it } from 'vitest'
import type { ID, ToolCall } from '@shared/types'
import { memoryWorld } from '../../../../tests/unit/helpers'
import { keepStages, person, setCard, stage } from '../../../../tests/unit/storyIndexWorld'
import * as repo from '../../db/repo'
import * as mem from '../../db/memory'
import { sceneMemory } from '../../memory/scene'
import { buildStoryIndex } from '../../storyIndex'
import { answerLookups, LOOKUP_TOOLS, LOOKUPS_MOST, runLookup, sceneLabel, type LookupContext } from '.'
import { passageOf, wholeSentences } from './text'

/** Two chapters: Mara and Tobin at the Swan; the market; the seal goes missing; then the scene being written. */
function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const ch1 = o.chapters[0].id
  const ch2 = repo.createChapter(db, story.id, { title: 'Two' }).id
  const s1 = o.scenes[0].id
  repo.updateScene(db, s1, { title: 'The Swan' })
  const s2 = repo.createScene(db, ch1, { title: 'Market day' }).id
  const s3 = repo.createScene(db, ch2, { title: 'The strongbox' }).id
  const s4 = repo.createScene(db, ch2, { title: 'Now' }).id
  const s5 = repo.createScene(db, ch2, { title: 'Later' }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara Venn', aliases: ['the Captain'], summary: 'Runs the ferry.' }).id
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin', summary: 'A ferryman.' }).id
  const ash = repo.createEntry(db, 'character', { name: 'Ash', summary: 'A drover.' }).id
  const inn = repo.createEntry(db, 'place', { name: 'The Swan' }).id
  const market = repo.createEntry(db, 'place', { name: 'The Market' }).id
  const seal = repo.createEntry(db, 'thread', { name: 'The stolen seal' }).id
  repo.saveSceneText(db, s1, null, 'Mara set the lantern on the table. Tobin watched her from the hearth.\n\nShe thought of the river, high with rain.')
  repo.saveSceneText(db, s2, null, 'Ash came in out of the rain, and the Captain bought bread.\n\nTobin said nothing all morning.')
  repo.saveSceneText(db, s3, null, 'Mara found the strongbox empty.\n\nTobin swore the seal had been there at dawn.\n\nShe did not believe him.')
  repo.saveSceneText(db, s5, null, 'Much later, Mara left the Swan for good.')
  setCard(db, s1, { povId: mara, presentIds: [tobin], locationId: inn, when: 'Day 1, 9pm' })
  setCard(db, s2, { povId: mara, presentIds: [ash], locationId: market, when: 'Day 2, morning' })
  setCard(db, s3, { povId: mara, presentIds: [tobin], locationId: inn, when: 'Day 2, evening', setsUpIds: [seal] })
  setCard(db, s4, { povId: mara, presentIds: [tobin], locationId: inn, when: 'Day 3' })
  setCard(db, s5, { povId: mara, presentIds: [], locationId: inn, when: 'Day 9' })
  mem.putSummary(db, { level: 'scene', targetId: s1, text: 'Mara and Tobin wait out the night at the Swan.', origin: 'text' })
  mem.putSummary(db, { level: 'scene', targetId: s2, text: 'Ash comes to the market; Mara buys bread.', origin: 'text' })
  mem.putSummary(db, { level: 'scene', targetId: s3, text: 'The seal is gone from the strongbox.', origin: 'text' })
  mem.insertChange(db, {
    entryId: mara,
    anchor: 'scene',
    sceneId: s3,
    kind: 'knowledge',
    payload: { factId: 'f-seal', fact: 'The seal was taken from the strongbox', there: [mara, tobin] },
    origin: 'text'
  })
  mem.insertChange(db, { entryId: seal, anchor: 'scene', sceneId: s3, kind: 'thread', payload: { status: 'open', note: 'The seal is missing' }, origin: 'text' })
  keepStages(db, {
    [s3]: stage(s3, [person('Mara Venn', { where: 'by the strongbox', clothes: [{ name: 'grey coat', state: 'on' }] })], {
      'mara venn|where': 'found the strongbox',
      'mara venn|clothes:grey coat': 'found the strongbox empty'
    })
  })
  buildStoryIndex(db, story.id)
  const memory = sceneMemory(db, s4, { forWriter: true })
  const ctx = (over: Partial<LookupContext> = {}): LookupContext => ({
    db,
    sceneId: s4,
    storyId: story.id,
    asItBegins: true,
    entries: memory.entries,
    facts: memory.facts,
    relationships: memory.relationships,
    people: ['Mara Venn', 'Tobin'],
    hidden: new Set<ID>(),
    ...over
  })
  return { db, storyId: story.id, s1, s2, s3, s4, s5, mara, tobin, ash, seal, ctx }
}

let n = 0
const call = (name: string, args: Record<string, unknown> | string = {}): ToolCall => ({
  id: `c${++n}`,
  name,
  arguments: typeof args === 'string' ? args : JSON.stringify(args)
})

describe('the look-up tools', () => {
  it('are offered as tools with short descriptions, each with its parameters', () => {
    expect(LOOKUP_TOOLS.map((t) => t.name)).toEqual([
      'state_of',
      'last_seen',
      'where_is',
      'who_knows',
      'open_threads',
      'what_happened',
      'who_was_there',
      'timeline',
      'get_entry',
      'find_in_story',
      'read_passage'
    ])
    for (const t of LOOKUP_TOOLS) {
      expect(t.description.length).toBeLessThan(170)
      expect(t.parameters).toMatchObject({ type: 'object' })
    }
  })

  it('where_is: where a thing was left and since when, who has it, and what to try when nothing says', async () => {
    const w = world()
    const kept = stage(w.s3, [person('Mara Venn', { where: 'by the strongbox' })], { 'mara venn|where': 'found the strongbox' })
    keepStages(w.db, {
      [w.s3]: {
        ...kept,
        things: [{ name: 'the ledger', state: 'hidden behind the loose brick' }],
        said: { ...kept.said, '|thing:ledger': { quote: 'pushed the ledger behind the loose brick', sceneId: w.s3 } }
      }
    })
    buildStoryIndex(w.db, w.storyId)
    const a = await runLookup(call('where_is', { thing: 'the ledger' }), w.ctx())
    expect(a).toMatchObject({ ok: true, label: 'Where “the ledger” is' })
    expect(a.text).toBe('Now: the ledger hidden behind the loose brick, at The Swan (since Ch 2, Sc 1).')
    expect(a.facts).toEqual([a.text])
    const none = await runLookup(call('where_is', { thing: 'the compass' }), w.ctx())
    expect(none.ok).toBe(false)
    expect(none.text).toContain('Try find_in_story')
    expect((await runLookup(call('where_is', {}), w.ctx())).text).toContain('Say what thing')
  })

  it('state_of: where someone is and what they wear, from the story index, as the scene begins', async () => {
    const w = world()
    const a = await runLookup(call('state_of', { name: 'Mara' }), w.ctx())
    expect(a.ok).toBe(true)
    expect(a.text).toContain('Mara Venn: by the strongbox (since Ch 2, Sc 1)')
    expect(a.text).toContain('Mara Venn: wearing grey coat (since Ch 2, Sc 1)')
    expect(a.text).toContain('Mara Venn knows: The seal was taken from the strongbox')
    expect(a.facts).toContain('Mara Venn: by the strongbox (since Ch 2, Sc 1)')
    expect(a.label).toBe('Looking up Mara Venn')
    // By another name, too.
    expect((await runLookup(call('state_of', { name: 'the Captain' }), w.ctx())).text).toContain('Mara Venn: by the strongbox')
  })

  it('last_seen, who_knows, open_threads, what_happened, who_was_there and timeline answer from the index in a line or a few', async () => {
    const w = world()
    expect((await runLookup(call('last_seen', { name: 'Ash' }), w.ctx())).text).toBe(
      'Ash was last there in Ch 1, Sc 2, at The Market: Ash comes to the market; Mara buys bread.'
    )
    expect((await runLookup(call('who_knows', { fact: 'the seal' }), w.ctx())).text).toContain('The seal was taken from the strongbox: known by')
    expect((await runLookup(call('open_threads'), w.ctx())).text).toContain('The stolen seal (open since Ch 2, Sc 1')
    const happened = await runLookup(call('what_happened'), w.ctx())
    expect(happened.text.split('\n')).toEqual([
      'Ch 1, Sc 1: Mara and Tobin wait out the night at the Swan.',
      'Ch 1, Sc 2: Ash comes to the market; Mara buys bread.',
      'Ch 2, Sc 1: The seal is gone from the strongbox.'
    ])
    expect((await runLookup(call('what_happened', { from: 'Ch 1, Sc 2', to: 'chapter 1 scene 2' }), w.ctx())).text).toBe(
      'Ch 1, Sc 2: Ash comes to the market; Mara buys bread.'
    )
    const there = await runLookup(call('who_was_there', { scene: 'Market day' }), w.ctx())
    expect(there.text).toContain('Ch 1, Sc 2 at The Market, Day 2, morning')
    expect(there.text).toContain('There: Mara Venn, Ash')
    expect((await runLookup(call('timeline'), w.ctx())).text).toContain('Ch 2, Sc 1: Day 2')
  })

  it('get_entry: the entry as it stands at this scene, short unless the whole is asked for; it is noted for the briefing', async () => {
    const w = world()
    const a = await runLookup(call('get_entry', { name: 'mara venn' }), w.ctx())
    expect(a.entryId).toBe(w.mara)
    expect(a.text).toContain('Mara Venn (character), as things stand at this scene')
    expect(a.text).toContain('Also called: the Captain')
    expect(a.text).toContain('In short: Runs the ferry.')
    expect(a.text).toContain('What Mara Venn knows:\n- The seal was taken from the strongbox')
  })

  it('read_passage: the exact words of an earlier scene, around some words or at its start or end; never a later scene', async () => {
    const w = world()
    const around = await runLookup(call('read_passage', { scene: 'Ch 2, Sc 1', around: 'swore the seal' }), w.ctx())
    expect(around.text).toContain('Tobin swore the seal had been there at dawn.')
    expect(around.passages[0].where).toBe('Ch 2, Sc 1, around “swore the seal”')
    expect((await runLookup(call('read_passage', { scene: 'previous', part: 'start' }), w.ctx())).text).toContain('Mara found the strongbox empty.')
    const later = await runLookup(call('read_passage', { scene: 'Ch 2, Sc 3' }), w.ctx())
    expect(later.ok).toBe(false)
    expect(later.text).toBe("There's no Ch 2, Sc 3 before this scene (only earlier scenes can be read). Scenes before this one run from Ch 1, Sc 1 to Ch 2, Sc 1.")
    const missing = await runLookup(call('read_passage', { scene: 'Ch 1, Sc 1', around: 'a dragon lands' }), w.ctx())
    expect(missing.text).toBe(`Those words aren't in Ch 1, Sc 1. Try fewer of them, or "part": "start" or "end".`)
  })

  it('find_in_story: the search, passed in, a few passages with where each is; none, or none available, says what to try', async () => {
    const w = world()
    const asked: [string, number][] = []
    const find = async (q: string, most: number) => {
      asked.push([q, most])
      return [{ where: 'Ch 1, Sc 1', text: 'Mara set the lantern on the table.' }]
    }
    const a = await runLookup(call('find_in_story', { query: 'the lantern' }), w.ctx({ find }))
    expect(a.text).toBe('### Ch 1, Sc 1\nMara set the lantern on the table.')
    expect(a.passages).toEqual([{ where: 'Ch 1, Sc 1', text: 'Mara set the lantern on the table.' }])
    expect(asked).toEqual([['the lantern', 3]])
    expect((await runLookup(call('find_in_story', { query: 'x' }), w.ctx())).text).toBe('Searching isn’t available just now. Try read_passage or what_happened.')
    expect((await runLookup(call('find_in_story', { query: 'dragons' }), w.ctx({ find: async () => [] }))).text).toBe(
      'Nothing earlier in the story matches “dragons”. Try other words, or what_happened.'
    )
  })

  it('a look-up that can’t be answered says why and what to try next', async () => {
    const w = world()
    const who = await runLookup(call('state_of', { name: 'Gale' }), w.ctx())
    expect(who.ok).toBe(false)
    expect(who.text).toBe(
      'No one or nothing called “Gale” is known at this point. People in this scene: Mara Venn, Tobin. Use a name as the briefing gives it, or find_in_story to search the words.'
    )
    expect((await runLookup(call('state_of', '{not json'), w.ctx())).text).toBe(
      'The arguments for state_of weren\'t a JSON object. Call it again with them as one, such as {"name": "…"}.'
    )
    expect((await runLookup(call('dance'), w.ctx())).text).toMatch(/^There is no look-up called “dance”. The look-ups are: state_of, last_seen/)
    expect((await runLookup(call('who_was_there', { scene: 'The moon' }), w.ctx())).text).toBe(
      'No earlier scene is called “The moon”. Scenes before this one run from Ch 1, Sc 1 to Ch 2, Sc 1; name one as "Ch 2, Sc 1".'
    )
    // The index has nothing for a scene not built yet.
    const fresh = repo.createScene(w.db, repo.getOutline(w.db, w.storyId).chapters[1].id, { title: 'New' }).id
    expect((await runLookup(call('open_threads'), w.ctx({ sceneId: fresh }))).text).toBe(
      'The story index has nothing for this scene yet. Try get_entry, find_in_story or read_passage instead.'
    )
  })

  it('never tells anything Adam kept out of the scene', async () => {
    const w = world()
    const ctx = w.ctx({ hidden: new Set([w.ash]) })
    expect((await runLookup(call('state_of', { name: 'Ash' }), ctx)).text).toBe('Nothing can be looked up about “Ash” for this scene.')
    expect((await runLookup(call('get_entry', { name: 'Ash' }), ctx)).ok).toBe(false)
    const happened = await runLookup(call('what_happened'), ctx)
    expect(happened.text).not.toContain('Ash')
    expect(happened.text).toContain('Ch 1, Sc 1: Mara and Tobin wait out the night at the Swan.')
  })

  it('answers a round in order, a tool message and a step each, and no more than a handful', async () => {
    const w = world()
    const calls = [call('open_threads'), ...Array.from({ length: LOOKUPS_MOST }, () => call('last_seen', { name: 'Ash' }))]
    const r = await answerLookups(calls, w.ctx())
    expect(r.results).toHaveLength(calls.length)
    expect(r.results[0]).toMatchObject({ role: 'tool', toolCallId: calls[0].id })
    expect(r.results[LOOKUPS_MOST].content).toBe(`Not looked up: at most ${LOOKUPS_MOST} look-ups at once.`)
    expect(r.steps[0]).toMatchObject({ label: 'The open plot threads', tool: 'open_threads' })
  })
})

describe('the look-ups a stand-in test found short (2026-10-19)', () => {
  it('what_happened: each scene’s gist in whole sentences, never cut part-way, and “no summary yet” for a scene with none', async () => {
    const w = world()
    const ch1 = repo.getOutline(w.db, w.storyId).chapters[0].id
    mem.putSummary(w.db, {
      level: 'scene',
      targetId: w.s2,
      text: 'Ash comes to the market. Mara buys bread and haggles over the price of salt with a trader who will not',
      origin: 'text'
    })
    const long = Array.from({ length: 12 }, (_, i) => `Mara counts the river stones for the ${i + 1}th time while Tobin waits.`).join(' ')
    mem.putSummary(w.db, { level: 'scene', targetId: w.s1, text: long, origin: 'text' })
    // A scene the memory hasn't summed up yet.
    repo.createScene(w.db, ch1, { title: 'The ford' })
    buildStoryIndex(w.db, w.storyId)
    const a = await runLookup(call('what_happened'), w.ctx())
    const lines = a.text.split('\n')
    expect(lines).toHaveLength(4)
    // As many whole sentences as fit in the line, ending at a full stop.
    expect(lines[0]).toMatch(/^Ch 1, Sc 1: Mara counts the river stones for the 1th time while Tobin waits\. .*waits\.$/)
    expect(lines[0].length).toBeLessThan(320)
    // A summary that stops part-way through a sentence: its whole sentences only.
    expect(lines[1]).toBe('Ch 1, Sc 2: Ash comes to the market.')
    expect(lines[2]).toBe('Ch 1, Sc 3: no summary yet')
    expect(lines[3]).toBe('Ch 2, Sc 1: The seal is gone from the strongbox.')
    // Only scenes with a gist are facts for the writer.
    expect(a.facts.some((f) => f.includes('no summary yet'))).toBe(false)
    expect(wholeSentences('One very long sentence that goes on and on without ever stopping anywhere at all', 30)).toBe('One very long sentence that…')
  })

  it('state_of: everything the index has, kind by kind, and what it has nothing on yet', async () => {
    const w = world()
    const tobin = await runLookup(call('state_of', { name: 'Tobin', full: true }), w.ctx())
    expect(tobin.text).toContain('Tobin: at The Swan (since Ch 1, Sc 1)')
    expect(tobin.text).toContain(
      'Not recorded yet for Tobin: what they wear, what they carry, how they are (injuries and the like), what they know, their ties to others.'
    )
    expect(tobin.facts.some((f) => f.startsWith('Not recorded yet'))).toBe(false)
    const mara = await runLookup(call('state_of', { name: 'Mara' }), w.ctx())
    expect(mara.text).toContain('Not recorded yet for Mara Venn: what they carry, how they are (injuries and the like), their ties to others.')
  })

  it('state_of: with nothing of what someone wears, carries or suffers, the scene before is filled in first when that is quick', async () => {
    const w = world()
    const asked: string[] = []
    const fill = async (sceneId: string): Promise<boolean> => {
      asked.push(sceneId)
      keepStages(w.db, {
        [w.s3]: stage(w.s3, [person('Mara Venn', { where: 'by the strongbox', clothes: [{ name: 'grey coat', state: 'on' }] }), person('Tobin', { clothes: [{ name: 'oilskin', state: 'on' }] })], {
          'mara venn|where': 'found the strongbox',
          'mara venn|clothes:grey coat': 'found the strongbox empty',
          'tobin|clothes:oilskin': 'Tobin swore'
        })
      })
      buildStoryIndex(w.db, w.storyId)
      return true
    }
    const a = await runLookup(call('state_of', { name: 'Tobin' }), w.ctx({ fill }))
    expect(asked).toEqual([w.s3])
    expect(a.text).toContain('Tobin: wearing oilskin (since Ch 2, Sc 1)')
    // Not quick (or it failed): nothing more, and it says what isn't recorded yet.
    const fresh = world()
    const b = await runLookup(call('state_of', { name: 'Tobin' }), fresh.ctx({ fill: async () => false }))
    expect(b.text).toContain('Not recorded yet for Tobin: what they wear')
    // Something of it known already: nothing filled in.
    asked.length = 0
    await runLookup(call('state_of', { name: 'Mara' }), w.ctx({ fill }))
    expect(asked).toEqual([])
  })
})

describe('reading passages and scene names', () => {
  it('knows a scene however it is written', () => {
    expect(sceneLabel('Ch 2, Sc 3')).toBe('Ch 2, Sc 3')
    expect(sceneLabel('chapter 2, scene 3')).toBe('Ch 2, Sc 3')
    expect(sceneLabel('Ch2 Sc3')).toBe('Ch 2, Sc 3')
    expect(sceneLabel('2.3')).toBe('Ch 2, Sc 3')
    expect(sceneLabel('The strongbox')).toBeNull()
  })

  it('gives whole paragraphs out from the words found, or its start or end, within the words allowed', () => {
    const text = ['One two three.', 'Four five six.', 'Seven eight nine.', 'Ten eleven twelve.'].join('\n\n')
    expect(passageOf(text, { near: 'EIGHT, nine', most: 6 })).toBe('Four five six.\n\nSeven eight nine.')
    expect(passageOf(text, { part: 'start', most: 6 })).toBe('One two three.\n\nFour five six.')
    expect(passageOf(text, { part: 'end', most: 3 })).toBe('Ten eleven twelve.')
    expect(passageOf(text, { near: 'thirteen', most: 6 })).toBeNull()
    expect(passageOf('a b c d e f g h', { part: 'end', most: 3 })).toBe('… f g h')
  })
})
