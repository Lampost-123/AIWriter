// Applying the editor chat's replace_all (chat Phase 4, EXTRATOOLS) and undoing it, through the app's own Find and
// replace: the main process's half (src/main/find/story.ts) runs for real on an in-memory world, the window's api stood
// in for. Every scene changes with a History snapshot first, the open scene through the editor; Undo puts each back
// (and the entry's old name), and leaves alone a scene changed since. Invented text only.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import type { Proposal } from '@shared/contracts/ask'
import type { PageForFind, StoryFindInput, StoryReplaceInput } from '@shared/contracts/find'
import type { Entry, EntryInput, ID, Outline, Scene } from '@shared/types'
import { docText } from '@shared/findReplace'
import { sceneExtensions } from '@/features/editor/extensions'

// The main process's code, loaded by path (the window's type-check never reads src/main): the world's database and
// the story-wide Find and replace itself.
type DB = { readonly open: boolean }
interface Repo {
  listStories(db: DB): { id: ID }[]
  getOutline(db: DB, storyId: ID): Outline
  createScene(db: DB, chapterId: ID, input: { title: string }): { id: ID }
  createChapter(db: DB, storyId: ID, input: { title: string }): { id: ID }
  createStory(db: DB, input: { title: string; startStoryId: null }): { id: ID }
  saveSceneText(db: DB, sceneId: ID, doc: unknown, text: string): unknown
  getScene(db: DB, sceneId: ID): Scene
  createEntry(db: DB, kind: 'character', input: { name: string }): Entry
  getEntry(db: DB, id: ID): Entry
  updateEntry(db: DB, id: ID, patch: EntryInput): Entry
}
interface Deps {
  snapshot(sceneId: ID, doc: unknown, text: string): void
  save(sceneId: ID, doc: unknown, text: string): void
  updateEntry(entryId: ID, patch: EntryInput): void
  drafting(sceneId: ID): boolean
}
interface FindStory {
  findInStory(db: DB, input: StoryFindInput): unknown
  replaceInStory(db: DB, input: StoryReplaceInput, deps: Deps): unknown
  undoReplaceInStory(db: DB, token: ID, page: PageForFind | null, deps: Deps): unknown
}
const MAIN = { helpers: '../../../../../tests/unit/helpers', repo: '../../../../main/db/repo', story: '../../../../main/find/story' }

const main = vi.hoisted(() => ({
  db: null as unknown as { readonly open: boolean },
  story: null as unknown as {
    findInStory(db: unknown, input: unknown): unknown
    replaceInStory(db: unknown, input: unknown, deps: unknown): unknown
    undoReplaceInStory(db: unknown, token: string, page: unknown, deps: unknown): unknown
  },
  deps: null as unknown,
  snapshots: [] as string[],
  statuses: [] as string[],
  toasts: [] as string[],
  app: {
    storyId: null as string | null,
    bumpOutline: () => undefined,
    bumpEntries: () => undefined,
    bumpBriefing: () => undefined
  }
}))

let repo: Repo
let memoryWorld: () => DB

beforeAll(async () => {
  memoryWorld = ((await import(/* @vite-ignore */ MAIN.helpers)) as { memoryWorld: () => DB }).memoryWorld
  repo = (await import(/* @vite-ignore */ MAIN.repo)) as Repo
  main.story = (await import(/* @vite-ignore */ MAIN.story)) as FindStory as typeof main.story
  main.deps = {
    snapshot: (sceneId) => main.snapshots.push(sceneId),
    save: (sceneId, doc, text) => repo.saveSceneText(main.db, sceneId, doc, text),
    updateEntry: (id, patch) => repo.updateEntry(main.db, id, patch),
    drafting: () => false
  } satisfies Deps
})

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  onEvent: () => () => undefined,
  api: {
    findInStory: async (input: unknown) => main.story.findInStory(main.db, input),
    replaceInStory: async (input: unknown) => main.story.replaceInStory(main.db, input, main.deps),
    undoReplaceInStory: async (token: string, page: unknown) => main.story.undoReplaceInStory(main.db, token, page, main.deps),
    setProposalStatus: async (_g: string, id: string, status: string) => {
      main.statuses.push(`${id}:${status}`)
    }
  }
}))
vi.mock('@/lib/flush', () => ({ flushAll: async () => undefined, registerDiscarder: () => () => undefined }))
vi.mock('@/lib/store', () => ({ useApp: { getState: () => main.app } }))
vi.mock('@/components/ui', () => ({ toast: (m: string) => main.toasts.push(m) }))
vi.mock('@/features/history/snapshot', () => ({ snapshotBefore: async () => null }))
vi.mock('@/features/history/open', () => ({ openHistory: async () => undefined }))

import { setEditorBridge, type EditorBridge } from '@/lib/editorBridge'
import { applyAndKeep, undoChanges } from './applyProposal'
import { REPLACE_GONE, REPLACE_OTHER_STORY } from './applyReplaceAll'

const schema = getSchema(sceneExtensions())
const page = (...texts: string[]): PMNode => schema.topNodeType.create(null, texts.map((t, i) => schema.nodes.paragraph.create({ pid: `p${i}` }, schema.text(t))))
const textsOf = (doc: PMNode): string[] => {
  const out: string[] = []
  doc.forEach((n) => out.push(n.textContent))
  return out
}

/** The page showing a scene, as the editor bridge gives it to Find and replace. */
function openPage(sceneId: string, doc: PMNode): { doc: () => PMNode } {
  let state = EditorState.create({ doc })
  const view = {
    get state() {
      return state
    },
    dispatch: (tr: Transaction) => {
      state = state.apply(tr)
    }
  }
  const editor = {
    get state() {
      return state
    },
    view,
    schema,
    isDestroyed: false
  }
  setEditorBridge({
    sceneId,
    editor,
    busy: () => false,
    flush: async () => undefined,
    current: () => ({ sceneId, doc: state.doc.toJSON(), text: docText(state.doc.toJSON()) })
  } as unknown as EditorBridge)
  return { doc: () => state.doc }
}

