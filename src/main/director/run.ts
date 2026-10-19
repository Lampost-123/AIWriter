// Directed writing, the stretch loop (Adam's spec, "Directed writing (an option)", 2026-10-19). With it on, a draft is
// written a stretch at a time and a director steers the writer between stretches, like a film director giving notes
// between takes; the director never writes prose.
//   1. The writer writes one stretch (one beat of the scene plan, or about 250 words) and pauses at the end of a
//      paragraph (stretch.ts). Its words stream into the page as any draft's do.
//   2. The free checks read the stretch (checks.ts); the director is asked (one short call, prompts.ts) only when one
//      found something, a planned beat or ask is overdue, Adam gave a note, or the plan's stretches are written and the
//      scene doesn't yet show it is complete (decide.ts); otherwise the decision is made for free.
//   3. Carry on with a note for the next stretch; take the last paragraph again with a reason (it leaves the page and is
//      written anew; at most MOST_RETAKES times); or the scene is done.
//   4. The writer carries on from the draft's actual words, with the note, in a request that starts exactly as every other
//      stretch's does (the briefing), so the provider's cache covers most of it.
//   5. Adam's notes, typed while it writes, go in at the next pause (live.ts).
// At most MOST_STRETCHES stretches; Stop stops it at once (the draft's own Stop: the words so far are kept). Each stretch's
// note and why are kept with the draft's record ("Steps it took" in What the AI saw). It is a DraftStream (ai/drafts.ts):
// the draft's record, filters, saving, events and ending are the plain draft's own.

import type Database from 'better-sqlite3'
import type { AgentStep, ChatMessage, GenerationRecord, ID } from '@shared/types'
import type { DirectorPhase } from '@shared/contracts/director'
import { countWords } from '@shared/defaults'
import { streamChat, type SentParams, type StreamChatOptions, type StreamOutcome } from '../ai/client'
import type { DraftPage, DraftStream, Emit } from '../ai/drafts'
import { runTask, stopTask } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import { estimateTokens } from '../keeper/text'
import { newId } from '../util'
import { checkStretch, type CheckWorld, type StretchFinding } from './checks'
import { decisionLine, freeDecision, progressOf, reasonsToAsk, type Decision, type Why } from './decide'
import { DIRECTOR_REPLY_TOKENS, DIRECTOR_TEMPERATURE, directorMessages, readVerdict } from './prompts'
import { closeLive, openLive, takeNotes, waitingNotes } from './live'
import {
  HOLD_AT,
  lastParagraph,
  lastSentenceEnd,
  MOST_RETAKES,
  MOST_STRETCHES,
  STOP_AT,
  STRETCH_WORDS,
  StretchCutter,
  stretchAsk,
  stretchMessages,
  stretchTokens,
  type StretchPlan,
  type StretchUnit
} from './stretch'

type DB = Database.Database
type GenerationParams = GenerationRecord['params']

/** A draft runs on no longer than this many times the words it aims for, whatever the director says. */
export const LONGEST = 1.6

export interface DirectorSetup {
  db: DB
  sceneId: ID
  /** The stretches: the scene plan's beats (else the card's), the words aimed for. */
  plan: StretchPlan
  /** The image the scene ends on ('' for none). */
  closing: string
  /** The checklist: the scene contract's "must change" asks (ai/contract.ts). */
  asks: string[]
  /** Adam's direction for the draft. */
  direction: string
  /** The scene's own words the draft carries on from (Add below): the checks read them, the writer was given them. */
  carryOn: string
  checks: CheckWorld
  /** The director model (Settings › Models, 'director'); null: decisions are made for free only. */
  model: JobModel | null
  /** For the director's line in the window ('director:progress'). */
  emit: Emit
  /** Write the whole chapter's drafts: nothing is said to the window as it goes. */
  quiet?: boolean
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()
const clip = (s: string, most: number): string => (s.length > most ? `${s.slice(0, most - 1).trimEnd()}…` : s)
/** Two runs of words as the page has them: a paragraph between. */
const joined = (a: string, b: string): string => [a.trim(), b.trim()].filter(Boolean).join('\n\n')

/** What the stretches cost together, as one draft's outcome reports it. */
class Totals {
  prompt = 0
  cached: number | null = null
  completion = 0
  cost = 0
  costKnown = true
  retries = 0
  calls = 0
  sent: SentParams | null = null
  effort: string | null = null

