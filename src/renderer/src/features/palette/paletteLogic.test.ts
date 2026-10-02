import { describe, expect, it } from 'vitest'
import type { SearchHit, SearchResults } from '@shared/contracts/search'
import { ENTRY_KINDS } from '@shared/fields'
import { SHORTCUTS } from '@/lib/shortcuts'
import {
  ACTIONS,
  ACTION_LIMIT,
  availableActions,
  entryAction,
  fold,
  goesAway,
  matchActions,
  paletteRows,
  remember,
  stepIndex,
  suggestedActions,
  type ActionContext,
  type Row
} from './paletteLogic'

const writing: ActionContext = { view: 'write', storyId: 's', sceneId: 'sc', sceneDone: false, drafting: false, theme: 'system' }
const labels = (q: string, c = writing): string[] => matchActions(q, c).map((a) => a.label)

const hit = (key: string, title = key): SearchHit => ({
  key,
  title: [{ text: title }],
  detail: '',
  snippet: [],
  prose: false,
  open: { kind: 'entry', entryId: key, entryKind: 'character', part: null, words: null }
})

/** A row as text: "# " before a heading, "+ " before "Show more", "~ " before a note. */
function rowText(r: Row): string {
  switch (r.type) {
    case 'heading':
      return `# ${r.label}`
    case 'action':
      return r.action.label
    case 'hit':
      return r.hit.title[0].text
    case 'more':
      return `+ ${r.label}`
    case 'note':
      return `~ ${r.text}`
  }
}

const show = (rows: Row[]): string[] => rows.map(rowText)

describe('the actions', () => {
  it('reach every screen and action the spec names', () => {
    const all = ACTIONS.map((a) => a.label)
    for (const label of [
      'New scene',
      'New chapter',
      'New story',
      'Mark scene done',
      'Generate a draft',
      'Quick start a character',
      'Codex',
      'Timeline',
      'Relationship map',
      'Plot threads board',
      'Style guide',
      'What changed',
      'Story settings',
      'Settings › Models',
      'Settings › Appearance',
      'Settings › Backups',
      'Settings › Recently deleted',
      'Light theme',
      'Dark theme',
      'Sepia theme',
      'Show or hide the binder',
      'Show or hide the scene panel',
      'Keyboard shortcuts'
    ])
      expect(all).toContain(label)
    // Each kind's list and a new entry of each kind.
    for (const kind of ENTRY_KINDS) {
      expect(ACTIONS.some((a) => a.id === `go-${kind}`)).toBe(true)
      expect(ACTIONS.some((a) => a.id === `new-${kind}`)).toBe(true)
    }
    expect(all).toContain('Characters')
    expect(all).toContain('New plot thread')
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length)
  })

  it('show their shortcuts from the one list', () => {
    const ids = new Set(SHORTCUTS.map((s) => s.id))
    for (const a of ACTIONS) if (a.shortcut) expect(ids.has(a.shortcut)).toBe(true)
    expect(ACTIONS.find((a) => a.id === 'generate')!.shortcut).toBe('generate')
    expect(ACTIONS.find((a) => a.id === 'mark-done')!.shortcut).toBe('markDone')
    expect(ACTIONS.find((a) => a.id === 'shortcuts')!.shortcut).toBe('shortcuts')
  })

  it('are in plain words', () => {
    for (const a of ACTIONS) expect(a.label).not.toMatch(/\b(entity|entities|generation|LLM|JSON|baseline|anchor|entry|entries)\b/i)
  })

  it('tell entry kind actions apart', () => {
    expect(entryAction('go-character')).toEqual({ verb: 'go', kind: 'character' })
    expect(entryAction('new-thread')).toEqual({ verb: 'new', kind: 'thread' })
    expect(entryAction('new-scene')).toBeNull()
    expect(entryAction('go-codex')).toBeNull()
  })

  it('fit the moment: only what can be done now', () => {
    const ids = (c: ActionContext): string[] => availableActions(c).map((a) => a.id)
    expect(ids(writing)).toContain('generate')
    expect(ids(writing)).not.toContain('stop')
    expect(ids({ ...writing, drafting: true })).toEqual(expect.arrayContaining(['stop']))
    expect(ids({ ...writing, drafting: true })).not.toContain('generate')
    expect(ids({ ...writing, sceneDone: true })).not.toContain('mark-done')
    expect(ids({ ...writing, sceneId: null })).not.toContain('mark-done')
    // A scene marked done can be reopened instead.
    expect(ids(writing)).not.toContain('reopen-scene')
    expect(ids({ ...writing, sceneDone: true })).toContain('reopen-scene')
    // Deleting only the scene on screen; marking done goes back to it from another page.
    expect(ids(writing)).toContain('delete-scene')
    expect(ids({ ...writing, view: 'codex' })).not.toContain('delete-scene')
    expect(ids({ ...writing, view: 'codex' })).toContain('mark-done')
    expect(ids(writing)).not.toContain('go-write')
    expect(ids({ ...writing, view: 'codex' })).toContain('go-write')
    expect(ids({ ...writing, theme: 'dark' })).not.toContain('theme-dark')
    expect(ids({ ...writing, storyId: null, sceneId: null })).not.toContain('new-scene')
  })

  it('know when they take Adam to another page, so focus goes there rather than back where it was', () => {
    const away = (id: string, c: ActionContext): boolean => goesAway(ACTIONS.find((a) => a.id === id)!, c)
    const codex: ActionContext = { ...writing, view: 'codex' }
    expect(away('go-codex', writing)).toBe(true)
    expect(away('toggle-binder', codex)).toBe(false)
    // Done on the writing page: from another page they go back to it, with the caret in the page.
    for (const id of ['generate', 'mark-done', 'reopen-scene', 'new-scene', 'new-chapter']) {
      expect(away(id, writing)).toBe(false)
      expect(away(id, codex)).toBe(true)
    }
    // Stopping a draft leaves Adam where he is.
    expect(away('stop', codex)).toBe(false)
  })
})

