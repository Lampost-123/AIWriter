// The sample world (milestone 6): made in an in-memory world as the app makes it, then checked like a real
// world: the memory answers sensibly at each scene, every row points at something that exists, the memory
// counts as read (so nothing would be sent to the AI), and the origins are right.

import type Database from 'better-sqlite3'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AsOf, ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import { memoryAt } from '../memory/asOf'
import { buildLine, knowsSentence } from '../memory/line'
import { loadShape } from '../memory/scene'
import { planRead } from '../keeper/track'
import { nextRollUp, sceneSummaryDue } from '../keeper/summaries'
import type { MemoryModel } from '../keeper/model'
import { fillSampleWorld, isSampleWorld } from './sampleWorld'
import { SAMPLE_CHAPTERS, SAMPLE_ENTRIES, SAMPLE_NAME } from './sampleContent'

let db: Database.Database
let storyId: ID
let sceneIds: ID[]
const entry = (name: string) => repo.listEntries(db).find((e) => e.name === name)!

beforeAll(() => {
  db = memoryWorld('Untitled')
  fillSampleWorld(db)
  storyId = repo.listStories(db)[0].id
  sceneIds = repo.getOutline(db, storyId).scenes.map((s) => s.id)
})

const at = (i: number): AsOf => ({ kind: 'scene', storyId, sceneId: sceneIds[i] })
const state = (i: number) => memoryAt(db, at(i)).state

