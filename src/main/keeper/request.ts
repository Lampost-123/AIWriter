// Builds the memory model's reading requests for one scene: the changed paragraphs split into
// chunks that fit the model, each with a little surrounding text, the scene card, the facts whose
// words changed, the facts already read from the scene and the memory at this point (entries the
// chunk mentions in full, then names of the rest while there is room). Entries, facts and known facts
// are given short ids (E1, F1, K1), mapped back when the reply is applied; an entry's E id is fixed by
// when it was made, so it reads the same in every request. No Electron imports.

import type { ChatMessage, ContextBlock, EntryState, ID, ModelChoice, SceneCard } from '@shared/types'
import type { SceneMemory } from '../memory/types'
import { READING_SYSTEM } from './prompts'
import { changeWords, fieldValue, type SceneFact } from './facts'
import { clip, estimateTokens, firstWords, lastWords, likeness, mentionAt, splitLong, words, type Para } from './text'
import { DEFAULT_MEMORY_CONTEXT } from './model'
import { lastClue } from './threads'

/** How much of the model's window each request may use. */
export interface ReadingBudget {
  contextLength: number
  /** Room kept for the reply. */
  reply: number
  /** Tokens for everything but the instructions. */
  available: number
  /** Tokens for the scene's paragraphs in one request. */
  text: number
}

export function readingBudget(choice: Pick<ModelChoice, 'contextLength' | 'maxOutput'>): ReadingBudget | null {
  const contextLength = choice.contextLength && choice.contextLength > 0 ? choice.contextLength : DEFAULT_MEMORY_CONTEXT
  let reply = Math.max(400, Math.min(4000, Math.floor(contextLength * 0.2)))
  if (choice.maxOutput && choice.maxOutput > 0) reply = Math.min(reply, choice.maxOutput)
  const available = Math.floor(contextLength * 0.9) - reply - estimateTokens(READING_SYSTEM)
  if (available < 350) return null
  return { contextLength, reply, available, text: Math.max(120, Math.floor(available * 0.45)) }
}

/** One piece of a chunk: a paragraph (or part of a long one) to read, or surrounding text. */
interface Piece {
  label: string
  text: string
  para: Para | null
}

export interface ReadingChunk {
  /** Paragraphs (or parts) to read, labelled P1, P2... by their place in the scene. */
  pieces: Piece[]
  /** The paragraphs this chunk reads. */
  paras: Para[]
  atRisk: SceneFact[]
}

/** Splits the paragraphs to read into chunks that fit, with a little surrounding text, and gives each fact whose words changed to one. */
export function planChunks(all: Para[], toRead: Para[], atRisk: SceneFact[], budget: ReadingBudget): ReadingChunk[] {
  if (!toRead.length) return []
  const index = new Map(all.map((p, i) => [p, i]))
  const reading = new Set(toRead)
  const chunks: ReadingChunk[] = []
  let cur: ReadingChunk = { pieces: [], paras: [], atRisk: [] }
  let used = 0
  const flush = (): void => {
    if (cur.paras.length) chunks.push(cur)
    cur = { pieces: [], paras: [], atRisk: [] }
    used = 0
  }
  const contextFor = (i: number, before: boolean): Piece | null => {
    const p = all[i]
    if (!p || reading.has(p)) return null
    return { label: 'Context', text: before ? lastWords(p.text, 50) : firstWords(p.text, 50), para: null }
  }
  for (const p of toRead) {
    const i = index.get(p) ?? 0
    const parts = splitLong(p.text, budget.text)
    for (const part of parts) {
      const cost = estimateTokens(part) + 4
      if (cur.paras.length && used + cost > budget.text) flush()
      if (!cur.paras.includes(p)) {
        const prev = cur.pieces.length ? null : contextFor(i - 1, true)
        if (prev && used + estimateTokens(prev.text) + cost <= budget.text) {
          cur.pieces.push(prev)
          used += estimateTokens(prev.text) + 4
        }
        cur.paras.push(p)
      }
      cur.pieces.push({ label: `P${i + 1}`, text: part, para: p })
      used += cost
    }
    const next = contextFor(i + 1, false)
    if (next && used + estimateTokens(next.text) + 4 <= budget.text) {
      cur.pieces.push(next)
      used += estimateTokens(next.text) + 4
    }
  }
  flush()
  giveAtRisk(chunks, atRisk)
  return chunks
}

