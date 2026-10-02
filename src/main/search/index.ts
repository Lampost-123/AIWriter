// The search index of an open world (milestone 3, spec: Search). It holds the world's words,
// folded so case and accents don't matter, and answers a search by scanning them in memory: a few
// milliseconds for a 300,000-word series, where reading them from the database each time would
// take far longer. It is filled once (prepareSearch, or the first search) and kept in step by the
// change feed in db/search.ts: a search first re-reads only the rows written since the last one.
// No Electron imports, so it is unit-tested against an in-memory world.

import type Database from 'better-sqlite3'
import type { EntryKind, ID, StyleGuide, SummaryLevel } from '@shared/types'
import type {
  CardPart,
  EntryPart,
  SearchGroup,
  SearchGroupId,
  SearchHit,
  SearchOpen,
  SearchOptions,
  SearchPlace,
  SearchResults,
  TextPart
} from '@shared/contracts/search'
import { ENTRY_KINDS, FIELD_GROUPS, KIND_LABELS } from '@shared/fields'
import * as rows from '../db/search'
import { loadShape } from '../db/memory'
import { labeler } from '../memory/line'
import {
  fold,
  hasPhrase,
  hasTerm,
  marked,
  matchesAll,
  parseQuery,
  plainWords,
  snippet,
  wordsToReveal,
  type Snippet,
  type Term
} from './text'

type DB = Database.Database

/** Results per group unless Adam asks for more, and how many "Show more" lists. */
export const GROUP_LIMIT = 4
export const MORE_LIMIT = 50

/** Above this many changed rows of one kind, reading them all again is quicker than one by one. */
const REREAD_ALL = 300

// ---------- What the index holds ----------

/** A labelled piece of text with its folded form. */
interface Field {
  label: string
  text: string
  f: string
}

const field = (label: string, text: string): Field => ({ label, text, f: fold(text) })

/** A field of a scene's card, with the part it is (to open the card there). */
interface CardField extends Field {
  part: CardPart
}

/** A field of an entry, with the part of its page it is on (to open the page there). */
interface EntryField extends Field {
  part: EntryPart
}

interface SceneDoc {
  id: ID
  title: string
  titleF: string
  text: string
  textF: string
  card: CardField[]
  notes: Field
  /** Everything a scene result matches on (not its notes, which are listed under Notes). */
  all: string[]
}

interface EntryDoc {
  id: ID
  kind: EntryKind
  name: string
  nameF: string
  aliases: Field[]
  summary: Field
  /** Description, tags, the kind's fields and what the memory has about it over the story, each labelled. */
  more: EntryField[]
  notes: Field
  /** Name and aliases; with the summary; with everything else. */
  names: string[]
  short: string[]
  all: string[]
}

interface SummaryDoc {
  level: SummaryLevel
  targetId: ID
  text: Field
}

interface ChapterDoc {
  id: ID
  storyId: ID
  title: Field
  goal: Field
}

interface StoryDoc {
  id: ID
  title: Field
  premise: Field
  seriesId: ID | null
  style: Field[]
}

/** Where each live story, chapter and scene is: reading order (shelf order, then chapters, then scenes) and plain words. */
interface Outline {
  stories: Map<ID, { order: number; firstSceneId: ID | null }>
  chapters: Map<ID, { storyId: ID; order: number; label: string; firstSceneId: ID | null }>
  scenes: Map<ID, { storyId: ID; chapterId: ID; order: number; label: string }>
}

interface Dirty {
  all: boolean
  outline: boolean
  chapters: boolean
  stories: boolean
  series: boolean
  style: boolean
  scenes: Set<ID>
  entries: Set<ID>
  summaries: Set<string>
}

const clean = (): Dirty => ({
  all: false,
  outline: false,
  chapters: false,
  stories: false,
  series: false,
  style: false,
  scenes: new Set(),
  entries: new Set(),
  summaries: new Set()
})

const everything = (): Dirty => ({ ...clean(), all: true })

