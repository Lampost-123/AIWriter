// The plan before a draft (withPlan) asks for a continuity brief only when the draft lets it: Write the whole chapter's
// drafts don't (token audit, 2026-10-19), as its study wrote one for every scene. Beat by beat says which beat it is, so
// the scene is planned once (plan/index.ts). The plan itself is stood in for here.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ db: { open: true }, asked: [] as { o: unknown }[] }))
vi.mock('../world', () => ({ db: () => h.db, maybeCurrentWorld: () => ({ db: h.db }) }))
vi.mock('../plan', () => ({
  planWanted: () => true,
  planBeforeWriting: async (_db: unknown, _sceneId: unknown, _b: unknown, _signal: unknown, o: unknown) => {
    h.asked.push({ o })
    return null
  }
}))

import { withPlan } from './draftFlow'

beforeEach(() => {
  h.asked = []
})

describe('the plan before a draft', () => {
  const b = { prepared: { finals: {} }, input: {}, preview: { blocks: [] } } as never

  it('is asked for a continuity brief as the settings say, unless the draft says not; a beat says which it is', async () => {
    expect(await withPlan('s', b)).toBe(b)
    expect(await withPlan('s', b, { brief: false })).toBe(b)
    expect(await withPlan('s', b, { beat: { index: 1, of: 2 } })).toBe(b)
    expect(h.asked).toEqual([{ o: { brief: undefined } }, { o: { brief: false } }, { o: { brief: undefined, beat: { index: 1, of: 2 } } }])
  })
})