describe('the sample world', () => {
  it('is a whole world: one story, two chapters, four scenes of prose, every entry', () => {
    expect(isSampleWorld(db)).toBe(true)
    expect(repo.getMeta(db, 'name')).toBe(SAMPLE_NAME)
    expect(repo.listStories(db)).toHaveLength(1)
    const outline = repo.getOutline(db, storyId)
    expect(outline.chapters.map((c) => c.title)).toEqual(SAMPLE_CHAPTERS.map((c) => c.title))
    expect(outline.scenes).toHaveLength(4)
    for (const s of outline.scenes) expect(s.wordCount).toBeGreaterThan(150)
    expect(outline.scenes.map((s) => s.status)).toEqual(['done', 'done', 'done', 'drafted'])
    expect(repo.listEntries(db).map((e) => e.name).sort()).toEqual(SAMPLE_ENTRIES.map((e) => e.name).sort())
    expect(entry('The Gullhaven Light').parentId).toBe(entry('Gullhaven').id)
    expect(entry('The light is never dark').hardRule).toBe(true)
  })

  it('has the right origins: Adam’s typed pages are his, what the memory found is from the text, with links', () => {
    expect(entry('Wren Halloway').origin).toBe('adam')
    expect(entry('Wren Halloway').byHand).toBe(true)
    const iska = entry('Iska Vey')
    expect(iska.origin).toBe('text')
    expect(iska.byHand).toBe(false)
    expect(hist.linksForEntry(db, iska.id).map((l) => l.factKind).sort()).toEqual(['entry', 'field', 'field'])
    const textChanges = mem.listAllChanges(db).filter((c) => c.anchor === 'scene')
    expect(textChanges.length).toBeGreaterThan(5)
    for (const c of textChanges) {
      expect(c.origin).toBe('text')
      expect(hist.linksForFact(db, 'change', c.id)).toHaveLength(1)
    }
    for (const c of mem.listAllChanges(db).filter((c) => c.anchor === 'baseline')) expect(c.origin).toBe('adam')
  })

  it('every source link quotes its scene exactly, where it says', () => {
    const links = db.prepare('SELECT id FROM source_links').all() as { id: ID }[]
    expect(links.length).toBeGreaterThan(10)
    for (const sceneId of sceneIds) {
      const scene = repo.getScene(db, sceneId)
      const paras = (scene.doc as { content: { attrs: { pid: string }; content: { text: string }[] }[] }).content
      for (const l of hist.linksInScene(db, sceneId)) {
        const para = paras.find((p) => p.attrs.pid === l.paragraphId)!
        expect(para.content[0].text.slice(l.start, l.end)).toBe(l.quote)
        expect(l.state).toBe('ok')
      }
    }
  })

  it('answers sensibly at each scene', () => {
    const wren = entry('Wren Halloway').id
    const edric = entry('Edric Halloway').id
    const iska = entry('Iska Vey').id
    const letter = entry('What is in the sealed letter?').id
    const midwinter = entry('Will the light go dark at midwinter?').id

    // Scene 1: Edric's hands; Iska hasn't arrived.
    expect(state(0).entries.get(edric)!.fields.movement).toMatch(/shaking hands/)
    expect(state(0).entries.has(iska)).toBe(false)
    expect(state(0).relationships.some((r) => [r.aId, r.bId].includes(wren) && [r.aId, r.bId].includes(edric))).toBe(true)

    // Scene 2: Iska is here and knows what the letter says; Wren doesn't yet. The letter's thread is open.
    const s2 = state(1)
    expect(s2.entries.has(iska)).toBe(true)
    const fact = s2.facts.find((f) => /midwinter/.test(f.fact))!
    expect(fact.knownBy).toEqual([iska])
    expect(s2.threads.find((t) => t.entryId === letter)?.status).toBe('open')

    // Scene 3: Wren and her father know it too; the letter is answered and the midwinter thread opens.
    const s3 = state(2)
    expect(s3.facts.find((f) => f.factId === fact.factId)!.knownBy.sort()).toEqual([edric, iska, wren].sort())
    expect(s3.threads.find((t) => t.entryId === letter)?.status).toBe('resolved')
    expect(s3.threads.find((t) => t.entryId === midwinter)?.status).toBe('open')
    expect(s3.entries.get(wren)!.fields.marks).not.toMatch(/palm/)

    // Scene 4: the rope burn, and Wren and Iska are uneasy allies.
    const s4 = state(3)
    expect(s4.entries.get(wren)!.fields.marks).toMatch(/left palm/)
    const tie = s4.relationships.find((r) => [r.aId, r.bId].includes(wren) && [r.aId, r.bId].includes(iska))
    expect(tie?.type).toBe('uneasy allies')
  })

  it('the line knows only the starting setup at the story’s start', () => {
    const shape = loadShape(db)
    expect(knowsSentence(shape, buildLine(shape, { storyId, through: 'start' }))).toBe('This story knows only the starting setup.')
  })

  it('counts as read: nothing to send the memory model, no summary to write', () => {
    expect(kdb.scenesToRead(db)).toEqual([])
    expect(kdb.memoryCounts(db)).toEqual({ behind: 0, failed: 0 })
    for (const id of sceneIds) {
      const scene = kdb.keeperScene(db, id)!
      expect(scene.read.length).toBe(repo.getScene(db, id).text.split('\n\n').length)
      const plan = planRead(db, scene)
      expect(plan.toRead).toEqual([])
      expect(plan.moves).toEqual([])
      expect(plan.gone).toEqual([])
      expect(sceneSummaryDue(db, id, true)).toBe(false)
      expect(mem.getSummary(db, 'scene', id)?.origin).toBe('text')
    }
    const model = { choice: { contextLength: 32000 } } as unknown as MemoryModel
    expect(nextRollUp(db, [storyId], () => '', model)).toBeNull()
  })

  it('leaves no row pointing at nothing', () => {
    const orphans = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
    expect(orphans('SELECT COUNT(*) AS n FROM changes c LEFT JOIN entries e ON e.id = c.entry_id WHERE e.id IS NULL')).toBe(0)
    expect(orphans("SELECT COUNT(*) AS n FROM changes c LEFT JOIN scenes s ON s.id = c.scene_id WHERE c.scene_id IS NOT NULL AND s.id IS NULL")).toBe(0)
    expect(orphans('SELECT COUNT(*) AS n FROM exists_points p LEFT JOIN entries e ON e.id = p.entry_id WHERE e.id IS NULL')).toBe(0)
    expect(orphans('SELECT COUNT(*) AS n FROM source_links l LEFT JOIN scenes s ON s.id = l.scene_id WHERE s.id IS NULL')).toBe(0)
    expect(
      orphans(
        `SELECT COUNT(*) AS n FROM source_links l WHERE
           (l.fact_kind IN ('entry', 'field') AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.id = l.fact_id)) OR
           (l.fact_kind = 'change' AND NOT EXISTS (SELECT 1 FROM changes c WHERE c.id = l.fact_id))`
      )
    ).toBe(0)
    for (const s of mem.listSummaries(db)) expect(mem.summaryTargetExists(db, s.level, s.targetId)).toBe(true)
    // Relationships point at entries that exist.
    for (const c of mem.listAllChanges(db).filter((x) => x.kind === 'relationship')) {
      expect(() => repo.getEntry(db, (c.payload as { otherId: ID }).otherId)).not.toThrow()
    }
    // Scene cards name only entries that exist.
    for (const id of sceneIds) {
      const card = repo.getScene(db, id).card
      for (const e of [card.povId, card.locationId, ...card.presentIds, ...card.setsUpIds, ...card.paysOffIds]) {
        expect(() => repo.getEntry(db, e!)).not.toThrow()
      }
    }
    // Every entry and change has its memory-history version.
    for (const e of repo.listEntries(db)) expect(hist.entryHistory(db, e.id).length).toBeGreaterThan(0)
  })
})
