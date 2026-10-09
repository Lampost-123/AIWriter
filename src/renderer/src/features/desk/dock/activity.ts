// What the AI is doing in the open scene, as the desk's AI dock shows it (UI overhaul, phase 3): nothing (the dock
// offers Continue, Add below and the steer box), getting ready, writing (a draft below the scene, or Continue's change,
// with how many words have come), polishing a finished draft, a change waiting for Accept or Reject, or Beat by beat
// (its bar takes the dock's place). Worked out from the draft (generate/draftRun.ts), its polish pass (polishRun.ts),
// the change waiting in the page (edits/suggestions.ts) and the beat-by-beat session. Pure, so it is unit-tested.
import type { EditTool } from '@shared/types'
import { countWords } from '@shared/defaults'
import { TOOL_NAMES, TOOL_WORKING } from '@/features/edits/names'

/** Generate's draft of this scene, as the dock needs it. */
export interface DraftNow {
  phase: 'idle' | 'starting' | 'streaming' | 'stopping'
  /** The AI service was busy, so the draft is being tried again. */
  retrying: boolean
  /** Words written so far (null until counted). */
  written: number | null
  /** The length the draft aims for; null for Auto. */
  target: number | null
}

/** The AI's change waiting (or being written) in the page, as the dock needs it. */
export interface ChangeNow {
  tool: EditTool
  status: 'starting' | 'writing' | 'stopping' | 'ready' | 'accepting'
  /** Its words so far. */
  text: string
  /** What it is called beside it, in place of its tool's name ("Polish pass"). */
  label?: string | null
  retrying?: boolean
}

export interface ActivityInput {
  draft: DraftNow
  /** The draft's polish pass is running on this scene (`stopping` once Stop was pressed). */
  polish: { running: boolean; stopping: boolean }
  change: ChangeNow | null
  /** Beat by beat is on for this scene. */
  beats: boolean
  /** The memory is reading earlier scenes before the draft can start. */
  memoryReading: boolean
}

/** What wrote, or is writing: Generate's draft, or an AI tool (Continue, mostly). */
export type Writer = 'draft' | EditTool

export type Activity =
  | { kind: 'idle' }
  | { kind: 'starting'; what: Writer; memory: boolean }
  | { kind: 'writing'; what: Writer; words: number; target: number | null; retrying: boolean; stopping: boolean }
  | { kind: 'polishing'; stopping: boolean }
  | { kind: 'review'; what: EditTool; label: string; words: number; accepting: boolean }
  | { kind: 'beats' }

export function activityOf(i: ActivityInput): Activity {
  // A change waiting in the page (a fix, an AI edit, an earlier beat written again) has the dock, even while Beat by beat
  // is on: its bar steps aside until the change is accepted or rejected, so it never covers Accept.
  const c = i.change
  if (c) {
    const words = countWords(c.text)
    if (c.status === 'starting') return { kind: 'starting', what: c.tool, memory: false }
    if (c.status === 'writing' || c.status === 'stopping') {
      return { kind: 'writing', what: c.tool, words, target: null, retrying: !!c.retrying, stopping: c.status === 'stopping' }
    }
    return { kind: 'review', what: c.tool, label: c.label || TOOL_NAMES[c.tool], words, accepting: c.status === 'accepting' }
  }
  // Beat by beat has the foot of the page while it is on (its bar says what it is doing).
  if (i.beats) return { kind: 'beats' }
  const d = i.draft
  if (d.phase === 'starting') return { kind: 'starting', what: 'draft', memory: i.memoryReading }
  if (d.phase === 'streaming' || d.phase === 'stopping') {
    return { kind: 'writing', what: 'draft', words: Math.max(0, d.written ?? 0), target: d.target, retrying: d.retrying, stopping: d.phase === 'stopping' }
  }
  if (i.polish.running) return { kind: 'polishing', stopping: i.polish.stopping }
  return { kind: 'idle' }
}

/** True while the AI is busy in the scene (the dock shows what it is doing and Stop). */
export const isBusy = (a: Activity): boolean => a.kind === 'starting' || a.kind === 'writing' || a.kind === 'polishing'

/** The words the busy dock says: "Writing… 120 words", "Updating memory…", "Polishing…". */
export function activityLine(a: Activity): string {
  switch (a.kind) {
    case 'starting':
      return a.memory ? 'Updating memory…' : 'Getting ready…'
    case 'writing': {
      if (a.stopping) return 'Stopping…'
      if (a.retrying) return 'The AI service is busy. Trying again…'
      const doing = a.what === 'draft' || a.what === 'continue' ? 'Writing' : TOOL_WORKING[a.what]
      return a.words > 0 ? `${doing}… ${a.words.toLocaleString('en-GB')} ${a.words === 1 ? 'word' : 'words'}` : `${doing}…`
    }
    case 'polishing':
      return a.stopping ? 'Stopping…' : 'Polishing…'
    case 'review':
      return `${a.label} · ${a.words.toLocaleString('en-GB')} ${a.words === 1 ? 'word' : 'words'}`
    default:
      return ''
  }
}

/**
 * How far the writing has got, 0 to 1, when its length is known (a draft with a target length); null otherwise (the
 * dock then shows a slow amber shimmer). Never quite full until it ends: a draft can run a little past its target.
 */
export function progressOf(a: Activity): number | null {
  if (a.kind !== 'writing' || !a.target || a.target <= 0) return null
  return Math.min(0.97, Math.max(0, a.words / a.target))
}
