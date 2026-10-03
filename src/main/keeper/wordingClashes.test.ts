import { describe, expect, it } from 'vitest'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import * as cdb from '../db/checks'
import { setAsideWordingClashes } from './wordingClashes'

function world() {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  const tam = repo.createEntry(db, 'character', { name: 'Tam', fields: { eyes: 'blue', hair: 'red beard' } })
  const inn = repo.createEntry(db, 'place', { name: 'The Gull', fields: { senses: 'smells of pine resin' } })
  const clash = (entryId: string, field: string, memory: string, text: string, extra: Record<string, unknown> = {}) =>
    kdb.raiseIssue(db, {
      sceneId,
      storyId: story.id,
      kind: 'fact',
      severity: 'warning',
      quote: `The words: ${text}`,
      message: `This scene says “${text}”, but the memory says “${memory}”.`,
      key: `clash:${entryId}:${field}:${text}`,
      payload: { entryId, field, memory, text, ...extra }
    })
  return { db, sceneId, tam, inn, clash }
}

const statuses = (db: ReturnType<typeof memoryWorld>, sceneId: string): Record<string, string> =>
  Object.fromEntries(cdb.sceneIssueRows(db, sceneId).map((r) => [cdb.payloadOf(r).text as string, r.status as string]))

describe('setting aside clashes that only say the same in other words', () => {
  it('sets aside rewordings and added detail as ignored, keeps real contradictions, and runs once', () => {
    const { db, sceneId, tam, inn, clash } = world()
    clash(tam.id, 'hair', 'red beard', 'a redder beard')
    clash(tam.id, 'eyes', 'blue', 'green')
    clash(inn.id, 'senses', 'smells of pine resin', 'cold, and quiet as a held breath')
    // One a consistency check also found keeps its place: it was judged on its meaning.
    clash(tam.id, 'speech', 'slow and careful', 'fast and loud', { check: 'facts', fix: 'He spoke slowly.' })

    expect(setAsideWordingClashes(db)).toBe(2)
    expect(statuses(db, sceneId)).toEqual({
      'a redder beard': 'ignored',
      green: 'open',
      'cold, and quiet as a held breath': 'ignored',
      'fast and loud': 'open'
    })
    // Ignored, so Adam can reopen it; and the next opening of the world leaves the issues alone.
    const row = cdb.sceneIssueRows(db, sceneId).find((r) => cdb.payloadOf(r).text === 'a redder beard')!
    cdb.setIssueStatus(db, row.id as string, 'open')
    expect(setAsideWordingClashes(db)).toBe(0)
    expect(statuses(db, sceneId)['a redder beard']).toBe('open')
  })
})
