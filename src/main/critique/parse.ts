// Reading the critic's reply (contracts/critique.ts): one JSON object with a summary, strengths and notes, forgiving
// the usual slips (keeper/json.ts parseLenient). Each note is checked: its category and weight are read from the words
// models use for them, its quote must be in the text (checks/quote.ts findSceneQuote: exactly, or with other quotation
// marks, dashes, capitals or spacing), and what is kept is the scene's own words, with which scene and which of their
// appearances. A quote that isn't in the text is taken off its note, which still shows, about the whole. Pure.

import type { Critique, CritiqueCategory, CritiqueNote, CritiqueScope, CritiqueWeight } from '@shared/contracts/critique'
import { CRITIQUE_CATEGORIES } from '@shared/contracts/critique'
import type { ID } from '@shared/types'
import { parseLenient, str } from '../keeper/json'
import { findSceneQuote, occurrenceAt, plainQuote } from '../checks/quote'
import { MAX_NOTES, MAX_STRENGTHS } from './prompts'

export interface RawCritique {
  summary: string
  strengths: string[]
  notes: Record<string, unknown>[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Reads the reply's JSON object, or says what was wrong with it (for asking once more). */
export function readCritiqueReply(reply: string): { ok: true; value: RawCritique } | { ok: false; why: string } {
  const parsed = parseLenient(reply)
  if (!parsed.ok) return parsed
  const v = parsed.value
  if (!isObj(v)) return { ok: false, why: 'it was not a JSON object' }
  const notes = v.notes ?? v.issues ?? []
  if (!Array.isArray(notes)) return { ok: false, why: 'its "notes" was not a list' }
  const summary = str(v.summary ?? v.overall, 1200)
  const strengths = (Array.isArray(v.strengths) ? v.strengths : typeof v.strengths === 'string' ? [v.strengths] : [])
    .map((s) => str(s, 300))
    .filter(Boolean)
  if (!summary && !notes.length) return { ok: false, why: 'it had no "summary" and no "notes"' }
  return { ok: true, value: { summary, strengths, notes: notes.filter(isObj) } }
}

/** The words models use for each category, made plain (lower case, letters only). */
const CATEGORY_WORDS: [CritiqueCategory, RegExp][] = [
  ['show-tell', /show|tell/],
  ['tension', /tension|stake|conflict|suspense/],
  ['dialogue', /dialog/],
  ['voice', /voice|character/],
  ['clarity', /clar|confus|follow/],
  ['pull', /pull|hook|cliff|read on|page turn/],
  ['opening', /open|start|begin/],
  ['ending', /end|clos/],
  ['shape', /shape|arc|structure/],
  ['flow', /flow|transition/],
  ['pacing', /pac|rhythm|drag|rush|length/],
  ['prose', /prose|repet|filler|clich|style|language|word|sentence/]
]

/** A note's category from what the model wrote; 'other' when it can't tell. */
export function categoryOf(v: unknown): CritiqueCategory {
  const s = str(v, 60).toLowerCase()
  const exact = CRITIQUE_CATEGORIES.find((c) => c === s.replace(/\s+/g, '-'))
  if (exact) return exact
  return CATEGORY_WORDS.find(([, re]) => re.test(s))?.[0] ?? 'other'
}

/** How much a note matters, from what the model wrote; 'medium' when it can't tell. */
export function weightOf(v: unknown): CritiqueWeight {
  const s = str(v, 40).toLowerCase()
  if (s === '1' || /high|major|big|important|crit|serious|must/.test(s)) return 'high'
  if (s === '3' || /low|minor|small|nit|slight/.test(s)) return 'low'
  return 'medium'
}

const WEIGHT_ORDER: Record<CritiqueWeight, number> = { high: 0, medium: 1, low: 2 }

/** The words a critique read: each scene's id and text, in reading order. */
export interface CritiqueText {
  sceneId: ID
  text: string
}

/**
 * Where a quote is: the first scene whose text holds it, its own words there, and which of their appearances it is.
 * Null when it is in none of them.
 */
export function anchorQuote(texts: CritiqueText[], quote: unknown): { sceneId: ID; quote: string; occurrence: number } | null {
  for (const t of texts) {
    const found = findSceneQuote(t.text, quote)
    if (found) return { sceneId: t.sceneId, quote: found.quote, occurrence: occurrenceAt(t.text, found.quote, found.start) }
  }
  return null
}

/**
 * The critique's notes from the reply's: each with a title or a suggestion, its quote anchored in the text (or taken
 * off), the same note twice kept once, at most eight, the ones that matter most first (otherwise as the model put
 * them).
 */
export function critiqueNotes(raw: Record<string, unknown>[], texts: CritiqueText[]): CritiqueNote[] {
  const seen = new Set<string>()
  const notes: Omit<CritiqueNote, 'id'>[] = []
  for (const n of raw) {
    const title = str(n.title ?? n.name, 120)
    const suggestion = str(n.suggestion ?? n.fix ?? n.advice ?? n.note, 900)
    if (!title && !suggestion) continue
    const at = anchorQuote(texts, n.quote)
    const key = `${title.toLowerCase()}|${at ? plainQuote(at.quote) : ''}`
    if (seen.has(key)) continue
    seen.add(key)
    notes.push({
      category: categoryOf(n.category),
      title: title || suggestion.split(/(?<=[.!?])\s/)[0].slice(0, 120),
      weight: weightOf(n.weight ?? n.severity ?? n.importance),
      quote: at?.quote ?? '',
      sceneId: at?.sceneId ?? null,
      occurrence: at?.occurrence ?? 0,
      suggestion
    })
  }
  return notes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => WEIGHT_ORDER[a.n.weight] - WEIGHT_ORDER[b.n.weight] || a.i - b.i)
    .slice(0, MAX_NOTES)
    .map(({ n }, i) => ({ id: `n${i + 1}`, ...n }))
}

/** The critique from a readable reply (the caller adds when, the fingerprint and the record). */
export function critiqueFrom(
  raw: RawCritique,
  texts: CritiqueText[],
  target: { scope: CritiqueScope; id: ID }
): Pick<Critique, 'scope' | 'targetId' | 'summary' | 'strengths' | 'notes'> {
  return {
    scope: target.scope,
    targetId: target.id,
    summary: raw.summary,
    strengths: [...new Set(raw.strengths)].slice(0, MAX_STRENGTHS),
    notes: critiqueNotes(raw.notes, texts)
  }
}