// ---------- Plain words ----------

const STYLE_FIELDS: [keyof StyleGuide, string][] = [
  ['pov', 'Point of view'],
  ['tense', 'Tense'],
  ['proseStyle', 'Prose style'],
  ['samplePassage', 'Sample passage'],
  ['avoidPhrases', 'Phrases to avoid'],
  ['contentLimits', 'Content limits'],
  ['notes', 'Notes']
]

function styleFields(style: Partial<StyleGuide>): Field[] {
  return STYLE_FIELDS.flatMap(([key, label]) => {
    const v = style[key]
    const text = Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : ''
    return text.trim() ? [field(label, text)] : []
  })
}

/** A field's label in plain words ("Fears", "Atmosphere"): the kind's own, else any kind's with that key. */
const ALL_FIELDS = Object.values(FIELD_GROUPS).flatMap((groups) => (groups ?? []).flatMap((g) => g.fields))
const fieldLabel = (kind: EntryKind, key: string): string =>
  FIELD_GROUPS[kind]?.flatMap((g) => g.fields).find((f) => f.key === key)?.label ?? ALL_FIELDS.find((f) => f.key === key)?.label ?? key

/** The sections of an entry's page that list what the memory has about it, by their titles there (features/world/memory/). */
function sectionLabel(kind: EntryKind, section: rows.ChangeSection): string {
  if (section === 'knows') return 'Knows at the start'
  if (section === 'changes') return 'Changes over time'
  return kind === 'character' || kind === 'group' ? 'Relationships' : 'Connections'
}

const SUMMARY_WORDS: Record<SummaryLevel, string> = {
  scene: 'Scene summary',
  chapter: 'Chapter summary',
  story: 'Story summary',
  series: 'Series summary'
}

const GROUP_LABELS: Record<Exclude<SearchGroupId, EntryKind>, string> = {
  scenes: 'Scenes',
  summaries: 'Summaries',
  notes: 'Notes',
  stories: 'Chapters and stories',
  style: 'Style guide'
}

const plain = (text: string): TextPart[] => (text ? [{ text }] : [])
const labelled = (label: string, rest: TextPart[]): TextPart[] => (rest.length ? [{ text: `${label}: ` }, ...rest] : [])

// ---------- The index ----------

/** One candidate result with how it sorts: lower first. */
interface Ranked<T> {
  doc: T
  rank: number[]
}

const byRank = <T>(a: Ranked<T>, b: Ranked<T>): number => {
  for (let i = 0; i < Math.max(a.rank.length, b.rank.length); i++) {
    const d = (a.rank[i] ?? 0) - (b.rank[i] ?? 0)
    if (d) return d
  }
  return 0
}

export class SearchIndex {
  private scenes = new Map<ID, SceneDoc>()
  private entries = new Map<ID, EntryDoc>()
  private summaries = new Map<string, SummaryDoc>()
  private chapters = new Map<ID, ChapterDoc>()
  private stories = new Map<ID, StoryDoc>()
  private series = new Map<ID, string>()
  private style: Field[] = []
  private outline: Outline = { stories: new Map(), chapters: new Map(), scenes: new Map() }
  private dirty: Dirty = everything()
  /** Rows written changes are followed (db/search.ts); otherwise any write means reading everything again. */
  private following: boolean
  private writes = -1

  constructor(private db: DB) {
    this.following = rows.followChanges(db, (kind, id) => this.changed(kind, id))
  }

  /** Notes a written row, to be read again before the next search. */
  private changed(kind: rows.ChangeKind, id: string): void {
    const d = this.dirty
    if (d.all) return
    switch (kind) {
      case 'scene':
        d.scenes.add(id)
        break
      case 'outline':
        d.outline = true
        break
      case 'chapter':
        d.chapters = true
        break
      case 'story':
        d.stories = true
        break
      case 'series':
        d.series = true
        break
      case 'entry':
        d.entries.add(id)
        break
      case 'summary':
        d.summaries.add(id)
        break
      case 'style':
        d.style = true
        break
    }
  }

