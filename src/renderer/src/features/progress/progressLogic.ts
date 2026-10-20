// The top bar's writing progress (Adam, 2026-10-20: "when the AI is writing a chapter or a scene there is no way to see
// its progress other than this"): the pill's words, and the progress card's steps, scenes, what it is doing right now,
// the bar, the time so far and about how long is left, the cost so far and which model does each step. Pure, so it is
// unit-tested; WritingStatus.tsx shows it. Everything comes from what the window already hears: the chapter writer's
// progress (with its scenes and words since this card), a Generate draft's words and steps, and the memory's status.

import type { ChapterWriterDoing, ChapterWriterProgress, ChapterWriterReport } from '@shared/contracts/chapterWriter'
import type { DraftStep } from '@shared/contracts/calm'
import { CHAPTER_WRITER_LIMITS } from '@shared/contracts/chapterWriter'
import type { ID, Job, MemoryStatus, ModelChoice } from '@shared/types'
import { AUTO_LENGTH } from '@shared/defaults'
import { jobModelName } from '@shared/modelJobs'
import { memoryFor } from '@/features/consistency/runsLogic'
import { lookupWords } from '@/features/waits/waitWords'

export type StepState = 'done' | 'now' | 'next'

export interface StepView {
  label: string
  state: StepState
  /** The model that does this step ('' when none is set). */
  model: string
}

export interface SceneRowView {
  sceneId: ID
  label: string
  state: 'waiting' | 'writing' | 'written'
  /** "1,240 words", "640 of about 1,500 words", "waiting". */
  words: string
  /** It is being checked or fixed now. */
  busy: boolean
}

export interface ProgressView {
  kind: 'chapter' | 'scene'
  /** The card's title: "Ch 3 · The Far Bank", "“Morning Confrontation”". */
  title: string
  /** The pill: what may be cut short ("Writing “Morning Confrontation”") and what never is ("640 of ~1,500 words"). */
  lead: string
  tail: string
  /** The pill's hover: the whole title, what it is doing, the model, and that a click says more. */
  hover: string
  steps: StepView[]
  /** All steps use one model: its name (said once); '' when they differ (each step says its own) or none is set. */
  oneModel: string
  scenes: SceneRowView[]
  /** What it is doing right now, in plain words, and the model doing it. */
  doing: string
  doingModel: string
  /** More about it, when there is more (the problem being fixed). */
  detail: string
  /** 0 to 1, or null for none to show. */
  fraction: number | null
  /** What the bar measures: "1,240 of about 6,000 words". */
  barLabel: string
  /** "4 min 10 s so far" ('' before it is worth saying). */
  elapsed: string
  /** "about 3 minutes left" ('' until there is enough to go on). */
  left: string
  /** "$0.04 so far" ('' when nothing is known). */
  cost: string
  /** The scene being written (Go to the scene), if any. */
  sceneId: ID | null
  /** Trying again after a failed call: the card says so plainly. */
  retrying: boolean
}

// ---------- Words ----------

