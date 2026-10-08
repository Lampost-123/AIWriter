// Invented text only.
import { describe, expect, it } from 'vitest'
import type { AgentRequest, GenerationRecord } from '@shared/types'
import { laterMessageLabel, messageText, requestNote, requestsOf, requestTitle, toolOfResult } from './requestSteps'

const ROLES = { system: 'Instructions and briefing', user: 'Question', assistant: 'Earlier answer', tool: 'Looked up' } as const
const params = (requests?: unknown): GenerationRecord['params'] =>
  ({ temperature: 0.8, top_p: 0.95, max_tokens: 1500, ...(requests !== undefined ? { requests } : {}) }) as GenerationRecord['params']

const first: AgentRequest = { n: 1, added: [], tools: true, promptTokens: 1200, completionTokens: 20 }
const second: AgentRequest = {
  n: 2,
  after: ['read_scene', 'read_scene', 'search'],
  tools: true,
  toolChoice: 'propose_changes',
  removed: 1,
  added: [
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_scene', arguments: '{"n":2}' }] },
    { role: 'tool', toolCallId: 'c1', content: 'The ferry left at dusk.' }
  ]
}

describe('What the AI saw: each request of an answer (E18)', () => {
  it('shows steps only for a record with more than one request; an older record shows none', () => {
    expect(requestsOf(params())).toEqual([])
    expect(requestsOf(params([first]))).toEqual([])
    expect(requestsOf(params('nonsense'))).toEqual([])
    expect(requestsOf(params([first, second]))).toHaveLength(2)
  })

  it('names each request for what it brought', () => {
    expect(requestTitle(first)).toBe('Request 1 · briefing + question')
    expect(requestTitle(second)).toBe('Request 2 · after read_scene ×2, search')
    expect(requestTitle({ n: 3, added: [], tools: false })).toBe('Request 3 · after a note sent back')
  })

  it('says how each was asked and what was counted', () => {
    expect(requestNote(first)).toBe('Tools offered · 1,200 tokens sent · 20 written')
    expect(requestNote(second)).toBe('Made to call propose_changes · 1 earlier result taken out to save room')
    expect(requestNote({ n: 3, added: [], tools: false })).toBe('No tools: asked for its answer')
  })

  it('labels a later request’s messages, and finds the tool each result answers', () => {
    expect(laterMessageLabel(second.added[0], ROLES)).toBe('Asked for tools')
    expect(laterMessageLabel({ role: 'assistant', content: 'Done.' }, ROLES)).toBe('Answer sent back')
    expect(laterMessageLabel({ role: 'user', content: 'Answer now.' }, ROLES)).toBe('Note from AI Write')
    expect(laterMessageLabel(second.added[1], ROLES)).toBe('Looked up')
    expect(messageText(second.added[0])).toBe('→ read_scene {"n":2}')
    expect(toolOfResult(second.added[1], second.added)).toBe('read_scene')
    expect(toolOfResult(second.added[0], second.added)).toBeNull()
  })
})
