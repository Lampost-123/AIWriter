// What each story flow tells the model, read from the open world's database: the memory at the right
// point (just before a story's own start-of-story changes for a time gap, the start of the book a
// prequel leads into for its starting cast), the world's style and lore, the story's own details, and
// for "When did these happen?" the book's start-of-story changes and the new story's scenes. Each
// request is built to fit the model's window. Entries get short ids (E1, E2 ...), changes C1 ...,
// scenes S1 ..., mapped back when the reply is applied. No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, ChatMessage, ContextBlock, EntryKind, EntryState, ID, Story, WritingPrefs } from '@shared/types'
import { effectiveStyle } from '@shared/style'
import type { MemoryData, WorldShape } from '../memory/types'
import { buildLine, labeler } from '../memory/line'
import { indexChanges, stateAt, type MemoryStateAll } from '../memory/state'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { changeWords } from '../keeper/facts'
import { clip, estimateTokens, firstWords } from '../keeper/text'
import type { FlowBudget } from './call'
import { CAST_KINDS, SYSTEMS } from './prompts'

type DB = Database.Database

// ---------- Short ids ----------

/** Short ids for one request (E1, C1, S1), and what they stand for. */
export class ShortIds {
  private readonly toId = new Map<string, ID>()
  private readonly toShort = new Map<ID, string>()
  constructor(private readonly prefix: string) {}
  /** The short id an id has, or would get next (without giving it one). */
  peek(id: ID): string {
    return this.toShort.get(id) ?? `${this.prefix}${this.toShort.size + 1}`
  }
  of(id: ID): string {
    let s = this.toShort.get(id)
    if (!s) {
      s = `${this.prefix}${this.toShort.size + 1}`
      this.toShort.set(id, s)
      this.toId.set(s, id)
    }
    return s
  }
  /** The id a short id in a reply stands for ("E1", "e1", " E1 "), or undefined. */
  get(short: unknown): ID | undefined {
    return typeof short === 'string' ? this.toId.get(short.trim().toUpperCase()) : undefined
  }
  has(id: ID): boolean {
    return this.toShort.has(id)
  }
  ids(): ID[] {
    return [...this.toShort.keys()]
  }
}

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

const q = (s: string): string => `"${s.replace(/\s+/g, ' ').trim()}"`

// ---------- The memory at a point ----------

/** The memory just before a story's own start-of-story changes: what a time gap starts from. */
export function stateBeforeStart(shape: WorldShape, data: MemoryData, storyId: ID): MemoryStateAll {
  const line = buildLine(shape, { storyId, through: 'start' })
  const steps = line.steps.filter((s) => !(s.type === 'start-changes' && s.storyId === storyId))
  return stateAt(data, shape, { ...line, steps }, indexChanges(data.changes))
}

/** The memory at a story's start, after its start-of-story changes: how a book first shows its cast. */
export function stateAtStart(shape: WorldShape, data: MemoryData, storyId: ID): MemoryStateAll {
  return stateAt(data, shape, buildLine(shape, { storyId, through: 'start' }), indexChanges(data.changes))
}

const KIND_ORDER: EntryKind[] = ['character', 'group', 'place', 'item']

/** Characters, places, groups and items, the ones that have been through most first. */
export function castOf(entries: Iterable<EntryState>): EntryState[] {
  return [...entries]
    .filter((e) => CAST_KINDS.includes(e.kind))
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        b.happened.length - a.happened.length ||
        a.name.localeCompare(b.name)
    )
}

// ---------- In words ----------