const num = (n: number): string => Math.round(n).toLocaleString('en-US')
const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`

/** "1,240 words", "640 of about 1,500 words". */
export function wordsOf(words: number, target: number | null): string {
  if (target && target > 0) return `${num(words)} of about ${num(target)} words`
  return plural(words, 'word')
}

/** The pill's short form: "640 of ~1,500 words", "640 words". */
export function shortWordsOf(words: number, target: number | null): string {
  if (target && target > 0) return `${num(words)} of ~${num(target)} words`
  return plural(words, 'word')
}

/** "40 s", "4 min 10 s", "1 h 5 min" so far. */
export function elapsedWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} s so far`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${s % 60} s so far`
  return `${Math.floor(m / 60)} h ${m % 60} min so far`
}

/** "less than a minute left", "about a minute left", "about 4 minutes left", "about 1 hour 20 minutes left". */
export function leftWords(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 45) return 'less than a minute left'
  const m = Math.round(seconds / 60)
  if (m <= 1) return 'about a minute left'
  if (m < 60) return `about ${m} minutes left`
  const h = Math.floor(m / 60)
  const rest = Math.round((m - h * 60) / 5) * 5
  return `about ${h === 1 ? '1 hour' : `${h} hours`}${rest ? ` ${rest} minutes` : ''} left`
}

/** Dollars so far: "$0.42 so far", "less than a cent so far", '' before anything is known. */
export function spentWords(cost: number | null | undefined): string {
  if (!(cost != null && cost > 0)) return ''
  if (cost < 0.01) return 'less than a cent so far'
  return `$${cost.toFixed(2)} so far`
}

/**
 * About how many seconds are left, from how far it has got (0 to 1) in the time it has taken: only once there is enough
 * to go on (at least `minFraction` done and `minMs` taken); else from the estimate (seconds in all), if any, while it
 * still has time to run; else null.
 */
export function secondsLeft(o: { elapsedMs: number; fraction: number | null; estimateS?: number | null; minFraction?: number; minMs?: number }): number | null {
  const { elapsedMs, fraction } = o
  const enough = fraction != null && fraction >= (o.minFraction ?? 0.08) && elapsedMs >= (o.minMs ?? 20_000)
  if (enough && fraction! > 0) return Math.max(0, ((elapsedMs / 1000) * (1 - fraction!)) / fraction!)
  if (o.estimateS != null && o.estimateS * 1000 - elapsedMs > 30_000) return o.estimateS - elapsedMs / 1000
  return null
}

const clamp = (n: number): number => Math.max(0, Math.min(1, n))

/** Steps from where it is (index `now`; past the end: all done). */
function stepsAt(labels: { label: string; model: string }[], now: number): StepView[] {
  return labels.map((s, i) => ({ ...s, state: i < now ? 'done' : i === now ? 'now' : 'next' }))
}

/** One model for every step: its name; else ''. */
function sameModel(steps: { model: string }[]): string {
  const names = new Set(steps.map((s) => s.model))
  return names.size === 1 ? [...names][0] : ''
}

type Models = Partial<Record<Job, ModelChoice | null>> | null | undefined

// ---------- A chapter ----------

/** "Ch 3" and its own name ('' for one that is only its number), from where it is in its story. */
export function chapterNames(chapters: { id: ID; title: string }[] | null | undefined, chapterId: ID): { short: string; name: string } {
  const at = chapters?.findIndex((c) => c.id === chapterId) ?? -1
  const ch = at >= 0 ? chapters![at] : null
  const name = ch && !/^\s*(chapter\s+[\w-]+)?\s*$/i.test(ch.title) ? ch.title.trim() : ''
  return { short: at >= 0 ? `Ch ${at + 1}` : 'the chapter', name }
}

/** Write this chapter's three steps (buildLogic.ts writeStep) and the model each one uses. */
export function chapterSteps(models: Models): { label: string; model: string }[] {
  return [
    { label: 'The plan', model: jobModelName(models, 'chapter') },
    { label: 'Writing', model: jobModelName(models, 'writer') },
    { label: 'Checking and fixing', model: jobModelName(models, 'check') }
  ]
}

/** The model doing each thing a chapter run does. */
const DOING_JOB: Record<ChapterWriterDoing, Job> = {
  plan: 'chapter',
  review: 'chapter',
  memory: 'memory',
  draft: 'writer',
  check: 'check',
  follow: 'check',
  critic: 'writer',
  rewrite: 'writer',
  fix: 'writer'
}

/** What a draft is doing before its first words, in the card's words, and which job's model does it. */
export function stepDoing(step: Pick<DraftStep, 'step' | 'about'> | null, memory: Pick<MemoryStatus, 'catchingUp'> | null | undefined, sceneId: ID): { words: string; job: Job } | null {
  switch (step?.step) {
    case 'memory': {
      const m = memoryFor(memory, sceneId)
      const at = m && m.stage === 'earlier' && m.total > 1 ? `: scene ${Math.min(m.done + 1, m.total)} of ${m.total}` : ''
      return { words: `Waiting for the story’s memory to catch up${at}`, job: 'memory' }
    }
    case 'gathering':
      return { words: 'Gathering what the scene needs', job: 'memory' }
    case 'plan':
      return { words: 'Planning the scene', job: 'memory' }
    case 'lookups': {
      const what = lookupWords(step.about ?? [])
      return { words: what ? `Looking up ${what}` : 'Looking things up for the plan', job: 'memory' }
    }
    case 'writing':
      return { words: 'Writing: the first words are on their way', job: 'writer' }
    default:
      return null
  }
}

export interface ChapterInput {
  progress: ChapterWriterProgress
  chapter: { short: string; name: string }
  now: number
  models: Models
  /** The step the scene being drafted is on before its first words (draft:step), if heard. */
  step?: Pick<DraftStep, 'step' | 'about'> | null
  memory?: Pick<MemoryStatus, 'catchingUp'> | null
}

/** How many rounds of checks a run does at most: one after the drafts, and one after each round of fixes. */
const MOST_ROUNDS = CHAPTER_WRITER_LIMITS.fixRounds + 1

export function chapterView(i: ChapterInput): ProgressView {
  const p = i.progress
  const doing: ChapterWriterDoing = p.doing ?? (p.stage === 'planning' ? 'plan' : p.stage === 'review' ? 'review' : p.stage === 'drafting' ? 'draft' : p.stage === 'checking' ? 'check' : 'fix')
  const title = i.chapter.name ? `${i.chapter.short} · ${i.chapter.name}` : i.chapter.short
  const labels = chapterSteps(i.models)
  const stepNo = doing === 'plan' || doing === 'review' ? 0 : doing === 'draft' || doing === 'memory' || (doing === 'rewrite' && p.stage === 'drafting') ? 1 : 2
  const steps = stepsAt(labels, stepNo)
  const all = p.scenes ?? []
  const now = all.find((s) => s.sceneId === p.sceneId) ?? null
  const nowAt = now ? all.indexOf(now) + 1 : 0
  const written = all.filter((s) => s.state === 'written').length
  const totalWords = all.reduce((k, s) => k + (s.state === 'waiting' ? 0 : s.words), 0)
  const busyId = doing === 'check' || doing === 'fix' || doing === 'follow' || doing === 'rewrite' ? p.sceneId : null
  const scenes: SceneRowView[] = all.map((s) => ({
    sceneId: s.sceneId,
    label: s.label,
    state: s.state,
    words: s.state === 'waiting' ? 'waiting' : s.state === 'writing' ? wordsOf(s.words, s.target) : plural(s.words, 'word'),
    busy: busyId === s.sceneId
  }))

  // What it is doing right now.
  const sceneName = now ? now.label : 'the scene'
  let words: string
  let job: Job = DOING_JOB[doing]
  let detail = ''
  switch (doing) {
    case 'plan':
      words = 'Planning the chapter: reading the cards and looking up what the story’s memory says'
      break
    case 'review':
      words = 'The chapter plan is ready for you to read'
      break
    case 'memory':
      words = `Waiting for the story’s memory to catch up before writing ${sceneName}`
      break
    case 'draft': {
      const before = now && now.words === 0 && p.sceneId ? stepDoing(i.step ?? null, i.memory, p.sceneId) : null
      if (before) {
        words = `${before.words} for ${sceneName}`
        job = before.job
      } else words = `Writing ${sceneName}${all.length > 1 && nowAt ? ` (scene ${nowAt} of ${all.length})` : ''}`
      break
    }
    case 'check':
      words = `Checking ${sceneName} against the plan and the story so far`
      break
    case 'follow':
      words = 'Checking that the next scene still follows on'
      break
    case 'critic':
      words = 'The critic is reading the chapter'
      break
    case 'rewrite':
      words = `Writing ${sceneName} again: it missed part of the plan`
      break
    case 'fix':
      words = p.fixAt && p.fixAt.of > 1 ? `Fixing problem ${p.fixAt.at} of ${p.fixAt.of}, in ${sceneName}` : `Fixing a problem in ${sceneName}`
      detail = p.note.includes(': ') ? p.note.slice(p.note.indexOf(': ') + 2) : ''
      break
  }
  const retrying = !!p.retrying
  if (retrying) words = `Trying again: ${p.retrying!.replace(/\.$/, '')}`

  // How far it has got: the plan a little, the writing most (by words against each scene's aim), checking and fixing the rest.
  let fraction: number | null
  let barLabel: string
  const aims = all.map((s) => s.target ?? AUTO_LENGTH.typical)
  const aimAll = aims.reduce((a, b) => a + b, 0)
  if (stepNo === 0) {
    fraction = 0.04
    barLabel = doing === 'review' ? 'Step 1 of 3: the plan, waiting for you' : 'Step 1 of 3: the plan'
  } else if (stepNo === 1) {
    const got = all.reduce((k, s, n) => k + (s.state === 'written' ? aims[n] : s.state === 'writing' ? Math.min(s.words, aims[n] * 0.98) : 0), 0)
    fraction = 0.05 + 0.7 * (aimAll ? got / aimAll : written / Math.max(1, all.length))
    const aimed = all.every((s) => s.target != null)
    barLabel = all.length
      ? `${num(totalWords)} ${aimed ? `of about ${num(aimAll)} ` : ''}words · ${written} of ${plural(all.length, 'scene')} written`
      : 'Writing the scenes'
  } else {
    const round = Math.max(1, Math.min(p.round || 1, MOST_ROUNDS))
    const within = doing === 'fix' && p.fixAt ? 0.5 + 0.5 * (p.fixAt.at / Math.max(1, p.fixAt.of)) : doing === 'critic' ? 0.4 : 0.25
    fraction = Math.min(0.97, 0.75 + 0.25 * ((round - 1 + within) / MOST_ROUNDS))
    barLabel = `${num(totalWords)} words written · checking, round ${round} of up to ${MOST_ROUNDS}`
  }

  // The time so far (the run's own: not the time the plan waited for Adam), and about how long is left (from writing on).
  const ran = p.startedMs ? i.now - p.startedMs - (p.waitedMs ?? 0) : 0
  const elapsed = p.startedMs && doing !== 'review' && ran >= 5_000 ? elapsedWords(ran) : ''
  const writingFor = p.writingMs ? i.now - p.writingMs : 0
  const left =
    stepNo > 0 && p.writingMs && fraction != null
      ? leftWords(secondsLeft({ elapsedMs: writingFor, fraction: (fraction - 0.05) / 0.95, estimateS: p.estimate?.minutes != null ? p.estimate.minutes * 60 : null }))
      : ''

  const model = jobModelName(i.models, job)
  // The pill: never cut short where it counts.
  const lead =
    doing === 'review'
      ? 'The chapter plan is ready for you'
      : stepNo === 0
        ? `Planning ${i.chapter.short}`
        : stepNo === 1
          ? `Writing ${i.chapter.short}`
          : `${doing === 'fix' || doing === 'rewrite' ? 'Fixing' : 'Checking'} ${i.chapter.short}`
  const tail = retrying
    ? 'trying again'
    : stepNo === 1
      ? [nowAt && all.length > 1 ? `scene ${nowAt} of ${all.length}` : '', totalWords ? plural(totalWords, 'word') : ''].filter(Boolean).join(' · ')
      : doing === 'fix' && p.fixAt && p.fixAt.of > 1
        ? `${p.fixAt.at} of ${p.fixAt.of}`
        : stepNo === 2
          ? `round ${Math.max(1, p.round || 1)}`
          : ''
  return {
    kind: 'chapter',
    title,
    lead,
    tail,
    hover: `${title}: ${words}.${model ? ` Model: ${model}.` : ''} Click to see how it is going, or stop it.`,
    steps,
    oneModel: sameModel(labels),
    scenes,
    doing: words,
    doingModel: model,
    detail,
    fraction: fraction == null ? null : clamp(fraction),
    barLabel,
    elapsed,
    left,
    cost: spentWords(p.cost),
    sceneId: p.sceneId,
    retrying
  }
}

// ---------- One scene's draft ----------

export interface SceneInput {
  sceneId: ID
  /** The scene's title as the binder shows it ('' for none). */
  sceneTitle: string
  now: number
  /** The draft's phase (useDraft); 'idle' once it has ended and its words are being checked. */
  phase: 'starting' | 'streaming' | 'stopping' | 'idle'
  words: number
  target: number | null
  startedAt: number
  firstWordAt: number | null
  /** Its new words are being checked now (features/repair). */
  checking: boolean
  /** Why it is being tried again, while it is. */
  retrying: string | null
  /** Its step before its first words (draft:step), if heard; the plan waiting for Adam. */
  step: Pick<DraftStep, 'step' | 'about'> | null
  review: boolean
  memory?: Pick<MemoryStatus, 'catchingUp'> | null
  /** Plan before writing is on (Settings › Models). */
  planFirst: boolean
  /** Check new words straight away is on (Settings › Models): off, there is no Checking step. */
  checkNewWords: boolean
  /** The writer model's name (or the one this draft was tried with), and the memory model's. */
  model: string
  memoryModel: string
  /** A directed draft: the stretch it is on, of how many. */
  stretch?: { at: number; of: number } | null
}

export function sceneView(i: SceneInput): ProgressView {
  const name = `“${i.sceneTitle.trim() || 'Untitled scene'}”`
  const labels = [
    { label: 'The memory', model: i.memoryModel },
    ...(i.planFirst ? [{ label: 'The plan', model: i.memoryModel }] : []),
    { label: 'Writing', model: i.model },
    ...(i.checkNewWords ? [{ label: 'Checking', model: i.memoryModel }] : [])
  ]
  const at = (label: string): number => labels.findIndex((l) => l.label === label)
  // Past the last step when the new words aren't checked, so nothing reads as checking.
  const checkingAt = i.checkNewWords ? at('Checking') : labels.length
  const writingNow = i.words > 0 || i.step?.step === 'writing' || i.phase === 'streaming'
  let stepNo: number
  let words: string
  let model = i.model
  let short = ''
  if (i.checking && i.phase === 'idle' && i.checkNewWords) {
    stepNo = checkingAt
    words = 'Checking the new words against the story so far'
    model = i.memoryModel
  } else if (i.phase === 'stopping') {
    stepNo = at('Writing')
    words = 'Stopping: the words written so far stay in the scene'
  } else if (i.review) {
    stepNo = Math.max(0, at('The plan'))
    words = 'The plan is ready for you to read'
    model = i.memoryModel
    short = 'plan ready for you'
  } else if (writingNow) {
    stepNo = at('Writing')
    const st = i.stretch && i.stretch.of > 0 ? ` (stretch ${Math.min(i.stretch.at, i.stretch.of)} of ${i.stretch.of})` : ''
    words = i.words > 0 ? `Writing the scene${st}` : 'Writing: the first words are on their way'
  } else {
    const before = stepDoing(i.step, i.memory, i.sceneId)
    const kind = i.step?.step
    stepNo = kind === 'memory' || !kind ? 0 : i.planFirst ? at('The plan') : at('Writing')
    words = before?.words ?? 'Getting ready'
    model = before ? (before.job === 'writer' ? i.model : i.memoryModel) : i.memoryModel
    short = kind === 'memory' || !kind ? 'memory catching up' : kind === 'lookups' ? 'looking things up' : kind === 'plan' ? 'planning' : 'getting ready'
  }
  const retrying = !!i.retrying
  if (retrying) words = `Trying again: ${i.retrying!.replace(/\.$/, '')}`
  const aim = i.target ?? AUTO_LENGTH.typical
  const fraction = stepNo >= checkingAt ? 0.97 : stepNo < at('Writing') ? 0.03 + 0.04 * stepNo : 0.1 + 0.85 * Math.min(1, i.words / aim)
  const writingMs = i.firstWordAt ? i.now - i.firstWordAt : 0
  const rate = writingMs > 0 ? i.words / (writingMs / 1000) : 0
  const left =
    stepNo === at('Writing') && i.target && i.words >= 60 && writingMs >= 10_000 && rate > 0
      ? i.words >= i.target
        ? 'nearly done'
        : leftWords((i.target - i.words) / rate)
      : ''
  const ran = i.now - i.startedAt
  const lead = `${stepNo >= checkingAt ? 'Checking' : 'Writing'} ${name}`
  const tail = retrying ? 'trying again' : short || (i.words > 0 || stepNo >= at('Writing') ? shortWordsOf(i.words, i.target) : '')
  return {
    kind: 'scene',
    title: name,
    lead,
    tail,
    hover: `${name}: ${words}.${model ? ` Model: ${model}.` : ''} Click to see how it is going, or stop it.`,
    steps: stepsAt(labels, stepNo),
    oneModel: sameModel(labels),
    scenes: [],
    doing: words,
    doingModel: model,
    detail: '',
    fraction: clamp(fraction),
    barLabel: i.words > 0 || stepNo >= at('Writing') ? wordsOf(i.words, i.target) : stepNo === 0 ? 'Getting ready to write' : 'Planning before it writes',
    elapsed: ran >= 5_000 ? elapsedWords(ran) : '',
    left,
    cost: '',
    sceneId: i.sceneId,
    retrying
  }
}

// ---------- How it ended (for a card left open) ----------

/** What a Generate draft that has ended says: what happened, and what was kept. */
export function sceneEndWords(e: { status: 'complete' | 'stopped' | 'error'; words: number; error: string | null; cutOff: boolean }): { text: string; tone: 'done' | 'stopped' | 'problem' } {
  const kept = e.words > 0 ? `The ${plural(e.words, 'word')} written so far ${e.words === 1 ? 'stays' : 'stay'} in the scene.` : 'Nothing was written, so the scene is as it was.'
  if (e.status === 'error') return { text: `${(e.error || 'Something went wrong talking to the AI.').trim()} ${kept}`, tone: 'problem' }
  if (e.status === 'stopped') return { text: `Stopped. ${kept}`, tone: 'stopped' }
  if (e.cutOff) return { text: `The writer ran out of room before the scene’s end. ${kept}`, tone: 'problem' }
  return { text: `Written: ${plural(e.words, 'word')}.`, tone: 'done' }
}

/** What a chapter run that has ended says (its report's message, else its heading) and what was kept. */
export function chapterEndWords(r: Pick<ChapterWriterReport, 'status' | 'message' | 'rounds' | 'left'>): { text: string; tone: 'done' | 'stopped' | 'problem' } {
  switch (r.status) {
    case 'done':
      return { text: `Written and checked: ${plural(r.rounds, 'round')} of checks, clean at the end.`, tone: 'done' }
    case 'stuck':
      return { text: r.message || `Written, with ${plural(r.left.length, 'thing')} left for you.`, tone: 'done' }
    case 'stopped':
      return { text: r.message || 'Stopped. The words written so far are kept; Undo puts the chapter back as it was.', tone: 'stopped' }
    case 'cancelled':
      return { text: r.message || 'Cancelled before writing: nothing in the chapter changed.', tone: 'stopped' }
    default:
      return { text: r.message || 'It stopped with a problem. The words written so far are kept; Undo puts the chapter back as it was.', tone: 'problem' }
  }
}
