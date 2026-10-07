// Scoring, claim by claim. Each written passage gets one verdict per check:
//   kept        the judge says the passage keeps to the truth
//   broken      the passage contradicts it: the judge gave the bad answer with a quote found in the passage, or a
//               tripwire (a deterministic pattern) matched; for a check whose bad answer is "no" (something that should
//               happen and doesn't, like a promise kept), the judge's "no" is enough
//   unverified  the judge gave the bad answer but its quote isn't in the passage (not counted as broken)
//   silent      the passage doesn't touch it ("unclear"), or the judge's reply couldn't be read
// Consistency = kept / (kept + broken): of the checks a passage touched, how many it kept to. Pure, so it can be tested.

import type { JudgeAnswer } from './judge'
import { TRAPS, type Check, type Probe, type ProbeKind, type TrapId, type Tripwire } from './story'

export type Verdict = 'kept' | 'broken' | 'unverified' | 'silent'

export interface CheckResult {
  id: string
  trap: TrapId
  ask: string
  verdict: Verdict
  /** What decided it. */
  by: 'judge' | 'tripwire' | 'none'
  answer: string
  quote: string
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * True when the judge's quote is in the passage: word for word once punctuation and spacing are set aside, or with
 * at least 85% of its words found in the passage (a judge often drops or changes a word when it copies).
 */
export function quoteInPassage(passage: string, quote: string): boolean {
  const q = norm(quote.replace(/^\.{3}|\.{3}$/g, ''))
  if (!q) return false
  const p = norm(passage)
  if (p.includes(q)) return true
  const words = q.split(' ').filter((w) => w.length > 1)
  if (words.length < 3) return false
  const have = new Set(p.split(' '))
  return words.filter((w) => have.has(w)).length / words.length >= 0.85
}

/** The words around a tripwire's match, for the report. */
function around(passage: string, m: RegExpExecArray): string {
  const from = Math.max(0, m.index - 40)
  const to = Math.min(passage.length, m.index + m[0].length + 40)
  return `${from > 0 ? '…' : ''}${passage.slice(from, to).replace(/\s+/g, ' ').trim()}${to < passage.length ? '…' : ''}`
}

/** One check's verdict from the judge's answer (undefined: no answer) and any tripwires paired with it. */
export function judgeCheck(check: Check, answer: JudgeAnswer | undefined, passage: string, tripwires: Tripwire[] = []): CheckResult {
  const base = { id: check.id, trap: check.trap, ask: check.ask }
  for (const t of tripwires) {
    if (t.check !== check.id) continue
    const m = new RegExp(t.pattern.source, t.pattern.flags.replace('g', '')).exec(passage)
    if (m) return { ...base, verdict: 'broken', by: 'tripwire', answer: answer?.answer ?? '', quote: around(passage, m) }
  }
  if (!answer || answer.answer === 'unclear') return { ...base, verdict: 'silent', by: answer ? 'judge' : 'none', answer: answer?.answer ?? '', quote: answer?.quote ?? '' }
  const r = { ...base, by: 'judge' as const, answer: answer.answer, quote: answer.quote }
  if (answer.answer !== check.bad) return { ...r, verdict: 'kept' }
  // Something that should have happened and didn't has nothing to quote.
  if (check.bad === 'no') return { ...r, verdict: 'broken' }
  return { ...r, verdict: quoteInPassage(passage, answer.quote) ? 'broken' : 'unverified' }
}

/** Every check of a probe for one passage. `answers` null: the judge's reply couldn't be read. */
export function scorePassage(probe: Pick<Probe, 'checks' | 'tripwires'>, passage: string, answers: JudgeAnswer[] | null): CheckResult[] {
  const byId = new Map((answers ?? []).map((a) => [a.id.toUpperCase(), a]))
  return probe.checks.map((c) => judgeCheck(c, byId.get(c.id.toUpperCase()), passage, probe.tripwires))
}

export interface Tally {
  kept: number
  broken: number
  unverified: number
  silent: number
  /** kept / (kept + broken); null when nothing was touched. */
  consistency: number | null
}

export function tally(results: Pick<CheckResult, 'verdict'>[]): Tally {
  const t = { kept: 0, broken: 0, unverified: 0, silent: 0 }
  for (const r of results) t[r.verdict]++
  return { ...t, consistency: t.kept + t.broken > 0 ? t.kept / (t.kept + t.broken) : null }
}

// ---------- The run's report ----------

export interface Usage {
  calls: number
  promptTokens: number
  completionTokens: number
  /** USD, as the provider reported it (or worked out from the model's prices); null when nothing was known. */
  cost: number | null
}

export interface SampleResult {
  index: number
  status: 'complete' | 'error' | 'stopped' | 'skipped'
  error: string | null
  generationId: string | null
  words: number
  text: string
  judge: { status: 'ok' | 'unreadable' | 'failed' | 'skipped'; raw: string }
  results: CheckResult[]
  /** Step 3's check and repair on this passage, when the checkout has it. */
  repair?: RepairResult
}

/** What check and repair (step 3) did to one passage as it landed, and the repaired passage scored again. */
export interface RepairResult {
  /** False when it checked nothing (no memory model, switched off, the call failed or its reply couldn't be read). */
  checked: boolean
  claims: number
  slips: number
  /** The fixes it sent back, and whether the page could make each. */
  fixes: { was: string; now: string; why: string; made: boolean }[]
  /** The questions it raised in the Issues tab, in its words. */
  questions: string[]
  /** The passage after the fixes the page made (the passage itself when none). */
  text: string
  judge: SampleResult['judge']
  results: CheckResult[]
}

export interface ProbeResult {
  id: string
  scene: string
  kind: ProbeKind
  asks: string
  samples: SampleResult[]
}

export interface RunReport {
  storyVersion: number
  startedAt: string
  finishedAt: string
  fake: boolean
  /** The checkout whose app code was run (it may not be the harness's own). */
  tested: { root: string; branch: string; commit: string; dirty: boolean; appVersion: string }
  harness: { root: string; commit: string }
  provider: string
  /** USD per million tokens in and out, given for the run (DeepSeek's API reports tokens, not cost); null when not given. */
  prices?: { in: number; out: number } | null
  models: { writer: string; memory: string; judge: string }
  samples: number
  words: { generate: number; addBelow: number; beatScene: number }
  probes: ProbeResult[]
  usage: { byJob: Record<string, Usage>; judge: Usage; total: Usage }
  summary: Summary
  /** The scores after check and repair (step 3), when the checkout has it; absent otherwise. */
  repaired?: Summary & { checked: number; fixes: number; made: number; questions: number }
}

export interface Summary {
  byTrap: Record<string, Tally>
  byProbe: Record<string, Tally>
  total: Tally & { passages: number; brokenPerPassage: number | null }
}

/**
 * The tallies by trap, by probe and in all, from the scored passages: as written, or after check and repair (a
 * passage the repair didn't change, or didn't check, counts as written).
 */
export function summarise(probes: ProbeResult[], after: 'written' | 'repaired' = 'written'): Summary {
  const all: CheckResult[] = []
  const byProbe: Record<string, Tally> = {}
  let passages = 0
  const of = (s: SampleResult): CheckResult[] => (after === 'repaired' && s.repair ? s.repair.results : s.results)
  for (const p of probes) {
    const rs = p.samples.filter((s) => s.status === 'complete').flatMap(of)
    passages += p.samples.filter((s) => s.status === 'complete').length
    byProbe[p.id] = tally(rs)
    all.push(...rs)
  }
  const byTrap: Record<string, Tally> = {}
  for (const t of TRAPS) byTrap[t.id] = tally(all.filter((r) => r.trap === t.id))
  const total = tally(all)
  return { byTrap, byProbe, total: { ...total, passages, brokenPerPassage: passages ? total.broken / passages : null } }
}

/** The scores after check and repair, with what it did; undefined when no passage went through it. */
export function summariseRepair(probes: ProbeResult[]): RunReport['repaired'] {
  const samples = probes.flatMap((p) => p.samples.filter((s) => s.status === 'complete' && s.repair))
  if (!samples.length) return undefined
  const reps = samples.map((s) => s.repair!)
  return {
    ...summarise(probes, 'repaired'),
    checked: reps.filter((x) => x.checked).length,
    fixes: reps.reduce((n, x) => n + x.fixes.length, 0),
    made: reps.reduce((n, x) => n + x.fixes.filter((f) => f.made).length, 0),
    questions: reps.reduce((n, x) => n + x.questions.length, 0)
  }
}

/** USD for these tokens at the given prices per million. */
export const estimatedCost = (u: Pick<Usage, 'promptTokens' | 'completionTokens'>, prices: { in: number; out: number }): number =>
  (u.promptTokens * prices.in + u.completionTokens * prices.out) / 1_000_000

const pct = (v: number | null): string => (v == null ? '–' : `${Math.round(v * 100)}%`)
const usd = (v: number | null): string => (v == null ? 'not reported' : `$${v.toFixed(v < 0.1 ? 4 : 2)}`)
const MARK: Record<Verdict, string> = { kept: 'kept', broken: '**BROKEN**', unverified: 'unverified', silent: '·' }

/** The short Markdown report. */
export function reportMarkdown(r: RunReport): string {
  const out: string[] = []
  const s = r.summary
  out.push(`# Trap scores: ${r.tested.branch} @ ${r.tested.commit.slice(0, 9)}${r.tested.dirty ? ' (with uncommitted changes)' : ''}`)
  out.push('')
  out.push(`- Story version ${r.storyVersion}, ${r.samples} sample${r.samples === 1 ? '' : 's'} per probe, ${r.startedAt.slice(0, 16).replace('T', ' ')}${r.fake ? ' — **fake model (a check of the harness, not a score)**' : ''}`)
  out.push(`- Writer: \`${r.models.writer}\`; memory: \`${r.models.memory}\`; judge: \`${r.models.judge}\` (${r.provider})`)
  out.push(`- App code from \`${r.tested.root}\` (version ${r.tested.appVersion}); harness at ${r.harness.commit.slice(0, 9)}`)
  out.push('')
  out.push(
    `**Consistency ${pct(s.total.consistency)}**: ${s.total.kept} kept, ${s.total.broken} broken, ${s.total.unverified} unverified, ${s.total.silent} not touched, over ${s.total.passages} passages (${s.total.brokenPerPassage == null ? '–' : s.total.brokenPerPassage.toFixed(2)} broken per passage).`
  )
  const rp = r.repaired
  if (rp) {
    out.push('')
    out.push(
      `**After check and repair ${pct(rp.total.consistency)}**: ${rp.total.kept} kept, ${rp.total.broken} broken (${rp.total.brokenPerPassage == null ? '–' : rp.total.brokenPerPassage.toFixed(2)} per passage). The repair checked ${rp.checked} of ${rp.total.passages} passages, sent ${rp.fixes} fix${rp.fixes === 1 ? '' : 'es'} (${rp.made} made in the page) and raised ${rp.questions} question${rp.questions === 1 ? '' : 's'}.`
    )
    if (rp.checked === 0) out.push('', '**The repair checked nothing**: no memory model, switched off, or every call failed. See the log.')
  }
  out.push('')
  out.push('## By trap')
  out.push('')
  out.push(`| Trap | Kept | Broken | Unverified | Not touched | Consistency |${rp ? ' Broken after repair | After repair |' : ''}`)
  out.push(`|---|---:|---:|---:|---:|---:|${rp ? '---:|---:|' : ''}`)
  for (const t of TRAPS) {
    const x = s.byTrap[t.id]
    const y = rp?.byTrap[t.id]
    out.push(`| ${t.name} | ${x.kept} | ${x.broken} | ${x.unverified} | ${x.silent} | ${pct(x.consistency)} |${y ? ` ${y.broken} | ${pct(y.consistency)} |` : ''}`)
  }
  out.push('')
  out.push('## By probe')
  out.push('')
  for (const p of r.probes) {
    const x = s.byProbe[p.id]
    out.push(`### ${p.id}. ${p.asks}`)
    out.push('')
    out.push(`Consistency ${pct(x.consistency)} (${x.kept} kept, ${x.broken} broken, ${x.unverified} unverified, ${x.silent} not touched).`)
    const done = p.samples.filter((m) => m.status === 'complete')
    const y = rp?.byProbe[p.id]
    if (y) {
      const reps = done.map((m) => m.repair).filter((m): m is RepairResult => !!m)
      const fixes = reps.reduce((n, m) => n + m.fixes.length, 0)
      const questions = reps.reduce((n, m) => n + m.questions.length, 0)
      out.push(`After check and repair: ${pct(y.consistency)} (${y.broken} broken); ${fixes} fix${fixes === 1 ? '' : 'es'}, ${questions} question${questions === 1 ? '' : 's'}.`)
    }
    out.push('')
    const failed = p.samples.filter((m) => m.status !== 'complete')
    for (const m of failed) out.push(`- Sample ${m.index + 1} not written: ${m.error ?? m.status}`)
    if (failed.length) out.push('')
    if (done.length) {
      out.push(`| Check | ${done.map((m) => `#${m.index + 1}`).join(' | ')} |`)
      out.push(`|---|${done.map(() => '---').join('|')}|`)
      const ids = done[0].results.map((c) => c.id)
      for (const id of ids) {
        const ask = done[0].results.find((c) => c.id === id)?.ask ?? ''
        const cell = (m: SampleResult): string => {
          const was = m.results.find((c) => c.id === id)?.verdict ?? 'silent'
          const now = m.repair?.results.find((c) => c.id === id)?.verdict ?? was
          return now === was ? MARK[was] : `${MARK[was]} → ${MARK[now]} after repair`
        }
        out.push(`| ${id}: ${ask} | ${done.map(cell).join(' | ')} |`)
      }
      const unread = done.filter((m) => m.judge.status !== 'ok')
      if (unread.length) out.push('', `Judge reply not read for sample${unread.length === 1 ? '' : 's'} ${unread.map((m) => `#${m.index + 1}`).join(', ')}.`)
      out.push('')
    }
  }
  const broken = r.probes.flatMap((p) =>
    p.samples.flatMap((m) => m.results.filter((c) => c.verdict === 'broken' || c.verdict === 'unverified').map((c) => ({ p, m, c })))
  )
  if (broken.length) {
    out.push('## What broke')
    out.push('')
    for (const { p, m, c } of broken) {
      const tag = c.verdict === 'broken' ? (c.by === 'tripwire' ? 'broken (tripwire)' : 'broken') : 'unverified'
      out.push(`- ${p.id} #${m.index + 1}, ${c.id} ${tag}: ${c.ask}${c.quote ? ` — “${c.quote}”` : ''}`)
    }
    out.push('')
  }
  const repaired = r.probes.flatMap((p) =>
    p.samples.filter((m) => m.repair && (m.repair.fixes.length || m.repair.questions.length)).map((m) => ({ p, m, x: m.repair! }))
  )
  if (repaired.length) {
    out.push('## What the repair did')
    out.push('')
    for (const { p, m, x } of repaired) {
      for (const f of x.fixes) out.push(`- ${p.id} #${m.index + 1}, fix${f.made ? '' : ' (not made)'}: “${f.was}” → “${f.now}”: ${f.why}`)
      for (const q of x.questions) out.push(`- ${p.id} #${m.index + 1}, question: ${q}`)
    }
    out.push('')
  }
  out.push('## Calls and cost')
  out.push('')
  out.push(`| Job | Calls | Prompt tokens | Reply tokens | Cost reported |${r.prices ? ' Estimated cost |' : ''}`)
  out.push(`|---|---:|---:|---:|---:|${r.prices ? '---:|' : ''}`)
  const rows: [string, Usage][] = [...Object.entries(r.usage.byJob), ['judge', r.usage.judge], ['total', r.usage.total]]
  for (const [job, u] of rows) out.push(`| ${job} | ${u.calls} | ${u.promptTokens.toLocaleString('en-GB')} | ${u.completionTokens.toLocaleString('en-GB')} | ${usd(u.cost)} |${r.prices ? ` ${usd(estimatedCost(u, r.prices))} |` : ''}`)
  if (r.prices) out.push('', `Estimated at $${r.prices.in} per million tokens in and $${r.prices.out} out (cache hits counted at the full price).`)
  out.push('')
  return out.join('\n')
}

/** Every passage written, for reading. */
export function passagesMarkdown(r: RunReport): string {
  const out = [`# Passages: ${r.tested.branch} @ ${r.tested.commit.slice(0, 9)}`, '']
  for (const p of r.probes) {
    for (const m of p.samples) {
      out.push(`## ${p.id} #${m.index + 1}: ${p.asks}`, '')
      if (m.status !== 'complete') {
        out.push(`(not written: ${m.error ?? m.status})`, '')
        continue
      }
      out.push(m.text.trim(), '')
      const x = m.repair
      if (!x) continue
      if (!x.checked) {
        out.push('*Check and repair checked nothing here.*', '')
        continue
      }
      out.push(`### Check and repair: ${x.claims} claim${x.claims === 1 ? '' : 's'} checked, ${x.slips} slip${x.slips === 1 ? '' : 's'}`, '')
      for (const f of x.fixes) out.push(`- Fix${f.made ? '' : ' (not made)'}: “${f.was}” → “${f.now}”: ${f.why}`)
      for (const q of x.questions) out.push(`- Question: ${q}`)
      if (x.fixes.length || x.questions.length) out.push('')
      if (x.text !== m.text) out.push('After the fixes:', '', x.text.trim(), '')
    }
  }
  return out.join('\n')
}

/** Two runs side by side (say main, then the step 2 branch), by trap and in all. */
export function compareMarkdown(a: RunReport, b: RunReport): string {
  const name = (r: RunReport): string => `${r.tested.branch} @ ${r.tested.commit.slice(0, 7)}`
  const out = [`# Trap scores: ${name(a)} against ${name(b)}`, '']
  if (a.storyVersion !== b.storyVersion) out.push(`**Different story versions (${a.storyVersion} and ${b.storyVersion}): the scores don't compare.**`, '')
  if (JSON.stringify(a.models) !== JSON.stringify(b.models)) out.push(`Different models: ${JSON.stringify(a.models)} and ${JSON.stringify(b.models)}.`, '')
  if (a.fake || b.fake) out.push('One of the runs used the fake model: not a real score.', '')
  out.push(`| | ${name(a)} | ${name(b)} |`, '|---|---:|---:|')
  // A trap an older story version didn't have is shown as a dash.
  const cell = (t: Tally | undefined): string => (t ? `${pct(t.consistency)} (${t.broken} broken of ${t.kept + t.broken})` : '–')
  for (const t of TRAPS) out.push(`| ${t.name} | ${cell(a.summary.byTrap[t.id])} | ${cell(b.summary.byTrap[t.id])} |`)
  out.push(`| **All** | ${cell(a.summary.total)} | ${cell(b.summary.total)} |`)
  if (a.repaired || b.repaired) {
    const after = (r: RunReport): string => (r.repaired ? `${cell(r.repaired.total)}; ${r.repaired.made} fixes, ${r.repaired.questions} questions` : 'no repair')
    out.push(`| **All, after check and repair** | ${after(a)} | ${after(b)} |`)
  }
  const tokens = (r: RunReport): string => `${r.usage.total.promptTokens.toLocaleString('en-GB')} / ${r.usage.total.completionTokens.toLocaleString('en-GB')}`
  const per = (r: RunReport): string => (r.summary.total.brokenPerPassage == null ? '–' : r.summary.total.brokenPerPassage.toFixed(2))
  out.push(`| Broken per passage | ${per(a)} | ${per(b)} |`)
  out.push(`| Passages | ${a.summary.total.passages} | ${b.summary.total.passages} |`)
  out.push(`| Cost reported | ${usd(a.usage.total.cost)} | ${usd(b.usage.total.cost)} |`)
  out.push(`| Tokens in / out | ${tokens(a)} | ${tokens(b)} |`)
  out.push('')
  return out.join('\n')
}
