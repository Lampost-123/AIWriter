// The chat eval's Phase 1 scores (tests/chat-eval/score.ts), on made-up turns: the new tools by their fixed names, the
// preamble count, forced tool_choice, the real set's headline and the A/B table. No model, no app.
import { describe, expect, it } from 'vitest'
import type { TurnResult } from '../chat-eval/harness'
import { forcedChoice } from '../chat-eval/harness'
import { asExpected, compareMarkdown, shapeOf, summarise, type RunMeta } from '../chat-eval/score'
import { pickScenarios, SCENARIOS } from '../chat-eval/scenarios'
import { C_ENTRIES, C_OPEN, winterParagraphs } from '../chat-eval/bigWorld'

const turn = (o: Partial<TurnResult>): TurnResult => ({
  scenario: 'R01',
  group: 'r-vague',
  turn: 1,
  question: 'this drags',
  expect: { do: 'propose', kinds: ['text', 'passage'] },
  status: 'complete',
  error: null,
  answer: 'Done.',
  proposals: [],
  checks: [],
  steps: [],
  requests: 1,
  nudged: false,
  toolResults: [],
  system: '',
  promptTokens: 100,
  cachedTokens: 0,
  completionTokens: 10,
  cost: null,
  wallMs: 1,
  toolCalls: [],
  forced: [],
  intent: null,
  ...o
})

const meta: RunMeta = { backend: 'fake', model: 'fake/chat', provider: 'fake', commit: 'abc', branch: 'b', dirty: false, appVersion: '0', root: '.', at: 'now', label: '', switches: {}, note: '' }

describe('chat eval scores (Phase 1)', () => {
  it('counts the new tools by name, and ask_user as asking', () => {
    const changes = turn({
      toolCalls: [{ name: 'propose_changes', arguments: JSON.stringify({ items: [{ kind: 'edit' }, { kind: 'rewrite' }, { kind: 'new_entry' }] }) }]
    })
    const askUser = turn({ scenario: 'R07', expect: { do: 'propose', orAsk: true }, toolCalls: [{ name: 'ask_user', arguments: '{"question":"Which?"}' }] })
    const draft = turn({ scenario: 'R19', group: 'r-continue', expect: { do: 'propose', draft: true }, toolCalls: [{ name: 'propose_draft', arguments: '{}' }] })
    const s = summarise([changes, askUser, draft], true)
    expect(s.tools.changes).toEqual({ calls: 1, turns: 1, items: { edit: 1, rewrite: 1, new_entry: 1 } })
    expect(s.tools.askUser.calls).toBe(1)
    expect(s.tools.draft.turns).toBe(1)
    expect(asExpected(askUser)).toBe(true)
    expect(asExpected(draft)).toBe(true)
    // A draft hand-off isn't a proposal where the scenario wants an edit.
    expect(asExpected(turn({ toolCalls: [{ name: 'propose_draft', arguments: '{}' }] }))).toBe(false)
    expect(s.real).toMatchObject({ proposeTurns: 3, valid: 1, askedInstead: 1 })
  })

  it('reads forced tool_choice and the preamble', () => {
    expect(forcedChoice('auto')).toBeNull()
    expect(forcedChoice(undefined)).toBeNull()
    expect(forcedChoice('required')).toBe('required')
    expect(forcedChoice({ type: 'function', function: { name: 'propose_changes' } })).toBe('propose_changes')
    expect(shapeOf('I’ll read the scene first.').preamble).toBe(true)
    expect(shapeOf('Let me check the current text.').preamble).toBe(true)
    expect(shapeOf('I proposed one fix.').preamble).toBe(false)
    expect(shapeOf('Two fixes:\n- one two\n- three\nDone now.').wordsOutsideLists).toBe(4)
    const s = summarise([turn({ forced: ['required', 'propose_changes'] }), turn({ forced: [] })], true)
    expect(s.forced).toMatchObject({ known: true, requests: 2, turns: 1 })
  })

  it('puts reports side by side, old ones (without the new fields) too', () => {
    const old = turn({ scenario: 'E01', group: 'edit' })
    delete old.toolCalls
    delete old.forced
    const a = { name: 'off', meta, turns: [old], summary: summarise([old], true) }
    const b = { name: 'on', meta, turns: [turn({ scenario: 'E01', group: 'edit' })], summary: summarise([turn({ scenario: 'E01', group: 'edit' })], true) }
    const md = compareMarkdown([a, b])
    expect(md).toContain('| Measure | off | on |')
    expect(md).toContain('| propose_changes calls (turns) | – | 0 (0) |')
  })

  it('has the core 40 and the real set, and a big world past read_scene’s cut', () => {
    expect(pickScenarios(null)).toHaveLength(40)
    expect(pickScenarios(['REAL']).length).toBeGreaterThanOrEqual(20)
    expect(pickScenarios(['ALL'])).toHaveLength(SCENARIOS.length)
    expect(pickScenarios(['E01', 'R05']).map((s) => s.id)).toEqual(['E01', 'R05'])
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length)
    for (const s of pickScenarios(['REAL'])) if (s.history) expect(s.history.length).toBeGreaterThanOrEqual(8)
    expect(C_ENTRIES.length).toBeGreaterThan(500)
    expect(winterParagraphs().join('\n\n').length).toBeGreaterThan(24_000)
    expect(C_OPEN.paragraphs.join('\n\n').indexOf('Ilse walked home along the harbour wall')).toBeGreaterThan(24_000)
  })
})
