import { describe, expect, it } from 'vitest'
import type { MemoryTag } from '@shared/types'
import { blockTagNote, recordTagNote, tagBadges, tagLabel, tagsInOrder } from './memoryTagsView'

const tag = (o: Partial<MemoryTag>): MemoryTag => ({ label: 'Kell', entryId: 'e1', origin: 'text', health: 'ok', ...o })

describe('origin tags in What the AI saw', () => {
  it('names what each line is about', () => {
    expect(tagLabel(tag({}))).toBe('Kell')
    expect(tagLabel(tag({ field: 'hair', fieldLabel: 'Hair' }))).toBe('Kell: Hair')
    expect(tagLabel(tag({ entryId: undefined, sceneId: 's1', label: 'Book 1, Ch 1, Sc 2' }))).toBe('Book 1, Ch 1, Sc 2')
  })

  it('says where it came from and how it stands, in plain words', () => {
    expect(tagBadges(tag({}))).toEqual([{ text: 'From your story', tone: 'plain' }])
    expect(tagBadges(tag({ origin: 'yours' }))).toEqual([{ text: 'Yours', tone: 'plain' }])
    expect(tagBadges(tag({ origin: 'guess', field: 'hair' }))).toEqual([{ text: 'Guess', tone: 'ai' }])
    expect(tagBadges(tag({ field: 'summary', health: 'changed' }))).toEqual([
      { text: 'From your story', tone: 'plain' },
      { text: 'Words edited since', tone: 'ai' }
    ])
    expect(tagBadges(tag({ sceneId: 's1', entryId: undefined, health: 'updating' }))).toEqual([
      { text: 'From your story', tone: 'plain' },
      { text: 'Being updated', tone: 'ai' }
    ])
  })

  it('sums up a part in a few words, only when something in it is a guess or out of date', () => {
    expect(blockTagNote([tag({})])).toBeNull()
    expect(blockTagNote(undefined)).toBeNull()
    expect(blockTagNote([tag({}), tag({ origin: 'guess', field: 'hair' }), tag({ field: 'summary', health: 'changed' })])).toBe(
      '1 guess, 1 edited since'
    )
    expect(blockTagNote([tag({ sceneId: 's1', health: 'updating' }), tag({ sceneId: 's2', health: 'updating' })])).toBe('2 being updated')
  })

  it('sums up the whole record for the notice at the top', () => {
    expect(recordTagNote({ lines: 5, stale: 0, guesses: 0, yours: 2 })).toBeNull()
    expect(recordTagNote({ lines: 5, stale: 1, guesses: 2, yours: 0 })).toBe(
      'The AI was given 2 guesses and 1 fact that was out of date or being updated. They’re marked below.'
    )
    expect(recordTagNote({ lines: 5, stale: 0, guesses: 1, yours: 0 })).toBe('The AI was given 1 guess. It’s marked below.')
  })

  it('lists guesses and out-of-date lines first', () => {
    const ok = tag({ label: 'Anna' })
    const guess = tag({ label: 'Kell', origin: 'guess', field: 'hair' })
    const stale = tag({ label: 'Mara', field: 'summary', health: 'changed' })
    expect(tagsInOrder([ok, guess, stale]).map((t) => t.label)).toEqual(['Kell', 'Mara', 'Anna'])
  })
})