  /** True when nothing has been written since the index was last brought up to date. */
  get fresh(): boolean {
    const d = this.dirty
    return (
      !d.all &&
      !d.outline &&
      !d.chapters &&
      !d.stories &&
      !d.series &&
      !d.style &&
      !d.scenes.size &&
      !d.entries.size &&
      !d.summaries.size &&
      (this.following || rows.writeCount(this.db) === this.writes)
    )
  }

  /** Reads again whatever was written since the last search (everything, the first time). */
  refresh(): void {
    if (!this.following) {
      const n = rows.writeCount(this.db)
      if (n !== this.writes) this.dirty = everything()
      this.writes = n
    }
    const d = this.dirty
    this.dirty = clean()
    try {
      this.apply(d)
    } catch (e) {
      // Whatever wasn't read is read on the next search.
      this.dirty = everything()
      throw e
    }
  }

  private apply(d: Dirty): void {
    const db = this.db
    if (d.all || d.stories) this.stories = new Map(rows.storyWords(db).map((s) => [s.id, this.storyDoc(s)]))
    if (d.all || d.chapters) this.chapters = new Map(rows.chapterWords(db).map((c) => [c.id, this.chapterDoc(c)]))
    if (d.all || d.series) this.series = rows.seriesNames(db)
    if (d.all || d.style) this.style = styleFields(rows.worldStyle(db))
    if (d.all || d.outline || d.chapters || d.stories) this.outline = this.readOutline()

    // Scenes: every one the first time; then those written, and any live scene not read yet (a chapter brought back).
    if (d.all) this.scenes = new Map(rows.sceneWords(db).map((s) => [s.id, this.sceneDoc(s)]))
    else {
      const ids = new Set(d.scenes)
      if (d.outline || d.chapters || d.stories) for (const id of this.outline.scenes.keys()) if (!this.scenes.has(id)) ids.add(id)
      if (ids.size > REREAD_ALL) this.scenes = new Map(rows.sceneWords(db).map((s) => [s.id, this.sceneDoc(s)]))
      else if (ids.size) {
        for (const id of ids) this.scenes.delete(id)
        for (const s of rows.sceneWords(db, [...ids])) this.scenes.set(s.id, this.sceneDoc(s))
      }
    }

    if (d.all || d.entries.size > REREAD_ALL) this.entries = new Map(rows.entryWords(db).map((e) => [e.id, this.entryDoc(e)]))
    else if (d.entries.size) {
      for (const id of d.entries) this.entries.delete(id)
      for (const e of rows.entryWords(db, [...d.entries])) this.entries.set(e.id, this.entryDoc(e))
    }

    const key = (s: rows.SummaryWords): string => `${s.level}:${s.targetId}`
    if (d.all || d.summaries.size > REREAD_ALL) this.summaries = new Map(rows.summaryWords(db).map((s) => [key(s), this.summaryDoc(s)]))
    else if (d.summaries.size) {
      for (const k of d.summaries) this.summaries.delete(k)
      for (const s of rows.summaryWords(db, [...d.summaries])) this.summaries.set(key(s), this.summaryDoc(s))
    }
  }

  private readOutline(): Outline {
    const shape = loadShape(this.db)
    const label = labeler(shape)
    const out: Outline = { stories: new Map(), chapters: new Map(), scenes: new Map() }
    let order = 0
    for (const story of shape.stories) {
      const first = story.chapters.find((c) => c.scenes.length)?.scenes[0]?.id ?? null
      out.stories.set(story.id, { order: order++, firstSceneId: first })
      for (const c of story.chapters) {
        out.chapters.set(c.id, {
          storyId: story.id,
          order: order++,
          label: label({ storyId: story.id, chapterId: c.id }),
          firstSceneId: c.scenes[0]?.id ?? null
        })
        for (const s of c.scenes) {
          out.scenes.set(s.id, {
            storyId: story.id,
            chapterId: c.id,
            order: order++,
            label: label({ storyId: story.id, chapterId: c.id, sceneId: s.id })
          })
        }
      }
    }
    return out
  }

