// A proposed draft never writes over a scene's words: "generate" on a scene that has words goes below them, as
// "add below" does; into an empty scene it writes as usual. The writer's own flows are stood in for. Invented text only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Proposal } from '@shared/contracts/ask'

const s = vi.hoisted(() => ({
  hasText: true,
  /** Write the chapter holds the scene (sceneInPage.ts heldWhy). */
  held: false,
  calls: [] as { replace?: boolean; options: Record<string, unknown> }[],
  /** How the latest draft ended (draftRun's `last`). */
  last: null as null | { sceneId: string; status: 'complete' | 'stopped' | 'error'; error: string | null; at: number },
  /** The page's suggestions: the one waiting, and the last that went (features/edits/suggestions). */
  page: { active: null as null | { id: string }, gone: null as null | { id: string; reason: string } }
}))

vi.mock('@/lib/api', () => ({ api: { getScene: async () => ({ card: { beats: [] } }) } }))
vi.mock('@/lib/store', () => ({ useApp: { getState: () => ({ settings: { models: { writer: { modelId: 'w' } } }, draftOptions: {}, activeGeneration: null }) } }))
vi.mock('@/lib/editorBridge', () => ({
  editorBridge: () => ({ sceneId: 'sc1', busy: () => false, hasText: () => s.hasText, editor: { isDestroyed: false, state: s.page } })
}))
vi.mock('./askEdits', () => ({ continueAt: () => 1, beatNumber: () => 1 }))
vi.mock('@/features/edits/suggestions', () => ({
  suggestionsOf: (state: typeof s.page) => state,
  activeSuggestion: (state: typeof s.page) => state.active
}))
vi.mock('./sceneInPage', () => ({
  sceneInPage: async () => ({ state: { doc: null } }),
  heldWhy: () => (s.held ? 'Write the chapter is writing this scene right now.' : null),
  notOpened: async () => 'It didn’t open.'
}))
vi.mock('@/features/generate/draftOptions', () => ({ BLANK_DRAFT_OPTIONS: { direction: '' } }))
vi.mock('@/features/generate/draftRun', () => ({
  busyElsewhere: () => false,
  useDraft: { getState: () => ({ sceneId: null, phase: 'idle', last: s.last }) },
  startDraft: async (_id: string, _bridge: unknown, opts: { replace?: boolean; options: () => Record<string, unknown> }) => {
    s.calls.push({ replace: opts.replace, options: opts.options() })
    return true
  }
}))
vi.mock('@/features/edits/session', () => ({ startTool: async () => true, waitingSuggestion: () => false }))
vi.mock('@/features/beats/flow', () => ({ beatBeingWritten: () => null }))
vi.mock('@/features/beats/redo', () => ({ redoBeat: async () => true, redoing: () => null }))
vi.mock('@/features/variants/store', () => ({ isWriting: () => false, setOf: () => null, useVariants: { getState: () => ({}) } }))

const { startProposedDraft, LANDED_POLL_MS } = await import('./applyDraft')

const draft = (mode: string): Parameters<typeof startProposedDraft>[0] =>
  ({ id: 'd', kind: 'draft', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', mode, direction: 'She climbs to the lamp room.', why: '', status: 'pending' }) as unknown as Extract<Proposal, { kind: 'draft' }>

beforeEach(() => {
  s.calls.length = 0
  s.held = false
  s.last = null
  s.page = { active: null, gone: null }
})

describe('a proposed draft on a scene that has words', () => {
  it('generate goes below the words, never in place of them', async () => {
    s.hasText = true
    expect(await startProposedDraft(draft('generate'))).toMatchObject({ ok: true })
    expect(s.calls).toEqual([{ replace: false, options: expect.objectContaining({ addBelow: true, direction: 'She climbs to the lamp room.' }) }])
  })

  it('add below goes below the words', async () => {
    s.hasText = true
    await startProposedDraft(draft('add_below'))
    expect(s.calls[0]).toMatchObject({ replace: false, options: { addBelow: true } })
  })
})

describe('a proposed draft on an empty scene', () => {
  it('generate writes the scene as usual', async () => {
    s.hasText = false
    await startProposedDraft(draft('generate'))
    expect(s.calls[0].replace).toBe(false)
    expect(s.calls[0].options).not.toHaveProperty('addBelow')
  })
})

/** How a started draft ended, once its end has been looked at. */
async function landing(started: Awaited<ReturnType<typeof startProposedDraft>>, end: () => void): Promise<unknown> {
  if (!started.ok) throw new Error('not started')
  let out: unknown = 'still going'
  void started.landed.then((l) => (out = l))
  await vi.advanceTimersByTimeAsync(LANDED_POLL_MS * 2)
  expect(out).toBe('still going')
  end()
  await vi.advanceTimersByTimeAsync(LANDED_POLL_MS * 2)
  return out
}

describe('a started draft says when it lands, or why not (Started is not Applied)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    s.hasText = false
  })
  afterEach(() => vi.useRealTimers())

  it('generate lands when the draft completes; an earlier draft’s end doesn’t count', async () => {
    s.last = { sceneId: 'sc1', status: 'complete', error: null, at: Date.now() - 60_000 }
    const out = await landing(await startProposedDraft(draft('generate')), () => (s.last = { sceneId: 'sc1', status: 'complete', error: null, at: Date.now() }))
    expect(out).toEqual({ ok: true })
  })

  it('a stopped draft is said plainly, and the change waits again', async () => {
    const out = await landing(await startProposedDraft(draft('generate')), () => (s.last = { sceneId: 'sc1', status: 'stopped', error: null, at: Date.now() }))
    expect(out).toEqual({ ok: false, why: 'The draft in Ch 1, Sc 1 was stopped before it finished, so the change is waiting again.' })
  })

  it('a failed draft says what went wrong', async () => {
    const out = await landing(await startProposedDraft(draft('generate')), () => (s.last = { sceneId: 'sc1', status: 'error', error: 'The writer model is busy.', at: Date.now() }))
    expect(out).toEqual({ ok: false, why: 'The draft in Ch 1, Sc 1 didn’t finish, so the change is waiting again. The writer model is busy.' })
  })

  it('continue lands when Adam accepts its change in the page', async () => {
    s.hasText = true
    s.page.active = { id: 'chg' }
    const out = await landing(await startProposedDraft({ ...draft('continue') }), () => (s.page = { active: null, gone: { id: 'chg', reason: 'accepted' } }))
    expect(out).toEqual({ ok: true })
  })

  it('continue rejected in the page: the change waits again, with why', async () => {
    s.hasText = true
    s.page.active = { id: 'chg' }
    const out = await landing(await startProposedDraft({ ...draft('continue') }), () => (s.page = { active: null, gone: { id: 'chg', reason: 'rejected' } }))
    expect(out).toEqual({ ok: false, why: 'You rejected it in the page, so the change is waiting again.' })
  })
})

describe('a proposed draft on a scene Write the chapter is writing', () => {
  it('is turned down in plain words, and nothing starts', async () => {
    s.held = true
    expect(await startProposedDraft(draft('generate'))).toEqual({ ok: false, why: 'Write the chapter is writing this scene right now.' })
    expect(s.calls).toEqual([])
  })
})
