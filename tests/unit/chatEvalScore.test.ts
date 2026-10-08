// The chat eval's Phase 1 scores (tests/chat-eval/score.ts), on made-up turns: the new tools by their fixed names, the
// preamble count, forced tool_choice, the real set's headline and the A/B table; Phase 2's answer-format metrics. No
// model, no app.
import { describe, expect, it } from 'vitest'
import type { TurnResult } from '../chat-eval/harness'
import { configFromEnv, effectiveSwitches, forcedChoice } from '../chat-eval/harness'
import type { Proposal } from '../../src/shared/contracts/ask'
import { askedUser, asExpected, compareMarkdown, formatOf, ideasTurn, repeatsChange, reportMarkdown, shapeOf, summarise, type RunMeta } from '../chat-eval/score'
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

  it('counts a question carried by propose_changes (one item of kind ask) as asking, not beside changes', () => {
    const args = (kinds: string[]): string => JSON.stringify({ changes: kinds.map((kind) => ({ kind, question: 'Which?' })) })
    const askItem = turn({ scenario: 'R07', expect: { do: 'propose', orAsk: true }, answer: 'Which?', toolCalls: [{ name: 'propose_changes', arguments: args(['ask']) }] })
    expect(askedUser(askItem)).toBe(true)
    expect(asExpected(askItem)).toBe(true)
    expect(askedUser(turn({ toolCalls: [{ name: 'propose_changes', arguments: args(['ask', 'edit']) }] }))).toBe(false)
    expect(summarise([askItem], true).tools.changes.items).toEqual({ ask: 1 })
  })

  it('records the switches in effect, defaults (on) included, and which were set', () => {
    const env = { AIWRITE_EXP_CHAT_ROUTE: 'off', AIWRITE_EXP_CHAT_TEMP: 'on', AIWRITE_EXP_OTHER: 'on', PATH: 'x' }
    const sw = effectiveSwitches(env)
    // Every chat switch (15 with Phase 3's TEXTTOOLS, STORYTOOLS, SCENE, CACHE and CAP), and the other one set.
    expect(Object.keys(sw)).toHaveLength(16)
    expect(sw).toMatchObject({
      AIWRITE_EXP_CHAT_CONTRACT: 'on',
      AIWRITE_EXP_CHAT_FORMAT: 'on',
      AIWRITE_EXP_CHAT_ACTFIRST: 'on',
      AIWRITE_EXP_CHAT_TEXTTOOLS: 'on',
      AIWRITE_EXP_CHAT_STORYTOOLS: 'on',
      AIWRITE_EXP_CHAT_ROUTE: 'off',
      AIWRITE_EXP_CHAT_TEMP: 'on',
      AIWRITE_EXP_OTHER: 'on'
    })
    const cfg = configFromEnv(env)
    expect(cfg.switches).toEqual(sw)
    expect(cfg.switchesSet).toEqual({ AIWRITE_EXP_CHAT_ROUTE: 'off', AIWRITE_EXP_CHAT_TEMP: 'on', AIWRITE_EXP_OTHER: 'on' })
    const m = { ...meta, switches: sw, switchesSet: cfg.switchesSet }
    const md = reportMarkdown(m, summarise([turn({})], true), [turn({})])
    expect(md).toContain('AIWRITE_EXP_CHAT_ROUTE=off')
    expect(md).toContain('Set for this run: ROUTE=off, TEMP=on, AIWRITE_EXP_OTHER=on.')
    const r = { name: 'defaults', meta: { ...meta, switches: effectiveSwitches({}), switchesSet: {} }, turns: [turn({})], summary: summarise([turn({})], true) }
    expect(compareMarkdown([r])).toMatch(
      /switches: CONTRACT=on, ROUTE=on, .*DRAFT=on, FORMAT=on, ACTFIRST=on, TEXTTOOLS=on, STORYTOOLS=on, SCENE=on, CACHE=on, CAP=on \(set: none, the defaults\)/
    )
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

describe('chat eval scores (Phase 2: the answer format)', () => {
  const IDEAS = 'Three ways to open.\n::options\n- **Bell**: loud\n- **Fish**: cold\n- **Row**: sharp\n::\n::next\n- One\n- Two\n- Three\n- Four\n::'
  const edit = (replace: string): Proposal => ({ id: '1', status: 'pending', why: 'x', kind: 'text', sceneId: 's', sceneLabel: 'Ch 1, Sc 1', find: 'old words', replace })

  it('reads an answer as blocks: markers, lead, words outside blocks, options and follow-ups', () => {
    const f = formatOf(turn({ answer: IDEAS, question: 'Ideas for the opening?', expect: { do: 'no-propose' } }))
    expect(f).toEqual({ marked: true, balanced: true, leadFirst: true, leadWords: 4, wordsOutsideBlocks: 4, options: 3, next: 4 })
    expect(formatOf(turn({ answer: 'Ideas.\n::options\n- **A**: x' })).balanced).toBe(false)
    // No markers: the fallback, with the ideas turn's list made cards.
    const old = formatOf(turn({ answer: 'Three.\n1. One idea here\n2. Two\n3. Three', question: 'Any ideas?', expect: { do: 'no-propose' } }))
    expect(old).toMatchObject({ marked: false, balanced: true, leadFirst: true, options: 3 })
  })

  it('tells ideas turns: brainstorm intent or wording, never one that should propose', () => {
    expect(ideasTurn(turn({ intent: 'brainstorm', question: 'hmm', expect: { do: 'no-propose' } }))).toBe(true)
    expect(ideasTurn(turn({ question: 'Give me some names for the inn', expect: { do: 'no-propose' } }))).toBe(true)
    expect(ideasTurn(turn({ question: 'Ideas? Then fix it.', expect: { do: 'propose' } }))).toBe(false)
  })

  it('sees an edit answer that repeats its change in words', () => {
    const replace = 'The tide came in slow over the grey flats at dawn.'
    expect(repeatsChange(turn({ answer: `1 change ready: "${replace}"`, proposals: [edit(replace)] }))).toBe(true)
    expect(repeatsChange(turn({ answer: '1 change ready.', proposals: [edit(replace)] }))).toBe(false)
    expect(repeatsChange(turn({ answer: 'Changed to: the grey flats at dawn.', proposals: [edit('The grey flats at dawn.')] }))).toBe(true)
    expect(repeatsChange(turn({ answer: 'Done: dawn.', proposals: [edit('dawn')] }))).toBe(false)
  })

  it('sums the shape metrics and shows them in the report and the A/B', () => {
    const turns = [
      turn({ scenario: 'Q1', group: 'question', answer: IDEAS, question: 'Ideas for the opening?', expect: { do: 'no-propose' }, intent: 'brainstorm' }),
      turn({ scenario: 'E1', group: 'edit', answer: '1 change ready: "The tide came in slow over the grey flats at dawn."', proposals: [edit('The tide came in slow over the grey flats at dawn.')] })
    ]
    const s = summarise(turns, false)
    expect(s.format).toMatchObject({ answers: 2, marked: 1, balanced: 1, leadFirst: 2, leadShort: 2, over60: 0, ideas: { answers: 1, withOptions: 1, inRange: 1 }, next: { answers: 1, overMax: 1 }, editRepeats: { turns: 1, of: 1 } })
    const md = reportMarkdown(meta, s, turns)
    expect(md).toMatch(/\| Answer format \(blocks\) \| blocks in 1 of 2 answers \(markers balanced 1 of 1\)/)
    expect(md).toMatch(/\| Ideas answers: option cards \| 1 of 1 with cards \(3\.0 on average\); 3 to 5 cards 1 \|/)
    expect(md).toMatch(/\| ::next follow-ups \| in 1 answers; more than 3 in 1 \|/)
    expect(md).toMatch(/\| Edit answers repeating the change in words \| 1 of 1 \|/)
    const ab = compareMarkdown([{ name: 'on', meta, summary: s, turns }, { name: 'off', meta, summary: s, turns }])
    expect(ab).toMatch(/\| Answers in blocks \(markers balanced\) \| 1 of 2 \(50%\) \(1\) \|/)
    expect(ab).toMatch(/\| Edit answers repeating the change \| 1 of 1 \| 1 of 1 \|/)
  })
})
