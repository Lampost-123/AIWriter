// The outline helper's store, with the main process stood in for (2026-10-19): Suggest again keeps the suggestions Adam
// hadn't decided on under "Earlier suggestions", where Keep, Edit, Discard and Undo work on them as on the newest; "Put
// these away" discards what is left in a batch, with Undo; a request that can't start leaves everything where it was;
// and applying a talk's revision keeps what was kept and Adam's own changes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeepItem, KeptItem } from '@shared/contracts/outline'

const main = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown) => void>(),
  kept: [] as KeepItem[][],
  unkept: [] as KeptItem[][],
  /** What the story has: everything kept and not taken back. */
  present: new Set<string>(),
  toasts: [] as { id: number; message: string; undo?: () => void }[],
  failStart: false,
  ids: 0
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    code?: string
  },
  api: {
    keepOutline: async (_storyId: string, items: KeepItem[]) => {
      main.kept.push(items)
      const made = items.map((i) => ({ key: i.key, kind: i.kind, id: `id-${i.key}-${++main.ids}` }))
      for (const m of made) main.present.add(m.id)
      return made
    },
    unkeepOutline: async (kept: KeptItem[]) => {
      main.unkept.push(kept)
      for (const k of kept) main.present.delete(k.id)
      return { sceneIds: [] }
    },
    getOutline: async () => ({ acts: [], chapters: [...main.present].map((id) => ({ id })), scenes: [] }),
    outlineBlank: async () => true,
    stopTask: async () => undefined
  },
  onEvent: (name: string, fn: (payload: unknown) => void) => {
    main.listeners.set(name, fn)
    return () => undefined
  }
}))
vi.mock('@/components/ui', () => ({
  toast: (message: string, o?: { action?: { run: () => void } }) => {
    const id = main.toasts.length + 1
    main.toasts.push({ id, message, undo: o?.action?.run })
    return id
  },
  useToasts: { getState: () => ({ items: main.toasts, dismiss: () => undefined, update: () => undefined }) }
}))
vi.mock('@/lib/store', async () => {
  const { create } = await import('zustand')
  const useApp = create(() => ({
    world: { id: 'w' },
    outlineRev: 0,
    view: { kind: 'outline', storyId: 's' },
    sceneId: null,
    bumpOutline: () => undefined,
    selectScene: () => undefined,
    navigate: () => undefined
  }))
  return { useApp }
})
vi.mock('@/lib/editorBridge', () => ({ editorBridge: () => null }))
vi.mock('@/features/binder/outlineModel', () => ({ neighbourAfterRemoval: () => null, readingOrder: () => [] }))
vi.mock('@/features/binder/outlineStore', () => ({ useOutlineStore: { getState: () => ({ outline: null }) } }))
vi.mock('@/features/chapterCard/chapterCardEvents', () => ({ notifyChapterCard: () => undefined }))
vi.mock('@/features/worldBuilder/storyBuild', () => ({ buildStoryWorldSoon: () => undefined }))

import {
  applyRevision,
  earlierShown,
  helperKey,
  keepSuggestions,
  discardSuggestion,
  putAwayEarlier,
  saveEdit,
  settledRun,
  suggestOutlineWith,
  treeOf,
  useOutlineHelper
} from './helperStore'

const SIZE = { acts: 0, chapters: 2, scenes: 2 }
const FIRST = `## Chapter: Rain on the Narrows
Goal: Mara lands.

### Scene: Arrival at the docks
Summary: Mara lands.
- She lands

### Scene: A bargain at the docks
Summary: Tobin offers a deal.
- He names his price

## Chapter: The Ferryman's Price
Goal: The debt comes due.

### Scene: The crossing
Summary: They cross at night.
- The fog comes down`
const SECOND = `## Chapter: Lanterns at Low Tide
Goal: Mara follows the trail.

### Scene: Pursuit through the market
Summary: The guild gives chase.
- A shout behind her`

const session = () => useOutlineHelper.getState().sessions[helperKey('w', 's')]
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Asks for suggestions and plays the reply, whole. */
async function suggest(text: string): Promise<string> {
  let id = ''
  await suggestOutlineWith('s', SIZE, async (taskId) => {
    if (main.failStart) throw new Error('The service is busy. Please try again.')
    id = taskId
    return { generationId: `g-${taskId}` }
  })
  if (id) main.listeners.get('task:done')!({ job: 'outline', taskId: id, text, generationId: `g-${id}`, status: 'complete', cutOff: false })
  return id
}

beforeEach(() => {
  useOutlineHelper.setState({ sessions: {} })
  main.kept = []
  main.unkept = []
  main.present.clear()
  main.toasts = []
  main.failStart = false
})

