// How fast the story index is built and read: a story of 50 scenes of about 1,500 invented words each, a cast of 12
// with 40 other entries, where things stand kept for every scene and the memory's changes in each. The times are
// printed, and each must stay within its budget (src/shared/testPerf.ts gives CI its room).
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { budget } from '../../shared/testPerf'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { keepStages, person, setCard, stage } from '../../../tests/unit/storyIndexWorld'
import {
  buildStoryIndex,
  indexChecks,
  lastSeen,
  openThreads,
  presentAt,
  refreshSceneIndex,
  sceneGists,
  stateOf,
  timeline,
  whoKnows
} from '.'

const SCENES = 50
const CHAPTERS = 5

/** A story of SCENES scenes with everything the index is built from. */
function bigWorld(): { db: Database.Database; storyId: ID; scenes: ID[]; cast: { id: ID; name: string }[] } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const chapters = [o.chapters[0].id]
  while (chapters.length < CHAPTERS) chapters.push(repo.createChapter(db, story.id, {}).id)
  const scenes = [o.scenes[0].id]
  for (let i = 1; i < SCENES; i++) scenes.push(repo.createScene(db, chapters[Math.floor(i / (SCENES / CHAPTERS))], {}).id)
  const names = [
    'Mara Venn',
    'Tobin Ash',
    'Ilse Corran',
    'Bryn',
    'Kell Marrow',
    'Odile',
    'Penn Hart',
    'Ruth',
    'Sefa',
    'Wren Tal',
    'Yorick',
    'Zan'
  ]
  const cast = names.map((name) => ({
    id: repo.createEntry(db, 'character', { name, aliases: [`${name.split(' ')[0]}-${name.length}`] }).id,
    name
  }))
  const places = Array.from({ length: 6 }, (_, i) => repo.createEntry(db, 'place', { name: `Place ${String.fromCharCode(65 + i)}` }).id)
  for (let i = 0; i < 31; i++) repo.createEntry(db, 'item', { name: `Thing ${i}` })
  const threads = Array.from(
    { length: 3 },
    (_, i) => repo.createEntry(db, 'thread', { name: `The ${['seal', 'heir', 'debt'][i]} affair` }).id
  )

  const states: Record<ID, ReturnType<typeof stage>> = {}
  scenes.forEach((id, i) => {
    const here = [cast[i % 12], cast[(i + 3) % 12], cast[(i + 7) % 12]]
    const paragraphs: string[] = []
    let count = 0
    while (count < 1500) {
      const p = [
        `${here[0].name} crossed the yard while ${here[1].name.split(' ')[0]} counted the coins by the well, and the wind came off the hills.`,
        `She thought of ${cast[(i + 5) % 12].name}, far away, and of Thing ${i % 31} left on the sill.`,
        `"Not tonight," said ${here[2].name}, and the lamp burned low.`
      ].join(' ')
      paragraphs.push(p)
      count += p.split(' ').length
    }
    repo.saveSceneText(db, id, null, paragraphs.join('\n\n'))
    setCard(db, id, { povId: here[0].id, presentIds: [here[1].id], locationId: places[i % 6], when: `Day ${i + 1}, evening` })
    mem.putSummary(db, {
      level: 'scene',
      targetId: id,
      text: `Scene ${i + 1}: ${here[0].name} and ${here[1].name} at the well.`,
      origin: 'text'
    })
    mem.insertChange(db, {
      entryId: here[0].id,
      anchor: 'scene',
      sceneId: id,
      kind: 'knowledge',
      payload: { factId: `f${i}`, fact: `Secret number ${i} about the well`, there: [here[0].id, here[1].id] },
      origin: 'text'
    })
    mem.insertChange(db, {
      entryId: here[1].id,
      anchor: 'scene',
      sceneId: id,
      kind: 'update',
      payload: { note: `hurt a hand at the well (${i})` },
      origin: 'text'
    })
    if (i % 7 === 0)
      mem.insertChange(db, {
        entryId: threads[i % 3],
        anchor: 'scene',
        sceneId: id,
        kind: 'thread',
        payload: { status: 'open', note: `Step ${i}` },
        origin: 'text'
      })
    states[id] = stage(
      id,
      here.map((c, k) =>
        person(c.name, {
          where: `by the well ${i % 4}`,
          holding: `a lamp ${(i + k) % 3}`,
          clothes: [{ name: `coat ${(i + k) % 5}`, state: 'on' }]
        })
      ),
      Object.fromEntries(
        here.flatMap((c) => [
          [`${c.name.toLowerCase()}|where`, 'crossed the yard'],
          [`${c.name.toLowerCase()}|holding`, 'the lamp burned'],
          [`${c.name.toLowerCase()}|clothes:coat ${(i + here.indexOf(c)) % 5}`, 'crossed the yard']
        ])
      )
    )
  })
  keepStages(db, states)
  return { db, storyId: story.id, scenes, cast }
}

/** The middle time of a few runs, in milliseconds. */
function timed(run: () => unknown, times = 7): number {
  const ms: number[] = []
  for (let i = 0; i < times; i++) {
    const t = performance.now()
    run()
    ms.push(performance.now() - t)
  }
  return ms.sort((a, b) => a - b)[Math.floor(times / 2)]
}

describe('the story index on a story of 50 scenes', () => {
  it('builds in a second or two, builds nothing again when nothing changed, and answers each look-up in milliseconds', () => {
    const w = bigWorld()
    const first = buildStoryIndex(w.db, w.storyId)
    expect(first.built).toBe(SCENES)
    const again = timed(() => buildStoryIndex(w.db, w.storyId), 3)
    repo.saveSceneText(w.db, w.scenes[25], null, 'Mara Venn waited by the well.')
    const refresh = timed(() => refreshSceneIndex(w.db, w.scenes[25]), 1)
    const at = w.scenes[40]
    const looks = {
      stateOf: timed(() => stateOf(w.db, w.storyId, 'Mara Venn', at)),
      lastSeen: timed(() => lastSeen(w.db, w.storyId, 'Ruth', at)),
      whoKnows: timed(() => whoKnows(w.db, w.storyId, 'Secret number 12', at)),
      openThreads: timed(() => openThreads(w.db, w.storyId, at)),
      sceneGists: timed(() => sceneGists(w.db, w.storyId, w.scenes[30], at)),
      presentAt: timed(() => presentAt(w.db, at)),
      timeline: timed(() => timeline(w.db, w.storyId, at)),
      checks: timed(() => indexChecks(w.db, w.storyId))
    }
    const facts = (w.db.prepare('SELECT COUNT(*) AS n FROM index_facts').get() as { n: number }).n
    console.info(
      `Story index, ${SCENES} scenes, ${facts} facts: first build ${first.ms.toFixed(0)} ms, again with nothing changed ${again.toFixed(0)} ms, ` +
        `one scene refreshed ${refresh.toFixed(0)} ms; look-ups (ms): ${Object.entries(looks)
          .map(([k, v]) => `${k} ${v.toFixed(2)}`)
          .join(', ')}`
    )
    expect(stateOf(w.db, w.storyId, 'Mara Venn', at)?.lines.length).toBeGreaterThan(2)
    expect(first.ms).toBeLessThan(budget(4000))
    expect(again).toBeLessThan(budget(1500))
    expect(refresh).toBeLessThan(budget(500))
    for (const [name, ms] of Object.entries(looks))
      expect(ms, name).toBeLessThan(budget(name === 'checks' || name === 'timeline' ? 100 : 25))
  })
})