  private sceneDoc(s: rows.SceneWords): SceneDoc {
    const titleF = fold(s.title)
    const textF = fold(s.text)
    const card = s.card.map((c): CardField => ({ ...field(c.label, c.text), part: c.part }))
    return {
      id: s.id,
      title: s.title,
      titleF,
      text: s.text,
      textF,
      card,
      notes: field('Notes for the AI', s.notes),
      all: [titleF, textF, ...card.map((c) => c.f)]
    }
  }

  private entryDoc(e: rows.EntryWords): EntryDoc {
    const nameF = fold(e.name)
    const aliases = e.aliases.map((a) => field('Also called', a))
    const summary = field('Summary', e.summary)
    const at = (f: Field, part: EntryPart): EntryField => ({ ...f, part })
    const more = [
      at(field('', e.description), { kind: 'field', key: 'description' }),
      ...(e.tags.length ? [at(field('Tags', e.tags.join(', ')), { kind: 'field', key: 'tags' })] : []),
      ...Object.entries(e.fields).map(([key, v]) => at(field(fieldLabel(e.kind, key), v), { kind: 'field', key })),
      ...e.changes.map((c) => at(field(sectionLabel(e.kind, c.section), c.text), { kind: c.section }))
    ].filter((f) => f.text.trim() !== '')
    const names = [nameF, ...aliases.map((a) => a.f)]
    const short = [...names, summary.f]
    return {
      id: e.id,
      kind: e.kind,
      name: e.name,
      nameF,
      aliases,
      summary,
      more,
      notes: field('Private notes', e.notes),
      names,
      short,
      all: [...short, ...more.map((m) => m.f)]
    }
  }

  private summaryDoc(s: rows.SummaryWords): SummaryDoc {
    return { level: s.level, targetId: s.targetId, text: field(SUMMARY_WORDS[s.level], s.text) }
  }

  private chapterDoc(c: rows.ChapterWords): ChapterDoc {
    return { id: c.id, storyId: c.storyId, title: field('Title', c.title), goal: field('Goal', c.goal) }
  }

  private storyDoc(s: rows.StoryWords): StoryDoc {
    return {
      id: s.id,
      title: field('Title', s.title),
      premise: field('Premise', s.premise),
      seriesId: s.seriesId,
      style: styleFields(s.style)
    }
  }

  // ---------- Searching ----------

  search(query: string, options: SearchOptions = {}): SearchResults {
    const started = performance.now()
    const q = parseQuery(typeof query === 'string' ? query : '')
    if (!q) return { query, groups: [], ms: 0 }
    this.refresh()
    const terms = q.terms
    const limit = Math.max(1, Math.min(MORE_LIMIT, Math.floor(options.limit ?? GROUP_LIMIT)))
    const expand = new Set(options.expand ?? [])
    const take = (id: SearchGroupId): number => (expand.has(id) ? MORE_LIMIT : limit)

    // What is found by its name comes first (entries by a name or their summary, chapters and stories
    // by title), then the manuscript, then the rest: entries found only in their description or what
    // the memory has about them would otherwise fill the list before the first scene.
    const entries = this.entryGroups(terms, take)
    const stories = this.storyGroup(terms, take('stories'))
    const groups: SearchGroup[] = [
      ...entries.filter((e) => e.named).map((e) => e.group),
      ...(stories.named ? [stories.group] : []),
      this.sceneGroup(terms, take('scenes'), options.storyId ?? null),
      ...entries.filter((e) => !e.named).map((e) => e.group),
      this.summaryGroup(terms, take('summaries')),
      this.noteGroup(terms, take('notes')),
      ...(stories.named ? [] : [stories.group]),
      this.styleGroup(terms, take('style'))
    ].filter((g) => g.total > 0)
    return { query, groups, ms: Math.round((performance.now() - started) * 10) / 10 }
  }