describe('finding actions by typing', () => {
  it('matches the start of each word, in any order, ignoring case and accents', () => {
    expect(labels('codex')).toEqual(['Codex'])
    expect(labels('new sc')[0]).toBe('New scene')
    expect(labels('SCENE NEW')).toContain('New scene')
    // The themes by name, then Settings › Appearance through its other words.
    expect(labels('thème')).toEqual(['Light theme', 'Dark theme', 'Sepia theme', 'Settings › Appearance'])
    expect(labels('xyz')).toEqual([])
    expect(labels('  ')).toEqual([])
  })

  it('puts names that start with what was typed first, then names with every word, then other words', () => {
    const chara = labels('chara')
    expect(chara.slice(0, 3)).toEqual(['Characters', 'New character', 'Quick start a character'])
    // "draft" is a word of "Generate a draft"; "write" only one of its other words.
    expect(labels('draft')[0]).toBe('Generate a draft')
    expect(labels('write').slice(0, 2)).toEqual(['Generate a draft', 'New scene'])
    // From another page, the way back comes before Generate (which would start a draft there and then).
    const settings = { ...writing, view: 'settings' }
    expect(labels('write', settings).slice(0, 2)).toEqual(['Back to writing', 'Generate a draft'])
    expect(labels('writing', settings)[0]).toBe('Back to writing')
    expect(labels('trash')).toEqual(['Delete this scene', 'Settings › Recently deleted'])
  })

  it('finds What changed first by "memory", as the top bar\'s "Memory updated" note calls it', () => {
    expect(labels('memory')[0]).toBe('What changed')
    expect(labels('memory updated')).toEqual(['What changed'])
    // Each kind's list isn't found by "memory" or "world".
    expect(labels('memory')).not.toContain('Characters')
    expect(labels('world')).toEqual([
      'New world',
      'Switch to another world',
      'Rename this world',
      'Ask the world',
      'Build the world from a summary',
      'Codex'
    ])
  })

  it('suggests the most useful actions when nothing is typed', () => {
    expect(suggestedActions(writing).map((a) => a.id)).toEqual([
      'generate',
      'mark-done',
      'new-scene',
      'go-codex',
      'new-character',
      'quick-character'
    ])
    expect(suggestedActions({ ...writing, drafting: true })[0].id).toBe('stop')
    expect(suggestedActions({ ...writing, storyId: null, sceneId: null }).map((a) => a.id)).toEqual([
      'go-codex',
      'new-character',
      'quick-character',
      'go-memory',
      'shortcuts'
    ])
  })

  it('folds like the search does', () => {
    expect(fold('Élodie')).toBe('elodie')
  })

  it('moves through the list: single steps wrap around, page steps stop at the ends', () => {
    expect(stepIndex(0, 1, 3)).toBe(1)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
    expect(stepIndex(-1, 1, 3)).toBe(0)
    expect(stepIndex(1, 8, 3)).toBe(2)
    expect(stepIndex(1, -8, 3)).toBe(0)
    expect(stepIndex(0, 1, 0)).toBe(-1)
  })
})

