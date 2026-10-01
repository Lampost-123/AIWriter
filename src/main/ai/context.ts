// Context assembly: builds the writer model's briefing from memory in the
// spec's fixed priority order, measures it, and drops whole blocks from the
// least important up until it fits the model. Pure: the caller supplies the
// data and a token counter, so every rule here is unit-tested.
//
// Priorities (milestone 1):
//  1 instructions + style guide + sample passage + phrases to avoid (never dropped)
//  2 scene card + Adam's direction (never dropped)
//  3 the end of the previous scene, word for word
//  4 point-of-view character: full profile and voice
//  5 other characters present: profile and voice
//  6 relationships and knowledge (milestone 2)
//  7 location with the places around it, and hard-rule lore
//  8 story so far (milestone 2)
//  9 other entries named in the beats, notes or direction
// 10 themes, tone and premise

import type { ChatMessage, ContextBlock, ContextBudget, ContextPreview, DraftOptions, Entry, ID, SceneCard, StyleGuide } from '@shared/types'
import { FIELD_GROUPS, KIND_LABELS } from '@shared/fields'
import { finalInstruction, indentMore, instructionsText } from './prompts'

export const DEFAULT_CONTEXT_LENGTH = 16_000
export const TOKENS_PER_WORD = 1.35
/** Room for the reply: the target length plus 40%. */
export const REPLY_HEADROOM = 1.4
export const SAFETY_MARGIN = 0.1
/** Tokens for the chat format around each message. */
const MESSAGE_OVERHEAD = 4

export interface ContextInput {
  /** The style guide in effect (preferences, world and story merged). */
  style: StyleGuide
  scene: { title: string; card: SceneCard }
  /** Plain text of the scene before this one, or null at the start of the line. */
  previousText: string | null
  /** Every live entry in the world. */
  entries: Entry[]
  world: { themes: string; tone: string }
  story: { title: string; premise: string; themes: string; tone: string }
  options: DraftOptions
  /** From the model choice; null when unknown. */
  contextLength: number | null
}

export interface BlockDraft {
  id: string
  priority: number
  title: string
  text: string
  entryIds: ID[]
}

export interface PreparedContext {
  blocks: BlockDraft[]
  finals: { withPrevious: string; withoutPrevious: string }
  /** Every text to measure, in order: each block as sent, then both closing instructions. */
  texts: string[]
  contextLength: number
  targetWords: number
}

// ---------- Budget ----------

export const replyTokens = (targetWords: number): number => Math.ceil(Math.max(0, targetWords) * TOKENS_PER_WORD * REPLY_HEADROOM)

export function computeBudget(contextLength: number | null, targetWords: number): Omit<ContextBudget, 'used'> {
  const length = contextLength && contextLength > 0 ? contextLength : DEFAULT_CONTEXT_LENGTH
  const reserved = replyTokens(targetWords)
  const available = Math.max(0, length - reserved - Math.ceil(length * SAFETY_MARGIN))
  return { contextLength: length, reserved, available }
}

/** Token estimate with a 10% allowance, since providers count differently. */
export const withAllowance = (rawTokens: number): number => Math.ceil(rawTokens * 1.1)

// ---------- Formatting memory entries ----------

const clean = (s: string | undefined | null): string => (s ?? '').trim()

/** Every filled kind-specific field, grouped under the labels from src/shared/fields.ts. Never private notes. */
export function fieldSections(e: Entry): string[] {
  const groups = FIELD_GROUPS[e.kind] ?? []
  const out: string[] = []
  for (const g of groups) {
    const lines: string[] = []
    for (const f of g.fields) {
      const v = clean(e.fields?.[f.key])
      if (!v) continue
      if (v.includes('\n')) {
        lines.push(`- ${f.label}:\n${v.split(/\r?\n/).filter((l) => l.trim()).map((l) => `    ${l.trim()}`).join('\n')}`)
      } else {
        lines.push(`- ${f.label}: ${v}`)
      }
    }
    // A kind with a single group (places, lore) doesn't need the group's label.
    if (lines.length) out.push(groups.length > 1 ? `${g.label}\n${lines.join('\n')}` : lines.join('\n'))
  }
  return out
}