  /**
   * Entries, a group per kind: names first, then aliases, then the one-line summary, then everything
   * else. `named`: the group's best is found by a name or the summary (it is listed before the scenes).
   */
  private entryGroups(terms: Term[], take: (id: SearchGroupId) => number): { group: SearchGroup; named: boolean }[] {
    const words = terms.map((t) => t.word).join(' ')
    const found = new Map<EntryKind, Ranked<EntryDoc>[]>()
    for (const e of this.entries.values()) {
      // By the name itself, by any of its names, with the summary too, or with everything else.
      const tier = [[e.nameF], e.names, e.short, e.all].findIndex((texts) => matchesAll(texts, terms))
      if (tier < 0) continue
      // Among names: the name itself, then names starting with the first word, then the rest; shorter names first.
      const name = plainWords(e.nameF)
      const exact = tier > 0 ? 0 : name === words ? 0 : name.startsWith(terms[0].word) ? 1 : 2
      const list = found.get(e.kind) ?? []
      list.push({ doc: e, rank: [tier, exact, tier === 0 ? e.name.length : 0] })
      found.set(e.kind, list)
    }
    return ENTRY_KINDS.flatMap((kind) => {
      const list = found.get(kind)
      if (!list?.length) return []
      list.sort((a, b) => byRank(a, b) || a.doc.name.localeCompare(b.doc.name))
      const hits = list.slice(0, take(kind)).map((r) => this.entryHit(r.doc, terms, r.rank[0]))
      return [{ group: { id: kind, label: KIND_LABELS[kind].many, total: list.length, hits }, best: list[0].rank }]
    })
      .sort((a, b) => a.best[0] - b.best[0] || a.best[1] - b.best[1])
      .map((g) => ({ group: g.group, named: g.best[0] < 3 }))
  }

  private entryHit(e: EntryDoc, terms: Term[], tier: number): SearchHit {
    let rest: TextPart[]
    // Found further down its page than its name and summary: the page opens there.
    let part: EntryPart | null = null
    let words: string | null = null
    if (tier === 1) {
      const alias = e.aliases.find((a) => matchesAll([a.f], terms)) ?? e.aliases.find((a) => terms.some((t) => hasTerm(a.f, t)))
      rest = alias ? labelled('Also called', marked(alias.text, terms)) : []
    } else if (tier === 3) {
      // The field with the most of the words in it.
      const count = (f: Field): number => terms.filter((t) => hasTerm(f.f, t)).length
      const best = [...e.more].sort((a, b) => count(b) - count(a))[0]
      const s = snippet(best.text, terms, 140)
      rest = best.label ? labelled(best.label, s.parts) : s.parts
      part = best.part
      words = entryWords(best, s)
    } else rest = e.summary.text.trim() ? snippet(e.summary.text, terms, 140).parts : []
    return {
      key: `entry:${e.id}`,
      title: marked(e.name || 'Untitled', terms),
      detail: '',
      snippet: rest,
      prose: false,
      open: { kind: 'entry', entryId: e.id, entryKind: e.kind, part, words }
    }
  }

  /**
   * The manuscript: titles first, then scenes with the words together as typed, then the rest; the
   * open story first, then in reading order.
   */
  private sceneGroup(terms: Term[], take: number, storyId: ID | null): SearchGroup {
    const found: Ranked<SceneDoc>[] = []
    for (const [id, place] of this.outline.scenes) {
      const s = this.scenes.get(id)
      if (!s || !matchesAll(s.all, terms)) continue
      const tier = matchesAll([s.titleF], terms) ? 0 : hasPhrase(s.textF, terms) ? 1 : 2
      found.push({ doc: s, rank: [tier, place.storyId === storyId ? 0 : 1, place.order] })
    }
    found.sort(byRank)
    const hits = found.slice(0, take).map((r) => this.sceneHit(r.doc, terms))
    return { id: 'scenes', label: GROUP_LABELS.scenes, total: found.length, hits }
  }

