// "Update the plan" in the window (chat truth R10): each card lands on the scene main asked about at its place, a
// scene written in between is left alone, and the toast counts only real changes and the scenes that got no card.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import type { SceneCard } from '@shared/types'

const main = vi.hoisted(() => ({
  cards: {} as Record<string, SceneCard>,
  titles: {} as Record<string, string>,
  words: {} as Record<string, number>,
  sent: [] as string[],
  reply: '',
  toasts: [] as { message: string; undo?: () => void }[],
  renamed: [] as [string, string][]
}))

vi.mock('@/components/ui', () => ({
  toast: (message: string, o?: { action?: { run: () => void } }) => void main.toasts.push({ message, undo: o?.action?.run })
}))
vi.mock('@/lib/api', () => ({
  api: {
    planUpdateScenes: async (ids: string[]) =>
      ids.map((id) => ({ sceneId: id, label: `Sc ${id}`, title: main.titles[id], goal: main.cards[id].goal, when: main.cards[id].when, beats: main.cards[id].beats })),
    startPlanUpdate: async () => ({ generationId: 'g1', sceneIds: main.sent }),
    getScene: async (id: string) => ({ id, title: main.titles[id], wordCount: main.words[id] ?? 0, card: main.cards[id], text: '' })
  }
}))
vi.mock('@/lib/store', async () => {
  const { create } = await import('zustand')
  return { useApp: create(() => ({ world: { id: 'w' }, storyId: 'st', bumpOutline: () => undefined })) }
})
vi.mock('@/features/planning/talkStore', () => ({
  followTask: async (_taskId: string, start: () => Promise<void>) => {
    await start()
    return { text: main.reply, status: 'complete' }
  }
}))
vi.mock('@/features/outline/planInterviewStore', () => ({
  cardNow: async (id: string) => ({ ...main.cards[id] }),
  patchCard: async (id: string, p: Partial<SceneCard>) => void (main.cards[id] = { ...main.cards[id], ...p })
}))
vi.mock('@/features/binder/actions', () => ({ renameScene: async (id: string, title: string) => void main.renamed.push([id, title]) }))
// Fill in the empty cards: the outline helper's run stood in for (one session, keyed as helperKey keys it).
vi.mock('@/features/outline/helperStore', async () => {
  const { create } = await import('zustand')
  const useOutlineHelper = create<{ sessions: Record<string, { run: { taskId: string; fill?: string[] } | null }> }>(() => ({ sessions: {} }))
  return {
    useOutlineHelper,
    helperKey: (worldId: string | null | undefined, storyId: string) => `${worldId ?? ''}:${storyId}`,
    openHelper: () => undefined,
    suggestOutlineWith: async (storyId: string, _size: unknown, start: (taskId: string) => Promise<unknown>, extra: { fill?: string[] }) => {
      useOutlineHelper.setState({ sessions: { [`w:${storyId}`]: { run: { taskId: 't1', fill: extra.fill } } } })
      await start('t1')
    }
  }
})
vi.mock('@/features/storyBuilder/store', () => ({ flushBrief: async () => undefined }))

import { useOutlineHelper } from '@/features/outline/helperStore'
import { fillCardsIn, keepUpdate, startUpdate } from './hubStore'

const card = (goal: string): SceneCard => ({ ...emptySceneCard(), goal, beats: ['Old beat'] })
const drift = (ids: string[]): { sceneId: string; label: string; title: string; text: string }[] => ids.map((id) => ({ sceneId: id, label: `Sc ${id}`, title: '', text: '' }))
const reply = (...cards: [string, string][]): string => cards.map(([title, summary]) => `### Scene: ${title}\nSummary: ${summary}\n- New beat`).join('\n\n')

beforeEach(() => {
  main.cards = { s1: card('One'), s2: card('Two'), s3: card('Three') }
  main.titles = { s1: 'First', s2: 'Second', s3: 'Third' }
  main.words = {}
  main.toasts = []
  main.renamed = []
})

describe('Keep these changes (Update the plan)', () => {
  it('puts each card on the scene main sent, not on the window’s scene at the same place', async () => {
    // The window asked about s1, s2, s3; main sent only s1 and s3 (s2 was written before it started).
    main.sent = ['s1', 's3']
    main.reply = reply(['First', 'One, again'], ['Third', 'Three, again'])
    await startUpdate('st', drift(['s1', 's2', 's3']) as never)
    await keepUpdate('st')
    expect(main.cards.s1.goal).toBe('One, again')
    expect(main.cards.s2.goal).toBe('Two')
    expect(main.cards.s3.goal).toBe('Three, again')
    expect(main.toasts.map((t) => t.message)).toEqual(['Updated the plan: 2 scene cards now follow what you’ve written.'])
  })

  it('leaves a scene written in between alone and says so (edge case 9)', async () => {
    main.sent = ['s1', 's2']
    main.reply = reply(['First', 'One, again'], ['Second', 'Two, again'])
    await startUpdate('st', drift(['s1', 's2']) as never)
    main.words.s2 = 400
    await keepUpdate('st')
    expect(main.cards.s2.goal).toBe('Two')
    expect(main.toasts[0].message).toBe('Updated the plan: 1 scene card now follows what you’ve written. Sc s2 was written meanwhile, so its card was left as it was.')
  })

  it('counts only cards that changed, and says how many scenes got no card', async () => {
    main.sent = ['s1', 's2', 's3']
    main.cards.s1 = { ...card('One'), beats: ['New beat'] }
    // s1's card comes back as it was; s3 gets no card at all.
    main.reply = reply(['First', 'One'], ['Second', 'Two, again'])
    await startUpdate('st', drift(['s1', 's2', 's3']) as never)
    await keepUpdate('st')
    expect(main.toasts[0].message).toBe('Updated the plan: 1 scene card now follows what you’ve written. 2 of 3 scenes got new cards.')
    // Undo puts back only what changed.
    main.toasts[0].undo?.()
    await new Promise((r) => setTimeout(r, 0))
    expect(main.cards.s2.goal).toBe('Two')
  })
})

describe('Fill in the empty cards', () => {
  it('pairs each suggestion with the scenes main plans (empty ones only, in its order), not the ones the window asked about', async () => {
    // The window asked about s1, s2, s3; s2's card isn't empty any more, so main plans s3 and s1.
    main.sent = ['s3', 's1']
    await fillCardsIn('st', { id: 'c1', title: 'Low Water' }, ['s1', 's2', 's3'])
    expect(useOutlineHelper.getState().sessions['w:st']?.run?.fill).toEqual(['s3', 's1'])
  })
})
