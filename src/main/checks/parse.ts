// Reads the consistency check model's reply (milestone 5, AI checks) and keeps only what can be trusted:
// - an issue whose quote isn't in the scene is dropped (other quotation marks, dashes, capitals or spacing
//   are allowed); what is kept is the scene's own words, exactly;
// - names and ids (E1, S2) are mapped to the memory's entries and the earlier scenes, and a field to its key;
// - each issue gets a stable key (its check, what it is about and its quote), so a re-run finds the same
//   issue rather than a new one, and a key Adam ignored is never raised again;
// - "Update the memory" is offered only for a fact that disagrees with one of Adam's own fields.
// Pure, no Electron imports.

import type { CheckKind, IssueSeverity, IssueSource } from '@shared/contracts/checks'
import { ALL_CHECKS } from '@shared/contracts/checks'
import type { EntryState, ID } from '@shared/types'
import { FIELD_GROUPS } from '@shared/fields'
import type { FoundIssue } from '../db/checks'
import { parseLenient, str } from '../keeper/json'
import { plain } from '../keeper/text'
import { fieldValue } from '../keeper/facts'
import { issueKey, KIND_OF_CHECK, plainQuote, sceneQuote } from './quote'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The reply's issues (each still to be checked), or why the reply can't be read. */
export function readCheckReply(text: string): { ok: true; items: Record<string, unknown>[] } | { ok: false; why: string } {
  // A bare list of issues is fine too.
  const list = text.trim().match(/^(?:```(?:json)?\s*)?(\[[\s\S]*\])\s*(?:```)?$/)
  if (list) {
    try {
      const v = JSON.parse(list[1]) as unknown
      if (Array.isArray(v)) return { ok: true, items: v.filter(isObj) }
    } catch {
      /* read as an object below */
    }
  }
  const parsed = parseLenient(text)
  if (!parsed.ok) return parsed
  const v = parsed.value
  if (!isObj(v)) return { ok: false, why: 'it was not a JSON object' }
  const issues = v.issues ?? v.problems ?? v.findings
  if (issues === undefined) {
    if ('quote' in v && 'message' in v) return { ok: true, items: [v] }
    return { ok: false, why: 'it had no "issues" list' }
  }
  if (issues === null) return { ok: true, items: [] }
  if (!Array.isArray(issues)) return { ok: false, why: 'its "issues" was not a list' }
  return { ok: true, items: issues.filter(isObj) }
}

/** A check's name as the model may write it. */
export function checkOf(v: unknown, asked: CheckKind[]): CheckKind | null {
  const s = str(v, 40).toLowerCase()
  const named: CheckKind | null = !s
    ? null
    : /^fact/.test(s)
      ? 'facts'
      : /^know/.test(s)
        ? 'knowledge'
        : /time|place|travel|age/.test(s)
          ? 'timeline'
          : /voice|dialogue|speech/.test(s)
            ? 'voice'
            : /style|tone|tense|point of view|pov/.test(s)
              ? 'style'
              : null
  if (named) return asked.includes(named) ? named : null
  // Not said: the only check asked for, if there was one.
  return asked.length === 1 ? asked[0] : null
}

export function severityOf(v: unknown): IssueSeverity {
  const s = str(v, 30).toLowerCase()
  if (/must|error|critical|high|severe/.test(s)) return 'must-fix'
  if (/minor|low|small|nit/.test(s)) return 'minor'
  return 'warning'
}

/** Every field key an entry of this kind has (and the ones any kind has). */
function keysOf(e: EntryState): string[] {
  return ['summary', 'description', ...(FIELD_GROUPS[e.kind] ?? []).flatMap((g) => g.fields.map((f) => f.key))]
}

/** A field as the model wrote it (a key, or its label), as the entry's key; null when it isn't one. */
export function fieldOf(e: EntryState, v: unknown): string | null {
  const s = str(v, 60)
  if (!s) return null
  const keys = keysOf(e)
  const exact = keys.find((k) => k === s)
  if (exact) return exact
  const low = s.toLowerCase().replace(/[^a-z ]/g, '').trim()
  const labels = (FIELD_GROUPS[e.kind] ?? []).flatMap((g) => g.fields)
  return (
    keys.find((k) => k.toLowerCase() === low.replace(/ /g, '')) ??
    labels.find((f) => f.label.toLowerCase() === low)?.key ??
    labels.find((f) => low.length >= 3 && f.label.toLowerCase().startsWith(low))?.key ??
    null
  )
}