  private sceneHit(s: SceneDoc, terms: Term[]): SearchHit {
    const place = this.outline.scenes.get(s.id)!
    // How well a text holds the query: the words together, then every word, then how many of them.
    // A card part that holds it better than the text opens instead, so a phrase from the card's goal
    // isn't opened at one common word ("out", "the") the text shares with it. The text wins a tie.
    const fit = (f: string): number =>
      hasPhrase(f, terms) ? terms.length + 2 : matchesAll([f], terms) ? terms.length + 1 : terms.filter((t) => hasTerm(f, t)).length
    const textFit = fit(s.textF)
    const inText = textFit > 0
    let card: CardField | undefined
    let cardFit = textFit
    for (const c of s.card) {
      const n = fit(c.f)
      if (n > cardFit) [card, cardFit] = [c, n]
    }
    let parts: TextPart[]
    let words: string | null = null
    if (card) parts = labelled(card.label, snippet(card.text, terms, 160).parts)
    else {
      const found = snippet(s.text, inText ? terms : [], 180)
      parts = found.parts
      if (found.words) words = wordsToReveal(s.text, found.at, found.words)
    }
    return {
      key: `scene:${s.id}`,
      title: marked(s.title || 'Untitled scene', terms),
      detail: place.label,
      snippet: parts,
      prose: !card,
      open: { kind: 'scene', sceneId: s.id, storyId: place.storyId, words, card: card?.part ?? null }
    }
  }

  /** Summaries at every level, in reading order. */
  private summaryGroup(terms: Term[], take: number): SearchGroup {
    const found: Ranked<SummaryDoc>[] = []
    for (const s of this.summaries.values()) {
      const order = this.targetOrder(s)
      if (order === null || !matchesAll([s.text.f], terms)) continue
      found.push({ doc: s, rank: [order] })
    }
    found.sort(byRank)
    const hits = found.slice(0, take).map((r) => this.summaryHit(r.doc, terms))
    return { id: 'summaries', label: GROUP_LABELS.summaries, total: found.length, hits }
  }

  /** Where a summary's scene, chapter, story or series is in reading order; null when it is gone. */
  private targetOrder(s: SummaryDoc): number | null {
    const o = this.outline
    switch (s.level) {
      case 'scene':
        return o.scenes.get(s.targetId)?.order ?? null
      case 'chapter':
        return o.chapters.get(s.targetId)?.order ?? null
      case 'story':
        return o.stories.get(s.targetId)?.order ?? null
      case 'series':
        // Before its books; a series with no story left has nowhere to open.
        return this.seriesFirstStory(s.targetId) ? -1 : null
    }
  }

  /** A series' first live story, or null. */
  private seriesFirstStory(seriesId: ID): ID | null {
    if (!this.series.has(seriesId)) return null
    let first: { id: ID; order: number } | null = null
    for (const st of this.stories.values()) {
      const place = st.seriesId === seriesId ? this.outline.stories.get(st.id) : undefined
      if (place && (!first || place.order < first.order)) first = { id: st.id, order: place.order }
    }
    return first?.id ?? null
  }

  private summaryHit(s: SummaryDoc, terms: Term[]): SearchHit {
    const o = this.outline
    let title: string
    let detail = SUMMARY_WORDS[s.level]
    let open: SearchOpen
    if (s.level === 'scene') {
      const place = o.scenes.get(s.targetId)!
      title = this.scenes.get(s.targetId)?.title || 'Untitled scene'
      detail = `${detail} · ${place.label}`
      open = { kind: 'scene', sceneId: s.targetId, storyId: place.storyId, words: null, card: 'summary' }
    } else if (s.level === 'chapter') {
      const place = o.chapters.get(s.targetId)!
      title = this.chapters.get(s.targetId)?.title.text || 'Untitled chapter'
      detail = `${detail} · ${place.label}`
      open = this.chapterOpen(s.targetId)
    } else if (s.level === 'story') {
      title = this.stories.get(s.targetId)?.title.text || 'Untitled story'
      open = { kind: 'story', storyId: s.targetId, sceneId: null }
    } else {
      title = this.series.get(s.targetId) || 'Untitled series'
      open = { kind: 'story', storyId: this.seriesFirstStory(s.targetId)!, sceneId: null }
    }
    return {
      key: `summary:${s.level}:${s.targetId}`,
      title: plain(title),
      detail,
      snippet: snippet(s.text.text, terms, 180).parts,
      prose: false,
      open
    }
  }

