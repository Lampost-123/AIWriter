import { describe, expect, it } from 'vitest'
import { beforeOf, dismissProfile, editedKeys, profileOf, reachButton, reachNote, reachStory, rebase } from './reachLogic'

const stories = [
  { id: 'b1', title: 'Book 1' },
  { id: 'b2', title: 'Book 2' },
  { id: 'b3', title: ' ' }
]

describe('edits that reach other stories', () => {
  it('are noticed only in a story other than where the entry first exists', () => {
    expect(reachStory(['b1'], 'b2', stories)).toEqual({ id: 'b2', title: 'Book 2' })
    expect(reachStory(['b1'], 'b1', stories)).toBeNull()
    // Several first-exists points: any of their stories is home.
    expect(reachStory(['b1', 'b2'], 'b2', stories)).toBeNull()
    // Not known yet, nothing open, or a story that's gone: nothing to say.
    expect(reachStory(null, 'b2', stories)).toBeNull()
    expect(reachStory([], 'b2', stories)).toBeNull()
    expect(reachStory(['b1'], null, stories)).toBeNull()
    expect(reachStory(['b1'], 'gone', stories)).toBeNull()
    expect(reachStory(['b1'], 'b3', stories)?.title).toBe('this story')
  })

  it('find what was edited since the page opened, ignoring spaces at the ends', () => {
    const before = profileOf({
      summary: 'Ferrywoman',
      description: '',
      fields: { eyes: 'blue', hair: 'dark' },
      fieldOrigins: { eyes: 'text' }
    })
    expect(editedKeys(before, { summary: 'Ferrywoman ', description: '', fields: { eyes: 'blue', hair: 'dark' } })).toEqual([])
    expect(editedKeys(before, { summary: 'Older now', description: '', fields: { eyes: 'green', hair: 'dark', scars: 'one' } })).toEqual([
      'summary',
      'eyes',
      'scars'
    ])
  })

  it('send only the edited values as they were, with who they came from', () => {
    const before = profileOf({ summary: 'Ferrywoman', description: 'Tall', fields: { eyes: 'blue' }, fieldOrigins: { eyes: 'text' } })
    expect(beforeOf(before, ['summary', 'eyes', 'scars'])).toEqual({
      summary: 'Ferrywoman',
      fields: { eyes: 'blue', scars: '' },
      origins: { summary: null, eyes: 'text', scars: null }
    })
  })

  it('never take someone else’s change, arriving while the page is open, for Adam’s edit', () => {
    const since = profileOf({ summary: 'Ferrywoman', description: '', fields: { eyes: 'blue', hair: 'dark' }, fieldOrigins: {} })
    // Adam changed her eyes; meanwhile the memory keeper filled in her hair.
    const mine = { summary: 'Ferrywoman', description: '', fields: { eyes: 'green', hair: 'dark' } }
    const theirs = {
      summary: 'Ferrywoman',
      description: '',
      fields: { eyes: 'green', hair: 'grey', scars: 'one' },
      fieldOrigins: { hair: 'text' as const }
    }
    const next = rebase(since, mine, theirs)
    expect(editedKeys(next, theirs)).toEqual(['eyes'])
    expect(next.fields).toEqual({ eyes: 'blue', hair: 'grey', scars: 'one' })
    expect(next.origins.hair).toBe('text')
  })

  it('once dismissed, take Adam’s edits as his, so keeping a later edit for one story puts back his words as his', () => {
    const opened = profileOf({
      summary: 'Ferrywoman',
      description: '',
      fields: { eyes: 'blue', hair: 'dark' },
      fieldOrigins: { eyes: 'text' }
    })
    // He changed her eyes, then dismissed the note before hearing back from the save.
    const now = { summary: 'Ferrywoman', description: '', fields: { eyes: 'green', hair: 'dark' } }
    const next = dismissProfile(opened, now, { eyes: 'text' })
    expect(editedKeys(next, now)).toEqual([])
    expect(next.origins).toEqual({ summary: null, description: null, eyes: 'adam', hair: null })
    // Later he changes them again and keeps that for Book 2 on: Book 1 has his green eyes, as his.
    expect(beforeOf(next, ['eyes'])).toEqual({ fields: { eyes: 'green' }, origins: { eyes: 'adam' } })
    // Saved meanwhile, his edit is his either way.
    expect(dismissProfile(opened, now, { eyes: 'adam' }).origins.eyes).toBe('adam')
  })

  it('say so in plain words', () => {
    expect(reachNote('Mara')).toBe('This changes Mara in every story')
    expect(reachButton('Book 2')).toBe('Only from Book 2 on')
  })
})
