// The words of the Ask panel's tool activity (chat Phase 2b: "a way to see when the chat called a tool"): each call
// as a verb phrase ("Read Ch 1, Sc 2 “The Ford”", "Searched “lamp oil”", "Proposed 2 edits"), how it went, how long
// it took, and the folded line over the answer ("3 tool calls · 4s"). Pure, so it is unit-tested.
import type { ToolActivity, ToolKind, ToolStatus } from '@shared/toolActivity'
import { durationWords } from './answerView'

type Call = Pick<ToolActivity, 'kind' | 'summary' | 'status' | 'tool'> & Partial<Pick<ToolActivity, 'outcome'>>

/** What a call is doing, while it runs: "Reading Ch 1, Sc 2 “The Ford”", "Searching", "Proposing changes". */
export function runningPhrase(c: Call): string {
  const s = c.summary
  switch (c.kind) {
    case 'read':
      return `Reading ${s || 'the scene'}`
    case 'outline':
      return 'Opening the outline'
    case 'search':
      return s ? `Searching ${s}` : 'Searching'
    case 'mentions':
      return s ? `Finding ${s}` : 'Finding mentions'
    case 'entry':
      return s ? `Looking up ${s}` : 'Looking something up'
    case 'style':
      return 'Checking the style guide'
    case 'issues':
      return s ? `Listing open issues in ${s}` : 'Listing open issues'
    case 'chapter':
      return `Reading the chapter card of ${s || 'the open chapter'}`
    case 'threads':
      return `Listing ${s || 'plot threads'}`
    case 'propose':
      return s ? `Proposing ${s}` : 'Proposing changes'
    case 'draft':
      return 'Proposing a draft'
    case 'ask':
      return 'Writing you a question'
    default:
      return `Using ${c.tool || 'a tool'}`
  }
}

/** What a call did: "Read Ch 1, Sc 2 “The Ford”", "Looked up Wren Halloway"; one that went wrong, what it tried. */
export function toolPhrase(c: Call): string {
  if (c.status === 'running' || c.status === 'stopped') return runningPhrase(c)
  const tried = c.status === 'failed' || c.status === 'not-proposed'
  const s = c.summary
  switch (c.kind) {
    case 'read':
      return `${tried ? 'Tried to read' : 'Read'} ${s || 'the scene'}`
    case 'outline':
      return tried ? 'Tried to open the outline' : 'Opened the outline'
    case 'search':
      return `${tried ? 'Tried to search' : 'Searched'}${s ? ` ${s}` : ''}`
    case 'mentions':
      // "Found “oil lamp” 7 times in 3 scenes"; with none, "Looked for “oil lamp”" (its outcome says so).
      if (tried) return `Tried to find ${s || 'mentions'}`
      return /^\d/.test(c.outcome ?? '') ? `Found ${s || 'mentions'} ${c.outcome}` : `Looked for ${s || 'mentions'}`
    case 'entry':
      return tried ? `Tried to look up ${s || 'an entry'}` : `Looked up ${s || 'an entry'}`
    case 'style':
      return tried ? 'Tried to check the style guide' : 'Checked the style guide'
    case 'issues':
      return `${tried ? 'Tried to list open issues' : 'Listed open issues'}${s ? ` in ${s}` : ''}`
    case 'chapter':
      return `${tried ? 'Tried to read' : 'Read'} the chapter card of ${s || 'the open chapter'}`
    case 'threads':
      return `${tried ? 'Tried to list' : 'Listed'} ${s || 'plot threads'}`
    case 'propose':
      return `${tried ? 'Tried to propose' : 'Proposed'} ${s || 'changes'}`
    case 'draft':
      return `${tried ? 'Tried to propose' : 'Proposed'} ${s || 'a draft'}`
    case 'ask':
      return tried ? 'Tried to ask you a question' : 'Asked you a question'
    default:
      return `${tried ? 'Tried' : 'Used'} ${c.tool || 'a tool'}`
  }
}

/** How a call went, in a word or two (said with its row's ✓ / ✗). */
export const STATUS_WORDS: Record<ToolStatus, string> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  'not-proposed': 'not proposed',
  stopped: 'not run'
}

/** How long a call took, short: "0.4s", "12s", "1m 05s". */
export function callTime(ms: number): string {
  if (ms < 10_000) return `${Math.max(0.1, Math.round(ms / 100) / 10).toFixed(1)}s`
  return durationWords(ms)
}

