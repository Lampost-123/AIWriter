// Applying the editor chat's story changes (chat Phase 3, STORYTOOLS) and undoing them, with the page and the main
// process stood in for: an issue fix puts the check's rewrite in for the issue's words and marks it fixed (Undo puts
// the words back and reopens it), or sets the memory as Update the memory does; a chapter card change is written and
// restored with the card's own calls; a plot thread goes on a scene card's list as Adam's own link (a new thread made
// first) and Undo takes it off. Invented text only.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import type { Proposal } from '@shared/contracts/ask'
import type { ChapterCard, SceneCard } from '@shared/types'
import { chapterPartsOf, emptyChapterCard } from '@shared/chapterCard'
import { sceneExtensions } from '@/features/editor/extensions'

const main = vi.hoisted(() => ({
  calls: [] as string[],
  statuses: [] as string[],
  issue: { id: 'i1', sceneId: 'sc1', status: 'open', quote: 'carried the lantern', fix: 'carried a torch' } as Record<string, unknown>,
  entry: { id: 'e1', name: 'Ilse', summary: 'Keeps the tally.', description: '', fields: {} as Record<string, string> },
  chapterCard: null as unknown as ChapterCard,
  goal: 'Get to the ford.',
  /** The story's scenes as its outline lists them. */
  scenes: [] as { id: string; chapterId: string }[],
  outlineBumps: 0,
  cards: new Map<string, SceneCard>(),
  shown: [] as unknown[],
  /** The scene parts the last restoreChapterCard was given. */
  restored: [] as unknown[],
  /** The chapter's goal write fails this many times. */
  goalFails: 0,
  app: {
    view: { kind: 'write' },
    sceneId: 'sc1' as string | null,
    storyId: 's1' as string | null,
    selectScene: (_id: string) => undefined,
    bumpOutline: () => {
      main.outlineBumps++
    },
    bumpEntries: () => undefined,
    bumpBriefing: () => undefined,
    bumpMemory: () => undefined
  }
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  onEvent: () => () => undefined,
  api: {
    getScene: async (id: string) => {
      if (!main.cards.has(id)) throw new Error('That scene no longer exists.')
      return { id, chapterId: 'ch1', card: main.cards.get(id), doc: null, text: '' }
    },
    takeSnapshot: async () => null,
    setProposalStatus: async (_g: string, id: string, status: string) => {
      main.statuses.push(`${id}:${status}`)
    },
    listIssues: async () => [main.issue],
    markIssueFixed: async (id: string) => {
      main.calls.push(`fixed ${id}`)
      main.issue.status = 'fixed'
    },
    reopenIssue: async (id: string) => {
      main.calls.push(`reopen ${id}`)
      main.issue.status = 'open'
    },
    getEntry: async () => ({ ...main.entry }),
    updateMemoryFromIssue: async (id: string) => {
      main.calls.push(`memory ${id}`)
      main.entry.summary = 'Keeps no tally.'
    },
    updateEntry: async (_id: string, patch: { summary?: string }) => {
      main.calls.push(`entry ${JSON.stringify(patch)}`)
      if (patch.summary !== undefined) main.entry.summary = patch.summary
    },
    getChapterCard: async () => ({ ...main.chapterCard }),
    getOutline: async () => ({ chapters: [{ id: 'ch1', title: 'Low Water', goal: main.goal }], scenes: main.scenes }),
    updateChapter: async (id: string, patch: { goal?: string }) => {
      if (main.goalFails > 0) {
        main.goalFails--
        throw new Error('The chapter couldn’t be saved.')
      }
      main.calls.push(`goal ${id} ${patch.goal}`)
      if (patch.goal !== undefined) main.goal = patch.goal
      return { id, title: 'Low Water', goal: main.goal }
    },
    updateChapterCard: async (id: string, card: ChapterCard) => {
      main.calls.push(`chapter ${id} ${card.mood}`)
      main.chapterCard = card
      return { card, updated: [{ sceneId: 'sc1', before: { parts: emptyChapterCard(), inherits: null } }] }
    },
    restoreChapterCard: async (id: string, card: ChapterCard, scenes: unknown[]) => {
      main.calls.push(`restore ${id} ${card.mood} ${scenes.length}`)
      main.restored = scenes
      main.chapterCard = card
      return scenes.length
    },
    updateSceneCard: async (id: string, card: SceneCard) => {
      main.cards.set(id, card)
      return card
    },
    createEntry: async (kind: string, input: { name: string; fields?: Record<string, string> }) => {
      main.calls.push(`create ${kind} ${input.name} ${input.fields?.promise ?? ''}`)
      return { id: 't-new' }
    },
    deleteEntry: async (id: string) => {
      main.calls.push(`delete ${id}`)
    }
  }
}))
vi.mock('@/lib/flush', () => ({ flushAll: async () => undefined, registerDiscarder: () => () => undefined }))
vi.mock('@/lib/store', () => ({ useApp: { getState: () => main.app } }))
vi.mock('@/components/ui', () => ({ toast: () => 1 }))
vi.mock('@/features/history/snapshot', () => ({ snapshotBefore: async () => null }))
vi.mock('@/features/history/open', () => ({ openHistory: async () => undefined }))
vi.mock('@/features/chapterCard/chapterCardEvents', () => ({
  chapterCardShown: (_id: string, card: ChapterCard) => main.shown.push(card.mood),
  notifyChapterCard: () => undefined
}))

