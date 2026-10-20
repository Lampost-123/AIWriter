// Applying the editor chat's changes and undoing them, with the page and the main process stood in for: Undo puts
// back exactly what a change made, in the page when it shows the scene and in the saved scene when it doesn't; when
// Adam changed those words since it leaves them alone, says so and keeps the change marked applied; Apply all is
// undone latest first; and a new entry goes in the story the chat was asked in. Invented text only.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import type { Proposal } from '@shared/contracts/ask'
import { sceneExtensions } from '@/features/editor/extensions'

const main = vi.hoisted(() => ({
  /** The saved scenes' documents (JSON) and text. */
  scenes: new Map<string, { doc: unknown; text: string }>(),
  /** The scenes' cards (beats, TEXTTOOLS). */
  cards: new Map<string, { goal: string; beats: string[] }>(),
  /** The scenes' and chapters' titles (a rename). */
  titles: new Map<string, string>(),
  /** The chapter cards, by chapter. */
  chapterCards: new Map<string, Record<string, unknown>>(),
  chapterSaves: [] as string[],
  saves: [] as string[],
  statuses: [] as string[],
  created: [] as unknown[],
  toasts: [] as { message: string; tone?: string; action?: { label: string; run: () => void } }[],
  app: {
    view: { kind: 'write' },
    sceneId: 'sc1' as string | null,
    storyId: 's1' as string | null,
    selectScene: (_id: string) => undefined,
    bumpOutline: () => undefined,
    bumpEntries: () => undefined,
    bumpBriefing: () => undefined,
    bumpChapterCards: () => undefined
  }
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  onEvent: () => () => undefined,
  api: {
    getScene: async (id: string) => {
      // A scene deleted since is gone, as the main process says it.
      if (!main.scenes.has(id) && !main.cards.has(id)) throw new Error('That scene no longer exists.')
      return { id, title: main.titles.get(id) ?? '', ...main.scenes.get(id)!, card: main.cards.get(id) }
    },
    updateScene: async (id: string, patch: { title: string }) => {
      main.titles.set(id, patch.title)
      return { id }
    },
    updateChapter: async (id: string, patch: { title: string }) => {
      main.titles.set(id, patch.title)
      return { id }
    },
    getOutline: async () => ({
      chapters: [...main.titles].filter(([id]) => id.startsWith('ch')).map(([id, title]) => ({ id, title })),
      scenes: []
    }),
    getChapterCard: async (id: string) => main.chapterCards.get(id) ?? {},
    updateChapterCard: async (id: string, card: Record<string, unknown>) => {
      main.chapterCards.set(id, card)
      main.chapterSaves.push(id)
      return { card, updated: [] }
    },
    updateSceneCard: async (id: string, card: { goal: string; beats: string[] }) => {
      main.cards.set(id, card)
      return card
    },
    saveSceneText: async (id: string, doc: unknown, text: string) => {
      main.scenes.set(id, { doc, text })
      main.saves.push(id)
      return { wordCount: 1, updatedAt: '', status: 'drafted' }
    },
    takeSnapshot: async () => null,
    setProposalStatus: async (_g: string, id: string, status: string) => {
      main.statuses.push(`${id}:${status}`)
    },
    createEntry: async (kind: string, input: unknown) => {
      main.created.push({ kind, ...(input as object) })
      return { id: 'e-new' }
    },
    createBuilderEntry: async (input: unknown) => {
      main.created.push(input)
      return { id: 'e-new' }
    }
  }
}))
vi.mock('@/lib/flush', () => ({ flushAll: async () => undefined, registerDiscarder: () => () => undefined }))
vi.mock('@/lib/store', () => ({ useApp: { getState: () => main.app } }))
vi.mock('@/components/ui', () => ({
  toast: (message: string, opts: { tone?: string; action?: { label: string; run: () => void } } = {}) => {
    main.toasts.push({ message, ...opts })
    return 1
  }
}))
vi.mock('@/features/history/snapshot', () => ({ snapshotBefore: async () => null }))
vi.mock('@/features/history/open', () => ({ openHistory: async () => undefined }))
// A proposed draft starts the writer's own job (applyDraft.ts, with the page's flows): stood in for here.
type Landed = { ok: true } | { ok: false; why: string }
const drafts = vi.hoisted(() => ({
  started: [] as string[],
  reply: { ok: true } as { ok: true } | { ok: false; why: string },
  /** Says how the started draft ended (it lands, or fails, when the test says). */
  land: (_l: { ok: true } | { ok: false; why: string }): void => undefined
}))
vi.mock('./applyDraft', () => ({
  startProposedDraft: async (p: { id: string }) => {
    drafts.started.push(p.id)
    if (!drafts.reply.ok) return drafts.reply
    return { ok: true, landed: new Promise<Landed>((resolve) => (drafts.land = resolve)) }
  }
}))

