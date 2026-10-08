import { describe, expect, it } from 'vitest'
import { emptySceneCard } from './defaults'
import type { SceneCard } from './types'
import { aiLinked, isAiLink, mergeThreadLinks, withAiLink, withListEdited, withoutAiLink } from './threadLinks'

const card = (c: Partial<SceneCard> = {}): SceneCard => ({ ...emptySceneCard(), ...c })

describe('plot thread links the memory makes on a scene card', () => {
  it('adds its own link, marked, but never a second one or one Adam took off', () => {
    const c = withAiLink(card(), 'setsUp', 't1')!
    expect(c.setsUpIds).toEqual(['t1'])
    expect(isAiLink(c, 'setsUp', 't1')).toBe(true)
    expect(aiLinked(c, 'setsUp')).toEqual(new Set(['t1']))
    expect(withAiLink(c, 'setsUp', 't1')).toBeNull()
    expect(withAiLink(card({ setsUpIds: ['t1'] }), 'setsUp', 't1')).toBeNull()
    const removed = withListEdited(c, 'setsUp', [])
    expect(removed.threadLinks).toEqual({ 'setsUp:t1': 'removed' })
    expect(withAiLink(removed, 'setsUp', 't1')).toBeNull()
  })

  it('takes back only its own link', () => {
    const mine = card({ paysOffIds: ['t1'] })
    expect(withoutAiLink(mine, 'paysOff', 't1')).toBeNull()
    const ai = withAiLink(card(), 'paysOff', 't2')!
    const back = withoutAiLink(ai, 'paysOff', 't2')!
    expect(back.paysOffIds).toEqual([])
    expect(back.threadLinks).toEqual({ 'paysOff:t2': 'undone' })
  })

  it('a link Adam adds by hand is his, even one the memory had made before', () => {
    const c = withListEdited(withListEdited(withAiLink(card(), 'setsUp', 't1')!, 'setsUp', []), 'setsUp', ['t1'])
    expect(c.setsUpIds).toEqual(['t1'])
    expect(c.threadLinks).toBeUndefined()
    expect(isAiLink(c, 'setsUp', 't1')).toBe(false)
  })

  it('a save from an older copy keeps what the memory did since', () => {
    const before = card({ goal: 'Find the bell' })
    const disk = withAiLink(before, 'setsUp', 't1')!
    // The panel saves its older copy with a new goal: the memory's new link stays.
    const merged = mergeThreadLinks(disk, { ...before, goal: 'Ring the bell' })
    expect(merged).toMatchObject({ goal: 'Ring the bell', setsUpIds: ['t1'], threadLinks: { 'setsUp:t1': 'ai' } })
    // The memory took its link back since the panel read it: it stays gone.
    const undone = withoutAiLink(disk, 'setsUp', 't1')!
    expect(mergeThreadLinks(undone, disk)).toMatchObject({ setsUpIds: [], threadLinks: { 'setsUp:t1': 'undone' } })
    // Adam took it off in the panel: that wins.
    const off = withListEdited(disk, 'setsUp', [])
    expect(mergeThreadLinks(disk, off).setsUpIds).toEqual([])
    // Nothing to merge: the same object back.
    const plain = card()
    expect(mergeThreadLinks(card(), plain)).toBe(plain)
  })
})