/** One entry as the model is told it: in full (its state at the point) or its name and one line. */
export function entryLine(e: EntryState, id: string, full: boolean): string {
  const head = `- ${id} ${e.kind} ${q(e.name)}${e.aliases.length ? ` (also: ${e.aliases.join(', ')})` : ''}`
  const parts: string[] = []
  if (e.summary.trim()) parts.push(clip(e.summary, 30))
  if (!full) return parts.length ? `${head}: ${parts[0]}` : head
  if (e.description.trim()) parts.push(clip(e.description, 60))
  const fields = Object.entries(e.fields ?? {})
    .filter(([k, v]) => k !== 'sampleLines' && v && v.trim())
    .slice(0, 16)
    .map(([k, v]) => `${k}: ${clip(v, 15)}`)
  if (fields.length) parts.push(fields.join('; '))
  const happened = e.happened.slice(-6).map((h) => h.note.trim()).filter(Boolean)
  if (happened.length) parts.push(`So far: ${happened.join('; ')}`)
  return `${head}. ${parts.join('. ')}`.replace(/\.\s*\./g, '.').trim()
}

const STYLE_SPELLING = { UK: 'British', US: 'American' } as const

/** The world's themes, tone and style guide, the series' and the story's, in a few lines. */
function styleLines(db: DB, story: Story, prefs: WritingPrefs): string[] {
  const out: string[] = []
  const add = (label: string, v: string | undefined | null): void => {
    if (v && v.trim()) out.push(`${label}: ${clip(v.trim(), 60)}`)
  }
  add('World themes', repo.getMeta(db, 'themes'))
  add('World tone', repo.getMeta(db, 'tone'))
  const series = story.seriesId ? repo.listSeries(db).find((s) => s.id === story.seriesId) : undefined
  if (series) {
    add('Series themes', series.themes)
    add('Series tone', series.tone)
  }
  add('Story themes', story.themes)
  add('Story tone', story.tone)
  const style = effectiveStyle(prefs, repo.getWorldStyle(db), story.style)
  if (style.spelling) out.push(`Spelling: ${STYLE_SPELLING[style.spelling]}`)
  add('Content limits (always respect these)', style.contentLimits)
  add("Author's notes", style.notes)
  return out
}

/** Lore: world rules first, each in a line or two. */
function loreLines(lore: EntryState[]): string[] {
  return [...lore]
    .sort((a, b) => Number(b.hardRule) - Number(a.hardRule) || a.name.localeCompare(b.name))
    .map((e) => {
      const text = e.summary.trim() || e.description.trim() || e.fields?.rules?.trim() || ''
      return `- ${e.name}${e.hardRule ? ' (a rule never to break)' : ''}${text ? `: ${clip(text, 40)}` : ''}`
    })
}

/** The world section: style and lore, as much as fits. */
function worldSection(db: DB, story: Story, prefs: WritingPrefs, state: MemoryStateAll, room: Room): string {
  const style = styleLines(db, story, prefs).filter((l) => room.take(l))
  const lore = loreLines([...state.entries.values()].filter((e) => e.kind === 'lore')).filter((l) => room.take(l))
  const parts = ['## The world']
  if (style.length) parts.push(style.join('\n'))
  if (lore.length) parts.push(['Lore and world rules:', ...lore].join('\n'))
  if (parts.length === 1) parts.push('(No style guide or lore yet.)')
  return parts.join('\n')
}

function storyLines(db: DB, story: Story, extra: string[] = []): string[] {
  const series = story.seriesId ? repo.listSeries(db).find((s) => s.id === story.seriesId) : undefined
  return [
    `Title: ${story.title.trim() || 'Untitled story'}`,
    ...(series ? [`Series: ${series.name}`] : []),
    `Premise: ${story.premise.trim() ? clip(story.premise.trim(), 200) : '(none written yet)'}`,
    ...extra
  ]
}

// ---------- Requests ----------

export interface FlowRequest {
  messages: ChatMessage[]
  blocks: ContextBlock[]
  /** Entries told about, with their version, for the record of what the model saw. */
  entries: { entryId: ID; version: string }[]
}