/** The Salt Road: Sc 1 (Brom twice) and Sc 2 (Brom once); the Far Shore has its own Brom; an entry called Brom. */
function world() {
  const db = memoryWorld()
  main.db = db
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const sc1 = o.scenes[0].id
  const sc2 = repo.createScene(db, o.chapters[0].id, { title: 'The Ford' }).id
  repo.saveSceneText(db, sc1, null, 'Brom carried the lantern.\n\nBram waited for Brom.')
  repo.saveSceneText(db, sc2, null, 'At the ford Brom said nothing.')
  const other = repo.createStory(db, { title: 'The Far Shore', startStoryId: null })
  const ch = repo.getOutline(db, other.id).chapters[0]?.id ?? repo.createChapter(db, other.id, { title: 'Shore' }).id
  const far = repo.getOutline(db, other.id).scenes[0]?.id ?? repo.createScene(db, ch, { title: 'Far' }).id
  repo.saveSceneText(db, far, null, 'Brom of the far shore.')
  const brom = repo.createEntry(db, 'character', { name: 'Brom' })
  main.app.storyId = story.id
  return { db, story: story.id, sc1, sc2, far, brom }
}

const replaceAll = (w: ReturnType<typeof world>, o: Record<string, unknown> = {}): Proposal =>
  ({
    id: '1',
    status: 'pending',
    why: 'The name is Bram.',
    kind: 'replaceAll',
    storyId: w.story,
    find: 'Brom',
    replace: 'Bram',
    wholeWord: true,
    matchCase: true,
    sceneId: null,
    sceneLabel: '',
    count: 3,
    scenes: 2,
    examples: [],
    rename: { entryId: w.brom.id, kind: 'character', name: 'Brom' },
    ...o
  }) as Proposal

const text = (id: string): string => repo.getScene(main.db, id).text

beforeEach(() => {
  main.snapshots.length = 0
  main.statuses.length = 0
  main.toasts.length = 0
  setEditorBridge(null)
})

describe('replace all', () => {
  it('with no scene open: every stored scene of this story changes (a snapshot each), never another story; Undo puts them back', async () => {
    const w = world()
    const { undos, failed } = await applyAndKeep('g1', [replaceAll(w)], { storyId: w.story })
    expect(failed).toEqual([])
    expect(text(w.sc1)).toBe('Bram carried the lantern.\n\nBram waited for Bram.')
    expect(text(w.sc2)).toBe('At the ford Bram said nothing.')
    expect(text(w.far)).toBe('Brom of the far shore.')
    expect(main.snapshots).toEqual([w.sc1, w.sc2])
    expect(main.statuses).toEqual(['1:applied'])
    // Not renamed unless the writer ticked it.
    expect(repo.getEntry(w.db, w.brom.id).name).toBe('Brom')
    const [r] = await undoChanges(undos)
    expect(r).toEqual({ ok: true })
    expect(text(w.sc1)).toBe('Brom carried the lantern.\n\nBram waited for Brom.')
    expect(text(w.sc2)).toBe('At the ford Brom said nothing.')
    expect(main.statuses).toEqual(['1:applied', '1:pending'])
  })

  it('the open scene changes through the editor (one step) and the entry is renamed when picked; Undo puts both back', async () => {
    const w = world()
    const p = openPage(w.sc1, page('Brom carried the lantern.', 'Bram waited for Brom.'))
    const { undos } = await applyAndKeep('g1', [replaceAll(w, { renameEntry: true })], { storyId: w.story })
    expect(textsOf(p.doc())).toEqual(['Bram carried the lantern.', 'Bram waited for Bram.'])
    expect(text(w.sc2)).toBe('At the ford Bram said nothing.')
    expect(repo.getEntry(w.db, w.brom.id)).toMatchObject({ name: 'Bram', aliases: ['Brom'] })
    await undoChanges(undos)
    expect(textsOf(p.doc())).toEqual(['Brom carried the lantern.', 'Bram waited for Brom.'])
    expect(text(w.sc2)).toBe('At the ford Brom said nothing.')
    expect(repo.getEntry(w.db, w.brom.id).name).toBe('Brom')
  })

  it('in one scene only with sceneId; Undo leaves a scene changed since as it is, and says so', async () => {
    const w = world()
    const { undos } = await applyAndKeep('g1', [replaceAll(w, { sceneId: w.sc2, sceneLabel: 'Ch 1, Sc 2' })], { storyId: w.story })
    expect(text(w.sc1)).toBe('Brom carried the lantern.\n\nBram waited for Brom.')
    expect(text(w.sc2)).toBe('At the ford Bram said nothing.')
    repo.saveSceneText(w.db, w.sc2, null, 'At the ford Bram said nothing at all.')
    const [r] = await undoChanges(undos)
    expect(r.ok).toBe(false)
    expect(text(w.sc2)).toBe('At the ford Bram said nothing at all.')
    expect(main.statuses).toEqual(['1:applied'])
  })

  it('refuses another story’s change, and words no longer there', async () => {
    const w = world()
    expect((await applyAndKeep('g1', [replaceAll(w)], { storyId: 'another-story' })).failed).toEqual([REPLACE_OTHER_STORY])
    expect((await applyAndKeep('g1', [replaceAll(w, { find: 'Gorse' })], { storyId: w.story })).failed).toEqual([REPLACE_GONE])
    expect(text(w.sc1)).toBe('Brom carried the lantern.\n\nBram waited for Brom.')
  })
})
