// Scoring, claim by claim. Each written passage gets one verdict per check:
//   kept        the judge says the passage keeps to the truth
//   broken      the passage contradicts it: the judge gave the bad answer with a quote found in the passage, or a
//               tripwire (a deterministic pattern) matched; for a check whose bad answer is "no" (something that should
//               happen and doesn't, like a promise kept), the judge's "no" is enough
//   unverified  the judge gave the bad answer but its quote isn't in the passage (not counted as broken)
//   silent      the passage doesn't touch it ("unclear"), or the judge's reply couldn't be read
// Consistency = kept / (kept + broken): of the checks a passage touched, how many it kept to. Pure, so it can be tested.

import type { JudgeAnswer } from './judge'
import { firstBreak, patternVerdict } from './patterns'
import { proseMarkdown, proseRows, type ProseMetrics, type ProseSummary } from './prose'
import { TRAPS, type Check, type Probe, type ProbeKind, type Tripwire } from './story'

/** A story's traps, as the report lists them. */
export type TrapList = { id: string; name: string }[]

export type Verdict = 'kept' | 'broken' | 'unverified' | 'silent'

export interface CheckResult {
  id: string
  trap: string
  ask: string
  verdict: Verdict
  /** What decided it. */
  by: 'judge' | 'tripwire' | 'pattern' | 'none'
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

/** One check's verdict from the judge's answer (undefined: no answer) and any tripwires paired with it. */
export function judgeCheck(check: Check, answer: JudgeAnswer | undefined, passage: string, tripwires: Tripwire[] = []): CheckResult {
  const base = { id: check.id, trap: check.trap, ask: check.ask }
  for (const t of tripwires) {
    if (t.check !== check.id) continue
    const hit = firstBreak({ broken: t.pattern, not: t.not, unlessBefore: t.unlessBefore, outsideQuotes: t.outsideQuotes }, passage)
    if (hit) return { ...base, verdict: 'broken', by: 'tripwire', answer: answer?.answer ?? '', quote: hit.text }
  }
  if (!answer || answer.answer === 'unclear') return { ...base, verdict: 'silent', by: answer ? 'judge' : 'none', answer: answer?.answer ?? '', quote: answer?.quote ?? '' }
  const r = { ...base, by: 'judge' as const, answer: answer.answer, quote: answer.quote }
  if (answer.answer !== check.bad) return { ...r, verdict: 'kept' }
  // Something that should have happened and didn't has nothing to quote.
  if (check.bad === 'no') return { ...r, verdict: 'broken' }
  return { ...r, verdict: quoteInPassage(passage, answer.quote) ? 'broken' : 'unverified' }
}

/**
 * Every check of a probe for one passage: the judge's (`answers` null: its reply couldn't be read) and the deterministic
 * patterns', which need no judge.
 */
export function scorePassage(probe: Pick<Probe, 'checks' | 'tripwires' | 'patterns'>, passage: string, answers: JudgeAnswer[] | null): CheckResult[] {
  const byId = new Map((answers ?? []).map((a) => [a.id.toUpperCase(), a]))
  const judged = probe.checks.map((c) => judgeCheck(c, byId.get(c.id.toUpperCase()), passage, probe.tripwires))
  const patterned = (probe.patterns ?? []).map((pc): CheckResult => {
    const v = patternVerdict(pc, passage)
    return { id: pc.id, trap: pc.trap, ask: pc.what, verdict: v.verdict, by: 'pattern', answer: '', quote: v.quote }
  })
  return [...judged, ...patterned]
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
  /** Of the prompt tokens, how many the provider read from its cache (billed for much less), when it says. */
  cachedTokens?: number
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
  judge: { status: 'ok' | 'unreadable' | 'failed' | 'skipped'; raw: string; asked?: string }
  results: CheckResult[]
  /** Step 3's check and repair on this passage, when the checkout has it. */
  repair?: RepairResult
  /** How it is written (the prose check), with the judge's marks when it gave them. */
  prose?: ProseMetrics
  /**
   * The app's records for this sample, in order (ids in the world's database, saved beside the report as
   * evidence-world.db): the writer's draft, a plan, where things stand, the repair, any memory reads. The judge's calls
   * aren't the app's: their reply is `judge.raw` and what they were asked is `judge.asked`.
   */
  records?: { id: string; job: string; kind: string }[]
}

/**
 * The repair's reply, claim by claim, as the harness reads it: the app doesn't report what it drops, so this counts
 * what it would drop by its own rules (a quote not in the new words, a line the request never had, a slip the model
 * itself says could be true with the line: "bothTrue": "yes").
 */
export interface RepairDrops {
  /** The reply could be read. */
  read: boolean
  claims: number
  slips: number
  quoteNotFound: number
  unknownLine: number
  bothTrueYes: number
  note: string
}

const flat = (t: string): string =>
  t
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** Counts what a repair reply holds and what the app's rules would drop (`request`: what it was asked, `words`: the new words). */
export function repairDrops(reply: string, request: string, words: string): RepairDrops {
  const note = "Counted by the harness from the repair's reply; the app reports only the claims it kept and the slips."
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  let claims: Record<string, unknown>[] = []
  try {
    const v = JSON.parse(reply.slice(start, end + 1)) as { claims?: unknown }
    if (!Array.isArray(v.claims)) throw new Error('no claims')
    claims = v.claims.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
  } catch {
    return { read: false, claims: 0, slips: 0, quoteNotFound: 0, unknownLine: 0, bothTrueYes: 0, note }
  }
  const text = flat(words)
  const lines = new Set([...request.matchAll(/\[([A-Z]\d+)\]|### ([A-Z]\d+)\b/g)].map((m) => m[1] ?? m[2]))
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    read: true,
    claims: claims.length,
    slips: claims.filter((c) => str(c.verdict).toLowerCase() === 'slip').length,
    quoteNotFound: claims.filter((c) => !str(c.quote).trim() || !text.includes(flat(str(c.quote)))).length,
    unknownLine: claims.filter((c) => !lines.has(str(c.line).toUpperCase().replace(/[^A-Z0-9]/g, ''))).length,
    bothTrueYes: claims.filter((c) => str(c.verdict).toLowerCase() === 'slip' && str(c.bothTrue ?? c.both_true).toLowerCase() === 'yes').length,
    note
  }
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
  /** What the repair's reply held and what fell away before the app judged it (counted by the harness: the app reports only claims and slips). */
  drops?: RepairDrops
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
  /** How the page was set up, when it matters (a fact closer than planned). */
  note?: string
  /** Step 5: whether its briefings could search by meaning when the probe began. */
  recall?: { available: boolean; meaning: boolean; state: string; engine: string | null; indexed: { done: number; total: number } | null; note: string | null }
  samples: SampleResult[]
}

export interface RunReport {
  storyVersion: number
  /** The probes' version (story version 3): runs with different probe versions don't compare. */
  probesVersion?: number
  /** The world saved before the first probe scene (for --from-world), or the saved world this run started from. */
  world?: { saved?: string; from?: string }
  /** Where the story came from (story.ts, or the written story-v3.json with its model and date). */
  storySource?: string
  /** The story's traps (absent in reports from before story version 3: version 2's). */
  traps?: TrapList
  /** Why the run stopped before the end (the token budget, say); absent when it finished. */
  stopped?: string
  /** Step 5 (recall by meaning), when the checkout has it: whether finding by meaning was in use for the probes. */
  recall?: { meaning: boolean; probes: number; withMeaning: number; engine: string | null; indexed: { done: number; total: number } | null; notes: string[] }
  /** The world's database (every record of the run) and the index of which records belong to which sample. */
  evidence?: { world: string; index: string }
  /** Probes v4: chains of AI steps in one scene, with drift checked at every step (absent for probes v1 to v3). */
  chains?: ChainResult[]
  chainSummary?: ChainSummary
  /** K3's plot threads (summariseThreads), when a chain with threads ran. */
  threads?: ThreadSummary
  /** Re-scored offline (npm run traps -- --rescore): from which report, and what would have needed the judge. */
  rescored?: { from: string; at: string; needJudge: { chain: string; sample: number; step: number; plant: string; quote: string }[] }
  /** The token budget and what was used of it. */
  budget?: { maxIn: number; maxOut: number; usedIn: number; usedOut: number }
  startedAt: string
  finishedAt: string
  fake: boolean
  /** The checkout whose app code was run (it may not be the harness's own). */
  tested: { root: string; branch: string; commit: string; dirty: boolean; appVersion: string }
  harness: { root: string; commit: string }
  provider: string
  /** USD per million tokens in and out, given for the run (DeepSeek's API reports tokens, not cost); null when not given. */
  prices?: { in: number; cached?: number; out: number } | null
  models: { writer: string; memory: string; judge: string }
  samples: number
  words: { generate: number; addBelow: number; beatScene: number }
  probes: ProbeResult[]
  usage: { byJob: Record<string, Usage>; judge: Usage; total: Usage }
  summary: Summary
  /** How the AI writes, over every passage (the prose check); absent in reports from before it. */
  prose?: ProseSummary
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
export function summarise(probes: ProbeResult[], after: 'written' | 'repaired' = 'written', traps: TrapList = TRAPS): Summary {
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
  for (const t of traps) byTrap[t.id] = tally(all.filter((r) => r.trap === t.id))
  const total = tally(all)
  return { byTrap, byProbe, total: { ...total, passages, brokenPerPassage: passages ? total.broken / passages : null } }
}

/** Step 5 over the run: how many probes searched by meaning, the most passages read, and anything worth knowing. */
export function recallSummary(probes: ProbeResult[]): NonNullable<RunReport['recall']> {
  const with_ = probes.filter((p) => p.recall)
  const meaning = with_.filter((p) => p.recall!.meaning)
  const indexed = with_.map((p) => p.recall!.indexed).filter((x): x is { done: number; total: number } => !!x)
  return {
    meaning: meaning.length > 0 && meaning.length === with_.length,
    probes: with_.length,
    withMeaning: meaning.length,
    engine: meaning[0]?.recall?.engine ?? null,
    indexed: indexed.length ? indexed[indexed.length - 1] : null,
    notes: [...new Set(with_.map((p) => p.recall!.note).filter((n): n is string => !!n))]
  }
}

/** The scores after check and repair, with what it did; undefined when no passage went through it. */
export function summariseRepair(probes: ProbeResult[], traps: TrapList = TRAPS): RunReport['repaired'] {
  const samples = probes.flatMap((p) => p.samples.filter((s) => s.status === 'complete' && s.repair))
  if (!samples.length) return undefined
  const reps = samples.map((s) => s.repair!)
  return {
    ...summarise(probes, 'repaired', traps),
    checked: reps.filter((x) => x.checked).length,
    fixes: reps.reduce((n, x) => n + x.fixes.length, 0),
    made: reps.reduce((n, x) => n + x.fixes.filter((f) => f.made).length, 0),
    questions: reps.reduce((n, x) => n + x.questions.length, 0)
  }
}

/** USD for these tokens at the given prices per million. */
export const estimatedCost = (u: Pick<Usage, 'promptTokens' | 'completionTokens' | 'cachedTokens'>, prices: { in: number; cached?: number; out: number }): number => {
  const cached = Math.min(u.cachedTokens ?? 0, u.promptTokens)
  return ((u.promptTokens - cached) * prices.in + cached * (prices.cached ?? prices.in) + u.completionTokens * prices.out) / 1_000_000
}

const pct = (v: number | null): string => (v == null ? '–' : `${Math.round(v * 100)}%`)
const usd = (v: number | null): string => (v == null ? 'not reported' : `$${v.toFixed(v < 0.1 ? 4 : 2)}`)
const MARK: Record<Verdict, string> = { kept: 'kept', broken: '**BROKEN**', unverified: 'unverified', silent: '·' }

// ---------- Chains (probes v4) ----------

/** One AI step of a chain: what it wrote, what it planted, and every check still in force when it landed. */
export interface ChainStepResult {
  step: number
  kind: 'continue' | 'addBelow'
  direction: string
  status: 'complete' | 'error' | 'stopped' | 'skipped'
  error: string | null
  /** Drafts it took for the step's planted events to land (1 to 3). */
  tries: number
  generationId: string | null
  words: number
  text: string
  /** The plants this step was asked for, and the words where each landed (`by: 'judge'` where the patterns missed it). */
  planted: { id: string; quote: string; by?: 'judge' }[]
  /** The checks of every earlier plant still in force, and of the facts from chapters back. */
  results: CheckResult[]
  judge: SampleResult['judge']
  repair?: RepairResult
  /** Plants a change shown in this step ended (she pulled her boots back on): not checked after it. */
  resolved: string[]
  /** How it is written (the prose check), with the judge's marks when it gave them. */
  prose?: ProseMetrics
  records?: { id: string; job: string; kind: string }[]
  /** K3's plot threads at this step (left out for chains without threads). */
  threads?: ThreadStepNote
}

/** What K3's thread checks measure: (a) premature, (b) payoff, (c) alive, (d) invented (README "K3"). */
export type ThreadCheck = 'premature' | 'payoff' | 'alive' | 'invented'
export const THREAD_CHECKS: ThreadCheck[] = ['premature', 'payoff', 'alive', 'invented']

/** A chain step's plot threads (K3): which were open, which the writer's prompt carried, which it touched unasked. */
export interface ThreadStepNote {
  /** Threads planted and not yet paid off (nor resolved on the page). */
  open: string[]
  /** Of those, the ones the step's direction doesn't name (all of them on a Continue). */
  dormant: string[]
  /** Of the dormant ones, those the step's words touch anyway (a soft measure, never a slip). */
  touched: string[]
  /**
   * The writer's prompt: the heading of a threads block in it ("Open threads", "Plot threads in this scene"; null when it
   * has none, as on main for a card with no threads) and the threads that block names. Null when no prompt was saved.
   */
  carried: { block: string | null; ids: string[] } | null
}

export interface ChainSample {
  index: number
  /** Step 5: whether finding by meaning was on for this chain (read before its first step). */
  recall?: ProbeResult['recall']
  status: 'complete' | 'abandoned' | 'stopped' | 'error'
  why: string | null
  steps: ChainStepResult[]
  /** The first step with a broken check (as written), or null. */
  firstSlip: number | null
  /** The edit chain (K2E): what Adam's edit changed and removed in the page, after which step. */
  edit?: ChainEditDone
}

export interface ChainEditDone {
  after: number
  /** The paragraphs' words before and after, for each paragraph the edit touched. */
  changed: { before: string; after: string }[]
  /** Sentences taken out. */
  removed: string[]
  /** Plants ended by the edit, and those it starts (in force from the next step). */
  ends: string[]
  starts: string[]
}

export interface ChainResult {
  id: string
  scene: string
  title: string
  opening: string[]
  plants: { id: string; name: string; step: number | null; thread?: { id: string; check: ThreadCheck } }[]
  /** K3's plot threads, by id and name (left out for chains without threads). */
  threads?: { id: string; name: string }[]
  steps: number
  samples: ChainSample[]
}

/** K3's plot threads over every chain that has them: the four checks, dormant threads touched, what the prompt carried. */
export interface ThreadSummary {
  threads: { id: string; name: string }[]
  byCheck: Record<ThreadCheck, Tally>
  dormant: { thread: string; name: string; steps: number; touched: number; samples: number; samplesTouched: number }[]
  carried: { steps: number; withPrompt: number; withBlock: number; blocks: Record<string, number>; byThread: Record<string, number> }
}

/** The thread checks' tallies and the soft measures, or null when no chain has threads. */
export function summariseThreads(chains: ChainResult[]): ThreadSummary | null {
  const withThreads = chains.filter((c) => c.threads?.length)
  if (!withThreads.length) return null
  const results: Record<ThreadCheck, CheckResult[]> = { premature: [], payoff: [], alive: [], invented: [] }
  const names = new Map<string, string>()
  const dormant = new Map<string, { steps: number; touched: number; samples: number; samplesTouched: number }>()
  const carried: ThreadSummary['carried'] = { steps: 0, withPrompt: 0, withBlock: 0, blocks: {}, byThread: {} }
  for (const c of withThreads) {
    for (const t of c.threads!) names.set(t.id, t.name)
    const checkOf = new Map(c.plants.filter((p) => p.thread).map((p) => [p.id, p.thread!.check]))
    for (const m of c.samples) {
      const seen = new Map<string, boolean>()
      for (const st of m.steps.filter((x) => x.status === 'complete')) {
        for (const r of st.results) {
          const k = checkOf.get(r.trap)
          if (k) results[k].push(r)
        }
        const n = st.threads
        if (!n) continue
        carried.steps++
        if (n.carried) {
          carried.withPrompt++
          if (n.carried.block) {
            carried.withBlock++
            carried.blocks[n.carried.block] = (carried.blocks[n.carried.block] ?? 0) + 1
          }
          for (const id of n.carried.ids) carried.byThread[id] = (carried.byThread[id] ?? 0) + 1
        }
        for (const id of n.dormant) {
          const d = dormant.get(id) ?? { steps: 0, touched: 0, samples: 0, samplesTouched: 0 }
          d.steps++
          if (n.touched.includes(id)) d.touched++
          dormant.set(id, d)
          seen.set(id, (seen.get(id) ?? false) || n.touched.includes(id))
        }
      }
      for (const [id, touched] of seen) {
        const d = dormant.get(id)!
        d.samples++
        if (touched) d.samplesTouched++
      }
    }
  }
  const byCheck = Object.fromEntries(THREAD_CHECKS.map((k) => [k, tally(results[k])])) as Record<ThreadCheck, Tally>
  return { threads: [...names].map(([id, name]) => ({ id, name })), byCheck, dormant: [...dormant].map(([thread, d]) => ({ thread, name: names.get(thread) ?? thread, ...d })), carried }
}

const THREAD_CHECK_NAMES: Record<ThreadCheck, string> = {
  premature: '(a) Not paid off before the step that asks for it',
  payoff: '(b) Paid off at the step that asks for it',
  alive: '(c) Kept alive on Continue (not contradicted or forgotten)',
  invented: '(d) No payoff that no direction asked for'
}

/** The report's plot-thread section (K3). */
export function threadsMarkdown(t: ThreadSummary | null | undefined): string[] {
  if (!t) return []
  const out = ['### Plot threads (K3)', '', '| Check | Kept | Broken | Unverified | Not touched | Consistency |', '|---|---:|---:|---:|---:|---:|']
  for (const k of THREAD_CHECKS) {
    const x = t.byCheck[k]
    out.push(`| ${THREAD_CHECK_NAMES[k]} | ${x.kept} | ${x.broken} | ${x.unverified} | ${x.silent} | ${pct(x.consistency)} |`)
  }
  out.push('', 'Dormant threads touched unasked (a soft measure, not a score): a thread is dormant at a step whose direction doesn’t name it.', '')
  out.push('| Thread | Steps dormant | Touched | Chains touching it at least once |', '|---|---:|---:|---:|')
  for (const d of t.dormant) out.push(`| ${d.name} | ${d.steps} | ${d.touched} | ${d.samplesTouched} of ${d.samples} |`)
  const c = t.carried
  const blocks = Object.entries(c.blocks).map(([b, n]) => `“${b}” ${n}`).join(', ')
  const by = Object.entries(c.byThread).map(([id, n]) => `${t.threads.find((x) => x.id === id)?.name ?? id} ${n}`).join(', ')
  out.push('', `Writer prompts with a threads block: ${c.withBlock} of ${c.withPrompt} steps with a saved prompt (${c.steps} steps)${blocks ? `: ${blocks}` : ''}${by ? `; threads named there: ${by}` : ''}.`, '')
  return out
}

export interface ChainSummary {
  total: Tally & { steps: number; samples: number }
  byPlant: Record<string, Tally & { resolved: number }>
  byStep: Record<string, Tally>
  /** For each step, how many chains had slipped by then (of those that got that far). */
  firstSlip: { step: number; slipped: number; of: number }[]
  /** The same, after check and repair mended what it could (step 3 on). */
  repaired?: Tally
  repair: { checked: number; fixes: number; made: number; questions: number }
}

/** The chains' checks, in all, by plant and by step, and when drift starts. */
export function summariseChains(chains: ChainResult[]): ChainSummary {
  const all: CheckResult[] = []
  const after: CheckResult[] = []
  const byStepR: Record<string, CheckResult[]> = {}
  const resolved: Record<string, number> = {}
  let steps = 0
  let samples = 0
  const repair = { checked: 0, fixes: 0, made: 0, questions: 0 }
  let anyRepair = false
  for (const c of chains) {
    for (const m of c.samples) {
      samples++
      for (const st of m.steps.filter((x) => x.status === 'complete')) {
        steps++
        all.push(...st.results)
        ;(byStepR[String(st.step)] ??= []).push(...st.results)
        for (const id of st.resolved) resolved[id] = (resolved[id] ?? 0) + 1
        after.push(...(st.repair ? st.repair.results : st.results))
        if (st.repair) {
          anyRepair = true
          if (st.repair.checked) repair.checked++
          repair.fixes += st.repair.fixes.length
          repair.made += st.repair.fixes.filter((f) => f.made).length
          repair.questions += st.repair.questions.length
        }
      }
    }
  }
  const byPlant: ChainSummary['byPlant'] = {}
  for (const id of [...new Set(all.map((r) => r.trap))]) byPlant[id] = { ...tally(all.filter((r) => r.trap === id)), resolved: resolved[id] ?? 0 }
  const byStep: Record<string, Tally> = {}
  for (const [k, v] of Object.entries(byStepR)) byStep[k] = tally(v)
  const most = Math.max(0, ...chains.map((c) => c.steps))
  const firstSlip: ChainSummary['firstSlip'] = []
  for (let n = 1; n <= most; n++) {
    const reached = chains.flatMap((c) => c.samples).filter((m) => m.steps.some((x) => x.step >= n && x.status === 'complete') || (m.firstSlip != null && m.firstSlip <= n))
    firstSlip.push({ step: n, slipped: reached.filter((m) => m.firstSlip != null && m.firstSlip <= n).length, of: reached.length })
  }
  return { total: { ...tally(all), steps, samples }, byPlant, byStep, firstSlip, ...(anyRepair ? { repaired: tally(after) } : {}), repair }
}

/** The chains as the report's usual summary: by plant (as traps), by chain (as probes), in all. */
export function chainsAsSummary(chains: ChainResult[]): Summary {
  const cs = summariseChains(chains)
  const byProbe: Record<string, Tally> = {}
  for (const c of chains) byProbe[c.id] = tally(c.samples.flatMap((m) => m.steps.flatMap((x) => x.results)))
  return { byTrap: cs.byPlant, byProbe, total: { ...cs.total, passages: cs.total.steps, brokenPerPassage: cs.total.steps ? cs.total.broken / cs.total.steps : null } }
}

/** The chains' section of the report. */
function chainsMarkdown(r: RunReport): string[] {
  const out: string[] = []
  const cs = r.chainSummary
  if (!r.chains || !cs) return out
  out.push('## Chains: drift step by step (probes v4)', '')
  out.push(
    `${cs.total.samples} chain${cs.total.samples === 1 ? '' : 's'}, ${cs.total.steps} AI steps checked. Consistency over every later-step check: **${pct(cs.total.consistency)}** (${cs.total.kept} kept, ${cs.total.broken} broken, ${cs.total.unverified} unverified, ${cs.total.silent} not touched).${cs.repaired ? ` After check and repair: ${pct(cs.repaired.consistency)} (${cs.repaired.broken} broken); the repair checked ${cs.repair.checked} steps, sent ${cs.repair.fixes} fixes (${cs.repair.made} made) and raised ${cs.repair.questions} questions.` : ''}`,
    ''
  )
  for (const c of r.chains) {
    out.push(`### ${c.id}. ${c.title}`, '')
    for (const m of c.samples) {
      const done = m.steps.filter((x) => x.status === 'complete').length
      out.push(
        `- Chain ${m.index + 1}: ${m.status === 'complete' ? `${done} steps` : `${m.status} after ${done} steps${m.why ? ` (${m.why})` : ''}`}; ${m.firstSlip == null ? 'no slip' : `first slip at step ${m.firstSlip}`}.`
      )
    }
    out.push('')
    out.push('| Plant | Planted at step | Kept | Broken | Not touched | Ended on the page | Consistency |', '|---|---:|---:|---:|---:|---:|---:|')
    for (const pl of c.plants) {
      const x = cs.byPlant[pl.id]
      if (!x) continue
      out.push(`| ${pl.name} | ${pl.step ?? (pl.thread ? 'not in this run' : 'from the story')} | ${x.kept} | ${x.broken} | ${x.silent} | ${x.resolved} | ${pct(x.consistency)} |`)
    }
    out.push('')
  }
  out.push('### When drift starts', '')
  out.push('| Step | Checks | Broken | Consistency | Chains slipped by this step |', '|---:|---:|---:|---:|---:|')
  for (const f of cs.firstSlip) {
    const t = cs.byStep[String(f.step)]
    out.push(`| ${f.step} | ${t ? t.kept + t.broken + t.silent + t.unverified : 0} | ${t?.broken ?? 0} | ${pct(t?.consistency ?? null)} | ${f.slipped} of ${f.of} |`)
  }
  out.push('')
  out.push(...threadsMarkdown(r.threads))
  const broken = r.chains.flatMap((c) => c.samples.flatMap((m) => m.steps.flatMap((st) => st.results.filter((x) => x.verdict === 'broken' || x.verdict === 'unverified').map((x) => ({ c, m, st, x })))))
  if (broken.length) {
    out.push('### What drifted', '')
    for (const { c, m, st, x } of broken) out.push(`- ${c.id} chain ${m.index + 1}, step ${st.step} (${st.kind}), ${x.trap}${x.verdict === 'unverified' ? ' (unverified)' : x.by === 'tripwire' ? ' (tripwire)' : ''}: ${x.ask}${x.quote ? ` — “${x.quote}”` : ''}`)
    out.push('')
  }
  return out
}

/** The short Markdown report. */
export function reportMarkdown(r: RunReport): string {
  const out: string[] = []
  const s = r.summary
  out.push(`# Trap scores: ${r.tested.branch} @ ${r.tested.commit.slice(0, 9)}${r.tested.dirty ? ' (app code with uncommitted changes)' : ''}`)
  out.push('')
  out.push(`- Story version ${r.storyVersion}${r.probesVersion ? `, probes v${r.probesVersion}` : ''}, ${r.samples} ${r.chains ? 'chain ' : ''}sample${r.samples === 1 ? '' : 's'}${r.chains ? '' : ' per probe'},${r.startedAt.slice(0, 16).replace('T', ' ')}${r.fake ? ' — **fake model (a check of the harness, not a score)**' : ''}`)
  out.push(`- Writer: \`${r.models.writer}\`; memory: \`${r.models.memory}\`; judge: \`${r.models.judge}\` (${r.provider})`)
  out.push(`- App code from \`${r.tested.root}\` (version ${r.tested.appVersion}); harness at ${r.harness.commit.slice(0, 9)}`)
  if (r.storySource) out.push(`- Story: ${r.storySource}`)
  if (r.recall) {
    const x = r.recall
    out.push(
      `- Recall by meaning (step 5): ${x.meaning ? `on for every probe (${x.engine ?? '?'} engine)` : x.withMeaning ? `on for ${x.withMeaning} of ${x.probes} probes` : '**off**: keyword search, sticky entries and what was said only'}${x.indexed ? `; ${x.indexed.done} of ${x.indexed.total} passages read for meaning by the last probe` : ''}`
    )
    for (const n of x.notes) out.push(`  - ${n}`)
  }
  if (r.world?.from) out.push(`- Started from the saved world ${r.world.from} (no memory build before it)`)
  if (r.world?.saved) out.push(`- World saved for later runs: ${r.world.saved} (reuse with --from-world)`)
  if (r.budget) {
    out.push(
      `- Tokens: ${r.budget.usedIn.toLocaleString('en-GB')} in, ${r.budget.usedOut.toLocaleString('en-GB')} out (budget ${r.budget.maxIn.toLocaleString('en-GB')} in, ${r.budget.maxOut.toLocaleString('en-GB')} out)`
    )
  }
  if (r.stopped) out.push('', `**Stopped before the end: ${r.stopped}** The scores below cover only what was done.`)
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
  out.push(...chainsMarkdown(r))
  out.push(...proseMarkdown(r.prose))
  out.push(r.chains ? '## By plant' : '## By trap')
  out.push('')
  out.push(`| Trap | Kept | Broken | Unverified | Not touched | Consistency |${rp ? ' Broken after repair | After repair |' : ''}`)
  out.push(`|---|---:|---:|---:|---:|---:|${rp ? '---:|---:|' : ''}`)
  for (const t of r.traps ?? TRAPS) {
    const x = s.byTrap[t.id]
    if (!x) continue
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
    if (p.note) out.push(`*${p.note}*`, '')
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
  out.push(`| Job | Calls | Prompt tokens | Of them cached | Reply tokens | Cost reported |${r.prices ? ' Estimated cost |' : ''}`)
  out.push(`|---|---:|---:|---:|---:|---:|${r.prices ? '---:|' : ''}`)
  const rows: [string, Usage][] = [...Object.entries(r.usage.byJob), ['judge', r.usage.judge], ['total', r.usage.total]]
  for (const [job, u] of rows)
    out.push(
      `| ${job} | ${u.calls} | ${u.promptTokens.toLocaleString('en-GB')} | ${u.cachedTokens == null ? '–' : u.cachedTokens.toLocaleString('en-GB')} | ${u.completionTokens.toLocaleString('en-GB')} | ${usd(u.cost)} |${r.prices ? ` ${usd(estimatedCost(u, r.prices))} |` : ''}`
    )
  if (r.prices) {
    out.push(
      '',
      `Estimated at $${r.prices.in} per million tokens in, $${r.prices.cached ?? r.prices.in} for those read from the provider's cache, and $${r.prices.out} out (DeepSeek's chat prices unless set with --price-in, --price-cached, --price-out; check Flash's). The memory's calls don't record cache hits, so they count at the full price.`
    )
  }
  out.push('')
  return out.join('\n')
}

/** Every passage written, for reading. */
export function passagesMarkdown(r: RunReport): string {
  const out = [`# Passages: ${r.tested.branch} @ ${r.tested.commit.slice(0, 9)}`, '']
  for (const c of r.chains ?? []) {
    for (const m of c.samples) {
      out.push(`## ${c.id} chain ${m.index + 1}: ${c.title}${m.status === 'complete' ? '' : ` (${m.status}${m.why ? `: ${m.why}` : ''})`}`, '')
      out.push('*The opening, as Adam would type it:*', '', ...c.opening.flatMap((x) => [x, '']))
      for (const st of m.steps) {
        out.push(`### Step ${st.step}: ${st.kind === 'addBelow' ? 'Add below' : 'Continue'}${st.direction ? ` — “${st.direction}”` : ''}${st.tries > 1 ? ` (${st.tries} tries)` : ''}`, '')
        if (st.status !== 'complete') {
          out.push(`(not written: ${st.error ?? st.status})`, '')
          continue
        }
        out.push(st.text.trim(), '')
        const bad = st.results.filter((x) => x.verdict === 'broken' || x.verdict === 'unverified')
        if (st.planted.length) out.push(`- Planted: ${st.planted.map((x) => (x.by === 'judge' ? `${x.id} (by the judge)` : x.id)).join(', ')}`)
        for (const x of bad) out.push(`- ${x.verdict === 'broken' ? 'Broken' : 'Unverified'}: ${x.trap} — ${x.ask}${x.quote ? ` “${x.quote}”` : ''}`)
        if (st.resolved.length) out.push(`- Ended on the page: ${st.resolved.join(', ')}`)
        if (st.repair?.checked) {
          for (const f of st.repair.fixes) out.push(`- Repair fix${f.made ? '' : ' (not made)'}: “${f.was}” → “${f.now}”: ${f.why}`)
          for (const q of st.repair.questions) out.push(`- Repair question: ${q}`)
        }
        if (st.planted.length || bad.length || st.resolved.length || st.repair?.fixes.length || st.repair?.questions.length) out.push('')
      }
    }
  }
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
  if ((a.probesVersion ?? 0) !== (b.probesVersion ?? 0)) out.push(`**Different probe versions (${a.probesVersion ?? '–'} and ${b.probesVersion ?? '–'}): the scores don't compare.**`, '')
  if ((a.storySource ?? '') !== (b.storySource ?? '')) out.push(`Different stories: ${a.storySource ?? 'version 1 or 2'} and ${b.storySource ?? 'version 1 or 2'}.`, '')
  for (const r of [a, b]) if (r.stopped) out.push(`${name(r)} stopped before the end: ${r.stopped}`, '')
  out.push(`| | ${name(a)} | ${name(b)} |`, '|---|---:|---:|')
  // A trap an older story version didn't have is shown as a dash.
  const cell = (t: Tally | undefined): string => (t ? `${pct(t.consistency)} (${t.broken} broken of ${t.kept + t.broken})` : '–')
  const traps = [...(a.traps ?? TRAPS), ...(b.traps ?? TRAPS)].filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
  for (const t of traps) out.push(`| ${t.name} | ${cell(a.summary.byTrap[t.id])} | ${cell(b.summary.byTrap[t.id])} |`)
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
  if (a.prose || b.prose) {
    // The prose check, side by side (a report from before it has none).
    const ra = a.prose ? proseRows(a.prose) : null
    const rb = b.prose ? proseRows(b.prose) : null
    out.push('## Prose', '', `| | ${name(a)} | ${name(b)} |`, '|---|---|---|')
    for (const [i, [what]] of (ra ?? rb)!.entries()) out.push(`| ${what} | ${ra?.[i][1] ?? '–'} | ${rb?.[i][1] ?? '–'} |`)
    out.push('')
  }
  return out.join('\n')
}
