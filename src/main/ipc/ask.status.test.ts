// chat-truth R8 (task 4): a change that only started (a draft, an in-page fix) is kept as 'started', not applied; a
// status the window never sends is turned down. Invented words only.
import { describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { Proposal } from '@shared/contracts/ask'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { proposalsOf, saveProposals } from '../db/ask'

const open = vi.hoisted(() => ({ db: null as unknown as Database.Database }))
vi.mock('../world', () => ({ db: () => open.db, maybeCurrentWorld: () => ({ db: open.db }) }))

import { askHandlers } from './ask'

const card = (id: string): Proposal =>
  ({ id, status: 'pending', why: '', kind: 'card', sceneId: 's1', sceneLabel: 'Ch 1, Sc 1', patch: { goal: 'Cross before the tide.' } }) as Proposal

function withTurn(): string {
  open.db = memoryWorld()
  const scene = repo.getOutline(open.db, repo.listStories(open.db)[0].id).scenes[0].id
  open.db
    .prepare(
      `INSERT INTO generations (id, scene_id, job, status, provider_id, provider_name, model_id, params_json, blocks_json, messages_json, budget_json, created_at)
       VALUES ('g1', ?, 'chat', 'complete', 'p', 'OpenRouter', 'm', '{}', '[]', '[]', '{}', ?)`
    )
    .run(scene, new Date().toISOString())
  saveProposals(open.db, 'g1', [card('1'), card('2')])
  return 'g1'
}

const setStatus = askHandlers.setProposalStatus as unknown as (g: string, id: string, status: string) => unknown

describe('setProposalStatus', () => {
  it('keeps started, then applied, for the one change named', async () => {
    const g = withTurn()
    await setStatus(g, '1', 'started')
    expect(proposalsOf(open.db, g).map((p) => p.status)).toEqual(['started', 'pending'])
    await setStatus(g, '1', 'applied')
    expect(proposalsOf(open.db, g).map((p) => p.status)).toEqual(['applied', 'pending'])
  })

  it('turns down a status the window never sends, and changes nothing', async () => {
    const g = withTurn()
    expect(() => setStatus(g, '1', 'done')).toThrow('Something went wrong. Try again.')
    expect(proposalsOf(open.db, g).map((p) => p.status)).toEqual(['pending', 'pending'])
  })
})