function finish(
  flow: keyof typeof SYSTEMS,
  sections: { id: string; title: string; text: string; priority: number; entryIds?: ID[] }[],
  versions: Map<ID, string>
): FlowRequest {
  const system = SYSTEMS[flow]
  const user = sections
    .map((s) => s.text)
    .filter(Boolean)
    .join('\n\n')
  const block = (id: string, priority: number, title: string, text: string, entryIds: ID[] = []): ContextBlock => ({
    id,
    priority,
    title,
    text,
    tokens: estimateTokens(text),
    entryIds,
    dropped: false
  })
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    blocks: [
      block('instructions', 1, 'Instructions for the memory model', system),
      ...sections.filter((s) => s.text).map((s) => block(s.id, s.priority, s.title, s.text, s.entryIds ?? []))
    ],
    entries: [...versions].map(([entryId, version]) => ({ entryId, version }))
  }
}

export interface GapRequest extends FlowRequest {
  ids: ShortIds
  /** Entries the reply may change (the cast listed), and open plot threads it may close. */
  cast: Set<ID>
  threads: Set<ID>
}

/** "What changed before this story starts?": the gap, the story, the world and everything as it is just before it starts. */
export function timeGapRequest(
  db: DB,
  o: { story: Story; shape: WorldShape; data: MemoryData; prefs: WritingPrefs; budget: FlowBudget }
): GapRequest {
  const { story } = o
  const state = stateBeforeStart(o.shape, o.data, story.id)
  const ids = new ShortIds('E')
  const versions = new Map<ID, string>()
  const room = new Room(o.budget.available)

  const before = story.startStoryId ? o.shape.stories.find((s) => s.id === story.startStoryId) : undefined
  const storyText = ['## The new story', ...storyLines(db, story, [`Time since the story before it: ${story.timeGap.trim()}`])].join('\n')
  room.take(storyText)
  const summary = before ? (mem.getSummary(db, 'story', before.id)?.text.trim() ?? '') : ''
  const beforeText = before
    ? `## The story before it: ${before.title}\n${summary ? clip(summary, 300) : '(No summary of it yet.)'}`
    : '## The story before it\n(None: it starts at the beginning of the world.)'
  room.take(beforeText)

  // Open plot threads first (they are few, and closing them is half the job), then the cast.
  const threadLines: string[] = []
  const threads = new Set<ID>()
  for (const t of state.threads) {
    const e = state.entries.get(t.entryId)
    if (t.status !== 'open' || !e) continue
    const promise = e.fields?.promise?.trim() || e.summary.trim()
    const line = `- ${ids.peek(e.id)} ${q(e.name)}${promise ? `: ${clip(promise, 30)}` : ''}${t.setUp ? ` (set up in ${t.setUp})` : ''}`
    if (threadLines.length >= 40 || !room.take(line)) break
    ids.of(e.id)
    threads.add(e.id)
    versions.set(e.id, e.updatedAt)
    threadLines.push(line)
  }

  const worldText = worldSection(db, story, o.prefs, state, room)

  const cast = new Set<ID>()
  const castLines: string[] = []
  const people = castOf(state.entries.values())
  // In full while there is room, then names only, so the model knows who is there at all.
  for (const e of people) {
    const full = entryLine(e, ids.peek(e.id), true)
    const line = room.left > estimateTokens(full) * 3 ? full : entryLine(e, ids.peek(e.id), false)
    if (!room.take(line)) break
    ids.of(e.id)
    cast.add(e.id)
    versions.set(e.id, e.updatedAt)
    castLines.push(line)
  }
  const relLines: string[] = []
  for (const r of state.relationships) {
    if (!cast.has(r.aId) || !cast.has(r.bId)) continue
    const feel = r.aFeels || r.bFeels ? ` (${ids.of(r.aId)}: ${r.aFeels || '-'}; ${ids.of(r.bId)}: ${r.bFeels || '-'})` : ''
    const line = `- ${ids.of(r.aId)} and ${ids.of(r.bId)}: ${r.type || 'linked'}${feel}`
    if (relLines.length >= 60 || !room.take(line)) break
    relLines.push(line)
  }

  const memoryText = [
    castLines.length
      ? ['## Characters, places, groups and items just before the new story starts', ...castLines].join('\n')
      : '## Characters, places, groups and items just before the new story starts\n(None yet.)',
    relLines.length ? ['Relationships:', ...relLines].join('\n') : ''
  ]
    .filter(Boolean)
    .join('\n\n')
  const threadText = threadLines.length ? ['## Open plot threads', ...threadLines].join('\n') : '## Open plot threads\n(None.)'
  return {
    ...finish(
      'time-gap',
      [
        { id: 'story', priority: 1, title: 'The new story and the time since the story before it', text: storyText },
        { id: 'story-before', priority: 3, title: 'The story before it', text: beforeText },
        { id: 'world', priority: 4, title: 'Style and lore', text: worldText },
        { id: 'memory', priority: 2, title: 'Everything just before it starts', text: memoryText, entryIds: [...cast] },
        { id: 'threads', priority: 2, title: 'Open plot threads', text: threadText, entryIds: [...threads] }
      ],
      versions
    ),
    ids,
    cast,
    threads
  }
}

