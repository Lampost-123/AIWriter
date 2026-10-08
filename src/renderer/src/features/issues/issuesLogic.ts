// The Issues tab's words and small decisions, kept pure so they are unit-tested (milestone 5, AI checks).
import type { CheckKind, CheckProgress, CheckReport, Issue, IssueKind, IssueSeverity } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { FIELD_GROUPS } from '@shared/fields'

/** What each severity is called on screen. */
export const SEVERITY_WORDS: Record<IssueSeverity, string> = { 'must-fix': 'Must fix', warning: 'Worth a look', minor: 'Minor' }

/** What each kind of issue is about, in a word or two. */
export const KIND_WORDS: Record<IssueKind, string> = {
  fact: 'Facts',
  knowledge: 'Who knows what',
  timeline: 'Timeline and place',
  voice: 'Voice',
  style: 'Style and tone',
  continuity: 'Continuity',
  thread: 'Plot thread',
  story: 'Across stories',
  phrase: 'Phrase to avoid',
  repetition: 'Repetition',
  spelling: 'Name spelling'
}

/** "Found 2 things to look at in this scene." (or in the scene named, when Adam has moved on). */
export function foundWords(found: number, where: string | null): string {
  const things = found === 1 ? '1 thing' : `${found} things`
  return `Found ${things} to look at ${where ? `in ${where}` : 'in this scene'}.`
}

/** Open issues first as the main process sorts them; ignored ones apart, for "Show ignored". */
export function splitIssues(issues: Issue[]): { open: Issue[]; ignored: Issue[] } {
  return { open: issues.filter((i) => i.status === 'open'), ignored: issues.filter((i) => i.status === 'ignored') }
}

/** Open issues and how many must be fixed (for the tab's count). */
export function openCount(issues: Issue[] | null | undefined): { count: number; mustFix: number } {
  const open = (issues ?? []).filter((i) => i.status === 'open')
  return { count: open.length, mustFix: open.filter((i) => i.severity === 'must-fix').length }
}

/** The run checking this scene now (or waiting to), if any: Adam's own first. */
export function runFor(runs: Record<ID, CheckProgress & { background?: boolean }>, sceneId: ID): (CheckProgress & { background?: boolean }) | null {
  const covering = Object.values(runs).filter((r) => (r.sceneIds ?? (r.target.scope === 'scene' ? [r.target.id] : [])).includes(sceneId))
  return covering.find((r) => !r.background) ?? covering[0] ?? null
}

/** What a field is called on an entry page ("Eyes"), for "Update the memory". */
export function fieldWords(field: string): string {
  if (field === 'summary') return 'summary'
  if (field === 'description') return 'description'
  for (const groups of Object.values(FIELD_GROUPS)) for (const g of groups ?? []) for (const f of g.fields) if (f.key === field) return f.label.toLowerCase()
  return field
}

/** What "Update the memory" sets, in plain words: "Set Mara's eyes to “green”". */
export function memoryFixWords(issue: Issue): string | null {
  const fix = issue.memoryFix
  if (!fix) return null
  const name = issue.sources.find((s) => s.kind === 'entry' && s.entryId === fix.entryId)
  const who = name && name.kind === 'entry' ? `${name.name}’s ` : ''
  return `Set ${who}${fieldWords(fix.field)} to “${fix.value}” in the memory`
}

/** The direction Rewrite is given to fix an issue without a suggested rewrite. */
export const fixDirection = (issue: Issue): string =>
  `Change only what is needed so this is no longer a problem: ${issue.message.trim()} Keep the rest as it is.`

/**
 * The sentence around a range in a paragraph's text (offsets into it), so Rewrite gets whole words: from
 * after the last sentence end before `from` to the first sentence end after `to`.
 */
export function sentenceAround(text: string, from: number, to: number): { from: number; to: number } {
  let start = 0
  const before = text.slice(0, from)
  const ends = [...before.matchAll(/[.!?…]["'”’)\]]*\s+/g)]
  if (ends.length) {
    const last = ends[ends.length - 1]
    start = (last.index ?? 0) + last[0].length
  }
  // Words that end a sentence already end it; otherwise up to the end of the sentence they are in.
  const ended = /[.!?…]["'”’)\]]*$/.test(text.slice(0, to))
  const after = ended ? null : text.slice(to).match(/^[^.!?…]*[.!?…]+["'”’)\]]*/)
  const end = ended ? to : after ? to + after[0].length : text.length
  return { from: start, to: Math.max(end, to) }
}

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' }

/** Lower case, straight quotes, one space for any run of white space; `map[i]` is where each character came from. */
function normalise(text: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let space = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      if (!space && norm) {
        norm += ' '
        map.push(i)
      }
      space = true
      continue
    }
    space = false
    norm += (QUOTES[ch] ?? ch).toLowerCase()
    map.push(i)
  }
  return { norm, map }
}

/** Every place the quote appears in one paragraph's text (case, curly quotes and spacing don't matter), in order. */
export function occurrencesIn(text: string, quote: string): { from: number; to: number }[] {
  const want = normalise(quote.trim()).norm.trim()
  if (!want) return []
  const { norm, map } = normalise(text)
  const out: { from: number; to: number }[] = []
  for (let i = norm.indexOf(want); i >= 0; i = norm.indexOf(want, i + 1)) out.push({ from: map[i], to: map[i + want.length - 1] + 1 })
  return out
}

/**
 * Which of the quote's places "Fix the text" works on: the one the check found (its `occurrence`), or the
 * only one. Null when it can't tell (several, and the check didn't say which), or there is none.
 */
export function pickOccurrence<T>(found: T[], occurrence: number | undefined): T | null {
  if (occurrence !== undefined && found[occurrence]) return found[occurrence]
  return found.length === 1 ? found[0] : null
}

/** What each AI check is called in the critic's report. */
export const CHECK_WORDS: Record<CheckKind, string> = {
  facts: 'Facts',
  knowledge: 'Who knows what',
  timeline: 'Timeline and place',
  continuity: 'Continuity',
  voice: 'Voice',
  style: 'Style and tone'
}

const AFTER_WORDS: Record<CheckReport['after'], string> = {
  draft: 'Checked after the latest draft',
  done: 'Checked when marked done',
  request: 'Checked'
}

/**
 * The report's line while it is closed: "Checked after the latest draft · 6 checks · 2 issues". With none it says
 * "no issues" (what the checks found), never that all is well: the page may still have words underlined.
 */
export function reportHeadline(r: Pick<CheckReport, 'after' | 'items' | 'found'>): string {
  const checks = r.items.length === 1 ? '1 check' : `${r.items.length} checks`
  const how = r.found ? (r.found === 1 ? '1 issue' : `${r.found} issues`) : 'no issues'
  return `${AFTER_WORDS[r.after]} · ${checks} · ${how}`
}
