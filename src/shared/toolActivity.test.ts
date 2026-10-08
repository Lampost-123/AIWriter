// The tool calls' records, read back: as made since chat Phase 2b, and an older record that kept only a label, the
// tool, its arguments and its result.
import { describe, expect, it } from 'vitest'
import { activityOf, argSummary, changesSummary, counted, shortReason, toolKind } from './toolActivity'

describe('tool calls as records', () => {
  it('tells a tool’s kind from its name', () => {
    expect(['read_scene', 'outline', 'search', 'get_entry', 'style_guide', 'scene_issues', 'propose_rename', 'propose_changes', 'propose_draft', 'ask_user', 'other'].map(toolKind)).toEqual([
      'read',
      'outline',
      'search',
      'entry',
      'style',
      'issues',
      'propose',
      'propose',
      'draft',
      'ask',
      'other'
    ])
  })

  it('says what a call was for from its arguments', () => {
    expect(argSummary('read_scene', { scene: 'Ch 1, Sc 2' })).toBe('Ch 1, Sc 2')
    expect(argSummary('read_scene', {})).toBe('the open scene')
    expect(argSummary('search', { query: '  lamp   oil ' })).toBe('“lamp oil”')
    expect(argSummary('get_entry', { name: 'Wren' })).toBe('Wren')
    expect(argSummary('ask_user', { question: 'Which one?' })).toBe('Which one?')
    expect(argSummary('outline', {})).toBe('')
    expect(argSummary('propose_changes', { changes: [{ kind: 'edit' }, { kind: 'card' }, { kind: 'Edit' }, { kind: 'poem' }] })).toBe('2 edits, 1 card change, 1 change')
  })

  it('counts and words things plainly', () => {
    expect(counted(1, 'hit')).toBe('1 hit')
    expect(counted(1240, 'word')).toBe('1,240 words')
    expect(changesSummary([{ kind: 'new_entry' }, { kind: 'new_entry' }])).toBe('2 new entries')
    expect(changesSummary('nope')).toBe('')
    expect(shortReason('Those words aren’t in the scene. Copy them exactly.')).toBe('those words aren’t in the scene')
  })

  it('reads a record made since Phase 2b as it was kept', () => {
    const kept = {
      label: 'Reading Ch 1, Sc 1',
      tool: 'read_scene',
      arguments: '{}',
      result: 'x',
      id: 't3',
      kind: 'read' as const,
      summary: 'Ch 1, Sc 1',
      status: 'done' as const,
      outcome: '12 words',
      startedAt: 1,
      endedAt: 5,
      step: 2
    }
    expect(activityOf(kept, 0)).toEqual(kept)
  })

  it('works out an older record’s calls from their labels and arguments', () => {
    expect(activityOf({ label: 'Searching for “oil”', tool: 'search', arguments: '{"query":"oil"}', result: 'x' }, 1)).toEqual({
      label: 'Searching for “oil”',
      tool: 'search',
      arguments: '{"query":"oil"}',
      result: 'x',
      id: 's2',
      kind: 'search',
      summary: '“oil”',
      status: 'done',
      outcome: '',
      startedAt: null,
      endedAt: null,
      step: null
    })
    expect(activityOf({ label: 'A change that didn’t fit', tool: 'propose_edit', arguments: '{', result: '' }, 0)).toMatchObject({ status: 'not-proposed', kind: 'propose' })
    expect(activityOf({ label: 'Looking something up', tool: 'get_entry', arguments: '{}', result: '' }, 0)).toMatchObject({ status: 'failed' })
    expect(activityOf({ label: 'Asking you a question', tool: 'propose_changes', arguments: '{}', result: '' }, 0)).toMatchObject({ kind: 'ask', status: 'done' })
  })
})
