// Each draft's one note (the calm overhaul): what the draft, check and repair, the live checks and the check after it
// say goes into the same message, changed in place; a note that went is shown again only with news; landings that aren't
// a Generate draft keep their own messages. The toasts are stood in for.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const shown = vi.hoisted(() => ({ items: [] as { id: number; message: string; action?: { label: string }; secondary?: { label: string } }[], seq: 0 }))

vi.mock('@/components/ui', () => ({
  toast: (message: string, o: { action?: { label: string }; secondary?: { label: string } } = {}) => {
    const id = ++shown.seq
    shown.items.push({ id, message, action: o.action, secondary: o.secondary })
    return id
  },
  useToasts: {
    getState: () => ({
      items: shown.items,
      update: (id: number, patch: { message: string; action?: { label: string }; secondary?: { label: string } }) => {
        const t = shown.items.find((i) => i.id === id)
        if (t) Object.assign(t, patch)
      }
    })
  }
}))

const { beginDraftNote, draftNoteRecord, noteDraftCheck, noteDraftEnd, noteDraftPhrases, noteDraftRepair, noteDraftStart, resetDraftNotes } = await import('./draftNote')

const run = (): void => undefined
const repair = (mended: number, questions: number) => ({ mended, why: null, questions, undo: run, show: run })

describe('one note per draft', () => {
  beforeEach(() => {
    shown.items.length = 0
    resetDraftNotes()
  })

  it('says nothing for a draft written here with nothing found', () => {
    beginDraftNote('s1', null)
    draftNoteRecord('s1', 'g1')
    noteDraftEnd('s1', { kind: 'written' }, { away: null, handlers: {} })
    expect(shown.items).toEqual([])
  })

  it('gathers check and repair, the phrases and the check after it into the one message', () => {
    beginDraftNote('s1', 'g1')
    noteDraftEnd('s1', { kind: 'written' }, { away: null, handlers: {} })
    expect(noteDraftRepair('s1', 'g1', repair(2, 1))).toBe(true)
    expect(noteDraftPhrases('s1', { phrase: 0, ai: 1 }, run)).toBe(true)
    noteDraftCheck('s1', 2)
    expect(shown.items).toHaveLength(1)
    expect(shown.items[0].message).toBe(
      '2 small slips fixed in amber · 1 question in Issues · 2 more things to look at · 1 common AI phrase underlined'
    )
    expect(shown.items[0].action?.label).toBe('Undo')
    expect(shown.items[0].secondary?.label).toBe('Show')
  })

  it('leaves other landings to say it their own way', () => {
    beginDraftNote('s1', 'g1')
    noteDraftEnd('s1', { kind: 'written' }, { away: null, handlers: {} })
    // Continue's words, or a rewrite accepted: not the draft's record.
    expect(noteDraftRepair('s1', 'edit-1', repair(1, 0))).toBe(false)
    expect(noteDraftRepair('s2', 'g1', repair(1, 0))).toBe(false)
    expect(shown.items).toEqual([])
  })

  it('shows a note that went again only with news, and then only the news', () => {
    beginDraftNote('s1', 'g1')
    noteDraftEnd('s1', { kind: 'written' }, { away: null, handlers: {} })
    noteDraftRepair('s1', 'g1', repair(1, 0))
    expect(shown.items.map((t) => t.message)).toEqual(['1 small slip fixed in amber'])
    // The note goes (its time is up).
    shown.items.length = 0
    noteDraftCheck('s1', 1)
    expect(shown.items.map((t) => t.message)).toEqual(['1 thing to look at in Issues'])
  })

  it('says how the draft was briefed as it starts, in the same note it ends with', () => {
    beginDraftNote('s1', 'g1')
    noteDraftStart('s1', 'Written without where things stood as the scene before ended, so check the opening follows on.')
    expect(shown.items).toHaveLength(1)
    noteDraftEnd('s1', { kind: 'written' }, { away: null, handlers: {} })
    expect(shown.items).toHaveLength(1)
    expect(shown.items[0].message).toBe('Written without where things stood as the scene before ended, so check the opening follows on.')
  })

  it('offers to try a refused draft again with another model', () => {
    beginDraftNote('s1', 'g1')
    noteDraftEnd(
      's1',
      { kind: 'refused', message: 'This model turned the request down. Try another model.' },
      { away: null, retryWith: 'Fake writer', handlers: { retry: { label: 'Try with Fake writer', run }, settings: { label: 'Open Settings', run } } }
    )
    expect(shown.items).toHaveLength(1)
    expect(shown.items[0].action?.label).toBe('Try with Fake writer')
    expect(shown.items[0].secondary?.label).toBe('Open Settings')
  })

  it('says what the check after a draft found on its own when there is no draft’s note', () => {
    noteDraftCheck('s9', 2)
    expect(shown.items.map((t) => t.message)).toEqual(['The check after the draft found 2 things to look at.'])
  })
})