  private chapterOpen(chapterId: ID): SearchOpen {
    const c = this.outline.chapters.get(chapterId)!
    return c.firstSceneId
      ? { kind: 'scene', sceneId: c.firstSceneId, storyId: c.storyId, words: null, card: null }
      : { kind: 'story', storyId: c.storyId, sceneId: null }
  }

  /** Entries' private notes (by name), then scene cards' notes for the AI (in reading order). */
  private noteGroup(terms: Term[], take: number): SearchGroup {
    const entries: EntryDoc[] = []
    for (const e of this.entries.values()) if (e.notes.f && matchesAll([e.notes.f], terms)) entries.push(e)
    entries.sort((a, b) => a.name.localeCompare(b.name))
    const scenes: Ranked<SceneDoc>[] = []
    for (const [id, place] of this.outline.scenes) {
      const s = this.scenes.get(id)
      if (s?.notes.f && matchesAll([s.notes.f], terms)) scenes.push({ doc: s, rank: [place.order] })
    }
    scenes.sort(byRank)
    const total = entries.length + scenes.length
    const hits: SearchHit[] = [
      ...entries.slice(0, take).map((e): SearchHit => {
        const s = snippet(e.notes.text, terms, 180)
        return {
          key: `note:entry:${e.id}`,
          title: plain(e.name || 'Untitled'),
          detail: `Private notes · ${KIND_LABELS[e.kind].one}`,
          snippet: s.parts,
          prose: false,
          open: { kind: 'entry', entryId: e.id, entryKind: e.kind, part: { kind: 'notes' }, words: entryWords(e.notes, s) }
        }
      }),
      ...scenes.slice(0, Math.max(0, take - entries.length)).map(({ doc: s }): SearchHit => {
        const place = this.outline.scenes.get(s.id)!
        return {
          key: `note:scene:${s.id}`,
          title: plain(s.title || 'Untitled scene'),
          detail: `Notes for the AI · ${place.label}`,
          snippet: snippet(s.notes.text, terms, 180).parts,
          prose: false,
          open: { kind: 'scene', sceneId: s.id, storyId: place.storyId, words: null, card: 'notes' }
        }
      })
    ]
    return { id: 'notes', label: GROUP_LABELS.notes, total, hits }
  }