import { setEditorBridge, type EditorBridge } from '@/lib/editorBridge'
import { applyAndKeep, applyChanges, COULDNT, HELD_CHAPTER, PAGE_REFUSED, undoChanges } from './applyProposal'
import { HELD_APPLY, notOpened } from './sceneInPage'
import { setHeld } from '@/features/chapterWriter/hold'
import { useAsk } from './askStore'
import { useOutlineStore } from '@/features/binder/outlineStore'

const schema = getSchema(sceneExtensions())
const para = (pid: string, text: string): PMNode => schema.nodes.paragraph.create({ pid }, text ? schema.text(text) : null)
const page = (...texts: string[]): PMNode => schema.topNodeType.create(null, texts.map((t, i) => para(`p${i}`, t)))
const textsOf = (doc: PMNode): string[] => {
  const out: string[] = []
  doc.forEach((n) => out.push(n.textContent))
  return out
}
const storedTexts = (sceneId: string): string[] => textsOf(schema.nodeFromJSON(main.scenes.get(sceneId)!.doc))

/** A page showing a scene: a real editor state behind a stand-in for the editor. */
function openPage(sceneId: string, doc: PMNode): { doc: () => PMNode; type: (pos: number, text: string) => void; close: () => void } {
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
  const bridge = {
    sceneId,
    editor,
    busy: () => false,
    current: (id?: string) => (id === undefined || id === sceneId ? { sceneId, doc: state.doc.toJSON(), text: '' } : null)
  }
  setEditorBridge(bridge as unknown as EditorBridge)
  main.app.sceneId = sceneId
  return {
    doc: () => state.doc,
    type: (pos, text) => view.dispatch(state.tr.insertText(text, pos)),
    // Leaving the scene: what the page showed is saved, and the page shows no scene.
    close: () => {
      main.scenes.set(sceneId, { doc: state.doc.toJSON(), text: textsOf(state.doc).join('\n\n') })
      setEditorBridge({ ...bridge, sceneId: 'other', editor: null, current: () => null } as unknown as EditorBridge)
      main.app.sceneId = 'other'
    }
  }
}