/** Each fact whose words changed goes with the chunk holding its paragraph, or the most alike text. */
function giveAtRisk(chunks: ReadingChunk[], atRisk: SceneFact[]): void {
  for (const f of atRisk) {
    const link = f.links[0]
    let best = link?.paragraphId ? chunks.findIndex((c) => c.paras.some((p) => p.pid === link.paragraphId)) : -1
    if (best < 0) {
      let score = -1
      chunks.forEach((c, n) => {
        const s = Math.max(0, ...c.paras.map((p) => likeness(link?.quote ?? '', p.text)))
        if (s > score) {
          score = s
          best = n
        }
      })
    }
    chunks[Math.max(0, best)].atRisk.push(f)
  }
}

/**
 * A chunk in two halves of about the same size, for when the model's reply to it ran past the reply
 * limit; null when it is too small to split.
 */
export function splitChunk(chunk: ReadingChunk): [ReadingChunk, ReadingChunk] | null {
  let pieces = chunk.pieces
  const reading = pieces.filter((p) => p.para)
  if (reading.length === 1) {
    // One paragraph (or part of one): split its text, keeping the surrounding text either side.
    const one = reading[0]
    const parts = splitLong(one.text, Math.ceil(estimateTokens(one.text) / 2))
    if (parts.length < 2) return null
    const at = pieces.indexOf(one)
    pieces = [...pieces.slice(0, at), ...parts.map((text) => ({ ...one, text })), ...pieces.slice(at + 1)]
  }
  const cost = (p: Piece): number => (p.para ? estimateTokens(p.text) + 4 : 0)
  const total = pieces.reduce((n, p) => n + cost(p), 0)
  // Cut before the paragraph piece that would take the first half past the middle (never before the first).
  let used = 0
  let cut = -1
  let seen = 0
  for (let i = 0; i < pieces.length; i++) {
    if (!pieces[i].para) continue
    if (seen > 0 && used + cost(pieces[i]) / 2 > total / 2) {
      cut = i
      break
    }
    used += cost(pieces[i])
    seen++
  }
  if (cut < 0) return null
  const half = (ps: Piece[]): ReadingChunk => ({ pieces: ps, paras: [...new Set(ps.flatMap((p) => (p.para ? [p.para] : [])))], atRisk: [] })
  const halves: [ReadingChunk, ReadingChunk] = [half(pieces.slice(0, cut)), half(pieces.slice(cut))]
  giveAtRisk(halves, chunk.atRisk)
  return halves
}

/**
 * Short ids for one request, and what they stand for. `order`: entries whose E id is fixed by their place in it (E1 the
 * first), whatever order the request names them in, so the same entry reads the same from one request to the next and a
 * provider can reuse the start of a prompt it has seen (DeepSeek, OpenAI); any other entry gets the next id after them.
 */
export class Ids {
  readonly entries = new Map<string, ID>()
  readonly byEntry = new Map<ID, string>()
  readonly facts = new Map<string, SceneFact>()
  readonly known = new Map<string, ID>()
  readonly knownText = new Map<string, string>()
  private readonly fixed = new Map<ID, number>()
  private extra = 0

  constructor(order: ID[] = []) {
    for (const id of order) if (!this.fixed.has(id)) this.fixed.set(id, this.fixed.size + 1)
  }

  /** The number an entry's E id has, or would get next (without giving it one). */
  private number(id: ID): number {
    const e = this.byEntry.get(id)
    if (e) return Number(e.slice(1))
    return this.fixed.get(id) ?? this.fixed.size + this.extra + 1
  }
  /** The short id an entry has, or would get next (without giving it one). */
  peek(id: ID): string {
    return `E${this.number(id)}`
  }
  entry(id: ID): string {
    let e = this.byEntry.get(id)
    if (!e) {
      if (!this.fixed.has(id)) this.extra++
      e = `E${this.fixed.get(id) ?? this.fixed.size + this.extra}`
      this.byEntry.set(id, e)
      this.entries.set(e, id)
    }
    return e
  }
  fact(f: SceneFact): string {
    const id = `F${this.facts.size + 1}`
    this.facts.set(id, f)
    return id
  }
  knownFact(factId: ID, fact: string): string {
    for (const [k, v] of this.known) if (v === factId) return k
    const k = `K${this.known.size + 1}`
    this.known.set(k, factId)
    this.knownText.set(k, fact)
    return k
  }
}

export interface ReadingRequest {
  messages: ChatMessage[]
  blocks: ContextBlock[]
  ids: Ids
  /** Entries told about, for the record of what the model saw. */
  entryIds: ID[]
}

const q = (s: string): string => `"${s.replace(/\s+/g, ' ').trim()}"`

