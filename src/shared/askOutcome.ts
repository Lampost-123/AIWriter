// The outcome line under a chat answer (chat-truth R1): what came of it, worked out only from what the app recorded
// (the changes and what Adam made of each, or why a change it tried was turned down), never from the AI's words.
// Ask passes its answer's proposals; the Plan, recipe and cast talks pass their preview as one change (pending when
// offered, then applied or declined) with `where` ("The plan below"), or none with the reason nothing changed.
import type { ProposalStatus } from './contracts/ask'

export type OutcomeState = 'none' | 'refused' | 'waiting' | 'started' | 'applied' | 'partly' | 'declined' | 'failed' | 'unknown'

/** One change as recorded: its status, and whether Adam's last Apply of it failed (it still waits). */
export interface OutcomeChange {
  status: ProposalStatus
  failed?: boolean
}

export interface OutcomeInput {
  /** The answer has ended (done or stopped). While it streams there is no line yet. */
  finished: boolean
  /** False for an old answer saved with nothing to go on: no line rather than a wrong one. Default true. */
  recorded?: boolean
  changes: readonly OutcomeChange[]
  /** Plain words: why the change it tried was turned down, when none came. */
  refused?: string | null
  /** What holds the waiting changes, for a preview: "The plan below" → "The plan below has 2 changes waiting". */
  where?: string
}

/** A piece of the line; `tone` marks the state words (amber waiting or started, green applied, red only if failed). */
export interface OutcomePart {
  text: string
  tone?: 'ai' | 'success' | 'danger'
}

export interface Outcome {
  state: OutcomeState
  parts: OutcomePart[]
  /** The whole line, or null when none is shown. */
  words: string | null
}

const changes = (n: number): string => `${n} ${n === 1 ? 'change' : 'changes'}`
const reasonOf = (why: string): string => why.trim().replace(/[.\s]+$/, '')

function make(state: OutcomeState, parts: OutcomePart[]): Outcome {
  return { state, parts, words: parts.map((p) => p.text).join('') }
}

export function outcomeOf(input: OutcomeInput): Outcome {
  if (!input.finished || input.recorded === false) return { state: 'unknown', parts: [], words: null }
  const all = input.changes
  const applied = all.filter((c) => c.status === 'applied').length
  const started = all.filter((c) => c.status === 'started').length
  const failed = all.filter((c) => c.status === 'pending' && c.failed).length
  const waiting = all.filter((c) => c.status === 'pending' && !c.failed).length
  const declined = all.filter((c) => c.status === 'declined').length

  if (!all.length) {
    const why = input.refused ? reasonOf(input.refused) : ''
    return why ? make('refused', [{ text: `Nothing was changed: ${why}.` }]) : make('none', [{ text: 'Nothing was changed.' }])
  }
  if (declined === all.length) return make('declined', [{ text: `Not applied: you turned ${declined === 1 ? 'it' : 'them'} down.` }])
  if (applied && applied + declined === all.length) {
    return declined ? make('partly', [{ text: `${applied} of ${all.length} applied`, tone: 'success' }, { text: '.' }]) : make('applied', [{ text: 'Applied', tone: 'success' }, { text: '.' }])
  }

  const tail = waiting ? ': press Apply.' : failed ? ': see why on its card.' : '.'
  const state: OutcomeState = failed ? 'failed' : waiting ? 'waiting' : 'started'
  const kinds = [applied, started, waiting, failed].filter(Boolean).length
  if (kinds === 1) {
    // One kind of outcome: said in full.
    if (waiting && input.where) return make(state, [{ text: `${input.where} has ` }, { text: `${changes(waiting)} waiting`, tone: 'ai' }, { text: tail }])
    if (waiting) return make(state, [{ text: `${changes(waiting)} ${waiting === 1 ? 'is' : 'are'} waiting for you`, tone: 'ai' }, { text: tail }])
    if (started) return make(state, [{ text: `${changes(started)} ${started === 1 ? 'has' : 'have'} started`, tone: 'ai' }, { text: tail }])
    return make(state, [{ text: `${changes(failed)} couldn’t be applied`, tone: 'danger' }, { text: tail }])
  }
  // Mixed: "1 applied, 2 waiting: press Apply."
  const pieces: OutcomePart[] = [
    ...(applied ? [{ text: `${applied} applied`, tone: 'success' as const }] : []),
    ...(started ? [{ text: `${started} started`, tone: 'ai' as const }] : []),
    ...(waiting ? [{ text: `${waiting} waiting`, tone: 'ai' as const }] : []),
    ...(failed ? [{ text: `${failed} couldn’t be applied`, tone: 'danger' as const }] : [])
  ]
  const parts = pieces.flatMap((p, i) => (i ? [{ text: ', ' }, p] : [p]))
  return make(state, [...parts, { text: tail }])
}
