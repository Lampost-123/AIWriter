import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import type { SceneCard } from '@shared/types'
import { CardSync, changedFields, keptTypingNote, lostToTyping, mergeCard, sameCardField } from './cardMerge'

const card = (patch: Partial<SceneCard> = {}): SceneCard => ({ ...emptySceneCard(), ...patch })

describe('mergeCard', () => {
  it('takes every field from the card read again when Adam has typed nothing', () => {
    const mine = card({ goal: 'old goal' })
    const fresh = card({ goal: 'new goal', beats: ['a', 'b'] })
    expect(mergeCard(fresh, mine, new Set())).toEqual(fresh)
  })

  it('keeps the fields Adam typed in and takes the rest from the card read again (edge case 4)', () => {
    const mine = card({ mood: 'tense, unsaved', goal: 'old goal' })
    const fresh = card({ mood: '', goal: 'the goal the chat applied' })
    const out = mergeCard(fresh, mine, new Set(['mood']))
    expect(out.mood).toBe('tense, unsaved')
    expect(out.goal).toBe('the goal the chat applied')
  })

  it('keeps his value in a field both he and the change touched', () => {
    const out = mergeCard(card({ goal: 'from the chat' }), card({ goal: 'his' }), new Set(['goal']))
    expect(out.goal).toBe('his')
  })

  it('hands back the very same card when nothing differs, so the panel neither redraws nor saves', () => {
    const mine = card({ goal: 'g', beats: ['one', ''] })
    // Stored beats leave the blank row out: still the same beats.
    const fresh = card({ goal: 'g', beats: ['one'] })
    expect(mergeCard(fresh, mine, new Set(), sameCardField)).toBe(mine)
  })

  it('takes a field the card read again has and the panel copy lacks', () => {
    const mine = card()
    delete (mine as Partial<SceneCard>).lengthSet
    const out = mergeCard(card({ lengthSet: true, targetWords: 2500 }), mine, new Set())
    expect(out.lengthSet).toBe(true)
    expect(out.targetWords).toBe(2500)
  })
})

describe('lostToTyping', () => {
  it('names a field changed elsewhere that gave way to his typing', () => {
    const prev = card({ goal: 'before', mood: 'calm' })
    const fresh = card({ goal: 'from the chat', mood: 'calm' })
    const mine = card({ goal: 'his', mood: 'his mood' })
    expect(lostToTyping(prev, fresh, mine, new Set(['goal', 'mood']))).toEqual(['goal'])
  })

  it('names nothing when the change elsewhere already says what he typed', () => {
    const prev = card({ goal: 'before' })
    expect(lostToTyping(prev, card({ goal: 'same' }), card({ goal: 'same' }), new Set(['goal']))).toEqual([])
  })

  it('names nothing for fields he left alone', () => {
    expect(lostToTyping(card(), card({ goal: 'new' }), card(), new Set())).toEqual([])
  })
})

describe('changedFields', () => {
  it('lists the fields that differ', () => {
    expect(changedFields(card({ goal: 'a' }), card({ goal: 'b', mood: 'm' }), sameCardField).sort()).toEqual(['goal', 'mood'])
  })

  it('ignores blank beats and spacing, as the card is stored', () => {
    expect(changedFields(card({ beats: ['one  two', ''] }), card({ beats: ['one two'] }), sameCardField)).toEqual([])
  })
})

describe('CardSync', () => {
  const sync = (): CardSync<SceneCard> => new CardSync<SceneCard>(sameCardField)

  it('shows a change applied elsewhere when Adam has typed nothing', () => {
    const s = sync()
    const mine = s.start(card({ goal: 'old' }), null)
    const { card: shown, lost } = s.read(card({ goal: 'applied' }), mine)
    expect(shown.goal).toBe('applied')
    expect(lost).toEqual([])
  })

  it('keeps unsaved typing in Mood and the goal the chat applied, and writes both (edge case 4)', () => {
    const s = sync()
    const loaded = s.start(card({ goal: 'old' }), null)
    const typed = { ...loaded, mood: 'tense' }
    s.edited(loaded, typed)
    const { card: shown } = s.read(card({ goal: 'applied' }), typed)
    expect(shown).toMatchObject({ goal: 'applied', mood: 'tense' })
    // The save queued before the read still holds the old goal: it is never written back.
    expect(s.toWrite(typed)).toMatchObject({ goal: 'applied', mood: 'tense' })
  })

  it('a re-read of its own write changes nothing on screen', () => {
    const s = sync()
    const loaded = s.start(card(), null)
    const typed = { ...loaded, beats: ['one', ''] }
    s.edited(loaded, typed)
    s.written(card({ beats: ['one'] }), true)
    expect(s.typing).toBe(false)
    expect(s.read(card({ beats: ['one'] }), typed).card).toBe(typed)
  })

  it('keeps typing that came after the write it was told about', () => {
    const s = sync()
    const loaded = s.start(card(), null)
    const first = { ...loaded, goal: 'g' }
    s.edited(loaded, first)
    const second = { ...first, mood: 'm' }
    s.edited(first, second)
    s.written(card({ goal: 'g' }), false)
    expect(s.read(card({ goal: 'g', conflict: 'applied' }), second).card).toMatchObject({ goal: 'g', mood: 'm', conflict: 'applied' })
  })

  it('names a change that gave way to his typing in the same field', () => {
    const s = sync()
    const loaded = s.start(card({ goal: 'old' }), null)
    const typed = { ...loaded, goal: 'his' }
    s.edited(loaded, typed)
    const { card: shown, lost } = s.read(card({ goal: 'applied' }), typed)
    expect(shown.goal).toBe('his')
    expect(lost).toEqual(['goal'])
  })

  it('an unconfirmed copy it opened from counts as typing', () => {
    const s = sync()
    const shown = s.start(card({ goal: 'disk' }), card({ goal: 'draft' }))
    expect(shown.goal).toBe('draft')
    expect(s.typing).toBe(true)
    expect(s.toWrite(shown).goal).toBe('draft')
  })
})

describe('keptTypingNote', () => {
  it('names the parts on screen, once each', () => {
    expect(keptTypingNote(['goal', 'targetWords', 'lengthSet', 'mood'])).toBe(
      'Goal, Length and Mood or tone changed somewhere else while you were typing there. What you typed was kept.'
    )
  })

  it('says nothing for plot thread links or when nothing gave way', () => {
    expect(keptTypingNote(['setsUpIds', 'threadLinks'])).toBeNull()
    expect(keptTypingNote([])).toBeNull()
  })
})