describe('Suggest again', () => {
  it('keeps what Adam hadn’t decided on under Earlier suggestions, to keep from later', async () => {
    const first = await suggest(FIRST)
    await keepSuggestions('s', ['c0s0'])
    discardSuggestion('s', 'c1')
    saveEdit('s', 'c0s1', { title: 'A deal at the docks', text: 'Tobin offers a deal.', beats: ['He names his price'] })
    const second = await suggest(SECOND)
    expect(session().run?.taskId).toBe(second)
    expect(earlierShown(session()).map((r) => r.taskId)).toEqual([first])
    expect(main.toasts.some((t) => t.message.includes('Earlier suggestions'))).toBe(true)

    // Kept from the earlier batch: from it, beside what it kept before, with Adam's words.
    await keepSuggestions('s', ['c0s1'], null, { runId: first })
    expect(main.kept.at(-1)).toMatchObject([{ key: 'c0s1', title: 'A deal at the docks', parent: { id: expect.stringMatching(/^id-c0-/) } }])
    expect(session().earlier[0].decisions.c0s1).toMatchObject({ status: 'kept' })
    expect(session().run?.decisions.c0s1).toBeUndefined()
    // Nothing left to decide in it: it leaves the page.
    expect(earlierShown(session())).toEqual([])

    // Its Keep's Undo (one toast for both keeps, while it shows) still finds them there, back to decide on.
    const added = main.toasts.filter((t) => t.message.startsWith('Added'))
    expect(added).toHaveLength(1)
    added[0].undo!()
    await settle()
    expect(main.unkept.at(-1)!.map((k) => k.key).sort()).toEqual(['c0', 'c0s0', 'c0s1'])
    expect(earlierShown(session()).map((r) => r.taskId)).toEqual([first])
    expect(session().earlier[0].decisions).toEqual({ c1: { status: 'discarded' }, c1s0: { status: 'discarded' } })
  })

  it('moves nothing when there was nothing left to decide, and puts a batch away with Undo', async () => {
    const first = await suggest(FIRST)
    await keepSuggestions('s', 'all')
    await suggest(SECOND)
    expect(earlierShown(session())).toEqual([])
    expect(main.toasts.some((t) => t.message.includes('Earlier suggestions'))).toBe(false)

    // Newest first: each batch still to decide on.
    const second = session().run!.taskId
    const third = await suggest(FIRST)
    await suggest(SECOND)
    expect(earlierShown(session()).map((r) => r.taskId)).toEqual([third, second])
    putAwayEarlier('s', third)
    expect(earlierShown(session()).map((r) => r.taskId)).toEqual([second])
    expect(main.toasts.at(-1)!.message).toBe('Put away 2 chapters and 3 scenes from earlier.')
    main.toasts.at(-1)!.undo!()
    expect(earlierShown(session()).map((r) => r.taskId)).toEqual([third, second])
    expect(first).not.toBe(third)
  })

  it('leaves everything where it was when the request can’t start', async () => {
    const first = await suggest(FIRST)
    main.failStart = true
    await suggest(SECOND)
    expect(session().run?.taskId).toBe(first)
    expect(session().earlier).toEqual([])
    expect(session().problem?.message).toBe('The service is busy. Please try again.')
  })
})

describe('applying a talk’s revision', () => {
  it('keeps what was kept, and Adam’s own changes where the talk didn’t change them', async () => {
    await suggest(FIRST)
    await keepSuggestions('s', ['c0s0'])
    saveEdit('s', 'c1s0', { title: 'The crossing', text: 'They cross in the fog.', beats: ['The fog comes down'] })
    const before = settledRun('s')!
    // A whole plan sent again with no tags: Arrival at the docks (kept) left out, a new scene, the crossing as sent.
    const revised = `## Chapter: Rain on the Narrows
Goal: Mara lands.

### Scene: A bargain at the docks
Summary: Tobin offers a deal she can't refuse.
- He names his price

### Scene: A watcher on the quay
Summary: Someone follows her.
- A shadow

## Chapter: The Ferryman's Price
Goal: The debt comes due.

### Scene: The crossing
Summary: They cross in the fog.
- The fog comes down`
    expect(applyRevision('s', { text: revised })).toBe(true)
    const run = session().run!
    expect(run.taskId).not.toBe(before.taskId)
    const lines = treeOf(run).flatMap((c) => [c, ...c.children]).map((n) => `${n.title}${run.decisions[n.key] ? ` (${run.decisions[n.key].status})` : ''}${run.edits[n.key] ? ' (edited)' : ''}`)
    expect(lines).toEqual([
      'Rain on the Narrows (kept)',
      'Arrival at the docks (kept)',
      'A bargain at the docks',
      'A watcher on the quay',
      "The Ferryman's Price",
      'The crossing (edited)'
    ])
    // Keep all that's left adds only what is new: never the kept scene a second time.
    await keepSuggestions('s', 'all')
    expect(main.kept.at(-1)!.map((i) => i.title)).toEqual(['A bargain at the docks', 'A watcher on the quay', "The Ferryman's Price", 'The crossing'])
    expect(main.kept.at(-1)![0]).toMatchObject({ parent: { id: expect.stringMatching(/^id-c0-/) } })
  })
})
