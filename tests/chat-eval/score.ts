// The chat eval's scores, from the turns the harness ran (harness.ts). Pure, so it can be re-run on a saved report.
//
// Headline: of the edit, selection and large-rewrite scenarios (26), the share whose FIRST ask came back with a
// proposal of the right kind. Then: proposals the page can apply (its own matcher, findTextRange), on the paragraph
// meant; "Not proposed" tool results; nudges (PROPOSE_NOW sent back); false proposals on questions and brainstorms;
// ambiguous asks answered with a question and no proposal; follow-ups that propose on "option 2" / "yes"; requests,
// tokens and time per turn; story-point leaks; and the answer's shape.
//
// Phase 1 adds (old reports re-score with them as unknown where the turn lacks the data):
//   - the new tools by their fixed names: propose_changes (its items by kind: edit, rewrite, card, entry, new_entry,
//     new_scene, new_chapter, rename), ask_user (counts as asking the writer; it ends the turn), propose_draft (a
//     hand-off that counts as a proposal where the scenario allows one: "write the next bit", the core large group);
//   - the real set's headline: of its turns that should propose, how many did (or asked one question, where allowed);
//   - answers that open with a preamble ("I'll read the scene first…"), words outside lists;
//   - requests that forced a tool (tool_choice), the intent the app recorded on the turn, and the briefing's size.
// compareMarkdown puts several reports side by side (the A/B of the AIWRITE_EXP_CHAT_* switches).

import { CANARIES } from './world'
import type { TurnResult } from './harness'

/** The new tools' fixed names. */
export const TOOLS = { changes: 'propose_changes', ask: 'ask_user', draft: 'propose_draft' } as const

const calls = (t: TurnResult, name: string): { name: string; arguments: string }[] => (t.toolCalls ?? []).filter((c) => c.name === name)

/** The model asked the writer through ask_user. */
export const askedUser = (t: TurnResult): boolean => calls(t, TOOLS.ask).length > 0

/** The model handed over a draft (propose_draft, or a proposal of kind 'draft' if the app keeps one). */
export const drafted = (t: TurnResult): boolean => calls(t, TOOLS.draft).length > 0 || t.proposals.some((p) => (p.kind as string) === 'draft')

/** The turn asked the writer a question and proposed nothing (ask_user, or a question in the answer). */
export const asked = (t: TurnResult): boolean => t.proposals.length === 0 && !drafted(t) && (askedUser(t) || shapeOf(t.answer).questions >= 1)

/** Whether a draft hand-off counts as the proposal at this turn: "write the next bit" scenarios and the core large group. */
const draftCounts = (t: TurnResult): boolean => t.expect.do === 'propose' && (!!t.expect.draft || t.group === 'large')

/** The kinds of the items in a propose_changes call (edit, rewrite, card, …). */
export function changeItemKinds(args: string): string[] {
  try {
    const a = JSON.parse(args) as Record<string, unknown>
    const list = (Array.isArray(a.items) ? a.items : Array.isArray(a.changes) ? a.changes : Object.values(a).find(Array.isArray)) as { kind?: unknown }[] | undefined
    return (list ?? []).map((i) => (typeof i?.kind === 'string' ? i.kind : '?'))
  } catch {
    return ['(unreadable)']
  }
}

export interface Leak {
  scenario: string
  turn: number
  /** otherStory, hidden or later. */
  kind: keyof typeof CANARIES
  /** answer: in the words the writer saw; tool: in a tool result the model was shown; briefing: in the system message. */
  where: 'answer' | 'tool' | 'briefing'
  canary: string
  /** A later-scene canary in a tool result that says it is later in the story. */
  labelled: boolean
  tool?: string
}

const LATER_LABEL = /later in (the|this) story|not in the story yet|after (this|the open) (point|scene)|hasn't happened yet|comes later/i

export function findLeaks(t: TurnResult): Leak[] {
  const out: Leak[] = []
  const scan = (text: string, where: Leak['where'], tool?: string): void => {
    for (const [kind, words] of Object.entries(CANARIES) as [keyof typeof CANARIES, readonly string[]][]) {
      for (const canary of words) {
        if (!text.toLowerCase().includes(canary.toLowerCase())) continue
        // The question itself naming it isn't a leak.
        if (t.question.toLowerCase().includes(canary.toLowerCase())) continue
        out.push({ scenario: t.scenario, turn: t.turn, kind, where, canary, labelled: kind === 'later' && where !== 'answer' && LATER_LABEL.test(text), ...(tool ? { tool } : {}) })
      }
    }
  }
  scan(t.answer, 'answer')
  for (const r of t.toolResults) scan(r.content, 'tool', r.tool)
  // The briefing is the same for every turn asked at the same place: scanned on the first turn of each scenario only.
  if (t.turn === 1) scan(t.system, 'briefing')
  return out
}

