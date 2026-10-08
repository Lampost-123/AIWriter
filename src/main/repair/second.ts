// A second opinion on each slip the check after new words finds, before anything is mended or asked (the writer lab,
// 2026-10-08; ported from Adam's Lampost-123/Poor-Mans-Holodeck src/lib/prompts/critic.ts: withdrawnFinding, the
// verdicts and canonGrounded). First, with no call, a slip is dropped when it leans on a line that isn't in what the
// check was given, when its quote isn't in the new words, or when the model took it back in its own last sentence
// ("...but that is not a contradiction."). Then one call, on the memory model at its 0.2, asks for each slip left:
// reason first, one sentence citing what settles it, then a real yes or no. A slip ruled not real is dropped. A reply
// that can't be read drops nothing. Pure except secondOpinion, which makes the call.

import type Database from 'better-sqlite3'
import type { ChatMessage, ContextBlock, ID } from '@shared/types'
import { callModel, type MemoryModel } from '../keeper/model'
import { estimateTokens } from '../keeper/text'
import { parseLenient } from '../keeper/json'
import type { Claim } from './claims'

export const SECOND_MARKER = '[AIWRITE-REPAIR-SECOND v1]'

/**
 * A finding the model took back in its own last sentence ("…but that is not a contradiction.", "No canon broken.").
 * Models reason in the detail field and then conclude there is nothing wrong; that is a pass, not a problem. Only the
 * last clause counts, so "no contradiction in the time, but Anselm is dead" still stands. (Holodeck critic.ts:17-28.)
 */
export function withdrawnFinding(detail: string): boolean {
  const sentences = detail
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /\w/.test(s))
  const last = (sentences[sentences.length - 1] ?? '').toLowerCase()
  if (!last) return false
  const tail = last.split(/[;,—–]| - /).pop()!.trim()
  const clear =
    /\b(no (?:actual |real |factual |true )?(?:[a-z]+ )?(?:contradiction|conflict|problem|issue|error|slip)s?\b|not (?:a |an )?(?:contradiction|conflict|error|problem|slip)\b|no canon (?:is )?broken|nothing (?:is )?(?:contradicted|broken)|(?:status|this check|the check|it) (?:should be|is) ok\b)/
  if (clear.test(tail)) return true
  if (/\b(?:draft|passage|text|chapter|wording|line|it|this|that|which|everything|words)\s+(?:is|are|remains?)\s+consistent with\b/.test(tail)) return true
  return /^(?:so |and |which means )?(?:this|that|it|the draft)(?: line)? is (?:fine|correct|consistent)[.!]?$/.test(tail)
}