/** A fact as the memory model is told it ("change E1: lost her left hand"). */
function describeFact(f: SceneFact, ids: Ids): string {
  const e = ids.entry(f.entry.id)
  switch (f.kind) {
    case 'change': {
      const c = f.change
      if (c.kind === 'relationship')
        return `relationship ${e} with ${ids.entry(c.payload.otherId)}: ${c.payload.type}${c.payload.ended ? ' (ended)' : ''}`
      if (c.kind === 'knowledge') return `${c.payload.forgets ? 'forgets' : 'knows'} ${e}: ${c.payload.fact}`
      if (c.kind === 'thread') return `thread ${e}: ${c.payload.status}${c.payload.note ? ` (${c.payload.note})` : ''}`
      const fields = Object.entries(c.kind === 'update' ? (c.payload.fields ?? {}) : {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')
      return `change ${e}: ${changeWords(c, () => '').toLowerCase()}${fields ? ` (${fields})` : ''}`
    }
    case 'field':
      // An entry's one-line summary (World Memory Overhaul A2): a "summary" item revises it.
      if (f.field === 'summary') return `summary ${e}: ${clip(fieldValue(f.entry, f.field), 30)}`
      return `detail ${e} ${f.field}: ${clip(fieldValue(f.entry, f.field), 30)}`
    case 'voice':
      return `voice ${e}: ${q(f.line)}`
    case 'entry':
      return `entry ${e} ${f.entry.kind} ${q(f.entry.name)}`
  }
}

/** One entry as the memory model is told it: in full (state at this point) or as a name only. */
function entryLine(e: EntryState, id: string, full: boolean): string {
  const head = `- ${id} ${e.kind} ${q(e.name)}${e.aliases.length ? ` (also: ${e.aliases.join(', ')})` : ''}`
  if (!full) return head
  const parts: string[] = []
  if (e.summary.trim()) parts.push(clip(e.summary, 30))
  if (e.description.trim()) parts.push(clip(e.description, 40))
  const fields = Object.entries(e.fields ?? {})
    .filter(([k, v]) => k !== 'sampleLines' && v && v.trim())
    .slice(0, 14)
    .map(([k, v]) => `${k}: ${clip(v, 15)}`)
  if (fields.length) parts.push(fields.join('; '))
  const happened = e.happened.slice(-5).map((h) => h.note)
  if (happened.length) parts.push(`So far: ${happened.join('; ')}`)
  return `${head}. ${parts.join('. ')}`.replace(/\.\s*\./g, '.').trim()
}

/**
 * The entries in the order their E ids are fixed in: by when each was made, then by id. An entry the keeper adds goes
 * last, so the ids of the others stay as they were from one request to the next.
 */
export function steadyIds(entries: Pick<EntryState, 'id' | 'createdAt'>[]): ID[] {
  const made = (e: Pick<EntryState, 'createdAt'>): string => e.createdAt ?? ''
  return [...entries].sort((a, b) => (made(a) < made(b) ? -1 : made(a) > made(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((e) => e.id)
}

/** Entry lines ("- E3 character ...") by their E id's number. */
function byIdNumber(lines: string[]): string[] {
  const n = (l: string): number => Number(/^- E(\d+)\b/.exec(l)?.[1] ?? Infinity)
  return [...lines].sort((a, b) => n(a) - n(b))
}

function mentioned(e: EntryState, text: string): boolean {
  return [e.name, ...e.aliases].some((n) => mentionAt(text, n) !== null)
}

/**
 * Room for the names of entries the chunk doesn't mention. They help the model reuse an entry the
 * text calls something else ("the Duke" for Duke Aldric), but a run should send only what the
 * changed paragraphs need, never every name in a big world on each pause in typing.
 */
export const NAMES_TOKENS = 1500

/** Lines added while they fit the room left. */
class Room {
  constructor(public left: number) {}
  take(line: string): boolean {
    const t = estimateTokens(line) + 1
    if (t > this.left) return false
    this.left -= t
    return true
  }
}

export interface RequestInput {
  where: string
  title: string
  card: SceneCard
  chunk: ReadingChunk
  /** Facts read from this scene whose words are still there. */
  found: SceneFact[]
  memory: SceneMemory | null
  budget: ReadingBudget
}

/** The messages for one chunk, and the blocks saved for "What the AI saw". */
export function buildRequest(r: RequestInput): ReadingRequest {
  const sm = r.memory
  const here = sm?.entries ?? []
  const ids = new Ids(steadyIds([...here, ...(sm?.elsewhere ?? []).map((x) => x.entry)]))
  const chunkText = r.chunk.pieces.map((p) => p.text).join('\n')
  const byId = new Map<ID, EntryState>(here.map((e) => [e.id, e]))
  const onCard = new Set<ID>([r.card.povId, ...r.card.presentIds, r.card.locationId].filter((x): x is ID => !!x))

  // The scene's paragraphs first: they must go in.
  const sceneLines = [
    `## Scene: ${r.where}${r.title ? ` ${q(r.title)}` : ''}`,
    ...cardLines(r.card, ids, byId),
    ...r.chunk.pieces.map((p) => `${p.label}: ${p.text}`)
  ]
  const room = new Room(r.budget.available - estimateTokens(sceneLines.join('\n')))

  // Facts whose words changed: they need a verdict, so they go in too.
  const riskLines = r.chunk.atRisk.map((f) => {
    const id = ids.fact(f)
    return `- ${id} ${describeFact(f, ids)} | words, no longer in the scene: ${q(f.links[0]?.quote ?? '')}`
  })
  for (const l of riskLines) room.take(l)

  // The memory: entries this chunk mentions (or the scene card lists) in full, as of this scene.
  const memoryLines: string[] = []
  const shown = new Set<ID>()
  const relevant = here.filter((e) => onCard.has(e.id) || mentioned(e, chunkText) || r.chunk.atRisk.some((f) => f.entry.id === e.id))
  for (const e of relevant) {
    const line = entryLine(e, ids.peek(e.id), true)
    if (room.take(line)) {
      ids.entry(e.id)
      memoryLines.push(line)
      shown.add(e.id)
    }
  }
  // Facts already read from this scene (so they aren't repeated): those in the chunk's paragraphs,
  // then those about the entries it mentions.
  const foundLines: string[] = []
  const pids = new Set(r.chunk.paras.map((p) => p.pid).filter(Boolean))
  const near = (f: SceneFact): number => (f.links.some((l) => l.paragraphId && pids.has(l.paragraphId)) ? 0 : 1)
  const about = new Set(relevant.map((e) => e.id))
  const found = r.found
    .filter((f) => near(f) === 0 || about.has(f.entry.id) || (f.kind === 'change' && about.has(f.change.entryId)))
    .sort((a, b) => near(a) - near(b))
  for (const f of found) {
    const line = `- ${ids.fact(f)} ${describeFact(f, ids)} | words: ${q(f.links.find((l) => l.state === 'ok')?.quote ?? f.links[0]?.quote ?? '')}`
    if (!room.take(line)) break
    foundLines.push(line)
  }
  // Relationships, known facts and open plot threads among those shown.
  const relLines: string[] = []
  for (const rel of sm?.relationships ?? []) {
    if (!shown.has(rel.aId) || !shown.has(rel.bId)) continue
    const line = `- ${ids.entry(rel.aId)} and ${ids.entry(rel.bId)}: ${rel.type}${rel.aFeels || rel.bFeels ? ` (${ids.entry(rel.aId)}: ${rel.aFeels || '-'}; ${ids.entry(rel.bId)}: ${rel.bFeels || '-'})` : ''}`
    if (room.take(line)) relLines.push(line)
  }
  const factLines: string[] = []
  for (const f of sm?.facts ?? []) {
    if (!f.knownBy.some((k) => shown.has(k)) && !relevant.some((e) => mentionAt(f.fact, e.name))) continue
    const known = f.knownBy.filter((k) => shown.has(k)).map((k) => ids.entry(k))
    const line = `- ${ids.knownFact(f.factId, f.fact)} ${q(f.fact)}${known.length ? `: known by ${known.join(', ')}` : ''}`
    if (factLines.length < 40 && room.take(line)) factLines.push(line)
  }
  // Each open thread with what it promises and its last clue (2026-10-08), so a clue or a payoff is told apart from news.
  const threadLines: string[] = []
  for (const t of sm?.threads ?? []) {
    if (t.status !== 'open') continue
    const e = byId.get(t.entryId)
    if (!e) continue
    const promise = clip(e.fields?.promise ?? '', 30)
    const clue = clip(lastClue(e), 20)
    const payoff = clip(e.fields?.payoff ?? '', 20)
    const about = [promise ? `promise: ${promise}` : '', clue ? `last clue: ${clue}` : '', payoff ? `meant to pay off: ${payoff}` : '']
      .filter(Boolean)
      .join('; ')
    const line = `- ${ids.peek(e.id)} thread ${q(e.name)}${about ? `. ${about}` : ''}`
    if (threadLines.length < 30 && room.take(line)) {
      ids.entry(e.id)
      threadLines.push(line)
      shown.add(e.id)
    }
  }
  // Entries from elsewhere in the world that this chunk mentions: reuse them, never duplicate them.
  const elsewhereLines: string[] = []
  for (const x of sm?.elsewhere ?? []) {
    if (!mentioned(x.entry, chunkText)) continue
    const line = `${entryLine(x.entry, ids.peek(x.entry.id), false)}: ${x.label}`
    if (!room.take(line)) continue
    ids.entry(x.entry.id)
    elsewhereLines.push(line)
  }
  // Names of other entries here, so a new entry isn't a duplicate: first those sharing a word with
  // the chunk, then the rest, within a small allowance.
  const nameLines: string[] = []
  const nameRoom = new Room(Math.min(room.left, NAMES_TOKENS))
  const chunkWords = new Set(words(chunkText).filter((w) => w.length >= 4))
  const shares = (e: EntryState): boolean => [e.name, ...e.aliases].some((n) => words(n).some((w) => chunkWords.has(w)))
  const others = here.filter((e) => !shown.has(e.id) && e.kind !== 'thread' && e.kind !== 'event')
  for (const e of [...others.filter(shares), ...others.filter((e) => !shares(e))]) {
    const line = entryLine(e, ids.peek(e.id), false)
    if (!nameRoom.take(line) || !room.take(line)) break
    ids.entry(e.id)
    nameLines.push(line)
  }

  // Sent in an order that changes as little as it can from one request to the next, so a provider can reuse the start of
  // a prompt it has seen (the cache audit of 8 October 2026 found keeper prompts matching for only their first ~1,000
  // characters): relationships and who knows what (the same unless the memory learns something) before the memory, and
  // the memory's lines by their E ids (fixed by when each entry was made: steadyIds), not by which ones the chunk names.
  const memoryText = [
    sm?.knows ? sm.knows : '',
    relLines.length ? ['Relationships:', ...relLines].join('\n') : '',
    factLines.length ? ['Facts (who knows what):', ...factLines].join('\n') : '',
    memoryLines.length || nameLines.length
      ? ['## Memory at this point', ...byIdNumber([...memoryLines, ...nameLines])].join('\n')
      : '## Memory at this point\n(nothing yet)',
    threadLines.length ? ['Open plot threads:', ...threadLines].join('\n') : '',
    elsewhereLines.length ? ['## Elsewhere in the world (not at this point yet; use these ids)', ...elsewhereLines].join('\n') : ''
  ]
    .filter(Boolean)
    .join('\n\n')
  const foundText = foundLines.length ? ['## Facts from this scene', ...foundLines].join('\n') : ''
  const riskText = riskLines.length ? ['## Facts whose words changed (a verdict for each)', ...riskLines].join('\n') : ''
  const sceneText = sceneLines.join('\n')
  const user = [memoryText, foundText, riskText, sceneText].filter(Boolean).join('\n\n')

  const entryIds = [...ids.entries.values()]
  const block = (id: string, priority: number, title: string, text: string, entries: ID[] = []): ContextBlock => ({
    id,
    priority,
    title,
    text,
    tokens: estimateTokens(text),
    entryIds: entries,
    dropped: false
  })
  const blocks = [
    block('instructions', 1, 'Instructions for the memory model', READING_SYSTEM),
    block('memory', 3, 'The memory at this point', memoryText, entryIds),
    ...(foundText ? [block('scene-facts', 4, 'Facts already read from this scene', foundText)] : []),
    ...(riskText ? [block('changed-facts', 2, 'Facts whose words changed', riskText)] : []),
    block('scene-text', 2, 'The new and changed paragraphs', sceneText)
  ]
  return {
    messages: [
      { role: 'system', content: READING_SYSTEM },
      { role: 'user', content: user }
    ],
    blocks,
    ids,
    entryIds
  }
}

function cardLines(card: SceneCard, ids: Ids, byId: Map<ID, EntryState>): string[] {
  const name = (id: ID | null): string | null => {
    if (!id) return null
    const e = byId.get(id)
    return e ? `${ids.entry(id)} ${e.name}` : null
  }
  const parts: string[] = []
  const pov = name(card.povId)
  if (pov) parts.push(`point of view ${pov}`)
  const present = card.presentIds.map(name).filter(Boolean)
  if (present.length) parts.push(`present ${present.join(', ')}`)
  const place = name(card.locationId)
  if (place) parts.push(`place ${place}`)
  if (card.when.trim()) parts.push(`when ${card.when.trim()}`)
  return parts.length ? [`Scene card: ${parts.join('; ')}`] : []
}