/** A full profile: name line, aliases, summary, description and every filled field. */
export function formatProfile(e: Entry, heading: string | null = `### ${e.name}`): string {
  const head: string[] = []
  if (heading) head.push(heading)
  const aliases = (e.aliases ?? []).map((a) => a.trim()).filter(Boolean)
  if (aliases.length) head.push(`Also called: ${aliases.join(', ')}`)
  if (clean(e.summary)) head.push(`In short: ${clean(e.summary)}`)
  const parts = [head.join('\n')]
  if (clean(e.description)) parts.push(clean(e.description))
  parts.push(...fieldSections(e))
  return parts.filter(Boolean).join('\n\n')
}

/** One line for an entry: its name and one-line summary. */
export function oneLine(e: Entry): string {
  return clean(e.summary) ? `${e.name}: ${clean(e.summary)}` : e.name
}

/** The places containing this one, nearest first (cycle-safe). */
export function parentChain(place: Entry, byId: Map<ID, Entry>): Entry[] {
  const out: Entry[] = []
  const seen = new Set<ID>([place.id])
  let next = place.parentId ? byId.get(place.parentId) : undefined
  while (next && !seen.has(next.id) && out.length < 12) {
    out.push(next)
    seen.add(next.id)
    next = next.parentId ? byId.get(next.parentId) : undefined
  }
  return out
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** True when `name` appears in `text` as a whole word or phrase, ignoring case. */
export function mentions(text: string, name: string): boolean {
  const n = name.trim()
  if (n.length < 2 || !text) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

// ---------- The end of the previous scene ----------

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu

/**
 * The last 400 to 800 words of a scene, aiming for about 600, cut at the start
 * of a paragraph if possible, otherwise at the start of a sentence.
 */
export function sceneTail(text: string, o: { min: number; target: number; max: number } = { min: 400, target: 600, max: 800 }): string {
  const t = text.trim()
  const starts: number[] = []
  for (const m of t.matchAll(WORD_RE)) starts.push(m.index ?? 0)
  const n = starts.length
  if (n <= o.max) return t

  // Words from position p to the end.
  const wordsFrom = (p: number): number => {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid] < p) lo = mid + 1
      else hi = mid
    }
    return n - lo
  }
  const best = (re: RegExp): number | null => {
    let pick: number | null = null
    let dist = Infinity
    for (const m of t.matchAll(re)) {
      const p = (m.index ?? 0) + m[0].length
      const w = wordsFrom(p)
      if (w < o.min || w > o.max) continue
      const d = Math.abs(w - o.target)
      if (d < dist) {
        dist = d
        pick = p
      }
    }
    return pick
  }
  const para = best(/\n\s*/g)
  if (para != null) return t.slice(para).trim()
  const sentence = best(/[.!?…]["'”’)\]]*\s+/g)
  if (sentence != null) return t.slice(sentence).trim()
  return `…${t.slice(starts[n - o.target])}`.trim()
}

// ---------- Blocks ----------

function sceneCardText(input: ContextInput, byId: Map<ID, Entry>): string {
  const { card, title } = input.scene
  const lines: string[] = []
  if (clean(title)) lines.push(`Scene: ${clean(title)}`)
  if (clean(card.when)) lines.push(`When: ${clean(card.when)}`)
  const pov = card.povId ? byId.get(card.povId) : undefined
  if (pov) lines.push(`Point of view: ${pov.name}`)
  const others = card.presentIds.filter((id) => id !== card.povId).map((id) => byId.get(id)).filter((e): e is Entry => !!e)
  if (others.length) lines.push(`Also in the scene: ${others.map((e) => e.name).join(', ')}`)
  const where = card.locationId ? byId.get(card.locationId) : undefined
  if (where) lines.push(`Where: ${where.name}`)

  const parts: string[] = []
  if (lines.length) parts.push(lines.join('\n'))
  const beats = card.beats.map((b) => b.trim()).filter(Boolean)
  if (beats.length) parts.push(`Beats, in order:\n${beats.map((b, i) => `${i + 1}. ${indentMore(b, '   ')}`).join('\n')}`)
  const shape: string[] = []
  if (clean(card.goal)) shape.push(`Goal: ${indentMore(card.goal)}`)
  if (clean(card.conflict)) shape.push(`Conflict: ${indentMore(card.conflict)}`)
  if (clean(card.outcome)) shape.push(`Outcome: ${indentMore(card.outcome)}`)
  if (clean(card.mood)) shape.push(`Mood: ${indentMore(card.mood)}`)
  shape.push(`Length: about ${input.options.targetWords.toLocaleString('en-GB')} words`)
  parts.push(shape.join('\n'))
  if (clean(card.notes)) parts.push(`Notes from the author:\n${clean(card.notes)}`)
  if (clean(input.options.direction)) parts.push(`The author's direction for this draft:\n${clean(input.options.direction)}`)
  return parts.join('\n\n')
}

function themesText(input: ContextInput): string {
  const lines: string[] = []
  const add = (label: string, v: string): void => {
    if (clean(v)) lines.push(`${label}: ${indentMore(v)}`)
  }
  add('Story premise', input.story.premise)
  add('Story themes', input.story.themes)
  add('Story tone', input.story.tone)
  add('World themes', input.world.themes)
  add('World tone', input.world.tone)
  return lines.join('\n')
}

/** Builds every block that has something in it, in priority order. */
export function buildBlocks(input: ContextInput): BlockDraft[] {
  const entries = input.entries
  const byId = new Map(entries.map((e) => [e.id, e]))
  const card = input.scene.card
  const used = new Set<ID>()
  const blocks: BlockDraft[] = []

  // 1 Instructions and style guide.
  blocks.push({ id: 'instructions', priority: 1, title: 'Instructions and style guide', text: instructionsText(input.style), entryIds: [] })

  // 2 Scene card and direction.
  blocks.push({ id: 'scene-card', priority: 2, title: 'Scene card', text: sceneCardText(input, byId), entryIds: [] })

  // 3 The end of the previous scene.
  const prev = clean(input.previousText)
  if (prev) blocks.push({ id: 'previous-scene', priority: 3, title: 'End of the previous scene', text: sceneTail(prev), entryIds: [] })

  // 4 Point-of-view character.
  const pov = card.povId ? byId.get(card.povId) : undefined
  if (pov) {
    used.add(pov.id)
    blocks.push({ id: 'pov', priority: 4, title: `Point-of-view character: ${pov.name}`, text: formatProfile(pov, null), entryIds: [pov.id] })
  }

  // 5 Other characters present.
  const present: Entry[] = []
  for (const id of card.presentIds) {
    const e = byId.get(id)
    if (!e || used.has(id)) continue
    used.add(id)
    present.push(e)
  }
  if (present.length) {
    blocks.push({
      id: 'present',
      priority: 5,
      title: present.length === 1 ? 'Also in the scene' : 'Others in the scene',
      text: present.map((e) => formatProfile(e)).join('\n\n'),
      entryIds: present.map((e) => e.id)
    })
  }

  // 6 Relationships and knowledge: milestone 2.

  // 7 Where the scene happens, and the world's hard rules.
  const settingParts: string[] = []
  const settingIds: ID[] = []
  const where = card.locationId ? byId.get(card.locationId) : undefined
  if (where && !used.has(where.id)) {
    used.add(where.id)
    settingIds.push(where.id)
    let text = formatProfile(where, `### Where: ${where.name}`)
    const around = parentChain(where, byId).filter((p) => !used.has(p.id))
    if (around.length) {
      around.forEach((p) => {
        used.add(p.id)
        settingIds.push(p.id)
      })
      text += `\n\nIt lies within:\n${around.map((p) => `- ${oneLine(p)}`).join('\n')}`
    }
    settingParts.push(text)
  }
  const rules = entries.filter((e) => e.kind === 'lore' && e.hardRule && !used.has(e.id))
  for (const r of rules) {
    used.add(r.id)
    settingIds.push(r.id)
    settingParts.push(formatProfile(r, `### World rule: ${r.name}`))
  }
  if (settingParts.length) {
    const title = where && rules.length ? 'Setting and world rules' : where ? 'Setting' : 'World rules (never break these)'
    blocks.push({ id: 'setting', priority: 7, title, text: settingParts.join('\n\n'), entryIds: settingIds })
  }

  // 8 Story so far: milestone 2 (no summaries yet).

  // 9 Anything else named in the beats, notes or direction.
  const haystack = [...card.beats, card.notes, input.options.direction].filter(Boolean).join('\n')
  if (haystack.trim()) {
    const named = entries.filter((e) => !used.has(e.id) && [e.name, ...(e.aliases ?? [])].some((n) => mentions(haystack, n)))
    if (named.length) {
      named.forEach((e) => used.add(e.id))
      blocks.push({
        id: 'mentioned',
        priority: 9,
        title: 'Also mentioned',
        text: named
          .map((e) => {
            const head = `### ${e.name} (${KIND_LABELS[e.kind].one.toLowerCase()})`
            return [head, clean(e.summary) ? `In short: ${clean(e.summary)}` : '', clean(e.description)].filter(Boolean).join('\n')
          })
          .join('\n\n'),
        entryIds: named.map((e) => e.id)
      })
    }
  }

  // 10 Themes, tone and premise.
  const themes = themesText(input)
  if (themes) blocks.push({ id: 'themes', priority: 10, title: 'Themes and tone', text: themes, entryIds: [] })

  return blocks
}

/** How a block appears in the user message. */
export const blockAsSent = (b: BlockDraft): string => (b.priority === 1 ? b.text : `## ${b.title}\n\n${b.text}`)

export function prepareContext(input: ContextInput): PreparedContext {
  const blocks = buildBlocks(input)
  const targetWords = input.options.targetWords
  const base = {
    targetWords,
    style: input.style,
    hasBeats: input.scene.card.beats.some((b) => b.trim()),
    hasDirection: !!clean(input.options.direction)
  }
  const finals = {
    withPrevious: finalInstruction({ ...base, hasPrevious: true }),
    withoutPrevious: finalInstruction({ ...base, hasPrevious: false })
  }
  return {
    blocks,
    finals,
    texts: [...blocks.map(blockAsSent), finals.withPrevious, finals.withoutPrevious],
    contextLength: computeBudget(input.contextLength, targetWords).contextLength,
    targetWords
  }
}

/**
 * Measures, drops whole blocks from priority 10 upward until the briefing fits
 * (blocks 1 and 2 are never dropped), and builds the messages.
 * `rawCounts` are plain token counts for `prepared.texts`, in order.
 */
export function finishContext(prepared: PreparedContext, rawCounts: number[]): ContextPreview {
  const n = prepared.blocks.length
  const blocks: ContextBlock[] = prepared.blocks.map((b, i) => ({ ...b, tokens: withAllowance(rawCounts[i] ?? 0), dropped: false }))
  const finalTokens = {
    withPrevious: withAllowance(rawCounts[n] ?? 0),
    withoutPrevious: withAllowance(rawCounts[n + 1] ?? 0)
  }
  const budget = computeBudget(prepared.contextLength, prepared.targetWords)

  const measure = (): number => {
    const hasPrev = blocks.some((b) => b.id === 'previous-scene' && !b.dropped)
    const sent = blocks.filter((b) => !b.dropped).reduce((sum, b) => sum + b.tokens, 0)
    return sent + (hasPrev ? finalTokens.withPrevious : finalTokens.withoutPrevious) + MESSAGE_OVERHEAD * 2
  }

  let used = measure()
  const droppable = blocks.filter((b) => b.priority >= 3).sort((a, b) => b.priority - a.priority)
  for (const b of droppable) {
    if (used <= budget.available) break
    b.dropped = true
    used = measure()
  }

  const sent = blocks.filter((b) => !b.dropped)
  const hasPrev = sent.some((b) => b.id === 'previous-scene')
  const system = sent.find((b) => b.priority === 1)?.text ?? ''
  const user = [...sent.filter((b) => b.priority > 1).map(blockAsSent), hasPrev ? prepared.finals.withPrevious : prepared.finals.withoutPrevious].join('\n\n')
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
  return { blocks, budget: { ...budget, used }, messages }
}

/** The whole assembly with a synchronous token counter (used by tests and as a fallback). */
export function assembleContext(input: ContextInput, countRaw: (text: string) => number): ContextPreview {
  const prepared = prepareContext(input)
  return finishContext(prepared, prepared.texts.map(countRaw))
}

/** Entry ids actually sent (blocks not dropped), first appearance first. */
export function sentEntryIds(blocks: ContextBlock[]): ID[] {
  const out: ID[] = []
  const seen = new Set<ID>()
  for (const b of blocks) {
    if (b.dropped) continue
    for (const id of b.entryIds) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
