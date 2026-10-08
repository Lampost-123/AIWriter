// A proposed draft never writes over a scene's words: "generate" on a scene that has words goes below them, as
// "add below" does; into an empty scene it writes as usual. The writer's own flows are stood in for. Invented text only.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Proposal } from '@shared/contracts/ask'

const s = vi.hoisted(() => ({
  hasText: true,
  calls: [] as { replace?: boolean; options: Record<string, unknown> }[]
}))

vi.mock('@/lib/api', () => ({ api: { getScene: async () => ({ card: { beats: [] } }) } }))
vi.mock('@/lib/store', () => ({ useApp: { getState: () => ({ settings: { models: { writer: { modelId: 'w' } } }, draftOptions: {}, activeGeneration: null }) } }))
vi.mock('@/lib/editorBridge', () => ({ editorBridge: () => ({ sceneId: 'sc1', busy: () => false, hasText: () => s.hasText }) }))
vi.mock('./sceneInPage', () => ({ sceneInPage: async () => ({ state: { doc: null } }) }))
vi.mock('@/features/generate/draftOptions', () => ({ BLANK_DRAFT_OPTIONS: { direction: '' } }))
vi.mock('@/features/generate/draftRun', () => ({
  busyElsewhere: () => false,
  useDraft: { getState: () => ({ sceneId: null, phase: 'idle' }) },
  startDraft: async (_id: string, _bridge: unknown, opts: { replace?: boolean; options: () => Record<string, unknown> }) => {
    s.calls.push({ replace: opts.replace, options: opts.options() })
    return true
  }
}))
vi.mock('@/features/edits/session', () => ({ startTool: async () => true, waitingSuggestion: () => false }))
vi.mock('@/features/beats/flow', () => ({ beatBeingWritten: () => null }))
vi.mock('@/features/beats/redo', () => ({ redoBeat: async () => true, redoing: () => null }))
vi.mock('@/features/variants/store', () => ({ isWriting: () => false, setOf: () => null, useVariants: { getState: () => ({}) } }))

const { startProposedDraft } = await import('./applyDraft')

const draft = (mode: string): Parameters<typeof startProposedDraft>[0] =>
  ({ id: 'd', kind: 'draft', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', mode, direction: 'She climbs to the lamp room.', why: '', status: 'pending' }) as unknown as Extract<Proposal, { kind: 'draft' }>

beforeEach(() => {
  s.calls.length = 0
})

describe('a proposed draft on a scene that has words', () => {
  it('generate goes below the words, never in place of them', async () => {
    s.hasText = true
    expect(await startProposedDraft(draft('generate'))).toEqual({ ok: true })
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