export interface CastRequest extends FlowRequest {
  ids: ShortIds
  /** The entries to draft, as they are at the book's start. */
  drafting: EntryState[]
}

/** The starting cast of a prequel: each entry as the book first shows it, the others they know, the world and the prequel. */
export function castRequest(
  db: DB,
  o: { story: Story; book: Story; entryIds: ID[]; shape: WorldShape; data: MemoryData; prefs: WritingPrefs; budget: FlowBudget }
): CastRequest {
  const { story, book } = o
  const state = stateAtStart(o.shape, o.data, book.id)
  const ids = new ShortIds('E')
  const versions = new Map<ID, string>()
  const room = new Room(o.budget.available)

  const extra = [`It leads into: ${book.title.trim() || 'Untitled story'}`]
  if (story.timeGap.trim()) extra.push(`How long before ${book.title.trim() || 'that book'} it starts: ${story.timeGap.trim()}`)
  const storyText = ['## The prequel', ...storyLines(db, story, extra)].join('\n')
  room.take(storyText)

  // Every entry asked for goes in, in full: they are the job.
  const drafting: EntryState[] = []
  for (const id of o.entryIds) {
    const e = state.entries.get(id) ?? state.absent.get(id)
    if (!e || drafting.some((d) => d.id === id)) continue
    drafting.push(e)
    ids.of(e.id)
    versions.set(e.id, e.updatedAt)
  }
  const castLines = drafting.map((e) => entryLine(e, ids.of(e.id), true))
  for (const l of castLines) room.take(l)

  const worldText = worldSection(db, story, o.prefs, state, room)

  // The others they know at the book's start, so the prequel's relationships can name them.
  const drafted = new Set(drafting.map((e) => e.id))
  const relLines: string[] = []
  const otherLines: string[] = []
  for (const r of state.relationships) {
    if (!drafted.has(r.aId) && !drafted.has(r.bId)) continue
    for (const id of [r.aId, r.bId]) {
      const e = state.entries.get(id)
      if (!e || ids.has(id)) continue
      const line = entryLine(e, ids.peek(id), false)
      if (!room.take(line)) continue
      ids.of(id)
      versions.set(id, e.updatedAt)
      otherLines.push(line)
    }
    if (!ids.has(r.aId) || !ids.has(r.bId)) continue
    const feel = r.aFeels || r.bFeels ? ` (${ids.of(r.aId)}: ${r.aFeels || '-'}; ${ids.of(r.bId)}: ${r.bFeels || '-'})` : ''
    const line = `- ${ids.of(r.aId)} and ${ids.of(r.bId)}: ${r.type || 'linked'}${feel}`
    if (relLines.length < 60 && room.take(line)) relLines.push(line)
  }
  const bookTitle = book.title.trim() || 'the book'
  const castText = [`## Cast to draft (each as it is at the start of ${bookTitle})`, ...castLines].join('\n')
  const othersText = [
    otherLines.length ? [`## Others they know at the start of ${bookTitle}`, ...otherLines].join('\n') : '',
    relLines.length ? [`Relationships at the start of ${bookTitle}:`, ...relLines].join('\n') : ''
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    ...finish(
      'starting-cast',
      [
        { id: 'story', priority: 1, title: 'The prequel', text: storyText },
        { id: 'world', priority: 3, title: 'Style and lore', text: worldText },
        { id: 'others', priority: 3, title: 'Others they know', text: othersText },
        { id: 'cast', priority: 1, title: 'The cast to draft, as the book first shows them', text: castText, entryIds: [...drafted] }
      ],
      versions
    ),
    ids,
    drafting
  }
}