const edit = (id: string, find: string, replace: string): Proposal =>
  ({ id, kind: 'text', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', find, replace, status: 'pending' }) as unknown as Proposal

beforeEach(() => {
  main.scenes.clear()
  main.cards.clear()
  main.saves.length = 0
  main.statuses.length = 0
  main.created.length = 0
  main.toasts.length = 0
  main.titles.clear()
  main.chapterCards.clear()
  main.chapterSaves.length = 0
  main.app.storyId = 's1'
  setEditorBridge(null)
  useAsk.setState({ turns: [] })
})

describe('Undo of words', () => {
  it('puts them back in the page when it shows the scene, and the change waits again', async () => {
    const p = openPage('sc1', page('The tide came in.', 'The gulls went quiet.'))
    const { undos } = await applyAndKeep('g1', [edit('a', 'went quiet', 'fell silent')], {})
    expect(textsOf(p.doc())).toEqual(['The tide came in.', 'The gulls fell silent.'])
    // Adam types in another paragraph meanwhile: that stays.
    p.type(1, 'Slowly, ')
    const [r] = await undoChanges(undos)
    expect(r).toEqual({ ok: true })
    expect(textsOf(p.doc())).toEqual(['Slowly, The tide came in.', 'The gulls went quiet.'])
    expect(main.statuses).toEqual(['a:applied', 'a:pending'])
  })

  it('puts them back in the saved scene when the scene is closed', async () => {
    const p = openPage('sc1', page('The tide came in.', 'The gulls went quiet.'))
    const { undos } = await applyAndKeep('g1', [edit('a', 'went quiet', 'fell silent')], {})
    p.close()
    const [r] = await undoChanges(undos)
    expect(r).toEqual({ ok: true })
    expect(main.saves).toEqual(['sc1'])
    expect(storedTexts('sc1')).toEqual(['The tide came in.', 'The gulls went quiet.'])
    expect(main.statuses).toEqual(['a:applied', 'a:pending'])
  })

  it('leaves words changed since alone, says so, and keeps the change applied (scene open)', async () => {
    const p = openPage('sc1', page('The tide came in.', 'The gulls went quiet.'))
    const { undos } = await applyAndKeep('g1', [edit('a', 'went quiet', 'fell silent')], {})
    const second = p.doc().child(0).nodeSize + 1
    p.type(second, 'All ')
    const [r] = await undoChanges(undos)
    expect(r.ok).toBe(false)
    expect(textsOf(p.doc())).toEqual(['The tide came in.', 'All The gulls fell silent.'])
    expect(main.statuses).toEqual(['a:applied'])
    expect(main.toasts.at(-1)).toMatchObject({ tone: 'danger', action: { label: 'Open History' } })
    expect(main.toasts.at(-1)?.message).toContain('changed since')
  })

  it('leaves words changed since alone in the saved scene too', async () => {
    const p = openPage('sc1', page('The tide came in.', 'The gulls went quiet.'))
    const { undos } = await applyAndKeep('g1', [edit('a', 'went quiet', 'fell silent')], {})
    p.type(p.doc().child(0).nodeSize + 1, 'All ')
    p.close()
    const [r] = await undoChanges(undos)
    expect(r.ok).toBe(false)
    expect(main.saves).toEqual([])
    expect(storedTexts('sc1')).toEqual(['The tide came in.', 'All The gulls fell silent.'])
    expect(main.statuses).toEqual(['a:applied'])
  })

  it('undoes Apply all latest first, so changes to one paragraph all come back', async () => {
    const p = openPage('sc1', page('The tide came in.', 'The gulls went quiet.'))
    const { undos, done } = await applyAndKeep('g1', [edit('a', 'went quiet', 'fell silent'), edit('b', 'The gulls', 'The terns')], {})
    expect(done).toBe(2)
    expect(textsOf(p.doc())).toEqual(['The tide came in.', 'The terns fell silent.'])
    const results = await undoChanges(undos)
    expect(results).toEqual([{ ok: true }, { ok: true }])
    expect(textsOf(p.doc())).toEqual(['The tide came in.', 'The gulls went quiet.'])
    expect(main.statuses).toEqual(['a:applied', 'b:applied', 'b:pending', 'a:pending'])
  })

  it('runs the toast’s Undo only once', async () => {
    openPage('sc1', page('The gulls went quiet.'))
    useAsk.setState({ turns: [{ generationId: 'g1', chatId: 's1:c1' } as never] })
    await applyChanges('g1', [edit('a', 'went quiet', 'fell silent')])
    const undo = main.toasts.at(-1)!.action!
    expect(undo.label).toBe('Undo')
    undo.run()
    undo.run()
    await new Promise((r) => setTimeout(r, 0))
    expect(main.statuses.filter((s) => s === 'a:pending')).toHaveLength(1)
  })

  it('gives each change its own Undo (a change card’s); the toast then undoes only the rest', async () => {
    const p = openPage('sc1', page('The tide came in.', 'The gulls went quiet.'))
    useAsk.setState({ turns: [{ generationId: 'g1', chatId: 's1:c1' } as never] })
    const { undoOf, failedOf } = await applyChanges('g1', [edit('a', 'went quiet', 'fell silent'), edit('b', 'nowhere at all', 'x')])
    expect(Object.keys(undoOf)).toEqual(['a'])
    expect(failedOf.b).toBeTruthy()
    await undoOf.a()
    expect(textsOf(p.doc())).toEqual(['The tide came in.', 'The gulls went quiet.'])
    main.toasts.at(-1)!.action!.run()
    await undoOf.a()
    await new Promise((r) => setTimeout(r, 0))
    expect(main.statuses.filter((s) => s === 'a:pending')).toHaveLength(1)
  })
})

describe('an anchored edit (the same words twice)', () => {
  it('changes the place the chat named, not the first', async () => {
    const p = openPage('sc1', page('The lamp went out.', 'Then the lamp went out.'))
    const anchored = { ...edit('a', 'the lamp went out.', 'the lamp guttered.'), at: { paragraph: 2, pid: 'p1', offset: 5 } } as Proposal
    await applyAndKeep('g1', [anchored], {})
    expect(textsOf(p.doc())).toEqual(['The lamp went out.', 'Then the lamp guttered.'])
  })
})

describe('a proposed draft', () => {
  const draft = { id: 'd', kind: 'draft', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', mode: 'continue', direction: 'On to the stair.', why: '', status: 'pending' } as unknown as Proposal

  it('starts the writer’s job, is marked started (not applied), and has no Undo of its own', async () => {
    drafts.started.length = 0
    drafts.reply = { ok: true }
    useAsk.setState({ turns: [{ generationId: 'g1', chatId: 's1:c1' } as never] })
    await applyChanges('g1', [draft])
    expect(drafts.started).toEqual(['d'])
    expect(main.statuses).toEqual(['d:started'])
    expect(main.toasts.at(-1)).toMatchObject({ message: 'The draft has started in Ch 1, Sc 1.', action: { label: 'Show' } })
  })

  it('turns to applied only when the draft lands', async () => {
    drafts.reply = { ok: true }
    const { landedOf } = await applyChanges('g1', [draft])
    expect(main.statuses).toEqual(['d:started'])
    drafts.land({ ok: true })
    expect(await landedOf.d).toEqual({ ok: true })
    expect(main.statuses).toEqual(['d:started', 'd:applied'])
  })

  it('goes back to waiting, with the reason, when the draft fails or is stopped', async () => {
    drafts.reply = { ok: true }
    const { landedOf } = await applyChanges('g1', [draft])
    drafts.land({ ok: false, why: 'The draft in Ch 1, Sc 1 was stopped before it finished.' })
    expect(await landedOf.d).toEqual({ ok: false, why: 'The draft in Ch 1, Sc 1 was stopped before it finished.' })
    expect(main.statuses).toEqual(['d:started', 'd:pending'])
    expect(main.toasts.at(-1)).toMatchObject({ message: 'The draft in Ch 1, Sc 1 was stopped before it finished.' })
  })

  it('says why when it can’t start, and stays waiting', async () => {
    drafts.reply = { ok: false, why: 'Something is being written into this scene already.' }
    useAsk.setState({ turns: [{ generationId: 'g1', chatId: 's1:c1' } as never] })
    await applyChanges('g1', [draft])
    expect(main.statuses).toEqual([])
    expect(main.toasts.at(-1)).toMatchObject({ tone: 'danger', message: 'Something is being written into this scene already.' })
  })

  it('never drops a start that comes back with no reason: it says so and stays waiting', async () => {
    drafts.reply = { ok: false, why: '' }
    const { failedOf } = await applyChanges('g1', [draft])
    expect(failedOf.d).toBe(COULDNT)
    expect(main.statuses).toEqual([])
    expect(main.toasts.at(-1)).toMatchObject({ tone: 'danger', message: COULDNT })
  })
})

describe('a card, title or chapter card changed since the chat proposed it', () => {
  it('a title: turned down with what it says now; a second Apply goes through', async () => {
    main.scenes.set('sc1', { doc: null, text: '' })
    main.titles.set('sc1', 'The Harbour at Dusk')
    const rename = { id: 'r', kind: 'rename', target: 'scene', targetId: 'sc1', from: 'The Harbour', to: 'Low Tide', why: '', status: 'pending' } as unknown as Proposal
    const first = await applyAndKeep('g1', [rename], {})
    expect(first.done).toBe(0)
    expect(first.failedOf.r).toBe('This title has changed since. Here’s what it says now: “The Harbour at Dusk”. Apply again to use the chat’s change.')
    expect(main.titles.get('sc1')).toBe('The Harbour at Dusk')
    const second = await applyAndKeep('g1', [rename], {})
    expect(second.done).toBe(1)
    expect(main.titles.get('sc1')).toBe('Low Tide')
  })

  it('a title as the chat saw it: applied at once', async () => {
    main.titles.set('ch1', 'The Harbour')
    const rename = { id: 'r', kind: 'rename', target: 'chapter', targetId: 'ch1', from: 'The Harbour', to: 'Low Tide', why: '', status: 'pending' } as unknown as Proposal
    expect((await applyAndKeep('g1', [rename], {})).done).toBe(1)
    expect(main.titles.get('ch1')).toBe('Low Tide')
  })

  it('a scene card: turned down with what the changed part says now, then applied on a second Apply', async () => {
    main.scenes.set('sc1', { doc: null, text: '' })
    main.cards.set('sc1', { goal: 'Find the keeper first.', beats: [] })
    const card = { id: 'c', kind: 'card', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', patch: { goal: 'Cross before dark.' }, before: { goal: 'Reach the lamp.' }, why: '', status: 'pending' } as unknown as Proposal
    const first = await applyAndKeep('g1', [card], {})
    expect(first.failedOf.c).toBe('This card has changed since. Here’s what it says now: Goal: “Find the keeper first.” Apply again to use the chat’s change.')
    expect(main.cards.get('sc1')?.goal).toBe('Find the keeper first.')
    expect((await applyAndKeep('g1', [card], {})).done).toBe(1)
    expect(main.cards.get('sc1')?.goal).toBe('Cross before dark.')
  })

  it('a scene card as the chat saw it (other parts changed meanwhile don’t count): applied at once', async () => {
    main.scenes.set('sc1', { doc: null, text: '' })
    main.cards.set('sc1', { goal: ' Reach the lamp. ', beats: ['Adam’s new beat'] })
    const card = { id: 'c', kind: 'card', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', patch: { goal: 'Cross before dark.' }, before: { goal: 'Reach the lamp.' }, why: '', status: 'pending' } as unknown as Proposal
    expect((await applyAndKeep('g1', [card], {})).done).toBe(1)
    expect(main.cards.get('sc1')).toEqual({ goal: 'Cross before dark.', beats: ['Adam’s new beat'] })
  })

  it('a chapter card: turned down with what it says now, then applied on a second Apply', async () => {
    main.chapterCards.set('ch1', { mood: 'Bright and loud.', notes: '' })
    const cc = { id: 'k', kind: 'chapterCard', chapterId: 'ch1', chapterLabel: 'Ch 1', patch: { mood: 'Grey and hushed.' }, before: { mood: 'Bright.' }, lines: [], scenes: 0, why: '', status: 'pending' } as unknown as Proposal
    const first = await applyAndKeep('g1', [cc], {})
    expect(first.failedOf.k).toBe('This card has changed since. Here’s what it says now: Mood or tone: “Bright and loud.” Apply again to use the chat’s change.')
    expect(main.chapterSaves).toEqual([])
    expect((await applyAndKeep('g1', [cc], {})).done).toBe(1)
    expect(main.chapterCards.get('ch1')?.mood).toBe('Grey and hushed.')
  })
})

describe('a new entry', () => {
  const lighthouse = { id: 'n', kind: 'newEntry', entryKind: 'lore', name: 'The Lamp', summary: '', description: '', status: 'pending' } as unknown as Proposal

  it('goes in the story the chat was asked in, even with another story open', async () => {
    useAsk.setState({ turns: [{ generationId: 'g1', chatId: 's2:c1' } as never] })
    main.app.storyId = 's1'
    await applyChanges('g1', [lighthouse])
    expect(main.created).toEqual([expect.objectContaining({ originStoryId: 's2' })])
  })

  it('goes in no story for a chat asked with none open', async () => {
    useAsk.setState({ turns: [{ generationId: 'g1', chatId: 'world:c1' } as never] })
    await applyChanges('g1', [lighthouse])
    expect(main.created).toEqual([expect.objectContaining({ originStoryId: null })])
  })
})

describe('an insert, a cut, beats (TEXTTOOLS)', () => {
  const base = { sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', status: 'pending', why: '' }
  const insert = (id: string, text: string): Proposal =>
    ({ ...base, id, kind: 'insert', where: 'after', at: { paragraph: 1, pid: 'p0', offset: 0 }, near: 'The tide came in.', text }) as unknown as Proposal
  const cut = (id: string): Proposal =>
    ({ ...base, id, kind: 'cut', from: { paragraph: 2, pid: 'p1', offset: 0 }, to: { paragraph: 2, pid: 'p1', offset: 21 }, paragraphs: ['The gulls went quiet.'] }) as unknown as Proposal
  const scene = (): PMNode => page('The tide came in.', 'The gulls went quiet.', 'Mara waited.')

  it('inserts in the page as one step; Undo takes out only the new paragraphs, the scene open', async () => {
    const p = openPage('sc1', scene())
    const { undos } = await applyAndKeep('g1', [insert('a', 'She *paused*.')], {})
    expect(textsOf(p.doc())).toEqual(['The tide came in.', 'She paused.', 'The gulls went quiet.', 'Mara waited.'])
    p.type(1, 'Slowly, ')
    expect(await undoChanges(undos)).toEqual([{ ok: true }])
    expect(textsOf(p.doc())).toEqual(['Slowly, The tide came in.', 'The gulls went quiet.', 'Mara waited.'])
    expect(main.statuses).toEqual(['a:applied', 'a:pending'])
  })

  it('undoes an insert in the saved scene with it closed, and leaves new paragraphs Adam changed since', async () => {
    const p = openPage('sc1', scene())
    const { undos } = await applyAndKeep('g1', [insert('a', 'She paused.')], {})
    p.close()
    expect(await undoChanges(undos)).toEqual([{ ok: true }])
    expect(storedTexts('sc1')).toEqual(['The tide came in.', 'The gulls went quiet.', 'Mara waited.'])

    main.statuses.length = 0
    const q = openPage('sc1', scene())
    const second = await applyAndKeep('g1', [insert('b', 'She paused.')], {})
    q.type(q.doc().child(0).nodeSize + 1, 'Then ')
    q.close()
    const [r] = await undoChanges(second.undos)
    expect(r.ok).toBe(false)
    expect(storedTexts('sc1')).toEqual(['The tide came in.', 'Then She paused.', 'The gulls went quiet.', 'Mara waited.'])
    expect(main.statuses).toEqual(['b:applied'])
  })

  it('cuts whole paragraphs; Undo puts them back in the saved scene, beside what Adam typed since', async () => {
    const p = openPage('sc1', scene())
    const { undos } = await applyAndKeep('g1', [cut('c')], {})
    expect(textsOf(p.doc())).toEqual(['The tide came in.', 'Mara waited.'])
    p.type(1, 'Slowly, ')
    p.close()
    expect(await undoChanges(undos)).toEqual([{ ok: true }])
    expect(storedTexts('sc1')).toEqual(['Slowly, The tide came in.', 'The gulls went quiet.', 'Mara waited.'])
    expect(main.statuses).toEqual(['c:applied', 'c:pending'])
  })

  it('doesn’t cut paragraphs that were changed since it was proposed', async () => {
    const p = openPage('sc1', page('The tide came in.', 'The gulls went very quiet.', 'Mara waited.'))
    const { failed } = await applyAndKeep('g1', [cut('c')], {})
    expect(failed[0]).toMatch(/aren’t in the scene as they were/)
    expect(textsOf(p.doc())).toHaveLength(3)
  })

  it('changes the beats only while the card has the ones the chat saw; Undo puts the old ones back', async () => {
    main.cards.set('sc1', { goal: 'Reach the stair', beats: ['A', '', 'B'] })
    const beats = { ...base, id: 'b', kind: 'beats', op: 'insert', index: 3, before: ['A', 'B'], beats: ['A', 'B', 'C'] } as unknown as Proposal
    const { undos } = await applyAndKeep('g1', [beats], {})
    expect(main.cards.get('sc1')).toEqual({ goal: 'Reach the stair', beats: ['A', 'B', 'C'] })
    // The goal changed meanwhile stays; the beats go back as they were.
    main.cards.set('sc1', { goal: 'Climb', beats: ['A', 'B', 'C'] })
    expect(await undoChanges(undos)).toEqual([{ ok: true }])
    expect(main.cards.get('sc1')).toEqual({ goal: 'Climb', beats: ['A', '', 'B'] })
    // Beats changed since: neither applied nor undone.
    main.cards.set('sc1', { goal: 'Climb', beats: ['A', 'X'] })
    const again = await applyAndKeep('g1', [{ ...beats, id: 'b2' } as Proposal], {})
    expect(again.failed[0]).toMatch(/beats were changed since/)
    main.cards.set('sc1', { goal: 'Climb', beats: ['A', 'B'] })
    const third = await applyAndKeep('g1', [{ ...beats, id: 'b3' } as Proposal], {})
    main.cards.set('sc1', { goal: 'Climb', beats: ['A', 'B', 'C', 'D'] })
    const [r] = await undoChanges(third.undos)
    expect(r).toEqual({ ok: false, why: expect.stringMatching(/changed since, so Undo left them/) })
    expect(main.cards.get('sc1')?.beats).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('when a change can’t go in, it says why and changes nothing (Adam: "it could not access something to edit")', () => {
  it('a scene Write the chapter is writing: turned down in plain words, never said as applied', async () => {
    const p = openPage('sc1', page('The tide came in.', 'The gulls went quiet.'))
    setHeld(['sc1'])
    try {
      const { done, failedOf } = await applyAndKeep('g1', [edit('a', 'went quiet', 'fell silent')], {})
      expect(done).toBe(0)
      expect(failedOf.a).toBe(HELD_APPLY)
      expect(textsOf(p.doc())).toEqual(['The tide came in.', 'The gulls went quiet.'])
      expect(main.statuses).toEqual([])
      // A card change for the held scene waits too.
      main.cards.set('sc1', { goal: '', beats: [] })
      const card = { id: 'c', kind: 'card', sceneId: 'sc1', sceneLabel: 'Ch 1, Sc 1', patch: { goal: 'Cross before dark.' }, status: 'pending' } as unknown as Proposal
      expect((await applyAndKeep('g1', [card], {})).failedOf.c).toBe(HELD_APPLY)
      expect(main.cards.get('sc1')?.goal).toBe('')
    } finally {
      setHeld([])
    }
  })

  it('a chapter card for a chapter Write the chapter is writing: turned down in plain words, nothing saved', async () => {
    useOutlineStore.setState({ outline: { chapters: [{ id: 'ch1' }], scenes: [{ id: 'sc7', chapterId: 'ch1' }, { id: 'sc8', chapterId: 'ch1' }] } as never })
    main.chapterCards.set('ch1', { mood: '' })
    const cc = { id: 'k', kind: 'chapterCard', chapterId: 'ch1', chapterLabel: 'Ch 1', patch: { mood: 'Grey.' }, lines: [], scenes: 0, why: '', status: 'pending' } as unknown as Proposal
    setHeld(['sc8'])
    try {
      const { done, failedOf } = await applyAndKeep('g1', [cc], {})
      expect(done).toBe(0)
      expect(failedOf.k).toBe(HELD_CHAPTER)
      expect(main.chapterSaves).toEqual([])
    } finally {
      setHeld([])
      useOutlineStore.setState({ outline: null })
    }
  })

  it('a page that turns the change down: never said as applied', async () => {
    const p = openPage('sc1', page('The tide came in.', 'The gulls went quiet.'))
    const bridge = { ...(await import('@/lib/editorBridge')).editorBridge()! }
    const editor = bridge.editor as unknown as { view: { dispatch: (tr: Transaction) => void } }
    const real = editor.view.dispatch
    // As a hold's filterTransaction does: any change to the words is dropped.
    editor.view.dispatch = (tr: Transaction) => (tr.docChanged ? undefined : real(tr))
    const { done, failedOf } = await applyAndKeep('g1', [edit('a', 'went quiet', 'fell silent')], {})
    expect(done).toBe(0)
    expect(failedOf.a).toBe(PAGE_REFUSED)
    expect(textsOf(p.doc())).toEqual(['The tide came in.', 'The gulls went quiet.'])
    expect(main.statuses).toEqual([])
  })

  it('a scene that didn’t open: deleted since, or slow, each said plainly with what to do', async () => {
    main.scenes.set('sc1', { doc: page('x').toJSON(), text: 'x' })
    expect(await notOpened('gone', 'Ch 2, Sc 1')).toMatch(/^Ch 2, Sc 1 isn’t in the story any more \(it may have been deleted\).*Recently deleted/)
    expect(await notOpened('sc1', 'Ch 1, Sc 1')).toMatch(/^Ch 1, Sc 1 is taking longer than usual to open, so the change wasn’t made\. Try Apply again/)
  })
})
