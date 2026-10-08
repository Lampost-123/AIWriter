// Stock phrases, said afresh (the writer lab, 2026-10-08). After check and repair has looked at new words, stock
// phrases in them (the writer round's stock tics, the trap runs' other frequent ones, the app's own list of AI phrases,
// and sample lines of dialogue copied word for word) are found by pattern and rewritten with one short call on the
// memory model, one instruction per kind of tic (FAMILY_FIX). Each rewrite goes back as one more of check and repair's
// fixes, so the page makes it in amber, with Undo. Only the AI's own words are touched.
// The writer prompt names none of these phrases (ai/prompts.ts): naming a phrase can prime it, so they are found after
// writing instead. In the lab's round E, passages with a stock phrase went from 21% to 4%.

import type Database from 'better-sqlite3'
import type { RepairFix, RepairInput, RepairOutcome } from '@shared/contracts/repair'
import { SLOP_PHRASES as APP_SLOP_PHRASES } from '@shared/slop'
import * as gens from '../db/generations'
import { callModel, type MemoryModel } from '../keeper/model'
import { estimateTokens } from '../keeper/text'
import { newId } from '../util'
import { STOCK_TICS } from '../ai/repetition'

export const SLOP_MARKER = '[AIWRITE-REPAIR-SLOP v1]'
const MOST = 8
/** What a stock phrase's fix says (the page's "Mended a slip in the new words, in amber: ..."). */
export const SLOP_WHY = 'A stock phrase, put in fresh words.'

/**
 * Stock phrases found after a landing: the writer round's STOCK_TICS (ai/repetition.ts) first, each run on to the end of
 * its clause so the whole clause is reworded, then phrases the trap runs found again and again that STOCK_TICS lacks,
 * and a few every editor knows.
 */
