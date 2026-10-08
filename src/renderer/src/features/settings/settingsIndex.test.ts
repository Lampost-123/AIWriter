import { describe, expect, it } from 'vitest'
import { SETTINGS_PAGES, findSettings, groupOf } from './settingsIndex'

describe('Settings in the New look', () => {
  it('has every page once, each in a group', () => {
    const ids = SETTINGS_PAGES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(['about', 'appearance', 'backups', 'editor', 'models', 'preferences', 'speech', 'trash', 'usage'])
    for (const id of ids) expect(groupOf(id)).not.toBe('')
  })

  it('finds a page by its name first, then by what is on it, every word typed', () => {
    expect(findSettings('backups')[0]).toMatchObject({ page: { id: 'backups' }, hit: null })
    expect(findSettings('typewriter')).toEqual([expect.objectContaining({ page: expect.objectContaining({ id: 'editor' }), hit: 'Typewriter scrolling' })])
    expect(findSettings('text size')[0]).toMatchObject({ page: { id: 'appearance' }, hit: 'Text size' })
    expect(findSettings('WHAT’S NEW')[0]).toMatchObject({ page: { id: 'about' } })
    expect(findSettings('  ')).toEqual([])
    expect(findSettings('zzzz')).toEqual([])
    // A word must start a word: "ark" doesn't find "Dark".
    expect(findSettings('ark')).toEqual([])
  })
})