  add(o: StreamOutcome, messages: readonly ChatMessage[], text: string): void {
    this.calls++
    this.prompt += o.promptTokens ?? estimateTokens(messages.map((m) => m.content).join('\n'))
    if (o.cachedTokens != null) this.cached = (this.cached ?? 0) + o.cachedTokens
    this.completion += o.completionTokens ?? estimateTokens(text)
    if (o.cost == null) this.costKnown = false
    else this.cost += o.cost
    this.retries += o.retries
    this.sent = o.sentParams
    this.effort = o.effort
  }
}

/** The plan's stretch to write next (past the plan: one more, to land what didn't). */
const unitAt = (plan: StretchPlan, i: number): StretchUnit =>
  plan.units[i] ?? { beats: [], words: Math.min(STRETCH_WORDS, Math.max(...plan.units.map((u) => u.words), 120)) }

/** The line the window shows while a stretch is written (the window shows which stretch beside it). */
function writingLine(unit: StretchUnit, n: number, of: number): string {
  const beat = unit.beats[0] ? clip(clean(unit.beats[0]).replace(/[.!]+$/, ''), 80) : ''
  if (beat) return `Writing: ${beat}`
  return n > of ? 'Writing one more stretch' : 'Writing the next stretch'
}

/** The record of one stretch, for What the AI saw. */
function stepOf(o: {
  n: number
  of: number
  unit: StretchUnit
  words: number
  findings: readonly StretchFinding[]
  why: readonly Why[]
  asked: 'yes' | 'no' | 'failed'
  askError: string
  decision: Decision
  adam: readonly string[]
  retake: number
  overruled: string
}): AgentStep {
  const verdict = o.decision.verdict === 'continue' ? 'Carry on' : o.decision.verdict === 'retake' ? 'Take the last paragraph again' : 'The scene is done'
  const what = o.retake
    ? `Wrote the last paragraph again (retake ${o.retake} of ${MOST_RETAKES}).`
    : `Wrote ${o.unit.beats.length ? `“${o.unit.beats.map(clean).join('” then “')}”` : 'what comes next'}: ${o.words} words (about ${o.unit.words} asked).`
  const lines = [
    what,
    o.findings.length ? `Free checks found:\n${o.findings.map((f) => `- ${f.message}${f.inLast ? ' (in the last paragraph)' : ''}`).join('\n')}` : 'Free checks: nothing found.',
    ...(o.adam.length ? [`Your notes: ${o.adam.map((a) => `“${a}”`).join(', ')}`] : []),
    o.asked === 'yes'
      ? `The director was asked, because:\n${o.why.map((w) => `- ${w.text}`).join('\n')}`
      : o.asked === 'failed'
        ? `The director couldn’t be asked (${o.askError || 'no answer'}), so this was decided without it.`
        : 'The director wasn’t asked: nothing was wrong or overdue.',
    `Decision: ${verdict}.${o.overruled ? ` (${o.overruled})` : ''}`,
    o.decision.reason ? `Why: ${o.decision.reason}` : '',
    o.decision.note ? `Note for the writer: ${o.decision.note}` : ''
  ]
  return {
    label: `${o.retake ? `Stretch ${o.n}, retake ${o.retake}` : `Stretch ${o.n} of ${Math.max(o.of, o.n)}`} · ${verdict}`,
    tool: 'director',
    arguments: '',
    result: lines.filter(Boolean).join('\n')
  }
}

/**
 * The director's one short call: through the task runner (its own record, job 'director', on the director model; it
 * stops with the draft's Stop). The decision, or why there is none (then it is made for free).
 */
async function askDirector(
  s: DirectorSetup,
  signal: AbortSignal,
  messages: ChatMessage[]
): Promise<{ decision: Omit<Decision, 'by'> | null; error: string; called: boolean }> {
  if (!s.model) return { decision: null, error: 'no director model', called: false }
  const taskId = newId()
  const stop = (): void => void stopTask(taskId)
  signal.addEventListener('abort', stop, { once: true })
  try {
    const r = await runTask({
      db: s.db,
      taskId,
      job: 'director',
      sceneId: s.sceneId,
      model: s.model,
      messages,
      reply: DIRECTOR_REPLY_TOKENS,
      temperature: DIRECTOR_TEMPERATURE,
      topP: 1,
      blocks: [
        {
          id: 'director',
          title: 'Directing the draft',
          text: messages[1]?.content ?? '',
          tokens: estimateTokens(messages.map((m) => m.content).join('\n')),
          priority: 1,
          dropped: false,
          entryIds: []
        }
      ],
      // The draft's own events say how it goes; the director's call goes quietly.
      emit: () => undefined,
      // A provider that stops answering is given up on after about a minute: the draft carries on without the note.
      background: true,
      ...(s.fetchImpl ? { fetchImpl: s.fetchImpl } : {}),
      ...(s.retryDelays ? { retryDelays: s.retryDelays } : {})
    })
    if (r.status !== 'complete') return { decision: null, error: r.status === 'stopped' ? 'stopped' : (r.error ?? 'it went wrong'), called: true }
    const v = readVerdict(r.text)
    return v ? { decision: v, error: '', called: true } : { decision: null, error: 'its answer couldn’t be read', called: true }
  } catch (e) {
    return { decision: null, error: e instanceof Error ? e.message : String(e), called: false }
  } finally {
    signal.removeEventListener('abort', stop)
  }
}

/** Writes one stretch (or one paragraph again) into the page; what came back. */
async function writeOne(
  args: StreamChatOptions,
  page: DraftPage,
  messages: ChatMessage[],
  words: number,
  paragraph: boolean
): Promise<StreamOutcome> {
  const thinks = !!args.thinking && args.thinking !== 'off'
  const limit = thinks ? args.body.max_tokens : Math.max(80, Math.min(args.body.max_tokens, stretchTokens(words)))
  const cutter = new StretchCutter({ stopAt: paragraph ? 1 : Math.round(words * STOP_AT), holdAt: Math.round(words * HOLD_AT) })
  const ctl = new AbortController()
  const stop = (): void => ctl.abort()
  args.signal.addEventListener('abort', stop, { once: true })
  if (args.signal.aborted) ctl.abort()
  // A stretch starts a paragraph of its own; one written again goes where the paragraph taken back was.
  const so = page.text()
  const joiner = !so.trim() || /\n$/.test(so) ? '' : '\n\n'
  let started = false
  const give = (t: string): void => {
    if (!t) return
    if (!started) {
      started = true
      args.onText(joiner)
    }
    args.onText(t)
  }
  let lead = true
  let outcome: StreamOutcome
  try {
    outcome = await streamChat({
      ...args,
      body: { ...args.body, messages, max_tokens: limit },
      fallbackMaxTokens: Math.min(args.fallbackMaxTokens ?? limit, limit),
      signal: ctl.signal,
      onText: (raw) => {
        if (cutter.stopped) return
        let t = raw
        if (lead) {
          t = t.replace(/^\s+/, '')
          if (!t) return
          lead = false
        }
        const r = cutter.push(t)
        give(r.out)
        if (r.stop) ctl.abort()
      }
    })
  } finally {
    args.signal.removeEventListener('abort', stop)
  }
  const cutOff = outcome.cutOff || outcome.finishReason === 'length'
  give(cutter.end(cutOff))
  page.settle()
  // Cut off by the reply limit before the cutter held anything back (a model that writes less in one go than the
  // stretch's room): the unfinished sentence comes off the page with its paragraph, and the paragraph goes back without it.
  if (cutOff && started && outcome.status !== 'error') {
    const all = page.text()
    const para = lastParagraph(all)
    const at = lastSentenceEnd(para, true)
    if (para && at < para.length) {
      page.takeBack(all.length - (all.replace(/\s+$/, '').length - para.length))
      if (at > 0) {
        args.onText(para.slice(0, at))
        page.settle()
      }
    }
  }
  // Stopped by the cutter at a paragraph's end: as good as finished.
  if (outcome.status === 'stopped' && !args.signal.aborted) outcome = { ...outcome, status: 'complete', cutOff: false }
  return outcome
}

/**
 * The stretch loop as a DraftStream (ai/drafts.ts): what the draft's record keeps (each stretch's note and why) and how
 * it runs. See the top of this file.
 */
export function directedStream(s: DirectorSetup): DraftStream {
  const steps: AgentStep[] = []
  const counts = { stretches: 0, retakes: 0, directorCalls: 0, notes: 0 }
  return {
    params: (): Partial<GenerationParams> => ({ ...(steps.length ? { steps: [...steps] } : {}), directed: { ...counts } }),
    run: async (args, page, job) => {
      openLive(job.generationId, job.sceneId)
      try {
        return await loop(s, args, page, job, steps, counts)
      } finally {
        closeLive(job.generationId)
      }
    }
  }
}

async function loop(
  s: DirectorSetup,
  args: StreamChatOptions,
  page: DraftPage,
  job: { generationId: ID; sceneId: ID },
  steps: AgentStep[],
  counts: { stretches: number; retakes: number; directorCalls: number; notes: number }
): Promise<StreamOutcome> {
  const base = args.body.messages
  const plan = s.plan
  const of = plan.units.length
  const totals = new Totals()
  let note = ''
  let adamNext: string[] = []
  let shown: { stretch: number; phase: DirectorPhase; line: string; note: string } = { stretch: 1, phase: 'writing', line: '', note: '' }
  const tell = (o: Partial<typeof shown> & { taken?: string[] }): void => {
    shown = { stretch: o.stretch ?? shown.stretch, phase: o.phase ?? shown.phase, line: o.line ?? shown.line, note: o.note ?? shown.note }
    if (s.quiet) return
    try {
      s.emit('director:progress', {
        generationId: job.generationId,
        sceneId: job.sceneId,
        ...shown,
        of,
        waiting: waitingNotes(job.generationId),
        ...(o.taken?.length ? { taken: o.taken } : {})
      })
    } catch (e) {
      console.warn('Could not tell the window how the draft is directed', e)
    }
  }
  const done = (status: StreamOutcome['status'], failed?: StreamOutcome): StreamOutcome => {
    if (status !== 'error') tell({ phase: 'done', line: status === 'stopped' ? 'Stopped.' : shown.line || 'That’s the scene.' })
    return {
      status,
      text: page.text(),
      error: status === 'error' ? (failed?.error ?? 'Something went wrong while writing. The text that arrived is kept.') : null,
      failure: status === 'error' ? (failed?.failure ?? null) : null,
      promptTokens: totals.calls ? totals.prompt : null,
      cachedTokens: totals.cached,
      completionTokens: totals.calls ? totals.completion : null,
      cost: totals.calls && totals.costKnown ? totals.cost : null,
      finishReason: status === 'complete' ? 'stop' : (failed?.finishReason ?? null),
      retries: totals.retries,
      maxTokens: args.body.max_tokens,
      cutOff: false,
      sentParams: totals.sent ?? args.startParams ?? { tokenParam: 'max_tokens', sampling: true },
      effort: totals.effort
    }
  }

  for (;;) {
    if (args.signal.aborted) return done('stopped')
    if (counts.stretches >= MOST_STRETCHES) break
    const i = counts.stretches
    const unit = unitAt(plan, i)
    const before = page.text()
    const ask = stretchAsk({
      stretch: i + 1,
      of: Math.max(of, i + 1),
      unit,
      note,
      adam: adamNext,
      last: i >= of - 1,
      closing: s.closing,
      first: !before.trim()
    })
    const messages = stretchMessages(base, before, ask)
    tell({ stretch: i + 1, phase: 'writing', line: writingLine(unit, i + 1, of), note, ...(adamNext.length ? { taken: adamNext } : {}) })
    const wrote = await writeOne(args, page, messages, unit.words, false)
    totals.add(wrote, messages, page.text().slice(before.length))
    if (wrote.status === 'error') return done('error', wrote)
    if (args.signal.aborted) return done('stopped')
    counts.stretches++
    let stretchText = page.text().slice(before.length).replace(/^\s+/, '')
    if (!stretchText.trim()) {
      steps.push({ label: `Stretch ${i + 1} · The scene is done`, tool: 'director', arguments: '', result: 'The writer had nothing more to write, so the scene ends here.' })
      break
    }

    // Read the stretch and decide; after a retake, read it again.
    let retakes = 0
    let decision: Decision
    for (;;) {
      tell({ phase: 'checking', line: 'Reading the stretch…' })
      const adam = takeNotes(job.generationId)
      counts.notes += adam.length
      const findings = checkStretch(s.checks, { before: joined(s.carryOn, before), stretch: stretchText })
      const words = countWords(page.text())
      const progress = progressOf(plan, s.asks, s.closing, joined(s.carryOn, page.text()), stretchText)
      const why = reasonsToAsk({ findings, progress, plan, stretches: counts.stretches, words, adam })
      const free = (): Decision => freeDecision({ findings, progress, plan, stretches: counts.stretches, retakes })
      let asked: 'yes' | 'no' | 'failed' = 'no'
      let askError = ''
      if (why.length && s.model) {
        tell({ phase: 'directing', line: 'The director is reading the stretch…' })
        const r = await askDirector(
          s,
          args.signal,
          directorMessages({
            plan,
            progress,
            stretch: counts.stretches,
            of,
            closing: s.closing,
            direction: s.direction,
            findings,
            why,
            before: joined(s.carryOn, before),
            stretchText,
            retakes,
            next: plan.units[counts.stretches] ?? null
          })
        )
        if (r.called) counts.directorCalls++
        if (args.signal.aborted) return done('stopped')
        if (r.decision) {
          decision = { ...r.decision, by: 'director' }
          asked = 'yes'
        } else {
          decision = free()
          asked = 'failed'
          askError = r.error
        }
      } else decision = free()
      // The limits: a paragraph is taken again at most MOST_RETAKES times; a stretch with no paragraph can't be.
      let overruled = ''
      if (decision.verdict === 'retake' && (retakes >= MOST_RETAKES || !lastParagraph(stretchText).trim())) {
        overruled = retakes >= MOST_RETAKES ? `It has been taken again ${MOST_RETAKES} times already, so it stays as it is.` : ''
        // As if no retake were left: carry on, or end when the plan's stretches are written.
        const f = freeDecision({ findings, progress, plan, stretches: counts.stretches, retakes: MOST_RETAKES })
        decision = f.verdict === 'done' ? { ...f, by: decision.by } : { ...f, note: decision.note || f.note, by: decision.by }
      }
      // Past the longest a draft may run, or the most stretches, it ends whatever was decided.
      if (decision.verdict === 'continue' && (words >= plan.target * LONGEST || counts.stretches >= MOST_STRETCHES) && counts.stretches >= of) {
        overruled = words >= plan.target * LONGEST ? 'The draft is long enough already, so it ends here.' : `That was the last of ${MOST_STRETCHES} stretches.`
        decision = { ...decision, verdict: 'done' }
      }
      steps.push(
        stepOf({ n: counts.stretches, of, unit, words: countWords(stretchText), findings, why, asked, askError, decision, adam, retake: retakes, overruled })
      )
      const next = decision.verdict === 'continue' ? unitAt(plan, counts.stretches) : null
      tell({ phase: decision.verdict === 'retake' ? 'retaking' : 'writing', line: decisionLine(decision, next), note: decision.verdict === 'continue' ? decision.note : '' })
      if (decision.verdict !== 'retake') {
        note = decision.verdict === 'continue' ? decision.note : ''
        adamNext = decision.verdict === 'continue' ? adam : []
        break
      }
      // Take the last paragraph again: it leaves the page, and is written anew where it was.
      retakes++
      counts.retakes++
      const all = page.text()
      const paragraph = lastParagraph(all)
      // The paragraph and anything after it (spaces, a line break the writer ended on).
      page.takeBack(all.length - (all.replace(/\s+$/, '').length - paragraph.length))
      const kept = page.text()
      const again = stretchMessages(
        base,
        kept,
        stretchAsk({
          stretch: counts.stretches,
          of: Math.max(of, counts.stretches),
          unit,
          note: decision.note,
          adam,
          last: false,
          closing: s.closing,
          first: !kept.trim(),
          retake: { paragraph, reason: decision.reason || 'it has a slip' }
        })
      )
      const rewrote = await writeOne(args, page, again, Math.max(60, countWords(paragraph)), true)
      totals.add(rewrote, again, page.text().slice(kept.length))
      if (rewrote.status === 'error') return done('error', rewrote)
      if (args.signal.aborted) return done('stopped')
      // Nothing came: the paragraph as it was goes back.
      if (!page.text().slice(kept.length).trim()) {
        args.onText(paragraph)
        page.settle()
      }
      stretchText = page.text().slice(before.length).replace(/^\s+/, '')
    }
    if (decision.verdict === 'done') break
  }
  return done('complete')
}

/** The words a stretch plan aims for, for tests and the record. */
export const planWords = (plan: StretchPlan): number => plan.units.reduce((n, u) => n + u.words, 0)

/** Re-exported for the caller's checks: whether a director model can be asked. */
export type { JobModel }