/** What a scene's check needs to read a reply. */
export interface ReadContext {
  sceneId: ID | null
  storyId: ID
  /** The text quotes must come from. */
  text: string
  checks: CheckKind[]
  /** Entries by their id in the request (E1...). */
  entries: Map<string, EntryState>
  /** Earlier scenes by their id in the request (S1...). */
  scenes: Map<string, { sceneId: ID; label: string }>
  /** True when the entry's field is one of Adam's own. */
  isAdams(entryId: ID, field: string): boolean
}

/** An entry named by its id in the request (E1), or by its name or other name. */
export function entryOf(ctx: Pick<ReadContext, 'entries'>, v: unknown): EntryState | null {
  const s = str(v, 120)
  if (!s) return null
  const code = s.match(/^E\d+\b/i)?.[0].toUpperCase()
  if (code && ctx.entries.has(code)) return ctx.entries.get(code)!
  const want = plain(s.replace(/^E\d+\s*/i, ''))
  if (!want) return null
  for (const e of ctx.entries.values()) if ([e.name, ...(e.aliases ?? [])].some((n) => plain(n) === want)) return e
  return null
}

/** The message with any request ids the model left in it (E1, S2) replaced by names. */
function namedMessage(message: string, ctx: Pick<ReadContext, 'entries' | 'scenes'>): string {
  return message
    .replace(/\b(E\d+)\b(\s+\(?[A-Z][\p{L}'’-]*\)?)?/gu, (m, code: string, after?: string) => {
      const e = ctx.entries.get(code)
      if (!e) return m
      // "E1 Mara" or "E1 (Mara)": just the name.
      return after && plain(after.replace(/[()]/g, '')) === plain(e.name.split(' ')[0]) ? e.name : `${e.name}${after ?? ''}`
    })
    .replace(/\b(S\d+)\b/g, (m, code: string) => ctx.scenes.get(code)?.label ?? m)
}

/** The issues of a reply that can be trusted, ready to save (one per key). */
export function foundIssues(items: Record<string, unknown>[], ctx: ReadContext): FoundIssue[] {
  const out = new Map<string, FoundIssue>()
  for (const item of items) {
    const check = checkOf(item.check ?? item.type ?? item.kind, ctx.checks)
    if (!check) continue
    const quote = sceneQuote(ctx.text, item.quote)
    if (!quote) continue
    const message = namedMessage(str(item.message ?? item.problem, 400), ctx)
    if (!message) continue
    const conflicts = isObj(item.conflicts) ? item.conflicts : isObj(item.conflictsWith) ? item.conflictsWith : {}
    const entry = entryOf(ctx, conflicts.entry ?? item.entry ?? (typeof item.conflicts === 'string' ? item.conflicts : undefined))
    const field = entry ? fieldOf(entry, conflicts.field ?? item.field) : null
    const sceneCode = str(conflicts.scene ?? item.scene, 20).toUpperCase().match(/^S\d+/)?.[0]
    const scene = sceneCode ? ctx.scenes.get(sceneCode) : undefined
    const sources: IssueSource[] = []
    if (entry) sources.push(entry.kind === 'thread' ? { kind: 'thread', entryId: entry.id, name: entry.name } : { kind: 'entry', entryId: entry.id, name: entry.name, field })
    if (scene) sources.push({ kind: 'scene', sceneId: scene.sceneId, label: scene.label })
    let fix = str(item.fix ?? item.rewrite, 2000) || null
    if (fix && plainQuote(fix) === plainQuote(quote)) fix = null
    const memory = str(item.memory, 200)
    const text = str(item.text, 200)
    // The text is right and one of Adam's own notes is wrong: offered only for one value of a fact.
    const memoryFix =
      check === 'facts' && entry && field && text && ctx.isAdams(entry.id, field) && plain(text) !== plain(fieldValue(entry, field))
        ? { entryId: entry.id, field, value: text }
        : null
    const key = issueKey(check, entry?.id ?? scene?.sceneId ?? '', quote)
    if (out.has(key)) continue
    out.set(key, {
      sceneId: ctx.sceneId,
      storyId: ctx.storyId,
      kind: KIND_OF_CHECK[check],
      severity: severityOf(item.severity),
      quote,
      message,
      key,
      payload: {
        by: 'check',
        check,
        sources,
        fix,
        memoryFix,
        entryId: entry?.id,
        field,
        ...(memory ? { memory } : {}),
        ...(text ? { text } : {})
      }
    })
  }
  return [...out.values()]
}

/** For tests and the prompt: the checks a set may hold, in their usual order. */
export const orderedChecks = (checks: CheckKind[]): CheckKind[] => ALL_CHECKS.filter((c) => checks.includes(c))