export interface WhenRequest extends FlowRequest {
  changeIds: ShortIds
  sceneIds: ShortIds
}

/** "When did these happen?": the new story with its scenes, the book and each of its start-of-story changes. */
export function whenRequest(
  db: DB,
  o: { story: Story; book: Story; changes: Change[]; shape: WorldShape; data: MemoryData; prefs: WritingPrefs; budget: FlowBudget }
): WhenRequest {
  const { story, book } = o
  const state = stateAtStart(o.shape, o.data, story.id)
  const changeIds = new ShortIds('C')
  const sceneIds = new ShortIds('S')
  const versions = new Map<ID, string>()
  const room = new Room(o.budget.available)
  const names = new Map(o.data.entries.map((e) => [e.id, e]))
  const nameOf = (id: ID): string => names.get(id)?.name ?? 'someone'

  const storyText = [
    '## The new story',
    ...storyLines(db, story, story.timeGap.trim() ? [`Time since the story before it: ${story.timeGap.trim()}`] : [])
  ].join('\n')
  room.take(storyText)
  const bookTitle = book.title.trim() || 'Untitled story'
  const changeLines = o.changes.map((c) => {
    const e = names.get(c.entryId)
    if (e) versions.set(e.id, e.updatedAt)
    const words = c.kind === 'full' ? `how it is from then on: ${clip(c.payload.description, 40)}` : changeWords(c, nameOf)
    return `- ${changeIds.of(c.id)} ${e ? `${e.name} (${e.kind})` : 'Someone'}: ${words}`
  })
  const changesText = [
    `## The later story: ${bookTitle}, which now continues after the new story`,
    'Changes at its start:',
    ...changeLines
  ].join('\n')
  room.take(changesText)

  const node = o.shape.stories.find((s) => s.id === story.id)
  const label = labeler(o.shape)
  const sceneLines: string[] = []
  const scenes = node ? node.chapters.flatMap((c) => c.scenes) : []
  for (const sc of scenes) {
    const summary = mem.getSummary(db, 'scene', sc.id)?.text.trim() ?? ''
    const text = summary || firstWords(mem.sceneText(db, sc.id)?.text ?? '', 80).trim()
    const where = label({ storyId: story.id, sceneId: sc.id }).replace(/^[^,]*, /, '')
    const titled = sc.title.trim() ? ` ${q(sc.title)}` : ''
    const line = `- ${sceneIds.peek(sc.id)} ${where}${titled}: ${text ? clip(text, 120) : '(not written yet)'}`
    if (!room.take(line)) break
    sceneIds.of(sc.id)
    sceneLines.push(line)
  }
  const scenesHead = `## Scenes of ${story.title.trim() || 'the new story'}`
  const scenesText = sceneLines.length
    ? [scenesHead, ...sceneLines].join('\n')
    : `${scenesHead}\n(It has no scenes yet, so nothing can happen in it: pick "before" or "after".)`
  const worldText = worldSection(db, story, o.prefs, state, room)
  return {
    ...finish(
      'when',
      [
        { id: 'story', priority: 1, title: 'The new story', text: storyText },
        { id: 'changes', priority: 1, title: `Changes at the start of ${bookTitle}`, text: changesText, entryIds: [...versions.keys()] },
        { id: 'scenes', priority: 2, title: 'Its scenes', text: scenesText },
        { id: 'world', priority: 4, title: 'Style and lore', text: worldText }
      ],
      versions
    ),
    changeIds,
    sceneIds
  }
}
