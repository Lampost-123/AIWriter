// The plot threads board on the fixed test world (tests/unit/testWorld.ts). "Who burned the mill?" is
// opened in Book 1, Ch 1, Sc 2 and resolved in Book 3, Ch 1, Sc 2; these tests add a thread resolved in
// Ash, a novella during Book 2, which shows as resolved only in the stories that count Ash.
import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import type { SceneCard } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { dbWorld } from '../../../tests/unit/testWorld'
import { memoryWorld } from '../../../tests/unit/helpers'
import { threadsBoardOf } from './index'
import { LONG_OPEN_CHAPTERS } from './threads'

function world() {
  const w = dbWorld()
  const { db } = w
  const thread = (name: string, promise = '') => repo.createEntry(db, 'thread', { name, fields: { promise } })
  const secret = thread('Whose ring is it?', 'Who gave Mara the ring, and why.')
  const map = thread('The lost map')
  const idea = thread('The stranger at the ferry')
  const open = (entryId: string, scene: string, status: 'open' | 'resolved') =>
    mem.insertChange(db, { kind: 'thread', payload: { status, note: '' }, entryId, anchor: 'scene', sceneId: w.id(scene), origin: 'adam' })
  // Opened before Ash starts (so Book 2 doesn't change it while Ash runs), resolved in Ash.
  open(secret.id, 'b1.c3.s1', 'open')
  open(secret.id, 'ash.c1.s2', 'resolved')
  const card = (key: string, c: Partial<SceneCard>): void => void repo.updateSceneCard(db, w.id(key), { ...emptySceneCard(), ...c })
  card('b1.c2.s1', { setsUpIds: [map.id] })
  card('b1.c3.s2', { paysOffIds: [w.id('burned')] })
  return { ...w, secret, map, idea }
}

describe('the plot threads board', () => {
  const w = world()
  const board = (story: string) => threadsBoardOf(w.db, w.id(story))
  const find = (story: string, id: string) => board(story).threads.find((t) => t.id === id)

  it('shows a thread open, with where it was set up as a link and where a scene card means to pay it off', () => {
    const burned = find('b1', w.id('burned'))!
    expect(burned).toMatchObject({
      name: 'Who burned the mill?',
      column: 'open',
      setUp: { label: 'Book 1, Ch 1, Sc 2', storyId: w.id('b1'), sceneId: w.id('b1.c1.s2'), planned: false },
      paidOff: { label: 'Book 1, Ch 3, Sc 2', sceneId: w.id('b1.c3.s2'), planned: true },
      longOpen: false
    })
    // Ch 1, Ch 2, Kell's Road's one chapter and Ch 3 have ended since.
    expect(burned.openChapters).toBe(4)
  })

  it('shows it resolved, with where it was paid off, in the story that resolves it', () => {
    expect(find('b3', w.id('burned'))).toMatchObject({
      column: 'resolved',
      setUp: { label: 'Book 1, Ch 1, Sc 2', sceneId: w.id('b1.c1.s2') },
      paidOff: { label: 'Book 3, Ch 1, Sc 2', sceneId: w.id('b3.c1.s2'), planned: false },
      openChapters: null,
      longOpen: false
    })
  })

  it(`highlights a thread open for ${LONG_OPEN_CHAPTERS} chapters or more`, () => {
    // By the end of Book 2: Book 1's three chapters, Kell's Road, The Quiet Year, Book 2's six, Ash, Ember and Wolf Winter.
    expect(find('b2', w.id('burned'))).toMatchObject({ column: 'open', openChapters: 14, longOpen: true })
  })

  it('shows a thread resolved in a side story as resolved only where that story counts', () => {
    expect(find('b2', w.secret.id)).toMatchObject({ column: 'resolved', paidOff: { label: 'Ash, Ch 1, Sc 2', sceneId: w.id('ash.c1.s2') } })
    expect(find('b3', w.secret.id)?.column).toBe('resolved')
    expect(find('wolf', w.secret.id)?.column).toBe('resolved')
    // Ember starts after Book 2's Ch 1, while Ash is still running: it doesn't know Ash.
    expect(find('ember', w.secret.id)).toMatchObject({ column: 'open', paidOff: null })
    expect(find('b1', w.secret.id)?.column).toBe('open')
    expect(find('ash', w.secret.id)?.column).toBe('resolved')
  })

  it('carries the promise to the reader', () => {
    expect(find('b2', w.secret.id)?.promise).toBe('Who gave Mara the ring, and why.')
  })

  it('shows threads only on scene cards so far, or nowhere yet, as planned', () => {
    expect(find('b1', w.map.id)).toMatchObject({
      column: 'planned',
      setUp: { label: 'Book 1, Ch 2, Sc 1', sceneId: w.id('b1.c2.s1'), planned: true },
      paidOff: null,
      openChapters: null
    })
    expect(find('b1', w.idea.id)).toMatchObject({ column: 'planned', setUp: null, paidOff: null })
    // A scene card in a story that doesn't count isn't a plan for this one.
    expect(find('other', w.map.id)?.setUp).toBeNull()
  })

  it('orders the board: open, then resolved, then planned, each by where it was set up', () => {
    const rank = ['open', 'resolved', 'planned']
    const columns = board('b2').threads.map((t) => t.column)
    expect(columns).toEqual([...columns].sort((a, b) => rank.indexOf(a) - rank.indexOf(b)))
  })
})

describe('an empty board', () => {
  it('has no threads in a new world', () => {
    const db = memoryWorld()
    expect(threadsBoardOf(db, repo.listStories(db)[0].id).threads).toEqual([])
  })

  it('leaves out threads that only exist in another story', () => {
    const w = dbWorld()
    const kells = repo.createEntry(w.db, 'thread', { name: "Kell's debt" }, { origin: 'adam', originStoryId: w.id('kr') })
    expect(threadsBoardOf(w.db, w.id('kr')).threads.some((t) => t.id === kells.id)).toBe(true)
    expect(threadsBoardOf(w.db, w.id('ym')).threads.some((t) => t.id === kells.id)).toBe(false)
  })
})