import { setEditorBridge, type EditorBridge } from '@/lib/editorBridge'
import { applyAndKeep, undoChanges } from './applyProposal'

const schema = getSchema(sceneExtensions())
const page = (...texts: string[]): PMNode => schema.topNodeType.create(null, texts.map((t, i) => schema.nodes.paragraph.create({ pid: `p${i}` }, schema.text(t))))
const textsOf = (doc: PMNode): string[] => {
  const out: string[] = []
  doc.forEach((n) => out.push(n.textContent))
  return out
}

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
  const editor = { get state() { return state }, view, schema, isDestroyed: false }
  setEditorBridge({
    sceneId,
    editor,
    busy: () => false,
    current: () => ({ sceneId, doc: state.doc.toJSON(), text: '' }),
    flush: async () => {
      main.calls.push(`saved ${sceneId}`)
    }
  } as unknown as EditorBridge)
  main.app.sceneId = sceneId
  return { doc: () => state.doc }
}

const proposal = (p: Record<string, unknown>): Proposal => ({ id: '1', status: 'pending', why: 'x', ...p }) as unknown as Proposal
const card = (o: Partial<SceneCard> = {}): SceneCard =>
  ({ povId: null, presentIds: [], locationId: null, when: '', beats: [], goal: '', conflict: '', outcome: '', mood: '', targetWords: 1500, notes: '', whenSort: null, setsUpIds: [], paysOffIds: [], ...o }) as SceneCard

beforeEach(() => {
  main.calls.length = 0
  main.statuses.length = 0
  main.shown.length = 0
  main.issue = { id: 'i1', sceneId: 'sc1', status: 'open', quote: 'carried the lantern', fix: 'carried a torch' }
  main.entry.summary = 'Keeps the tally.'
  main.chapterCard = { ...emptyChapterCard(), mood: 'Grey' }
  main.goal = 'Get to the ford.'
  main.scenes = []
  main.outlineBumps = 0
  main.restored = []
  main.goalFails = 0
  main.cards.clear()
  setEditorBridge(null)
})

