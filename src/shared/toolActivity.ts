// The editor chat's tool calls as a record and as the Ask panel shows them (chat Phase 2b: "a way to see when the
// chat called a tool"). Each call the model makes is one ToolActivity: which tool, a short line on what it was asked
// for ("Ch 1, Sc 2 “The Ford”", "“lamp oil”", "2 edits, 1 card change"), when it started and ended, how it went
// (running, done, failed, not proposed, stopped) with a short line on what came back ("1,240 words", "6 hits"), and
// which request of the answer it was in. The main side makes them (ask/agent.ts) and keeps them in the record's
// params.steps, beside the four fields steps always had; a record from before keeps only those four, and
// `activityOf` reads both.
import type { AgentStep } from './types'

/** How a call went: still running, done, failed, a change not proposed, or never run (the answer stopped first). */
export type ToolStatus = 'running' | 'done' | 'failed' | 'not-proposed' | 'stopped'

/**
 * What a call does, for its icon and its words ('mentions': find_mentions, lab switch TEXTTOOLS; 'chapter' and
 * 'threads': chapter_card and list_threads, lab switch STORYTOOLS).
 */
export type ToolKind = 'read' | 'outline' | 'search' | 'mentions' | 'entry' | 'style' | 'issues' | 'chapter' | 'threads' | 'propose' | 'draft' | 'ask' | 'other'

/** One tool call of the editor chat, as it is kept with the turn's record and sent live as `ask:tool`. */
export interface ToolActivity extends AgentStep {
  /** Unique within its answer ("t1", "t2", …). */
  id: string
  kind: ToolKind
  /** What it was asked for, in a few words ('' when there is nothing to say: the outline, the style guide). */
  summary: string
  status: ToolStatus
  /** What came back, in a few words ('' while it runs). */
  outcome: string
  /** When the model started asking for it (ms since 1970), and when its answer came back; null when not known. */
  startedAt: number | null
  endedAt: number | null
  /** The request of the answer it was asked in (from 1); null when not known. */
  step: number | null
}

const KINDS: Record<string, ToolKind> = {
  read_scene: 'read',
  outline: 'outline',
  search: 'search',
  find_mentions: 'mentions',
  get_entry: 'entry',
  entry_at: 'entry',
  style_guide: 'style',
  scene_issues: 'issues',
  list_issues: 'issues',
  chapter_card: 'chapter',
  list_threads: 'threads',
  propose_draft: 'draft',
  ask_user: 'ask'
}

/** A tool's kind from its name. */
export const toolKind = (tool: string): ToolKind => KINDS[tool] ?? (tool.startsWith('propose_') ? 'propose' : 'other')

/** "1 edit", "2 edits". */
export const counted = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/** A call's arguments as sent (JSON text), or {} when they aren't an object. */
export function parseArgs(json: string): Record<string, unknown> {
  try {
    const v = json.trim() ? (JSON.parse(json) as unknown) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const CHANGE_WORDS: Record<string, [string, string]> = {
  edit: ['edit', 'edits'],
  rewrite: ['rewrite', 'rewrites'],
  card: ['card change', 'card changes'],
  entry: ['entry change', 'entry changes'],
  new_entry: ['new entry', 'new entries'],
  new_scene: ['new scene', 'new scenes'],
  new_chapter: ['new chapter', 'new chapters'],
  rename: ['new title', 'new titles'],
  insert: ['insert', 'inserts'],
  cut: ['cut', 'cuts'],
  beats: ['beat change', 'beat changes'],
  issue_fix: ['issue fix', 'issue fixes'],
  chapter_card: ['chapter card change', 'chapter card changes'],
  thread: ['plot thread link', 'plot thread links'],
  ask: ['question', 'questions']
}

/** propose_changes' list in a few words, by kind in the order they first come: "2 edits, 1 card change". */
export function changesSummary(items: unknown): string {
  if (!Array.isArray(items) || !items.length) return ''
  const counts = new Map<string, number>()
  for (const raw of items) {
    const k = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).kind : null
    const kind = typeof k === 'string' ? k.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
    const key = CHANGE_WORDS[kind] ? kind : '?'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts]
    .map(([k, n]) => (k === '?' ? counted(n, 'change') : counted(n, CHANGE_WORDS[k][0], CHANGE_WORDS[k][1])))
    .join(', ')
}

const clipWords = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** What a call was asked for, from its arguments alone (the agent says it better when it knows the scene or entry meant). */
export function argSummary(tool: string, args: Record<string, unknown>): string {
  const str = (k: string): string => (typeof args[k] === 'string' ? clipWords(args[k] as string, 80) : '')
  switch (toolKind(tool)) {
    case 'read':
    case 'draft':
      return str('scene') || 'the open scene'
    case 'issues':
      return str('scope').toLowerCase() === 'story' ? 'the story' : str('scene') || 'the open scene'
    case 'chapter':
      return str('chapter') || 'the open chapter'
    case 'threads':
      return str('status') ? `${str('status').toLowerCase()} plot threads` : 'plot threads'
    case 'search':
      return str('query') ? `“${str('query')}”` : ''
    case 'mentions':
      return str('words') ? `“${str('words')}”` : ''
    case 'entry':
      return str('name')
    case 'ask':
      return str('question')
    case 'propose':
      if (tool === 'propose_changes') return changesSummary(args.changes)
      return ''
    default:
      return ''
  }
}

/** An old record's step (label only): how it went, told from its label (agent.ts's words for a call that failed). */
function statusFromLabel(label: string, kind: ToolKind): ToolStatus {
  if (/^A change that didn[’']t fit/i.test(label)) return 'not-proposed'
  if (/didn[’']t fit|^Something went wrong|^Looking something up$/i.test(label)) return 'failed'
  return kind === 'propose' && !/^(Proposing|Revising)/i.test(label) ? 'failed' : 'done'
}

/** A kept step as a ToolActivity: as it was made since Phase 2b, or worked out from an older record's four fields. */
export function activityOf(step: AgentStep & Partial<ToolActivity>, i: number): ToolActivity {
  const tool = typeof step.tool === 'string' ? step.tool : ''
  const label = typeof step.label === 'string' ? step.label : ''
  const kind = step.kind ?? (/^Asking you/i.test(label) ? 'ask' : toolKind(tool))
  return {
    label,
    tool,
    arguments: typeof step.arguments === 'string' ? step.arguments : '',
    result: typeof step.result === 'string' ? step.result : '',
    id: step.id ?? `s${i + 1}`,
    kind,
    summary: step.summary ?? argSummary(tool, parseArgs(typeof step.arguments === 'string' ? step.arguments : '')),
    status: step.status ?? statusFromLabel(label, kind),
    outcome: step.outcome ?? '',
    startedAt: step.startedAt ?? null,
    endedAt: step.endedAt ?? null,
    step: step.step ?? null
  }
}

/** A failure's reason, short, for a call's outcome: the first sentence, without its full stop. */
export function shortReason(message: string, max = 70): string {
  const first = message.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? ''
  const t = first.replace(/[.!]+$/, '')
  return clipWords(t.charAt(0).toLowerCase() + t.slice(1), max)
}
