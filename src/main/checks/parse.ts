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
import { findSceneQuote, issueKey, KIND_OF_CHECK, occurrenceAt, plainQuote } from './quote'
import { memoryFixable } from './memoryFix'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The reply's issues (each still to be checked), or why the reply can't be read. `complete` is false when
 * only part of it could be read (a single issue found inside something else): what such a reply didn't
 * mention mustn't be taken as gone.
 */
export function readCheckReply(
  text: string
): { ok: true; items: Record<string, unknown>[]; complete: boolean; checked?: Record<string, unknown>[] } | { ok: false; why: string } {
  // A bare list of issues is fine too, fenced or not, with words before it or not.
  const list = topLevelList(text)
  if (list !== null) {
    const wrapped = parseLenient(`{"issues": ${list}}`)
    if (wrapped.ok && isObj(wrapped.value) && Array.isArray(wrapped.value.issues)) {
      return { ok: true, items: wrapped.value.issues.filter(isObj), complete: true }
    }
  }
  const parsed = parseLenient(text)
  if (!parsed.ok) return parsed
  const v = parsed.value
  if (!isObj(v)) return { ok: false, why: 'it was not a JSON object' }
  const issues = v.issues ?? v.problems ?? v.findings
  if (issues === undefined) {
    if ('quote' in v && 'message' in v) return { ok: true, items: [v], complete: false }
    return { ok: false, why: 'it had no "issues" list' }
  }
  // What each check looked at and found good (the critic's report): optional, an old-style reply has none.
  const checked = Array.isArray(v.checked) ? v.checked.filter(isObj) : undefined
  if (issues === null) return { ok: true, items: [], complete: true, checked }
  if (!Array.isArray(issues)) return { ok: false, why: 'its "issues" was not a list' }
  return { ok: true, items: issues.filter(isObj), complete: true, checked }
}

/** A list at the top of the reply (in a code fence, or the first bracket before any brace), as text; null when there is none. */
function topLevelList(text: string): string | null {
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  const body = fence && fence[1].trim().startsWith('[') ? fence[1] : text
  const open = body.indexOf('[')
  const brace = body.indexOf('{')
  if (open < 0 || (brace >= 0 && brace < open)) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = open; i < body.length; i++) {
    const c = body[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '[') depth++
    else if (c === ']' && --depth === 0) return body.slice(open, i + 1)
  }
  return null
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
  /**
   * True when "Update the memory" may set this field: one of Adam's own, not changed by an earlier scene's
   * change, so his note is what the memory says here.
   */
  canUpdateMemory(entryId: ID, field: string): boolean
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
/**
 * True when an "issue" says what was checked was fine ("This line fits his voice. No problem."): a model that lists
 * what it looked at as issues (seen in a live run) buries the real ones. One that goes on to say what is wrong
 * ("consistent, but ...") stays.
 */
export function saysFine(message: unknown): boolean {
  const m = typeof message === 'string' ? message : ''
  if (!m.trim()) return false
  const fine = /\b(no (issue|problem|slip|error|inconsistency|conflict|contradiction)s?\b|no (tense|pov|point of view|style) slip|(is|are|seems|remains) consistent|consistent with|this is fine|which is fine|is not a problem|isn['’]t a problem|nothing wrong|fits (his|her|their|its|the)\b|matches (his|her|their|the))/i
  const butWrong = /\b(but|however|yet|although|contradict|inconsistent|doesn['’]t match|does not match|wrong)\b/i
  if (!fine.test(m)) return false
  // The verdict at the end decides: "..., but the scene says grey: this matches, no problem."
  const last = m.trim().split(/(?<=[.!?])\s+|\s+[–—-]\s+|;\s*/).filter(Boolean).at(-1) ?? m
  const finalFine = /\b(no (issue|problem|slip|error|inconsistency|conflict|contradiction)s?|(which|this|that|it) (matches|is fine|fits|is consistent)|(it['’]s|is) fine|not a problem)\b/i
  return (finalFine.test(last) && !butWrong.test(last)) || !butWrong.test(m)
}

/**
 * True when a knowledge issue rests only on the memory not listing the knowledge ("the memory does not list Dov
 * knowing this"): the memory's who-knows-what is never complete, so that alone isn't a problem (three live runs
 * raised dozens). One that says the knowledge comes later, or that they weren't there, stays.
 */
export function onlyUnlisted(item: Record<string, unknown>): boolean {
  if (String(item.check ?? '') !== 'knowledge') return false
  const m = typeof item.message === 'string' ? item.message : ''
  const unlisted =
    /\b(memory|knowledge table|who knows what)\b[^.]*\b(does not|doesn['’]t|did not|never)\s+(list|show|record|say|mention|include|note)|\bnot (listed|recorded|shown) (as known|in the memory)|\bno record\b|\bis known only (by|to)\b|\bknown only (by|to)\b/i
  const reallyCannot =
    /\b(later|not yet|before (she|he|they|it)\b[^.]*\b(learn|hear|find|see)|until\b|was not (there|present)|wasn['’]t (there|present)|not present|in a later scene|happens? (later|after))\b/i
  return unlisted.test(m) && !reallyCannot.test(m)
}

export function foundIssues(items: Record<string, unknown>[], ctx: ReadContext): FoundIssue[] {
  const out = new Map<string, FoundIssue>()
  for (const item of items) {
    if (saysFine(item.message) || onlyUnlisted(item)) continue
    const check = checkOf(item.check ?? item.type ?? item.kind, ctx.checks)
    if (!check) continue
    const found = findSceneQuote(ctx.text, item.quote)
    if (!found) continue
    const quote = found.quote
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
    // A rewrite of "A ... B" can't take the place of A alone; nor is one that changes nothing a fix.
    if (fix && (!found.whole || plainQuote(fix) === plainQuote(quote))) fix = null
    // How to put it right in a sentence, when the quote's own rewrite isn't the whole answer.
    const advice = str(item.advice ?? item.suggestion, 400)
    const memory = str(item.memory, 200)
    const text = str(item.text, 200)
    // The text is right and one of Adam's own notes is wrong: offered only for one short value of a fact.
    const memoryFix =
      check === 'facts' &&
      entry &&
      field &&
      memoryFixable(entry.kind, field, text) &&
      ctx.canUpdateMemory(entry.id, field) &&
      plain(text) !== plain(fieldValue(entry, field))
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
        ...(advice ? { advice } : {}),
        memoryFix,
        entryId: entry?.id,
        field,
        occurrence: occurrenceAt(ctx.text, quote, found.start),
        ...(memory ? { memory } : {}),
        ...(text ? { text } : {})
      }
    })
  }
  return [...out.values()]
}

/** For tests and the prompt: the checks a set may hold, in their usual order. */
export const orderedChecks = (checks: CheckKind[]): CheckKind[] => ALL_CHECKS.filter((c) => checks.includes(c))