describe('an issue fix', () => {
  const text = proposal({ kind: 'issueFix', issueId: 'i1', how: 'text', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', message: 'm', severity: 'warning', quote: 'carried the lantern', fix: 'carried a torch' })

  it('puts the check’s rewrite in for the issue’s words and marks it fixed; Undo puts them back and reopens it', async () => {
    const p = openPage('sc1', page('Ilse carried the lantern up the hill.', 'Bram waited.'))
    const { undos } = await applyAndKeep('g1', [text], {})
    expect(textsOf(p.doc())).toEqual(['Ilse carried a torch up the hill.', 'Bram waited.'])
    // Saved before it is marked fixed, so the scene's other issues on those words go with it (findings that stay current).
    expect(main.calls).toEqual(['saved sc1', 'fixed i1'])
    expect(main.statuses).toEqual(['1:applied'])
    const [r] = await undoChanges(undos)
    expect(r).toEqual({ ok: true })
    expect(textsOf(p.doc())).toEqual(['Ilse carried the lantern up the hill.', 'Bram waited.'])
    expect(main.calls).toEqual(['saved sc1', 'fixed i1', 'reopen i1'])
    expect(main.statuses).toEqual(['1:applied', '1:pending'])
  })

  it('isn’t applied once the issue is fixed or its words have gone', async () => {
    openPage('sc1', page('Ilse carried the lantern up the hill.'))
    main.issue.status = 'fixed'
    const r = await applyAndKeep('g1', [text], {})
    expect(r.failed).toEqual(['That issue is fixed already.'])
    main.issue.status = 'open'
    openPage('sc1', page('Ilse went up the hill.'))
    expect((await applyAndKeep('g1', [text], {})).failed).toEqual(['Those words aren’t in the scene any more.'])
  })

  it('sets the memory as Update the memory does; Undo puts the old value back and reopens the issue', async () => {
    const m = proposal({
      kind: 'issueFix',
      issueId: 'i1',
      how: 'memory',
      sceneId: 'sc1',
      sceneLabel: 'Ch 1, Sc 1',
      message: 'm',
      severity: 'warning',
      quote: 'q',
      fix: null,
      memory: { entryId: 'e1', name: 'Ilse', field: 'summary', fieldLabel: 'summary', from: 'Keeps the tally.', to: 'Keeps no tally.' }
    })
    const { undos } = await applyAndKeep('g1', [m], {})
    expect(main.entry.summary).toBe('Keeps no tally.')
    await undoChanges(undos)
    expect(main.entry.summary).toBe('Keeps the tally.')
    expect(main.calls).toEqual(['memory i1', 'entry {"summary":"Keeps the tally."}', 'reopen i1'])
  })
})

describe('a chapter card change', () => {
  it('is written with the card’s own call over the card as it is now, and Undo restores it and its scenes', async () => {
    const c = proposal({ kind: 'chapterCard', chapterId: 'ch1', chapterLabel: 'Ch 1', patch: { mood: 'Tense' }, lines: [], scenes: 1 })
    const { undos } = await applyAndKeep('g1', [c], {})
    expect(main.chapterCard.mood).toBe('Tense')
    await undoChanges(undos)
    expect(main.calls).toEqual(['chapter ch1 Tense', 'restore ch1 Grey 1'])
    expect(main.shown).toEqual(['Tense', 'Grey'])
  })

  const plan = (o: Record<string, unknown> = {}) =>
    proposal({
      kind: 'chapterCard',
      chapterId: 'ch1',
      chapterLabel: 'Ch 1',
      patch: { totalWords: 4000 },
      goal: 'Reach the ford before the tide.',
      before: { totalWords: null, goal: 'Get to the ford.' },
      lines: [],
      scenes: 0,
      ...o
    })

  it('sets the chapter’s goal and its length; the Plan hub re-reads both; Undo puts both back (R5)', async () => {
    const { done, undos } = await applyAndKeep('g1', [plan()], { storyId: 's1' })
    expect(done).toBe(1)
    expect(main.goal).toBe('Reach the ford before the tide.')
    expect(main.chapterCard.totalWords).toBe(4000)
    expect(main.chapterCard.mood).toBe('Grey')
    // The goal's page reads the outline; the length's re-reads the card (notifyChapterCard).
    expect(main.outlineBumps).toBe(1)
    await undoChanges(undos)
    expect(main.goal).toBe('Get to the ford.')
    expect(main.chapterCard.totalWords).toBeUndefined()
    expect(main.outlineBumps).toBe(2)
    // The chapter's length isn't a scene card part: no scene has anything of the chat's to put back.
    expect(main.calls).toEqual(['chapter ch1 Grey', 'goal ch1 Reach the ford before the tide.', 'restore ch1 Grey 0', 'goal ch1 Get to the ford.'])
  })

  it('a goal alone leaves the card alone', async () => {
    const { undos } = await applyAndKeep('g1', [plan({ patch: {}, before: { goal: 'Get to the ford.' } })], { storyId: 's1' })
    expect(main.calls).toEqual(['goal ch1 Reach the ford before the tide.'])
    await undoChanges(undos)
    expect(main.calls).toEqual(['goal ch1 Reach the ford before the tide.', 'goal ch1 Get to the ford.'])
  })

  it('a goal or length changed since: turned down with what it says now, then applied on a second Apply', async () => {
    main.goal = 'Find the ferryman.'
    main.chapterCard = { ...main.chapterCard, totalWords: 3000 }
    const first = await applyAndKeep('g1', [plan()], { storyId: 's1' })
    expect(first.failedOf['1']).toBe(
      'This chapter has changed since. Here’s what it says now: Length of the chapter: 3,000 words; What the chapter achieves: “Find the ferryman.” Apply again to use the chat’s change.'
    )
    expect(main.calls).toEqual([])
    expect((await applyAndKeep('g1', [plan()], { storyId: 's1' })).done).toBe(1)
    expect(main.goal).toBe('Reach the ford before the tide.')
    expect(main.chapterCard.totalWords).toBe(4000)
  })
})

describe('Undo on a card puts back only what the chat changed (Adam’s changes since stay)', () => {
  const scenePatch = proposal({ kind: 'card', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', patch: { mood: 'Tense' } })

  it('a scene card: notes Adam typed after Apply stay', async () => {
    main.cards.set('sc1', card({ mood: 'Calm' }))
    const { undos } = await applyAndKeep('g1', [scenePatch], {})
    expect(main.cards.get('sc1')?.mood).toBe('Tense')
    main.cards.set('sc1', { ...(main.cards.get('sc1') as SceneCard), notes: 'Keep her quiet.' })
    expect(await undoChanges(undos)).toEqual([{ ok: true }])
    expect(main.cards.get('sc1')).toMatchObject({ mood: 'Calm', notes: 'Keep her quiet.' })
  })

  it('a scene card: a part Adam changed again since is left as it is, and Undo says so', async () => {
    main.cards.set('sc1', card({ mood: 'Calm' }))
    const { undos } = await applyAndKeep('g1', [scenePatch], {})
    main.cards.set('sc1', { ...(main.cards.get('sc1') as SceneCard), mood: 'Wild' })
    expect(await undoChanges(undos)).toEqual([{ ok: false, why: 'Mood or tone was changed since, so Undo left it as it is.' }])
    expect(main.cards.get('sc1')?.mood).toBe('Wild')
  })

  it('a scene card: the part goes back to following its chapter, as it did before Apply', async () => {
    main.cards.set('sc1', card({ mood: 'Grey', inherits: { mood: true } }))
    const { undos } = await applyAndKeep('g1', [scenePatch], {})
    // The main process makes a changed part the scene's own.
    main.cards.set('sc1', { ...(main.cards.get('sc1') as SceneCard), inherits: { mood: false } })
    expect(await undoChanges(undos)).toEqual([{ ok: true }])
    expect(main.cards.get('sc1')).toMatchObject({ mood: 'Grey', inherits: { mood: true } })
  })

  it('a scene card: a part that follows its chapter again takes what the chapter says now', async () => {
    main.cards.set('sc1', card({ mood: 'Grey', inherits: { mood: true } }))
    const { undos } = await applyAndKeep('g1', [scenePatch], {})
    main.cards.set('sc1', { ...(main.cards.get('sc1') as SceneCard), inherits: { mood: false } })
    // Adam changed the chapter's mood after Apply.
    main.chapterCard = { ...main.chapterCard, mood: 'Stormy' }
    expect(await undoChanges(undos)).toEqual([{ ok: true }])
    expect(main.cards.get('sc1')).toMatchObject({ mood: 'Stormy', inherits: { mood: true } })
  })

  it('a scene card deleted since: Undo says so plainly', async () => {
    main.cards.set('sc1', card({ mood: 'Calm' }))
    const { undos } = await applyAndKeep('g1', [scenePatch], {})
    main.cards.delete('sc1')
    expect(await undoChanges(undos)).toEqual([
      { ok: false, why: 'That scene was deleted, so there’s nothing to undo. Settings › Recently deleted can bring it back.' }
    ])
  })

  const chapterPatch = proposal({ kind: 'chapterCard', chapterId: 'ch1', chapterLabel: 'Ch 1', patch: { mood: 'Tense' }, lines: [], scenes: 1 })

  it('a chapter card: a length set in the Plan hub after Apply stays, and its scenes keep what Adam changed', async () => {
    const { undos } = await applyAndKeep('g1', [chapterPatch], {})
    main.chapterCard = { ...main.chapterCard, totalWords: 5000 }
    // The scene took the chat's mood (it follows the chapter); its notes are Adam's own since.
    main.cards.set('sc1', card({ mood: 'Tense', notes: 'Keep her quiet.', inherits: { mood: true, notes: false } }))
    expect(await undoChanges(undos)).toEqual([{ ok: true }])
    expect(main.chapterCard).toMatchObject({ mood: 'Grey', totalWords: 5000 })
    expect(main.restored).toEqual([{ sceneId: 'sc1', before: { parts: chapterPartsOf(card({ notes: 'Keep her quiet.' })), inherits: { notes: false } } }])
  })

  it('a chapter card: a scene made after Apply that follows the chapter goes back with the rest', async () => {
    const { undos } = await applyAndKeep('g1', [chapterPatch], { storyId: 's1' })
    // A new scene in the chapter took the chat's mood; another follows it but has its own mood; a third is in another chapter.
    main.scenes = [
      { id: 'sc1', chapterId: 'ch1' },
      { id: 'sc2', chapterId: 'ch1' },
      { id: 'sc3', chapterId: 'ch1' },
      { id: 'sc4', chapterId: 'ch2' }
    ]
    main.cards.set('sc1', card({ mood: 'Tense', inherits: { mood: true } }))
    main.cards.set('sc2', card({ mood: 'Tense', notes: 'New.', inherits: { mood: true } }))
    main.cards.set('sc3', card({ mood: 'Tense', inherits: { mood: false } }))
    main.cards.set('sc4', card({ mood: 'Tense', inherits: { mood: true } }))
    expect(await undoChanges(undos)).toEqual([{ ok: true }])
    expect(main.restored).toEqual([
      { sceneId: 'sc1', before: { parts: chapterPartsOf(card()), inherits: null } },
      { sceneId: 'sc2', before: { parts: chapterPartsOf(card({ mood: 'Grey', notes: 'New.' })), inherits: { mood: true } } }
    ])
  })

  it('a chapter card: a part Adam changed again since is left as it is, and Undo says so', async () => {
    const { undos } = await applyAndKeep('g1', [chapterPatch], {})
    main.chapterCard = { ...main.chapterCard, mood: 'Wild' }
    expect(await undoChanges(undos)).toEqual([{ ok: false, why: 'Mood or tone was changed since, so Undo left it as it is.' }])
    expect(main.chapterCard.mood).toBe('Wild')
    expect(main.calls).toEqual(['chapter ch1 Tense'])
  })

  const plan = proposal({
    kind: 'chapterCard',
    chapterId: 'ch1',
    chapterLabel: 'Ch 1',
    patch: { totalWords: 4000 },
    goal: 'Reach the ford before the tide.',
    before: { totalWords: null, goal: 'Get to the ford.' },
    lines: [],
    scenes: 0
  })

  it('a chapter’s goal Adam typed after Apply is left as it is; the length still goes back', async () => {
    const { undos } = await applyAndKeep('g1', [plan], { storyId: 's1' })
    main.goal = 'Find the ferryman.'
    expect(await undoChanges(undos)).toEqual([{ ok: false, why: 'What the chapter achieves was changed since, so Undo left it as it is and put the rest back.' }])
    expect(main.goal).toBe('Find the ferryman.')
    expect(main.chapterCard.totalWords).toBeUndefined()
  })

  it('a goal that can’t be written puts the length back too: nothing is left half done', async () => {
    main.goalFails = 1
    const r = await applyAndKeep('g1', [plan], { storyId: 's1' })
    expect(r.done).toBe(0)
    expect(r.failedOf['1']).toBe('The chapter couldn’t be saved.')
    expect(main.chapterCard.totalWords).toBeUndefined()
    expect(main.goal).toBe('Get to the ford.')
    expect(main.calls).toEqual(['chapter ch1 Grey', 'restore ch1 Grey 1'])
    // Nothing changed, so Apply again goes ahead (it isn't turned down as changed since).
    expect((await applyAndKeep('g1', [plan], { storyId: 's1' })).done).toBe(1)
  })
})

describe('a plot thread link', () => {
  it('goes on the scene card’s list as Adam’s own link; Undo takes it off and puts its old mark back', async () => {
    main.cards.set('sc1', card({ paysOffIds: ['t0'], threadLinks: { 'paysOff:t1': 'removed' } }))
    const t = proposal({ kind: 'thread', threadId: 't1', name: 'The lamp oil', action: 'resolve', list: 'paysOff', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', note: '' })
    const { undos } = await applyAndKeep('g1', [t], {})
    expect(main.cards.get('sc1')).toMatchObject({ paysOffIds: ['t0', 't1'] })
    expect(main.cards.get('sc1')?.threadLinks).toBeUndefined()
    await undoChanges(undos)
    expect(main.cards.get('sc1')).toMatchObject({ paysOffIds: ['t0'], threadLinks: { 'paysOff:t1': 'removed' } })
  })

  it('makes a new plot thread first, with its promise; Undo takes the link off and the thread to Recently deleted', async () => {
    main.cards.set('sc1', card())
    const t = proposal({ kind: 'thread', threadId: null, name: 'The torn page', action: 'open', list: 'setsUp', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', note: 'Who tore it?' })
    const { undos } = await applyAndKeep('g1', [t], {})
    expect(main.calls).toEqual(['create thread The torn page Who tore it?'])
    expect(main.cards.get('sc1')).toMatchObject({ setsUpIds: ['t-new'] })
    await undoChanges(undos)
    expect(main.cards.get('sc1')).toMatchObject({ setsUpIds: [] })
    expect(main.calls).toEqual(['create thread The torn page Who tore it?', 'delete t-new'])
  })
})
