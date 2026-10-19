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
  ids: 0,
  /** The stages asked for (the outline in stages). */
  stages: [] as Record<string, unknown>[],
  /** Keeps make pages for new names (and so start the story's build). */
  newPages: false,
  builds: 0
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    code?: string
  },
  api: {
    keepOutline: async (_storyId: string, items: KeepItem[]) => {
      main.kept.push(items)
      const made = items.map((i) => ({ key: i.key, kind: i.kind, id: `id-${i.key}-${++main.ids}`, ...(main.newPages ? { entryIds: ['e1'], entryNames: ['Mara'] } : {}) }))
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
    stopTask: async () => undefined,
    startOutlineStage: async (input: Record<string, unknown>) => {
      main.stages.push(input)
      return { generationId: `gs-${main.stages.length}` }
    }
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
vi.mock('@/features/worldBuilder/storyBuild', () => ({ buildStoryWorldSoon: () => void main.builds++ }))

import {
  applyRevision,
  earlierShown,
  helperKey,
  keepSuggestions,
  discardSuggestion,
  putAwayEarlier,
  planStage,
  saveEdit,
  settledRun,
  BUILD_NOTE,
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
  main.stages = []
  main.newPages = false
  main.builds = 0
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

describe('the outline in stages', () => {
  const ACTS = `# Act: The Arrival
Purpose: Mara reaches the city.
Chapters: 2

# Act: The Turning
Purpose: Her loyalties split.
Chapters: 3`
  const CHAPTERS = `## Chapter: Rain on the Narrows
Goal: Mara lands.

## Chapter: The Ferryman's Price
Goal: The debt comes due.`
  const stageEvent = (name: 'task:progress' | 'task:done', taskId: string, text: string): void =>
    main.listeners.get(name)!({ job: 'outline', taskId, text, generationId: 'gs-1', status: 'complete', cutOff: false })

  it('asks for one act’s chapters, shows them under it as they come, then keeps every other suggestion’s key', async () => {
    await suggest(ACTS)
    await keepSuggestions('s', ['a1'])
    await planStage('s', 'a0')
    expect(main.stages).toHaveLength(1)
    const asked = main.stages[0] as { level: string; chapters: number; target: string; plan: string; taskId: string; actId: unknown }
    expect(asked).toMatchObject({ storyId: 's', level: 'chapters', chapters: 2, actId: null })
    expect(asked.target).toContain('# Act: The Arrival')
    expect(asked.plan).toContain('# Act: The Arrival (plan this one)')
    expect(asked.plan).toContain('# Act: The Turning (in the story)')

    // While it arrives: under its act, the last one arriving; the act and Keep all wait for it, the other act doesn't.
    stageEvent('task:progress', asked.taskId, `${CHAPTERS.split('\n').slice(0, 3).join('\n')}\n## Chapter: The Ferry`)
    let tree = treeOf(session().run!)
    expect(tree[0].children.map((c) => [c.key, c.complete])).toEqual([
      ['a0c0', true],
      ['a0c1', false]
    ])
    expect(settledRun('s')).toBeNull()
    await keepSuggestions('s', ['a0'])
    await keepSuggestions('s', 'all')
    expect(main.kept).toHaveLength(1)

    // Done: in the suggestions' own text, so the kept act keeps its key and its decision.
    main.listeners.get('task:done')!({ job: 'outline', taskId: asked.taskId, text: CHAPTERS, generationId: 'gs-1', status: 'complete', cutOff: false })
    const run = session().run!
    expect(run.stage).toMatchObject({ status: 'complete', merged: true, count: 2 })
    tree = treeOf(run)
    expect(tree.map((n) => n.key)).toEqual(['a0', 'a1'])
    expect(tree[0].children.map((c) => c.title)).toEqual(['Rain on the Narrows', "The Ferryman's Price"])
    expect(run.decisions.a1).toMatchObject({ status: 'kept' })

    // A chapter kept, then planned: the stage is told it is in the story.
    await keepSuggestions('s', ['a0c0'])
    await planStage('s', 'a0c0')
    expect(main.stages[1]).toMatchObject({ level: 'scenes', chapterId: expect.stringMatching(/^id-a0c0-/) })
  })

  it('keeps a chapter where Adam chose, and says so; a keep that builds the cast says that too', async () => {
    await suggest(ACTS)
    await planStage('s', 'a0')
    const asked = main.stages[0] as { taskId: string }
    stageEvent('task:done', asked.taskId, CHAPTERS)
    main.newPages = true
    await keepSuggestions('s', ['a0c1'], null, { place: { at: 'after', id: 'ch-9', actId: 'act-2' }, placeWords: 'after “The Bell”' })
    expect(main.kept.at(-1)).toEqual([
      expect.objectContaining({ key: 'a0c1', kind: 'chapter', parent: { id: 'act-2' }, after: { id: 'ch-9' } })
    ])
    const said = main.toasts.at(-1)!.message
    expect(said).toBe(`Added “The Ferryman's Price” to the story, after “The Bell”. Made a page for Mara.${BUILD_NOTE}`)
    expect(main.builds).toBe(1)
  })

  it('says why when a stage brings nothing to keep, and suggesting again waits for a stage', async () => {
    await suggest(ACTS)
    await planStage('s', 'a1')
    const asked = main.stages[0] as { taskId: string }
    // Suggest again waits while the stage arrives.
    let again = false
    await suggestOutlineWith('s', SIZE, async () => {
      again = true
      return { generationId: 'x' }
    })
    expect(again).toBe(false)
    main.listeners.get('task:done')!({ job: 'outline', taskId: asked.taskId, text: 'Sorry, I can’t help with that.', generationId: 'gs-1', status: 'complete', cutOff: false })
    expect(session().run!.stage).toMatchObject({ status: 'complete', merged: false })
    expect(treeOf(session().run!)[1].children).toEqual([])
  })
})