/** A call's time, when both its ends are known. */
export const callMs = (c: Pick<ToolActivity, 'startedAt' | 'endedAt'>): number | null =>
  c.startedAt != null && c.endedAt != null ? Math.max(0, c.endedAt - c.startedAt) : null

const wentWrong = (c: Pick<ToolActivity, 'status'>): boolean => c.status === 'failed' || c.status === 'not-proposed'

/**
 * The folded line over an answer: "3 tool calls · 4s", "2 tool calls, 1 didn’t work · 4s"; with no calls, "From the memory
 * · 1s". `ms`: how long the whole answer took, when known (else the calls' own times, when they are). Null with nothing
 * to say (an old answer that called nothing).
 */
export function toolsSummary(tools: Pick<ToolActivity, 'status' | 'startedAt' | 'endedAt'>[], ms: number | null): string | null {
  if (!tools.length) return ms === null ? null : `From the memory · ${durationWords(ms)}`
  const failed = tools.filter(wentWrong).length
  const head = `${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'}${failed ? `, ${failed} didn’t work` : ''}`
  const own = tools.map(callMs)
  const time = ms ?? (own.every((x) => x !== null) ? (own as number[]).reduce((a, b) => a + b, 0) : null)
  return time === null ? head : `${head} · ${time < 1000 && ms === null ? callTime(time) : durationWords(time)}`
}

/** The kinds of call an answer made, each once, in the order first made (the folded line's icons), at most `max`. */
export function kindsOf(tools: Pick<ToolActivity, 'kind'>[], max = 4): ToolKind[] {
  const out: ToolKind[] = []
  for (const t of tools) if (!out.includes(t.kind)) out.push(t.kind)
  return out.slice(0, max)
}

/** A call's arguments laid out to read (JSON indented), or as they came when they aren't JSON. */
export function prettyArgs(json: string): string {
  if (!json.trim()) return '(none)'
  try {
    const v = JSON.parse(json) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return '(none)'
    return JSON.stringify(v, null, 2)
  } catch {
    return json
  }
}

/** What the row's button says to a screen reader: the phrase, how it went, how long, and what pressing does. */
export function rowLabel(c: ToolActivity, open: boolean): string {
  const ms = callMs(c)
  const how = c.status === 'running' ? 'running' : STATUS_WORDS[c.status]
  return `${toolPhrase(c)}, ${how}${c.outcome && c.status !== 'running' ? ` (${c.outcome})` : ''}${ms !== null && c.status !== 'running' ? `, ${callTime(ms)}` : ''}. ${open ? 'Hide' : 'Show'} details`
}

/** The line a screen reader hears when a call goes wrong while the answer is written; '' while none has. */
export function failureWords(tools: ToolActivity[]): string {
  const last = [...tools].reverse().find(wentWrong)
  return last ? `${toolPhrase(last)}: ${STATUS_WORDS[last.status]}${last.outcome ? `, ${last.outcome}` : ''}` : ''
}

/** The turn's calls with one told of (`ask:tool`): added, or put in its place; an ended call never goes back to running. */
export function withCall(tools: ToolActivity[] | undefined, call: ToolActivity): ToolActivity[] {
  const list = tools ?? []
  const i = list.findIndex((t) => t.id === call.id)
  if (i < 0) return [...list, call]
  if (call.status === 'running' && list[i].status !== 'running') return list
  const next = list.slice()
  next[i] = { ...list[i], ...call }
  return next
}

/** Once an answer has ended: a call still shown running never ran (the answer stopped first). */
export function endedCalls(tools: ToolActivity[] | undefined, now: number): ToolActivity[] | undefined {
  if (!tools?.some((t) => t.status === 'running')) return tools
  return tools.map((t) => (t.status === 'running' ? { ...t, status: 'stopped' as const, endedAt: t.endedAt ?? now } : t))
}

/** True when a lead says its ideas come in an order ("worst first", "best first", "most likely first"): the cards are numbered. */
export const rankedLead = (lead: string): boolean =>
  /\b(worst|best|strongest|weakest|likeliest|most likely|least likely|riskiest|safest|biggest|smallest)\s+first\b|\branked\b|\bin order of\b/i.test(lead)