export const SLOP_EXTRA: RegExp[] = [
  /\bsaid nothing (?:more|else)\b/gi,
  /\bunhurried\b/gi,
  /\bthe whole of it\b/gi,
  /\bthe red core\b[^.,;!?]*/gi,
  /\bthree (?:soft |quick |slow )?(?:taps|knocks|raps)\b/gi,
  /\ba long while\b/gi,
  /\b(?:a breath (?:she|he) didn['’]t know (?:she|he) was holding|the words hung in the air|a shiver ran down (?:her|his) spine)\b/gi
]
export const SLOP_PHRASES: RegExp[] = [...STOCK_TICS.map((t) => new RegExp(`${t.re.source}[^.,;!?]*`, 'gi')), ...SLOP_EXTRA]

/** The kinds of tic the rewrite gives one instruction each. Every phrase found belongs to one. */
export type TicFamily = 'body' | 'silence' | 'filler' | 'grand' | 'pattern' | 'closer' | 'word' | 'voice'
export const FAMILY_FIX: Record<TicFamily, string> = {
  body: 'A stock body reaction: show the feeling through what this person does, says or chooses next, in this scene’s own terms, or leave it out.',
  silence: 'A stock pause or silence: give what each person actually does in the pause (a look, a move, a thing handled), or cut the pause.',
  filler: 'Weather or time used as filler: one concrete detail of this place at this moment, or cut it.',
  grand: 'A grand abstraction: one plain, physical detail of this place or these people in its place.',
  pattern: 'A stock sentence pattern: say the thing straight, once, in the plainest words.',
  closer: 'A summing-up or zinger line: end on an action, a line of talk or an image instead; no verdict on the moment.',
  word: 'An overused word: the plain exact word for what is meant here.',
  voice: 'A character’s sample line copied word for word: what they would say at this moment, in their voice, in new words.'
}

/** Which family each of SLOP_PHRASES belongs to, in the same order (STOCK_TICS first, then SLOP_EXTRA). */
export const SLOP_FAMILIES: TicFamily[] = [
  // STOCK_TICS: the rain went on, neither of them said, for a long moment, the silence stretched, let out a breath,
  // something shifted, and that was enough, which was answer enough.
  'filler', 'silence', 'filler', 'silence', 'body', 'pattern', 'closer', 'closer',
  // SLOP_EXTRA: said nothing more, unhurried, the whole of it, the red core, three taps, a long while, clichés.
  'silence', 'word', 'pattern', 'word', 'word', 'filler', 'body'
]

/**
 * The app's own list of common AI phrases (shared/slop.ts), found here since the writer prompt no longer names them.
 * "it wasn't X, it was Y" is left out: a structure, not a phrase, and the lab's held-out measure of it stays held out.
 */
export const APP_SLOP = APP_SLOP_PHRASES.filter((p) => p.id !== 'not-x-but-y')
const GROUP_FAMILY: Record<string, TicFamily> = { body: 'body', grand: 'grand', pattern: 'pattern', closer: 'closer', word: 'word' }

/** The sample lines of dialogue in a writer prompt, four words or more (the ones a copy of can be told). */
export function sampleLinesOf(prompt: string): string[] {
  const out: string[] = []
  const lines = prompt.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*-\s*Sample lines of dialogue:\s*$/i.test(lines[i])) continue
    for (let k = i + 1; k < lines.length && /^\s{2,}\S/.test(lines[k]); k++) {
      const l = lines[k].trim().replace(/^['‘"“]|['’"”]$/g, '').trim()
      if (l.split(/\s+/).length >= 4) out.push(l)
    }
  }
  return [...new Set(out)]
}

/**
 * Stock-phrase spans in a text: [start, end) of each, no overlaps, in order, with its tic family. Sample lines count
 * when copied whole. `app`: the app's own list of AI phrases too (APP_SLOP).
 */
export function slopSpans(text: string, samples: string[] = [], app = false): { start: number; end: number; was: string; family: TicFamily }[] {
  const found: { start: number; end: number; was: string; family: TicFamily }[] = []
  const add = (start: number, end: number, family: TicFamily): void => {
    if (found.some((f) => start < f.end && end > f.start)) return
    found.push({ start, end, was: text.slice(start, end), family })
  }
  SLOP_PHRASES.forEach((re, i) => {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) add(m.index ?? 0, (m.index ?? 0) + m[0].length, SLOP_FAMILIES[i] ?? 'pattern')
  })
  if (app) for (const p of APP_SLOP) for (const m of text.matchAll(new RegExp(p.pattern.source, p.pattern.flags))) add(m.index ?? 0, (m.index ?? 0) + m[0].length, GROUP_FAMILY[p.group] ?? 'pattern')
  const flat = (s: string): string => s.toLowerCase().replace(/[’']/g, "'")
  for (const line of samples) {
    const at = flat(text).indexOf(flat(line).replace(/[.!?]$/, ''))
    if (at >= 0) add(at, at + line.replace(/[.!?]$/, '').length, 'voice')
  }
  return found.sort((a, b) => a.start - b.start)
}

export interface SlopSpan {
  id: string
  para: number
  start: number
  end: number
  was: string
  sentence: string
  family: TicFamily
}

/** The stock-phrase spans in the AI's words of each landed paragraph (never in a paragraph Adam typed in). */
export function slopIn(input: Pick<RepairInput, 'paragraphs'>, samples: string[]): SlopSpan[] {
  const out: SlopSpan[] = []
  input.paragraphs.forEach((p, para) => {
    if (p.edited) return
    const ai = p.text.slice(p.from, p.to)
    for (const s of slopSpans(ai, samples, true)) {
      const start = p.from + s.start
      const end = p.from + s.end
      const from = Math.max(p.text.lastIndexOf('.', start - 1), p.text.lastIndexOf('\n', start - 1)) + 1
      const stop = p.text.slice(end).search(/[.!?](\s|$)/)
      out.push({ id: `S${out.length + 1}`, para, start, end, was: s.was, family: s.family, sentence: p.text.slice(from, stop < 0 ? p.text.length : end + stop + 1).trim() })
    }
  })
  return out.slice(0, MOST)
}

/**
 * The short request: the spans grouped by tic family, each family under its own instruction (FAMILY_FIX), each span
 * with its sentence; the reply is a JSON list of new wordings.
 */
export function slopMessages(spans: SlopSpan[]): { role: 'system' | 'user'; content: string }[] {
  const families = [...new Set(spans.map((s) => s.family))]
  return [
    {
      role: 'system',
      content: `${SLOP_MARKER}\nYou are a careful fiction editor. Each item is a stock phrase in a sentence of a novel, listed under the kind of fault it is and how to mend that kind. Give each a new wording that does what its kind asks, fits the sentence exactly where the phrase stands (same grammar, same tense, UK spelling) and keeps every fact. Reply with only JSON: {"rewrites": [{"id": "S1", "with": "..."}]}`
    },
    {
      role: 'user',
      content: families
        .map((f) => [`## ${FAMILY_FIX[f]}`, ...spans.filter((s) => s.family === f).map((s) => `${s.id}: phrase "${s.was}" in: ${s.sentence}`)].join('\n'))
        .join('\n\n')
    }
  ]
}

/** The new wordings, by span id; empty when the reply can't be read. */
export function readRewrites(reply: string): Map<string, string> {
  try {
    const v = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)) as { rewrites?: { id?: unknown; with?: unknown }[] }
    return new Map((v.rewrites ?? []).filter((r) => typeof r.id === 'string' && typeof r.with === 'string' && r.with.trim()).map((r) => [String(r.id).toUpperCase(), String(r.with).trim()]))
  } catch {
    return new Map()
  }
}

/**
 * The outcome with the stock phrases' rewrites added as fixes (none that overlap a fix check and repair already has).
 * One call; any failure leaves the outcome as it was.
 */
export async function withSlopFixes(
  o: { db: Database.Database; model: MemoryModel; signal?: AbortSignal; closed: () => boolean; fetchImpl?: typeof fetch; retryDelays?: number[] },
  input: RepairInput,
  out: RepairOutcome
): Promise<RepairOutcome> {
  try {
    let prompt = ''
    try {
      prompt = (gens.getGeneration(o.db, input.recordId).messages ?? []).map((m) => m.content).join('\n')
    } catch {
      prompt = ''
    }
    const spans = slopIn(input, sampleLinesOf(prompt)).filter((s) => !out.fixes.some((f) => f.para === s.para && s.start < f.end && s.end > f.start))
    if (!spans.length) return out
    const messages = slopMessages(spans)
    const got = await callModel({
      db: o.db,
      model: o.model,
      targetId: input.sceneId,
      job: 'memory',
      messages,
      blocks: [{ id: 'slop', title: 'Stock phrases to say afresh', text: messages[1].content, tokens: estimateTokens(messages[1].content), priority: 1, dropped: false, short: false, entryIds: [] }],
      maxTokens: 600,
      signal: o.signal ?? new AbortController().signal,
      closed: o.closed,
      fetchImpl: o.fetchImpl,
      retryDelays: o.retryDelays
    })
    if (got.status !== 'complete' || o.closed()) return out
    const rewrites = readRewrites(got.text)
    const fixes: RepairFix[] = spans
      .filter((s) => rewrites.has(s.id) && rewrites.get(s.id) !== s.was)
      .map((s) => ({ id: newId(), para: s.para, start: s.start, end: s.end, was: s.was, now: rewrites.get(s.id)!, why: SLOP_WHY }))
    if (!fixes.length) return out
    return { ...out, repairId: out.repairId ?? newId(), fixes: [...out.fixes, ...fixes] }
  } catch (e) {
    console.warn('Could not say the stock phrases afresh', e)
    return out
  }
}