const PREAMBLE = /^(sure|okay|ok|of course|certainly|great|absolutely|alright|happy to|good (idea|question)|let me|i('|’)ll|i will|i('|’)m going to|i can|here('|’)s what i)\b/i
const words = (s: string): number => (s.match(/\S+/g) ?? []).length

export interface Shape {
  /** The first line answers or says what was done, without a preamble ("Sure!", "Let me read the scene"). */
  firstLineLeads: boolean
  words: number
  /** Questions asked (sentences ending '?'). */
  questions: number
  /** The answer writes changed words out in quotes or a block (12+ words quoted), the thing proposals are for. */
  writesWordsOut: boolean
  /** The first line announces looking first: "I'll read the scene first", "Let me check…" (Phase 0's commonest opening). */
  preamble: boolean
  /** Words outside list items and quote blocks (the prose around them). */
  wordsOutsideLists: number
}

/** "I'll read / look / check …", "Let me …", "First, I'll …" (an optional "Sure," before it). */
const LOOK_FIRST = /^(?:(?:sure|okay|ok|of course|certainly|alright)[,!.]?\s+)?(?:first,?\s+)?(?:i('|’)ll|i will|let me|i('|’)m going to|i am going to|i need to|i('|’)d like to)\s+(?:first\s+|just\s+|quickly\s+)?(?:read|look|check|take a (?:quick )?look|have a (?:quick )?look|start|review|find|open|see|pull up|go through|examine|re-?read|get)\b/i
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)]|>)\s/

export function shapeOf(answer: string): Shape {
  const first = answer.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const quoted = [...answer.matchAll(/[“"]([^”"]{40,})[”"]|^>\s?(.+)$/gm)].map((m) => m[1] ?? m[2] ?? '')
  return {
    firstLineLeads: !!first && !PREAMBLE.test(first) && !/:$/.test(first),
    words: words(answer),
    questions: (answer.match(/\?(\s|$|["”)])/g) ?? []).length,
    writesWordsOut: quoted.some((q) => words(q) >= 12),
    preamble: LOOK_FIRST.test(first),
    wordsOutsideLists: answer
      .split('\n')
      .filter((l) => !LIST_LINE.test(l))
      .reduce((a, l) => a + words(l), 0)
  }
}

/** Did the turn propose what it should (any proposal of the expected kinds, or a draft hand-off where one counts)? */
export function proposedRight(t: TurnResult): boolean {
  if (t.expect.do !== 'propose') return false
  const kinds = t.expect.kinds
  if (draftCounts(t) && drafted(t)) return true
  return t.proposals.some((p) => !kinds || kinds.includes(p.kind as never))
}

/** ...and at least one of them applies (text/passage) or isn't a text change (a draft hand-off counts where allowed). */
export function proposedValid(t: TurnResult): boolean {
  if (!proposedRight(t)) return false
  if (draftCounts(t) && drafted(t)) return true
  const kinds = t.expect.do === 'propose' ? t.expect.kinds : undefined
  return t.checks.some((c) => (!kinds || kinds.includes(c.kind as never)) && c.applies !== false)
}

/** The turn did what its scenario expects. */
export function asExpected(t: TurnResult): boolean {
  const e = t.expect
  if (e.do === 'propose') return proposedValid(t) || (!!e.orAsk && asked(t))
  if (e.do === 'no-propose') return t.proposals.length === 0 && !drafted(t)
  if (e.do === 'ask') return asked(t)
  return true
}

const isReal = (t: TurnResult): boolean => t.group.startsWith('r-')

export interface Summary {
  turns: number
  scenarios: number
  /** Headline. */
  firstAsk: { scenarios: number; proposed: number; valid: number; onTarget: number; rate: number | null; validRate: number | null }
  byGroup: Record<string, { scenarios: number; asExpected: number }>
  proposals: { textOrPassage: number; applies: number; rate: number | null; onTarget: number; withTarget: number }
  notProposed: { results: number; turnsWithAny: number; perTurn: number | null }
  nudges: { turns: number; rate: number | null; onEditTurns: number }
  falseProposals: { turns: number; of: number }
  correctAsk: { turns: number; of: number }
  followUps: { proposed: number; of: number }
  requests: { total: number; perTurn: number | null; max: number }
  tokens: { prompt: number; cached: number; completion: number; perTurnPrompt: number | null; estimated: boolean }
  costUsd: number | null
  wallMs: { total: number; perTurn: number | null }
  leaks: { total: number; byKind: Record<string, number>; byWhere: Record<string, number>; laterUnlabelledInTools: number; inAnswers: number }
  shape: { firstLineLeads: number; meanWords: number | null; writesWordsOut: number; of: number; preamble: number; meanWordsOutsideLists: number | null }
  errors: number
  // ----- Phase 1 -----
  /** The real set's headline: of its turns that should propose, how many did (or asked, where that is allowed). */
  real: { turns: number; proposeTurns: number; proposed: number; valid: number; askedInstead: number; rate: number | null; asExpected: number }
  /** The new tools, by their fixed names, and every tool called (null: the report has no reply data). */
  tools: {
    known: boolean
    changes: { calls: number; turns: number; items: Record<string, number> }
    askUser: { calls: number; turns: number }
    draft: { calls: number; turns: number }
    byName: Record<string, number>
  }
  /** Requests that forced a tool through tool_choice (null: the report predates the count). */
  forced: { known: boolean; requests: number; turns: number; byChoice: Record<string, number> }
  /** The intent the app recorded on each turn ("none" when it records none). */
  intents: Record<string, number>
  /** The briefing's size (system message), in characters and estimated tokens (chars / 4), by story. */
  briefing: { known: boolean; small: { turns: number; meanTokens: number | null; maxTokens: number }; big: { turns: number; meanTokens: number | null; maxTokens: number; prompt: number; completion: number; cost: number | null } }
}

const rate = (a: number, b: number): number | null => (b ? a / b : null)

export function summarise(turns: TurnResult[], estimatedTokens: boolean): Summary {
  const scenarios = [...new Set(turns.map((t) => t.scenario))]
  const firstEdit = turns.filter((t) => t.turn === 1 && ['edit', 'selection', 'large'].includes(t.group))
  const proposed = firstEdit.filter(proposedRight)
  const valid = firstEdit.filter(proposedValid)
  const onTarget = firstEdit.filter((t) => t.checks.some((c) => c.onTarget === true))
  const byGroup: Summary['byGroup'] = {}
  for (const id of scenarios) {
    const ts = turns.filter((t) => t.scenario === id)
    const g = (byGroup[ts[0].group] ??= { scenarios: 0, asExpected: 0 })
    g.scenarios++
    if (ts.every(asExpected)) g.asExpected++
  }
  const checks = turns.flatMap((t) => t.checks.filter((c) => c.kind === 'text' || c.kind === 'passage'))
  const notProposed = turns.map((t) => t.toolResults.filter((r) => r.content.startsWith('Not proposed')).length)
  const questions = turns.filter((t) => t.group === 'question' || (t.expect.do === 'no-propose' && t.group === 'followup'))
  const ambiguous = turns.filter((t) => t.group === 'ambiguous')
  const follow = turns.filter((t) => t.group === 'followup' && t.turn === 2)
  const leaks = turns.flatMap(findLeaks)
  const count = (xs: string[]): Record<string, number> => xs.reduce<Record<string, number>>((o, k) => ((o[k] = (o[k] ?? 0) + 1), o), {})
  const shapes = turns.filter((t) => t.answer.trim()).map((t) => shapeOf(t.answer))
  const costs = turns.map((t) => t.cost).filter((c): c is number => c != null)
  return {
    turns: turns.length,
    scenarios: scenarios.length,
    firstAsk: {
      scenarios: firstEdit.length,
      proposed: proposed.length,
      valid: valid.length,
      onTarget: onTarget.length,
      rate: rate(proposed.length, firstEdit.length),
      validRate: rate(valid.length, firstEdit.length)
    },
    byGroup,
    proposals: {
      textOrPassage: checks.length,
      applies: checks.filter((c) => c.applies).length,
      rate: rate(checks.filter((c) => c.applies).length, checks.length),
      onTarget: checks.filter((c) => c.onTarget === true).length,
      withTarget: checks.filter((c) => c.onTarget != null).length
    },
    notProposed: { results: notProposed.reduce((a, b) => a + b, 0), turnsWithAny: notProposed.filter((n) => n > 0).length, perTurn: rate(notProposed.reduce((a, b) => a + b, 0), turns.length) },
    nudges: { turns: turns.filter((t) => t.nudged).length, rate: rate(turns.filter((t) => t.nudged).length, turns.length), onEditTurns: firstEdit.filter((t) => t.nudged).length },
    falseProposals: { turns: questions.filter((t) => t.proposals.length > 0).length, of: questions.length },
    correctAsk: { turns: ambiguous.filter(asked).length, of: ambiguous.length },
    followUps: { proposed: follow.filter(proposedValid).length, of: follow.length },
    requests: { total: turns.reduce((a, t) => a + t.requests, 0), perTurn: rate(turns.reduce((a, t) => a + t.requests, 0), turns.length), max: Math.max(0, ...turns.map((t) => t.requests)) },
    tokens: {
      prompt: turns.reduce((a, t) => a + (t.promptTokens ?? 0), 0),
      cached: turns.reduce((a, t) => a + (t.cachedTokens ?? 0), 0),
      completion: turns.reduce((a, t) => a + (t.completionTokens ?? 0), 0),
      perTurnPrompt: rate(turns.reduce((a, t) => a + (t.promptTokens ?? 0), 0), turns.length),
      estimated: estimatedTokens
    },
    costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    wallMs: { total: turns.reduce((a, t) => a + t.wallMs, 0), perTurn: rate(turns.reduce((a, t) => a + t.wallMs, 0), turns.length) },
    leaks: {
      total: leaks.length,
      byKind: count(leaks.map((l) => l.kind)),
      byWhere: count(leaks.map((l) => l.where)),
      laterUnlabelledInTools: leaks.filter((l) => l.kind === 'later' && l.where === 'tool' && !l.labelled).length,
      inAnswers: leaks.filter((l) => l.where === 'answer').length
    },
    shape: {
      firstLineLeads: shapes.filter((s) => s.firstLineLeads).length,
      meanWords: rate(shapes.reduce((a, s) => a + s.words, 0), shapes.length),
      writesWordsOut: shapes.filter((s) => s.writesWordsOut).length,
      of: shapes.length,
      preamble: shapes.filter((s) => s.preamble).length,
      meanWordsOutsideLists: rate(shapes.reduce((a, s) => a + s.wordsOutsideLists, 0), shapes.length)
    },
    errors: turns.filter((t) => t.status !== 'complete').length,
    real: realSummary(turns),
    tools: toolSummary(turns),
    forced: {
      known: turns.some((t) => t.forced !== undefined),
      requests: turns.reduce((a, t) => a + (t.forced?.length ?? 0), 0),
      turns: turns.filter((t) => (t.forced?.length ?? 0) > 0).length,
      byChoice: count(turns.flatMap((t) => t.forced ?? []))
    },
    intents: count(turns.map((t) => t.intent ?? 'none')),
    briefing: briefingSummary(turns)
  }
}

function realSummary(turns: TurnResult[]): Summary['real'] {
  const real = turns.filter(isReal)
  const should = real.filter((t) => t.expect.do === 'propose')
  const valid = should.filter(proposedValid)
  return {
    turns: real.length,
    proposeTurns: should.length,
    proposed: should.filter(proposedRight).length,
    valid: valid.length,
    askedInstead: should.filter((t) => !proposedValid(t) && t.expect.do === 'propose' && t.expect.orAsk && asked(t)).length,
    rate: rate(valid.length, should.length),
    asExpected: real.filter(asExpected).length
  }
}

function toolSummary(turns: TurnResult[]): Summary['tools'] {
  const byName: Record<string, number> = {}
  const items: Record<string, number> = {}
  for (const t of turns)
    for (const c of t.toolCalls ?? []) {
      byName[c.name] = (byName[c.name] ?? 0) + 1
      if (c.name === TOOLS.changes) for (const k of changeItemKinds(c.arguments)) items[k] = (items[k] ?? 0) + 1
    }
  const use = (name: string): { calls: number; turns: number } => ({ calls: byName[name] ?? 0, turns: turns.filter((t) => calls(t, name).length > 0).length })
  return { known: turns.some((t) => t.toolCalls !== undefined), changes: { ...use(TOOLS.changes), items }, askUser: use(TOOLS.ask), draft: use(TOOLS.draft), byName }
}

const tokensOf = (chars: number): number => Math.ceil(chars / 4)

function briefingSummary(turns: TurnResult[]): Summary['briefing'] {
  const firsts = turns.filter((t) => t.systemChars !== undefined && t.turn === 1)
  const side = (ts: TurnResult[]): { turns: number; meanTokens: number | null; maxTokens: number } => ({
    turns: ts.length,
    meanTokens: rate(ts.reduce((a, t) => a + tokensOf(t.systemChars ?? 0), 0), ts.length),
    maxTokens: Math.max(0, ...ts.map((t) => tokensOf(t.systemChars ?? 0)))
  })
  const big = turns.filter((t) => t.story === 'C')
  const costs = big.map((t) => t.cost).filter((c): c is number => c != null)
  return {
    known: firsts.length > 0,
    small: side(firsts.filter((t) => t.story !== 'C')),
    big: {
      ...side(firsts.filter((t) => t.story === 'C')),
      prompt: big.reduce((a, t) => a + (t.promptTokens ?? 0), 0),
      completion: big.reduce((a, t) => a + (t.completionTokens ?? 0), 0),
      cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null
    }
  }
}

const pct = (r: number | null): string => (r == null ? '–' : `${Math.round(r * 100)}%`)

export interface RunMeta {
  backend: string
  model: string
  provider: string
  commit: string
  branch: string
  dirty: boolean
  appVersion: string
  root: string
  at: string
  label: string
  switches: Record<string, string>
  note: string
}

export function reportMarkdown(meta: RunMeta, s: Summary, turns: TurnResult[]): string {
  const L: string[] = []
  L.push(`# Chat eval: ${meta.backend}${meta.label ? ` (${meta.label})` : ''}`, '')
  L.push(`App ${meta.appVersion} on ${meta.branch} @ ${meta.commit.slice(0, 9)}${meta.dirty ? ' (uncommitted changes in src)' : ''}; model ${meta.model} via ${meta.provider}; ${meta.at}.`)
  if (Object.keys(meta.switches).length) L.push(`Switches: ${Object.entries(meta.switches).map(([k, v]) => `${k}=${v}`).join(', ')}.`)
  if (meta.note) L.push('', `> ${meta.note}`)
  L.push('', '## Headline', '')
  if (s.firstAsk.scenarios)
    L.push(`**First-ask proposal rate (edit, selection, large): ${pct(s.firstAsk.rate)}** (${s.firstAsk.proposed} of ${s.firstAsk.scenarios}); with a proposal that applies: ${pct(s.firstAsk.validRate)} (${s.firstAsk.valid}); on the paragraph meant: ${s.firstAsk.onTarget}.`, '')
  if (s.real.turns)
    L.push(
      `**Real set: proposed (and it applies) on ${pct(s.real.rate)} of the turns that should** (${s.real.valid} of ${s.real.proposeTurns}; any proposal ${s.real.proposed}; asked one question instead, where allowed, ${s.real.askedInstead}); every real turn as expected: ${s.real.asExpected} of ${s.real.turns}.`,
      ''
    )
  L.push('| Measure | Value |', '|---|---|')
  L.push(`| Proposals that apply (page's matcher) | ${s.proposals.applies} of ${s.proposals.textOrPassage} (${pct(s.proposals.rate)}); on target ${s.proposals.onTarget} of ${s.proposals.withTarget} |`)
  L.push(`| "Not proposed" tool results | ${s.notProposed.results} in ${s.notProposed.turnsWithAny} turns (${s.notProposed.perTurn?.toFixed(2) ?? '–'} per turn) |`)
  L.push(`| Nudged (PROPOSE_NOW sent) | ${s.nudges.turns} of ${s.turns} turns (${pct(s.nudges.rate)}); first asks of edits: ${s.nudges.onEditTurns} |`)
  L.push(`| False proposals (questions, brainstorms, options) | ${s.falseProposals.turns} of ${s.falseProposals.of} |`)
  L.push(`| Ambiguous: asked a question, proposed nothing | ${s.correctAsk.turns} of ${s.correctAsk.of} |`)
  L.push(`| Follow-ups proposing on "option 2" / "yes" | ${s.followUps.proposed} of ${s.followUps.of} |`)
  L.push(`| Requests | ${s.requests.total} (${s.requests.perTurn?.toFixed(2) ?? '–'} per turn, most ${s.requests.max}) |`)
  L.push(`| Tokens${s.tokens.estimated ? ' (estimated from text)' : ''} | prompt ${s.tokens.prompt.toLocaleString('en-GB')} (cached ${s.tokens.cached.toLocaleString('en-GB')}), completion ${s.tokens.completion.toLocaleString('en-GB')}; ${Math.round(s.tokens.perTurnPrompt ?? 0).toLocaleString('en-GB')} prompt per turn |`)
  L.push(`| Cost | ${s.costUsd == null ? '–' : `$${s.costUsd.toFixed(4)}`} |`)
  L.push(`| Wall time | ${(s.wallMs.total / 1000).toFixed(1)} s (${((s.wallMs.perTurn ?? 0) / 1000).toFixed(1)} s per turn) |`)
  L.push(`| Story-point leaks | ${s.leaks.total}: ${Object.entries(s.leaks.byKind).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; where: ${Object.entries(s.leaks.byWhere).map(([k, v]) => `${k} ${v}`).join(', ') || '–'}; later content unlabelled in tool results ${s.leaks.laterUnlabelledInTools}; in answers ${s.leaks.inAnswers} |`)
  L.push(`| Answer shape | first line leads ${s.shape.firstLineLeads} of ${s.shape.of}; ${Math.round(s.shape.meanWords ?? 0)} words on average; writes changed words out ${s.shape.writesWordsOut} |`)
  L.push(`| Opens with a preamble ("I'll read the scene first") | ${s.shape.preamble} of ${s.shape.of} |`)
  L.push(`| Words outside lists | ${Math.round(s.shape.meanWordsOutsideLists ?? 0)} on average |`)
  L.push(`| New tools | ${toolsLine(s)} |`)
  L.push(`| Tool forced (tool_choice) | ${forcedLine(s)} |`)
  L.push(`| Intent recorded | ${Object.entries(s.intents).map(([k, v]) => `${k} ${v}`).join(', ')} |`)
  L.push(`| Briefing size (system message, est. tokens) | ${briefingLine(s)} |`)
  L.push(`| Turns that didn't complete | ${s.errors} |`)
  L.push('', '## By group (every turn as expected)', '', '| Group | As expected |', '|---|---|')
  for (const [g, v] of Object.entries(s.byGroup)) L.push(`| ${g} | ${v.asExpected} of ${v.scenarios} |`)
  L.push(
    '',
    '## Turns',
    '',
    '| Turn | Expect | Proposals (applies / on target) | Not proposed | Req | Nudged | Leaks | Tools called | Forced | Intent | Briefing | First line |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|'
  )
  for (const t of turns) {
    const props = t.checks.map((c) => `${c.kind}${c.applies == null ? '' : c.applies ? ' ✓' : ' ✗'}${c.onTarget == null ? '' : c.onTarget ? '◎' : '○'}`).join(', ') || '–'
    const lk = findLeaks(t).map((l) => `${l.kind}:${l.where}${l.tool ? `(${l.tool})` : ''}`)
    const first = (t.answer.split('\n').find((x) => x.trim()) ?? t.error ?? '').replace(/\|/g, '/').slice(0, 90)
    const briefing = t.turn === 1 && t.systemChars !== undefined ? `${(tokensOf(t.systemChars) / 1000).toFixed(1)}k` : ''
    L.push(
      `| ${t.scenario}.${t.turn} | ${t.expect.do} | ${props} | ${t.toolResults.filter((r) => r.content.startsWith('Not proposed')).length} | ${t.requests} | ${t.nudged ? 'yes' : ''} | ${[...new Set(lk)].join(' ') || ''} | ${toolList(t)} | ${(t.forced ?? []).join(', ')} | ${t.intent ?? ''} | ${briefing} | ${first} |`
    )
  }
  L.push('', 'Legend: ✓ the page can apply it, ✗ it can’t; ◎ on the paragraph meant, ○ elsewhere. Briefing: the system message in estimated tokens (characters / 4).')
  return L.join('\n') + '\n'
}

/** A turn's tool calls in order, repeats folded: "read_scene, propose_edit ×2". */
function toolList(t: TurnResult): string {
  const out: [string, number][] = []
  for (const c of t.toolCalls ?? []) {
    const last = out.at(-1)
    if (last && last[0] === c.name) last[1]++
    else out.push([c.name, 1])
  }
  return out.map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ')
}

function toolsLine(s: Summary): string {
  if (!s.tools.known) return '– (no reply data in this report)'
  const items = Object.entries(s.tools.changes.items).map(([k, v]) => `${k} ${v}`).join(', ')
  return `${TOOLS.changes} ${s.tools.changes.calls} calls in ${s.tools.changes.turns} turns${items ? ` (items: ${items})` : ''}; ${TOOLS.ask} ${s.tools.askUser.calls} in ${s.tools.askUser.turns} turns; ${TOOLS.draft} ${s.tools.draft.calls} in ${s.tools.draft.turns} turns`
}

function forcedLine(s: Summary): string {
  if (!s.forced.known) return '– (not recorded in this report)'
  const by = Object.entries(s.forced.byChoice).map(([k, v]) => `${k} ${v}`).join(', ')
  return `${s.forced.requests} requests in ${s.forced.turns} turns${by ? ` (${by})` : ''}`
}

function briefingLine(s: Summary): string {
  if (!s.briefing.known) return '– (not recorded in this report)'
  const k = (n: number | null): string => (n == null ? '–' : `${(n / 1000).toFixed(1)}k`)
  const b = s.briefing.big
  return `story A: ${s.briefing.small.turns ? `${k(s.briefing.small.meanTokens)} on average (most ${k(s.briefing.small.maxTokens)})` : 'not run'}; big briefing (story C): ${b.turns ? `${k(b.meanTokens)} on average (most ${k(b.maxTokens)}); its turns sent ${b.prompt.toLocaleString('en-GB')} prompt tokens${b.cost != null ? `, $${b.cost.toFixed(4)}` : ''}` : 'not run'}`
}

// ---------- A/B: several reports side by side ----------

export interface Compared {
  /** The column's name: the run's label, else its folder. */
  name: string
  meta: RunMeta
  summary: Summary
  turns: TurnResult[]
}

/** One markdown table of several runs side by side (headline, per group, tools, cost, tokens, requests), then the turns whose outcome differs. */
export function compareMarkdown(runs: Compared[]): string {
  const L: string[] = ['# Chat eval: A/B', '']
  for (const r of runs) {
    const sw = Object.entries(r.meta.switches ?? {}).map(([k, v]) => `${k.replace(/^AIWRITE_EXP_CHAT_/, '')}=${v}`)
    L.push(`- **${r.name}**: ${r.meta.backend} ${r.meta.model}, ${r.meta.branch} @ ${String(r.meta.commit).slice(0, 9)}, ${r.meta.at}; switches: ${sw.join(', ') || 'none'}; ${r.summary.scenarios} scenarios, ${r.summary.turns} turns`)
  }
  L.push('', `| Measure | ${runs.map((r) => r.name).join(' | ')} |`, `|---|${runs.map(() => '---').join('|')}|`)
  const row = (label: string, f: (s: Summary) => string): void => {
    L.push(`| ${label} | ${runs.map((r) => f(r.summary)).join(' | ')} |`)
  }
  const of = (a: number, b: number): string => (b ? `${a} of ${b} (${pct(a / b)})` : '–')
  row('**First-ask proposal (core edit/selection/large)**', (s) => of(s.firstAsk.proposed, s.firstAsk.scenarios))
  row('First ask, applies', (s) => of(s.firstAsk.valid, s.firstAsk.scenarios))
  row('**Real set: proposed and applies**', (s) => of(s.real.valid, s.real.proposeTurns))
  row('Real set: asked instead (allowed)', (s) => (s.real.turns ? String(s.real.askedInstead) : '–'))
  row('Real set: every turn as expected', (s) => of(s.real.asExpected, s.real.turns))
  row('Proposals that apply', (s) => of(s.proposals.applies, s.proposals.textOrPassage))
  row('Nudged turns', (s) => of(s.nudges.turns, s.turns))
  row('False proposals (core questions)', (s) => `${s.falseProposals.turns} of ${s.falseProposals.of}`)
  row('Ambiguous: asked', (s) => `${s.correctAsk.turns} of ${s.correctAsk.of}`)
  row('Follow-ups proposing (core)', (s) => `${s.followUps.proposed} of ${s.followUps.of}`)
  row('"Not proposed" results', (s) => String(s.notProposed.results))
  row('Opens with a preamble', (s) => of(s.shape.preamble, s.shape.of))
  row('First line leads', (s) => of(s.shape.firstLineLeads, s.shape.of))
  row('Words per answer / outside lists', (s) => `${Math.round(s.shape.meanWords ?? 0)} / ${Math.round(s.shape.meanWordsOutsideLists ?? 0)}`)
  row(`${TOOLS.changes} calls (turns)`, (s) => (s.tools.known ? `${s.tools.changes.calls} (${s.tools.changes.turns})` : '–'))
  row(`${TOOLS.ask} calls (turns)`, (s) => (s.tools.known ? `${s.tools.askUser.calls} (${s.tools.askUser.turns})` : '–'))
  row(`${TOOLS.draft} calls (turns)`, (s) => (s.tools.known ? `${s.tools.draft.calls} (${s.tools.draft.turns})` : '–'))
  row('Forced tool_choice: requests (turns)', (s) => (s.forced.known ? `${s.forced.requests} (${s.forced.turns})` : '–'))
  row('Intents recorded', (s) => Object.entries(s.intents).map(([k, v]) => `${k} ${v}`).join(', '))
  row('Requests (per turn, most)', (s) => `${s.requests.total} (${s.requests.perTurn?.toFixed(2) ?? '–'}, ${s.requests.max})`)
  row('Prompt tokens (cached)', (s) => `${s.tokens.prompt.toLocaleString('en-GB')} (${s.tokens.cached.toLocaleString('en-GB')})`)
  row('Completion tokens', (s) => s.tokens.completion.toLocaleString('en-GB'))
  row('Prompt tokens per turn', (s) => Math.round(s.tokens.perTurnPrompt ?? 0).toLocaleString('en-GB'))
  row('Briefing, story A / big (est. tokens)', (s) =>
    s.briefing.known ? `${((s.briefing.small.meanTokens ?? 0) / 1000).toFixed(1)}k / ${s.briefing.big.turns ? `${((s.briefing.big.meanTokens ?? 0) / 1000).toFixed(1)}k` : '–'}` : '–'
  )
  row('**Cost**', (s) => (s.costUsd == null ? '–' : `$${s.costUsd.toFixed(4)}`))
  row('Cost of big-briefing turns', (s) => (s.briefing.big.cost == null ? '–' : `$${s.briefing.big.cost.toFixed(4)}`))
  row('Wall time', (s) => `${(s.wallMs.total / 1000).toFixed(0)} s`)
  row('Story-point leaks (in answers)', (s) => `${s.leaks.total} (${s.leaks.inAnswers})`)
  row("Turns that didn't complete", (s) => String(s.errors))
  const groups = [...new Set(runs.flatMap((r) => Object.keys(r.summary.byGroup)))]
  for (const g of groups) row(`Group ${g}: as expected`, (s) => (s.byGroup[g] ? `${s.byGroup[g].asExpected} of ${s.byGroup[g].scenarios}` : '–'))

  // The turns whose outcome differs between the runs.
  const key = (t: TurnResult): string => `${t.scenario}.${t.turn}`
  // Turns that at least two of the runs asked.
  const keys = [...new Set(runs.flatMap((r) => r.turns.map(key)))].filter((k) => runs.filter((r) => r.turns.some((t) => key(t) === k)).length > 1)
  const cell = (t: TurnResult | undefined): string => {
    if (!t) return '–'
    const what = t.proposals.length ? t.proposals.map((p) => p.kind).join('+') : drafted(t) ? 'draft' : askedUser(t) ? 'ask_user' : asked(t) ? 'question' : 'words'
    return `${asExpected(t) ? '✓' : '✗'} ${what}`
  }
  const differ = keys.filter((k) => new Set(runs.map((r) => cell(r.turns.find((t) => key(t) === k)))).size > 1)
  L.push('', `## Turns that differ (${differ.length} of the ${keys.length} asked in more than one run)`, '')
  if (differ.length) {
    L.push(`| Turn | ${runs.map((r) => r.name).join(' | ')} |`, `|---|${runs.map(() => '---').join('|')}|`)
    for (const k of differ) L.push(`| ${k} | ${runs.map((r) => cell(r.turns.find((t) => key(t) === k))).join(' | ')} |`)
  } else L.push('None: every turn came out the same way in every run.')
  L.push('', 'Each run is re-scored from its saved turns with the current scores (score.ts). ✓ as the scenario expects, ✗ not; then what the turn did.')
  return L.join('\n') + '\n'
}
