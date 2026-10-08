// The tool activity's words (chat Phase 2b): each call as a verb phrase while it runs and once it has, how it went and
// how long it took, the folded line, and what a screen reader hears. Invented names only.
import { describe, expect, it } from 'vitest'
import type { ToolActivity } from '@shared/toolActivity'
import { callTime, failureWords, kindsOf, prettyArgs, rankedLead, rowLabel, runningPhrase, toolPhrase, toolsSummary } from './toolView'

const call = (over: Partial<ToolActivity>): ToolActivity => ({
  id: 't1',
  tool: 'read_scene',
  kind: 'read',
  label: '',
  summary: '',
  status: 'done',
  outcome: '',
  startedAt: 1000,
  endedAt: 1400,
  step: 1,
  arguments: '{}',
  result: '',
  ...over
})

describe('a tool call’s words', () => {
  it('says what each kind of call did', () => {
    expect(toolPhrase(call({ summary: 'Ch 1, Sc 2 “The Ford”' }))).toBe('Read Ch 1, Sc 2 “The Ford”')
    expect(toolPhrase(call({ kind: 'search', tool: 'search', summary: '“lamp oil”' }))).toBe('Searched “lamp oil”')
    expect(toolPhrase(call({ kind: 'entry', tool: 'get_entry', summary: 'Wren Halloway' }))).toBe('Looked up Wren Halloway')
    expect(toolPhrase(call({ kind: 'propose', tool: 'propose_changes', summary: '2 edits, 1 card change' }))).toBe('Proposed 2 edits, 1 card change')
    expect(toolPhrase(call({ kind: 'ask', tool: 'ask_user' }))).toBe('Asked you a question')
    expect(toolPhrase(call({ kind: 'outline', tool: 'outline' }))).toBe('Opened the outline')
    expect(toolPhrase(call({ kind: 'style', tool: 'style_guide' }))).toBe('Checked the style guide')
    expect(toolPhrase(call({ kind: 'issues', tool: 'scene_issues' }))).toBe('Listed open issues')
    expect(toolPhrase(call({ kind: 'draft', tool: 'propose_draft' }))).toBe('Proposed a draft')
  })

  it('says what find_mentions found (TEXTTOOLS)', () => {
    const find = (over: Partial<ToolActivity>): ToolActivity => call({ kind: 'mentions', tool: 'find_mentions', summary: '“oil lamp”', ...over })
    expect(toolPhrase(find({ outcome: '7 times in 3 scenes' }))).toBe('Found “oil lamp” 7 times in 3 scenes')
    expect(toolPhrase(find({ outcome: 'not found' }))).toBe('Looked for “oil lamp”')
    expect(toolPhrase(find({ status: 'running' }))).toBe('Finding “oil lamp”')
    expect(toolPhrase(find({ status: 'failed' }))).toBe('Tried to find “oil lamp”')
  })

  it('says what a call is doing while it runs, and what one that went wrong tried', () => {
    expect(runningPhrase(call({ status: 'running', summary: '' }))).toBe('Reading the scene')
    expect(toolPhrase(call({ kind: 'propose', tool: 'propose_changes', status: 'running' }))).toBe('Proposing changes')
    expect(toolPhrase(call({ kind: 'entry', tool: 'get_entry', summary: 'Nobody', status: 'failed' }))).toBe('Tried to look up Nobody')
    expect(toolPhrase(call({ kind: 'propose', tool: 'propose_changes', summary: '1 edit', status: 'not-proposed' }))).toBe('Tried to propose 1 edit')
  })

  it('says how long a call took, short', () => {
    expect(callTime(40)).toBe('0.1s')
    expect(callTime(420)).toBe('0.4s')
    expect(callTime(2350)).toBe('2.4s')
    expect(callTime(12_400)).toBe('12s')
  })

  it('folds an answer’s calls to one line, with what didn’t work and how long it all took', () => {
    expect(toolsSummary([call({}), call({}), call({})], 4200)).toBe('3 tool calls · 4s')
    expect(toolsSummary([call({}), call({ status: 'failed' })], 2000)).toBe('2 tool calls, 1 didn’t work · 2s')
    // An old chat: no answer time, the calls' own when known, none when not.
    expect(toolsSummary([call({})], null)).toBe('1 tool call · 0.4s')
    expect(toolsSummary([call({ startedAt: null, endedAt: null })], null)).toBe('1 tool call')
    expect(toolsSummary([], 3000)).toBe('From the memory · 3s')
    expect(toolsSummary([], null)).toBeNull()
  })

  it('names each kind once for the folded line’s icons', () => {
    expect(kindsOf([call({}), call({ kind: 'search' }), call({}), call({ kind: 'propose' })])).toEqual(['read', 'search', 'propose'])
  })

  it('lays the arguments out to read', () => {
    expect(prettyArgs('{"query":"lamp"}')).toBe('{\n  "query": "lamp"\n}')
    expect(prettyArgs('{}')).toBe('(none)')
    expect(prettyArgs('{broken')).toBe('{broken')
  })

  it('tells a screen reader the whole row, and a call that went wrong', () => {
    expect(rowLabel(call({ summary: 'Ch 1, Sc 1', outcome: '120 words' }), false)).toBe('Read Ch 1, Sc 1, done (120 words), 0.4s. Show details')
    expect(rowLabel(call({ status: 'running', endedAt: null }), true)).toBe('Reading the scene, running. Hide details')
    expect(failureWords([call({})])).toBe('')
    expect(failureWords([call({}), call({ kind: 'entry', summary: 'Nobody', status: 'failed', outcome: 'no such entry' })])).toBe(
      'Tried to look up Nobody: failed, no such entry'
    )
  })

  it('numbers ideas only when the lead says they are in an order', () => {
    expect(rankedLead('Three ways winter could break them, worst first.')).toBe(true)
    expect(rankedLead('Here are three ideas, in order of how likely they are.')).toBe(true)
    expect(rankedLead('Three ways winter could break them.')).toBe(false)
  })
})
