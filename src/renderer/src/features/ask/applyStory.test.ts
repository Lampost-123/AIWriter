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
import { emptyChapterCard } from '@shared/chapterCard'
import { sceneExtensions } from '@/features/editor/extensions'

const main = vi.hoisted(() => ({
  calls: [] as string[],
  statuses: [] as string[],
  issue: { id: 'i1', sceneId: 'sc1', status: 'open', quote: 'carried the lantern', fix: 'carried a torch' } as Record<string, unknown>,
  entry: { id: 'e1', name: 'Ilse', summary: 'Keeps the tally.', description: '', fields: {} as Record<string, string> },
  chapterCard: null as unknown as ChapterCard,
  cards: new Map<string, SceneCard>(),
  shown: [] as unknown[],
  app: {
    view: { kind: 'write' },
    sceneId: 'sc1' as string | null,
    storyId: 's1' as string | null,
    selectScene: (_id: string) => undefined,
    bumpOutline: () => undefined,
    bumpEntries: () => undefined,
    bumpBriefing: () => undefined,
    bumpMemory: () => undefined
  }
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  onEvent: () => () => undefined,
  api: {
    getScene: async (id: string) => ({ id, card: main.cards.get(id), doc: null, text: '' }),
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
    updateChapterCard: async (id: string, card: ChapterCard) => {
      main.calls.push(`chapter ${id} ${card.mood}`)
      main.chapterCard = card
      return { card, updated: [{ sceneId: 'sc1', before: { parts: emptyChapterCard(), inherits: null } }] }
    },
    restoreChapterCard: async (id: string, card: ChapterCard, scenes: unknown[]) => {
      main.calls.push(`restore ${id} ${card.mood} ${scenes.length}`)
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
  setEditorBridge({ sceneId, editor, busy: () => false, current: () => ({ sceneId, doc: state.doc.toJSON(), text: '' }) } as unknown as EditorBridge)
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
  main.cards.clear()
  setEditorBridge(null)
})

describe('an issue fix', () => {
  const text = proposal({ kind: 'issueFix', issueId: 'i1', how: 'text', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', message: 'm', severity: 'warning', quote: 'carried the lantern', fix: 'carried a torch' })

  it('puts the check’s rewrite in for the issue’s words and marks it fixed; Undo puts them back and reopens it', async () => {
    const p = openPage('sc1', page('Ilse carried the lantern up the hill.', 'Bram waited.'))
    const { undos } = await applyAndKeep('g1', [text], {})
    expect(textsOf(p.doc())).toEqual(['Ilse carried a torch up the hill.', 'Bram waited.'])
    expect(main.calls).toEqual(['fixed i1'])
    expect(main.statuses).toEqual(['1:applied'])
    const [r] = await undoChanges(undos)
    expect(r).toEqual({ ok: true })
    expect(textsOf(p.doc())).toEqual(['Ilse carried the lantern up the hill.', 'Bram waited.'])
    expect(main.calls).toEqual(['fixed i1', 'reopen i1'])
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
