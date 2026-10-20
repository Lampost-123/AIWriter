// Write the whole chapter: the words the window shows for a run (contracts/chapterWriter.ts). Pure, so it is unit-tested.

import { CHAPTER_WRITER_LIMITS, type ChapterWriterPlan, type ChapterWriterProgress, type ChapterWriterReport } from '@shared/contracts/chapterWriter'

const n = (k: number, one: string, many: string): string => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`

/** Dollars as the top bar says them: "$0.42", "less than a cent", or nothing before anything is known. */
export function costWords(cost: number): string {
  if (!(cost > 0)) return ''
  if (cost < 0.01) return 'less than a cent so far'
  return `$${cost.toFixed(2)} so far`
}

/** The top bar's line while a run goes on: "Fixing Sc 2 “The ferry”, round 2…". */
export const progressLine = (p: ChapterWriterProgress): string => `${p.note || 'Writing the chapter'}…`

const LATEST = CHAPTER_WRITER_LIMITS.minutes === 60 ? 'an hour' : `${CHAPTER_WRITER_LIMITS.minutes} minutes`

/** How far a run goes (CHAPTER_WRITER_LIMITS), as the start dialog says it. */
export const LIMIT_WORDS = `It does at most ${CHAPTER_WRITER_LIMITS.fixRounds} rounds of fixes, and starts no new one after ${LATEST}: anything still open then is listed for you.`

/** What the start dialog says about the chapter's scenes. */
export function planWords(plan: ChapterWriterPlan): { intro: string; warning: string | null; ready: number; left: string[] } {
  const ready = plan.scenes.filter((s) => s.ready)
  const left = plan.scenes.filter((s) => !s.ready).map((s) => s.label)
  const written = ready.filter((s) => s.hasWords).length
  const intro =
    `The AI plans the whole chapter first and shows you the plan, which you can change. Then it writes ${ready.length === 1 ? 'its scene' : ready.length === 0 ? 'its scenes' : `its ${n(ready.length, 'scene', 'scenes')}`} to the plan, ` +
    'checks each against the plan and the story so far, has a critic read the chapter, and fixes only what they flag. ' +
    `${LIMIT_WORDS} It works in the background; you can stop it at any time from the top bar.`
  const warning = written
    ? `${written === ready.length ? (ready.length === 1 ? 'The scene already has words. They' : 'Every scene already has words. They') : `${n(written, 'scene already has', 'scenes already have')} words. They`} will be replaced: the words now are kept, and one Undo puts the whole chapter back.`
    : null
  return { intro, warning, ready: ready.length, left }
}

/** How many changes the run made after drafting (fixes and scenes written again). */
export const fixedCount = (r: ChapterWriterReport): number => r.scenes.reduce((k, s) => k + s.fixed.length + s.rewritten.length, 0)

/** The message when a run ends. */
export function endWords(r: ChapterWriterReport, title: string): string {
  const fixed = fixedCount(r)
  const rounds = n(r.rounds, 'round of checks', 'rounds of checks')
  switch (r.status) {
    case 'done':
      return `${title} is written and checked: ${rounds}, ${n(fixed, 'thing', 'things')} fixed.`
    case 'stuck':
      return `${title} is written, but the AI couldn't settle ${n(r.left.length, 'thing', 'things')}. The report lists ${r.left.length === 1 ? 'it' : 'them'}.`
    case 'stopped':
      return `Stopped writing ${title}. The words so far are kept; Undo puts the chapter back.`
    case 'cancelled':
      return r.message || `Cancelled before writing ${title}: nothing changed.`
    default:
      return r.message || `Writing ${title} stopped with a problem.`
  }
}

/** What Undo says it put back: the scenes' words, and the chapter's name when the run had given it one. */
export function undoWords(restored: number, renamed: boolean): string {
  const scenes = restored === 1 ? 'one scene' : `${restored} scenes`
  if (restored && renamed) return `Put back ${scenes} and the chapter’s name as they were before the AI wrote the chapter.`
  if (restored) return `Put back ${scenes} as ${restored === 1 ? 'it was' : 'they were'} before the AI wrote the chapter.`
  if (renamed) return 'Put back the chapter’s name as it was before the AI wrote the chapter.'
  return 'The chapter was already as it was before.'
}

/** What the report says of the name the run gave the chapter ('' for none, or once undone). */
export const namedWords = (r: Pick<ChapterWriterReport, 'named' | 'undone'>): string => (r.named?.to.trim() && !r.undone ? `Named the chapter “${r.named.to.trim()}”.` : '')

/** The report's heading line. */
export function reportHeading(r: ChapterWriterReport): string {
  if (r.undone) return 'Put back as it was before the AI wrote it.'
  switch (r.status) {
    case 'running':
      return 'The AI is writing this chapter now.'
    case 'done':
      return `Written and checked: ${n(r.rounds, 'round', 'rounds')} of checks, clean at the end.`
    case 'stuck':
      return `Written, with ${n(r.left.length, 'thing', 'things')} the AI couldn't settle.`
    case 'stopped':
      return 'Stopped before it was finished.'
    case 'cancelled':
      return 'Cancelled before anything was written.'
    default:
      return r.message || 'It stopped with a problem.'
  }
}