describe('the list', () => {
  const results: SearchResults = {
    query: 'ma',
    ms: 1,
    groups: [
      { id: 'character', label: 'Characters', total: 2, hits: [hit('Mara'), hit('Malik')] },
      { id: 'scenes', label: 'Scenes', total: 9, hits: [hit('s1', 'The ferry'), hit('s2', 'Storm')] },
      { id: 'notes', label: 'Notes', total: 60, hits: [hit('n1', 'Note')] }
    ]
  }

  it('lists recent places and suggestions with nothing typed', () => {
    const rows = paletteRows({
      query: ' ',
      actions: [],
      results: null,
      recent: [hit('Mara')],
      suggested: suggestedActions(writing).slice(0, 2),
      expanded: new Set()
    })
    expect(show(rows)).toEqual(['# Recent', 'Mara', '# Suggested', 'Generate a draft', 'Mark scene done'])
    expect(show(paletteRows({ query: '', actions: [], results: null, recent: [], suggested: [], expanded: new Set() }))).toEqual([])
  })

  it('lists matching actions first, then each group, with a way to show more', () => {
    const rows = paletteRows({
      query: 'ma',
      actions: matchActions('new', writing),
      results,
      recent: [],
      suggested: [],
      expanded: new Set()
    })
    expect(show(rows)).toEqual([
      '# Actions',
      ...matchActions('new', writing)
        .slice(0, ACTION_LIMIT)
        .map((a) => a.label),
      '+ Show more actions',
      '# Characters',
      'Mara',
      'Malik',
      '# Scenes',
      'The ferry',
      'Storm',
      '+ Show more scenes',
      '# Notes',
      'Note',
      '+ Show more notes'
    ])
    // Every row has its own key.
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it('shows every action, or says how many more there are, once a group is opened up', () => {
    const rows = paletteRows({
      query: 'ma',
      actions: matchActions('new', writing),
      results,
      recent: [],
      suggested: [],
      expanded: new Set(['actions', 'notes'])
    })
    expect(show(rows)).toContain('~ Showing 1 of 60. Add a word to narrow it down.')
    expect(show(rows)).not.toContain('+ Show more actions')
    expect(rows.filter((r) => r.type === 'action')).toHaveLength(matchActions('new', writing).length)
  })
})

describe('recent places', () => {
  it('keeps each place once, newest first, and only a few', () => {
    let list = remember([], { kind: 'scene', id: 'a' })
    list = remember(list, { kind: 'entry', id: 'b' })
    list = remember(list, { kind: 'scene', id: 'a' })
    expect(list).toEqual([
      { kind: 'scene', id: 'a' },
      { kind: 'entry', id: 'b' }
    ])
    for (let i = 0; i < 20; i++) list = remember(list, { kind: 'scene', id: `s${i}` })
    expect(list).toHaveLength(8)
    expect(list[0].id).toBe('s19')
  })
})