  /**
   * Stories (title and premise) and chapters (title and goal): titles first, then in reading order.
   * `named`: one is found by its title (the group is listed before the scenes).
   */
  private storyGroup(terms: Term[], take: number): { group: SearchGroup; named: boolean } {
    type Doc = { story: StoryDoc } | { chapter: ChapterDoc }
    const found: Ranked<Doc>[] = []
    for (const [id, place] of this.outline.stories) {
      const st = this.stories.get(id)
      if (!st || !matchesAll([st.title.f, st.premise.f], terms)) continue
      found.push({ doc: { story: st }, rank: [matchesAll([st.title.f], terms) ? 0 : 1, place.order] })
    }
    for (const [id, place] of this.outline.chapters) {
      const c = this.chapters.get(id)
      if (!c || !matchesAll([c.title.f, c.goal.f], terms)) continue
      found.push({ doc: { chapter: c }, rank: [matchesAll([c.title.f], terms) ? 0 : 1, place.order] })
    }
    found.sort(byRank)
    const hits = found.slice(0, take).map(({ doc }): SearchHit => {
      if ('story' in doc) {
        const st = doc.story
        return {
          key: `story:${st.id}`,
          title: marked(st.title.text || 'Untitled story', terms),
          detail: 'Story',
          snippet: st.premise.text.trim() ? snippet(st.premise.text, terms, 160).parts : [],
          prose: false,
          open: { kind: 'story', storyId: st.id, sceneId: null }
        }
      }
      const c = doc.chapter
      return {
        key: `chapter:${c.id}`,
        title: marked(c.title.text || 'Untitled chapter', terms),
        detail: this.outline.chapters.get(c.id)!.label,
        snippet: c.goal.text.trim() ? labelled('Goal', snippet(c.goal.text, terms, 160).parts) : [],
        prose: false,
        open: this.chapterOpen(c.id)
      }
    })
    return { group: { id: 'stories', label: GROUP_LABELS.stories, total: found.length, hits }, named: found[0]?.rank[0] === 0 }
  }

  /** The world's style guide, and each story's own style for the AI. */
  private styleGroup(terms: Term[], take: number): SearchGroup {
    const hits: SearchHit[] = []
    const add = (fields: Field[], title: string, storyId: ID | null): void => {
      if (!fields.length || !matchesAll(fields.map((f) => f.f), terms)) return
      const best = [...fields].sort((a, b) => terms.filter((t) => hasTerm(b.f, t)).length - terms.filter((t) => hasTerm(a.f, t)).length)[0]
      hits.push({
        key: storyId ? `style:${storyId}` : 'style',
        title: plain(title),
        detail: best.label,
        snippet: snippet(best.text, terms, 160).parts,
        prose: false,
        open: { kind: 'style', storyId }
      })
    }
    add(this.style, 'Style guide', null)
    const stories = [...this.outline.stories].sort((a, b) => a[1].order - b[1].order)
    for (const [id] of stories) {
      const st = this.stories.get(id)
      if (st) add(st.style, `Style for ${st.title.text || 'Untitled story'}`, id)
    }
    return { id: 'style', label: GROUP_LABELS.style, total: hits.length, hits: hits.slice(0, take) }
  }

  /** Recent places as results with their current names and places; gone ones are left out. */
  places(list: SearchPlace[]): SearchHit[] {
    this.refresh()
    const out: SearchHit[] = []
    for (const p of Array.isArray(list) ? list : []) {
      if (p?.kind === 'scene') {
        const place = this.outline.scenes.get(p.id)
        const s = this.scenes.get(p.id)
        if (!place || !s) continue
        out.push({
          key: `scene:${s.id}`,
          title: plain(s.title || 'Untitled scene'),
          detail: place.label,
          snippet: [],
          prose: false,
          open: { kind: 'scene', sceneId: s.id, storyId: place.storyId, words: null, card: null }
        })
      } else if (p?.kind === 'entry') {
        const e = this.entries.get(p.id)
        if (!e) continue
        out.push({ ...this.entryHit(e, [], 0), snippet: [], detail: KIND_LABELS[e.kind].one })
      }
    }
    return out
  }
}

/**
 * The words to select where an entry's page opens: in a box Adam types in, the matched words with
 * enough around them to be the first place they appear there; in a section listing what the memory
 * has (shown in other words there), only the matched words, to find the change they belong to.
 */
function entryWords(f: Field | EntryField, s: Snippet): string | null {
  if (!s.words) return null
  return 'part' in f && f.part.kind !== 'field' ? s.words : wordsToReveal(f.text, s.at, s.words)
}

const indexes = new WeakMap<DB, SearchIndex>()

/** The search index of a world's database (made on first use, then kept up to date). */
export function searchIndex(db: DB): SearchIndex {
  let ix = indexes.get(db)
  if (!ix) {
    ix = new SearchIndex(db)
    indexes.set(db, ix)
  }
  return ix
}