/** Lower case, quotation marks and dashes made plain, whitespace collapsed. */
const plainText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[“”„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

/** Whether `needle` is in `hay`, reading "…" in the needle as words left out. */
export function quotedIn(hay: string, needle: string): boolean {
  const h = plainText(hay)
  const pieces = plainText(needle)
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((p) => p.replace(/^["'\s]+|["'\s.,;:!?]+$/g, ''))
    .filter((p) => p.length >= 3)
  return pieces.length > 0 && pieces.every((p) => h.includes(p))
}

/** Why a slip was dropped before the call, or by it. */
export type SecondWhy = 'no-line' | 'no-quote' | 'withdrawn' | 'not-real'

/**
 * The slips left after the checks that need no call: each slip's line must be one the check was given (`lines`), its
 * quote in the new words, and the model must not have taken it back. Claims that aren't slips pass as they are.
 */
export function groundedSlips(claims: Claim[], o: { newWords: string; lines: ReadonlySet<string> }): { kept: Claim[]; dropped: { claim: Claim; why: SecondWhy }[] } {
  const kept: Claim[] = []
  const dropped: { claim: Claim; why: SecondWhy }[] = []
  for (const c of claims) {
    if (c.verdict !== 'slip') {
      kept.push(c)
      continue
    }
    const why: SecondWhy | null = !o.lines.has(c.line)
      ? 'no-line'
      : !c.quote || !quotedIn(o.newWords, c.quote)
        ? 'no-quote'
        : withdrawnFinding(c.why)
          ? 'withdrawn'
          : null
    if (why) dropped.push({ claim: c, why })
    else kept.push(c)
  }
  return { kept, dropped }
}

/** The text of the line a slip cites, from the check's own material ("- [W2] ..." or an entry's "### E3 ..." heading). */
export function lineTextOf(code: string, material: string): string {
  for (const l of material.split('\n')) {
    if (l.startsWith(`- [${code}] `)) return l.slice(2).trim()
    if (l.startsWith(`### ${code} `)) return `[${code}] ${l.slice(4 + code.length).trim()} (its entry is above)`
  }
  return `[${code}]`
}

/** What the second opinion is told (Holodeck's verifySystem, in AI Write's terms). */
export const SECOND_SYSTEM = `${SECOND_MARKER} verdicts
You are checking another continuity editor's notes on newly written words of a novel, against the same material they read: where things stood just before the new words (W lines), the story's memory (E, K, O, D, S lines). For each numbered note, decide whether it is a real slip: the quoted new words and the line it cites cannot both be true at that moment, and nothing in the new words or the words just before shows the change happening. Reject a note that misreads the words, confuses two people, relies on something that is not in the material, flags something merely left out, flags details that can both be true on a natural reading, flags a change the new words themselves show, or is about style. What someone wears and how they are placed (boots, coat or anything else on or off; lying, sitting or standing; where they are, in the room or gone from it) change only when the new words or the words just before show it: never reject a note about those because the change could have happened off the page, or because someone may have put something back on or moved. Keep a note that is right even if it is worded badly.
Reply with JSON only: {"verdicts": [{"n": 1, "reason": "...", "real": true}]}, one per note: reason first (one sentence, citing the line or the words that settle it), then real (true or false).`

/** The request for the second opinion on `slips` (numbered from 1, in order). */
export function secondRequest(slips: Claim[], o: { material: string; leadIn: string; newWords: string }): { messages: ChatMessage[]; blocks: ContextBlock[] } {
  const notes = slips
    .map((c, i) => `${i + 1}. Quote: "${c.quote}" · Line: ${lineTextOf(c.line, o.material)} · The note: ${c.why || c.question || 'a slip'}`)
    .join('\n')
  const sections = [
    { id: 'material', title: 'What the check was given', text: o.material },
    ...(o.leadIn.trim() ? [{ id: 'lead-in', title: 'The words just before the new ones', text: `"""\n…${o.leadIn.trim()}\n"""` }] : []),
    { id: 'new-words', title: 'The new words', text: `"""\n${o.newWords}\n"""` },
    { id: 'notes', title: 'The notes to check', text: notes }
  ]
  const user = `${sections.map((s) => `## ${s.title}\n${s.text}`).join('\n\n')}\n\nReply with the JSON verdicts, one per note.`
  return {
    messages: [
      { role: 'system', content: SECOND_SYSTEM },
      { role: 'user', content: user }
    ],
    blocks: sections.map((s, i) => ({ id: s.id, priority: Math.min(10, i + 1), title: s.title, text: s.text, tokens: estimateTokens(s.text), entryIds: [], dropped: false }))
  }
}

/** Notes (0-based) a second opinion ruled not real. Null when its reply cannot be read, so nothing is dropped. (Holodeck critic.ts rejectedNotes.) */
export function rejectedNotes(raw: string): Set<number> | null {
  const parsed = parseLenient(raw)
  if (!parsed.ok) return null
  const v = parsed.value as { verdicts?: unknown } | unknown[]
  const list = Array.isArray(v) ? v : v && typeof v === 'object' ? (v as { verdicts?: unknown }).verdicts : null
  if (!Array.isArray(list)) return null
  const out = new Set<number>()
  for (const x of list) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const n = Number(r.n)
    if (Number.isInteger(n) && (r.real === false || r.real === 'false')) out.add(n - 1)
  }
  return out
}

/** Room for the verdicts: a sentence and a yes or no each. */
export const secondTokens = (n: number): number => Math.min(2000, 200 + 120 * n)

/**
 * The claims with the second opinion's drops taken out (see the top of this file), and how many were dropped. One call
 * at most, only when slips are left after the checks that need none; a call that fails, or a reply that can't be read,
 * drops nothing more.
 */
export async function secondOpinion(
  o: { db: Database.Database; model: MemoryModel; signal?: AbortSignal; closed: () => boolean; fetchImpl?: typeof fetch; retryDelays?: number[] },
  sceneId: ID,
  claims: Claim[],
  w: { newWords: string; leadIn: string; material: string; lines: ReadonlySet<string> }
): Promise<{ kept: Claim[]; dropped: { claim: Claim; why: SecondWhy }[] }> {
  const ground = groundedSlips(claims, w)
  const slips = ground.kept.filter((c) => c.verdict === 'slip')
  if (!slips.length) return ground
  const req = secondRequest(slips, w)
  const got = await callModel({
    db: o.db,
    model: o.model,
    targetId: sceneId,
    job: 'memory',
    messages: req.messages,
    blocks: req.blocks,
    maxTokens: secondTokens(slips.length),
    signal: o.signal ?? new AbortController().signal,
    closed: o.closed,
    fetchImpl: o.fetchImpl,
    retryDelays: o.retryDelays
  }).catch(() => null)
  const rejected = got && got.status === 'complete' ? rejectedNotes(got.text) : null
  if (!rejected?.size) return ground
  const out = slips.filter((_, i) => rejected.has(i))
  return {
    kept: ground.kept.filter((c) => !out.includes(c)),
    dropped: [...ground.dropped, ...out.map((claim) => ({ claim, why: 'not-real' as const }))]
  }
}
