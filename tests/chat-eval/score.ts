// The chat eval's scores, from the turns the harness ran (harness.ts). Pure, so it can be re-run on a saved report.
//
// Headline: of the edit, selection and large-rewrite scenarios (26), the share whose FIRST ask came back with a
// proposal of the right kind. Then: proposals the page can apply (its own matcher, findTextRange), on the paragraph
// meant; "Not proposed" tool results; nudges (PROPOSE_NOW sent back); false proposals on questions and brainstorms;
// ambiguous asks answered with a question and no proposal; follow-ups that propose on "option 2" / "yes"; requests,
// tokens and time per turn; story-point leaks; and the answer's shape.

import { CANARIES } from './world'
import type { TurnResult } from './harness'

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
}

export function shapeOf(answer: string): Shape {
  const first = answer.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const quoted = [...answer.matchAll(/[“"]([^”"]{40,})[”"]|^>\s?(.+)$/gm)].map((m) => m[1] ?? m[2] ?? '')
  return {
    firstLineLeads: !!first && !PREAMBLE.test(first) && !/:$/.test(first),
    words: words(answer),
    questions: (answer.match(/\?(\s|$|["”)])/g) ?? []).length,
    writesWordsOut: quoted.some((q) => words(q) >= 12)
  }
}

/** Did the turn propose what it should (any proposal of the expected kinds)? */
export function proposedRight(t: TurnResult): boolean {
  if (t.expect.do !== 'propose') return false
  const kinds = t.expect.kinds
  return t.proposals.some((p) => !kinds || kinds.includes(p.kind as never))
}

/** ...and at least one of them applies (text/passage) or isn't a text change. */
export function proposedValid(t: TurnResult): boolean {
  if (!proposedRight(t)) return false
  const kinds = t.expect.do === 'propose' ? t.expect.kinds : undefined
  return t.checks.some((c) => (!kinds || kinds.includes(c.kind as never)) && c.applies !== false)
}

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
  shape: { firstLineLeads: number; meanWords: number | null; writesWordsOut: number; of: number }
  errors: number
}

const rate = (a: number, b: number): number | null => (b ? a / b : null)

export function summarise(turns: TurnResult[], estimatedTokens: boolean): Summary {
  const scenarios = [...new Set(turns.map((t) => t.scenario))]
  const firstEdit = turns.filter((t) => t.turn === 1 && ['edit', 'selection', 'large'].includes(t.group))
  const proposed = firstEdit.filter(proposedRight)
  const valid = firstEdit.filter(proposedValid)
  const onTarget = firstEdit.filter((t) => t.checks.some((c) => c.onTarget === true))
  const asExpected = (t: TurnResult): boolean => {
    const e = t.expect
    if (e.do === 'propose') return proposedValid(t)
    if (e.do === 'no-propose') return t.proposals.length === 0
    if (e.do === 'ask') return t.proposals.length === 0 && shapeOf(t.answer).questions >= 1
    return true
  }
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
    correctAsk: { turns: ambiguous.filter((t) => t.proposals.length === 0 && shapeOf(t.answer).questions >= 1).length, of: ambiguous.length },
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
      of: shapes.length
    },
    errors: turns.filter((t) => t.status !== 'complete').length
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
  L.push(`**First-ask proposal rate (edit, selection, large): ${pct(s.firstAsk.rate)}** (${s.firstAsk.proposed} of ${s.firstAsk.scenarios}); with a proposal that applies: ${pct(s.firstAsk.validRate)} (${s.firstAsk.valid}); on the paragraph meant: ${s.firstAsk.onTarget}.`, '')
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
  L.push(`| Turns that didn't complete | ${s.errors} |`)
  L.push('', '## By group (every turn as expected)', '', '| Group | As expected |', '|---|---|')
  for (const [g, v] of Object.entries(s.byGroup)) L.push(`| ${g} | ${v.asExpected} of ${v.scenarios} |`)
  L.push('', '## Turns', '', '| Turn | Expect | Proposals (applies / on target) | Not proposed | Req | Nudged | Leaks | First line |', '|---|---|---|---|---|---|---|---|')
  for (const t of turns) {
    const props = t.checks.map((c) => `${c.kind}${c.applies == null ? '' : c.applies ? ' ✓' : ' ✗'}${c.onTarget == null ? '' : c.onTarget ? '◎' : '○'}`).join(', ') || '–'
    const lk = findLeaks(t).map((l) => `${l.kind}:${l.where}${l.tool ? `(${l.tool})` : ''}`)
    const first = (t.answer.split('\n').find((x) => x.trim()) ?? t.error ?? '').replace(/\|/g, '/').slice(0, 90)
    L.push(`| ${t.scenario}.${t.turn} | ${t.expect.do} | ${props} | ${t.toolResults.filter((r) => r.content.startsWith('Not proposed')).length} | ${t.requests} | ${t.nudged ? 'yes' : ''} | ${[...new Set(lk)].join(' ') || ''} | ${first} |`)
  }
  L.push('', 'Legend: ✓ the page can apply it, ✗ it can’t; ◎ on the paragraph meant, ○ elsewhere.')
  return L.join('\n') + '\n'
}
