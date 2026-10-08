// The editor chat's story tools (chat Phase 3, lab switch STORYTOOLS; off, none of this is offered): looking at the
// story beyond one scene's words and proposing changes to it, each through the app's own features.
//   list_issues    the open consistency issues of a scene or the whole story, with their ids, quotes, severity and
//                  the check's suggested rewrite, advice or memory fix (replaces scene_issues)
//   chapter_card   a chapter's card and which of its scenes follow each part
//   list_threads   the story's plot threads as of the open scene, with the scenes whose cards set up or pay off each
// and three kinds of change (items of propose_changes, or their own propose_ tools without TOOLCHOICE):
//   issue_fix      Fix the text (the check's suggested rewrite) or Update the memory, and the issue marked fixed
//   chapter_card   a chapter card's parts by name, written into the scene cards that follow it
//   thread         a plot thread put on a scene card's "Sets up" or "Pays off" (a new thread made first if needed)
// The scene card change (kind card) may also set its point of view, characters present and location by name here.
// Every read keeps the story-point rule (agent.ts): this story only, as of the open scene, later scenes labelled,
// entries Adam keeps out never shown unless named exactly. Nothing here writes to the world. No Electron imports.

import type Database from 'better-sqlite3'
import type { CardProposal, PartChange, Proposal, ThreadLinkList } from '@shared/contracts/ask'
import type { Issue, IssueKind } from '@shared/contracts/checks'
import type { CarryField, ChapterCard, Entry, EntryKind, ID, Outline, SceneCard, ThreadState, ToolSpec } from '@shared/types'
import { adoptChapter, CARRY_FIELDS, CARRY_LABELS, CHAPTER_CARD_LIMITS, changedFields, chapterCardEmpty, cleanChapterCard, follows, isFieldEmpty } from '@shared/chapterCard'
import { cardLength } from '@shared/defaults'
import { FIELD_GROUPS, KIND_LABELS } from '@shared/fields'
import { counted, type ToolKind, type ToolStatus } from '@shared/toolActivity'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import { stillThere } from '../checks/quote'
import { matchEntry } from '../outline/names'
import type { NewProposal, SeenEntry, StoryView } from './agent'

type DB = Database.Database

/** The most of an issue list sent back at once. */
const ISSUE_CHARS = 3_000
/** The most of a chapter card or the plot threads sent back at once. */
const STORY_CHARS = 6_000

/** What the story tools need of the agent answering the call. */
export interface StoryCtx {
  db: DB
  storyId: ID | null
  sceneId: ID | null
  /** How a scene after the open one is labelled (agent.ts LATER). */
  later: string
  view(): StoryView
  outline(): Outline
  /** A scene of this story by "Ch 2, Sc 1" or its title (the open one when none is named). */
  scene(name: unknown): ID
  /** A chapter of this story by "Ch 2" or its title. */
  chapter(name: unknown): ID
  /** "Ch 2, Sc 1 “The Ford”". */
  sceneLabel(id: ID): string
  /** The label with its mark: the open scene, or later. */
  sceneHeading(id: ID): string
  proposals(): Proposal[]
  propose(p: NewProposal): string
  /** What the call was for and how it went (its row in the Ask panel). */
  mark(m: { summary?: string; outcome?: string; status?: ToolStatus; kind?: ToolKind }): void
  /** A line said with the result (what a name was taken to mean). */
  note(line: string): void
  /** A mistake the model can put right: thrown, said back to it. */
  fail(message: string): never
}

// ---------- The tools offered ----------

const str = { type: 'string' } as const
const optionalScene = {
  type: 'string',
  description: 'Which scene: "Ch 2, Sc 1", or its title. Leave it out for the scene the writer has open.'
} as const
const chapterParam = { type: 'string', description: 'Which chapter: "Ch 2", or its title. Leave it out for the open scene’s chapter.' } as const
const HOW = { type: 'string', enum: ['text', 'memory'] } as const
const ACTIONS = ['open', 'resolve', 'link'] as const
const LISTS: ThreadLinkList[] = ['setsUp', 'paysOff']

/** How the kinds of change are named in a read tool's description: as propose_changes' kinds, or their own tools. */
const changeName = (toolChoice: boolean, kind: string, tool: string): string => (toolChoice ? `a change of kind ${kind}` : tool)

/** The read tools (list_issues takes scene_issues' place). */
export function storyReadTools(toolChoice: boolean): ToolSpec[] {
  return [
    {
      name: 'list_issues',
      description: `List the open consistency issues the app's checks found: in a scene (scope scene, the default; the open scene when none is named) or in this whole story (scope story, story-wide plot thread issues included). Each comes with its id, how serious it is, the words it quotes, what disagrees, and the check's suggested rewrite, advice or memory fix. To fix one, propose ${changeName(toolChoice, 'issue_fix', 'propose_issue_fix')} with its id rather than an edit: it is then marked fixed.`,
      parameters: { type: 'object', properties: { scope: { type: 'string', enum: ['scene', 'story'] }, scene: optionalScene } }
    },
    {
      name: 'chapter_card',
      description: `Read a chapter's card: what its scenes share (point of view, characters present, location, when, mood, length, notes for the AI), and which of its scenes follow each part or have their own. To change it, propose ${changeName(toolChoice, 'chapter_card', 'propose_chapter_card')}.`,
      parameters: { type: 'object', properties: { chapter: chapterParam } }
    },
    {
      name: 'list_threads',
      description: `List this story's plot threads as of the open scene: open, resolved, or planned (only on scene cards so far), with what each promises the reader, where the story set it up and paid it off, and the scenes whose cards set it up or pay it off (scenes after the open one marked later). \`status\` keeps only those. To put a thread on a scene, or start a new one, propose ${changeName(toolChoice, 'thread', 'propose_thread')}.`,
      parameters: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'resolved', 'planned'] } } }
    }
  ]
}

const WHO_WHERE = {
  pov: { type: 'string', description: 'The point of view character, by name.' },
  characters: { type: 'array', items: str, description: 'Everyone present, by name: the whole list (it replaces the card’s).' },
  location: { type: 'string', description: 'The place, by name.' }
} as const

/** The kinds of change propose_changes takes here, and the separate tool each stands for. */
export const STORY_CHANGE_KINDS = {
  issue_fix: 'propose_issue_fix',
  chapter_card: 'propose_chapter_card',
  thread: 'propose_thread'
} as const

/** propose_changes' words for the story kinds, one line each. */
export const STORY_KIND_LINES = [
  "- issue_fix: `issue_id` (from list_issues) and `how`: text puts the check's suggested rewrite in for the quoted words (with none, the app rewrites the sentence when the writer applies it), memory sets the entry to what the text says (only where list_issues shows a memory fix). For an issue list_issues shows, use this rather than an edit: it marks the issue fixed.",
  '- chapter_card: `chapter` ("Ch 2" or its title) with any of `pov` (a character’s name), `characters` (everyone present, by name: the whole list), `location` (a place’s name), `when`, `mood`, `notes`: the scenes that follow the chapter card take them too. chapter_card reads it first.',
  '- thread: `thread` (a plot thread’s name, as list_threads shows it; a name no thread has starts a new one, with `note` saying what it promises the reader) and `action`: open (the scene sets it up), resolve (the scene pays it off), or link with `list` (setsUp or paysOff); `scene` is left out for the open one. It goes on the scene’s card.',
  '- card may also set `pov`, `characters` (the whole list) and `location`, by name.'
]

/** propose_changes' item properties for the story kinds. */
export const STORY_ITEM_PROPERTIES = {
  issue_id: str,
  how: HOW,
  ...WHO_WHERE,
  thread: str,
  action: { type: 'string', enum: [...ACTIONS] },
  list: { type: 'string', enum: LISTS },
  note: str
} as const

/** The separate propose_ tools for the story kinds (without TOOLCHOICE), and propose_scene_card with names. */
export function storyProposeTools(): ToolSpec[] {
  return [
    {
      name: 'propose_issue_fix',
      description:
        "Propose fixing a consistency issue list_issues showed, by its `issue_id`: `how` text puts the check's suggested rewrite in for the quoted words (with none, the app rewrites the sentence when the writer applies it); memory sets the entry to what the text says (only where list_issues shows a memory fix). Either way the issue is marked fixed. Use this rather than an edit for an issue. The writer decides.",
      parameters: { type: 'object', properties: { issue_id: str, how: HOW, why: str }, required: ['issue_id', 'how', 'why'] }
    },
    {
      name: 'propose_chapter_card',
      description:
        "Propose new values for parts of a chapter's card (only the parts given change): the point of view, characters present and location by name, when, mood, notes for the AI. The scenes that follow the chapter card take them too. Read it with chapter_card first. The writer decides.",
      parameters: {
        type: 'object',
        properties: { chapter: chapterParam, ...WHO_WHERE, when: str, mood: str, notes: str, why: str },
        required: ['chapter', 'why']
      }
    },
    {
      name: 'propose_thread',
      description:
        "Propose putting a plot thread on a scene's card: `action` open (the scene sets it up), resolve (the scene pays it off) or link with `list` (setsUp or paysOff). `thread` is its name as list_threads shows it; a name no thread has starts a new one, with `note` saying what it promises the reader. `scene` is left out for the open one. The writer decides.",
      parameters: {
        type: 'object',
        properties: { thread: str, action: { type: 'string', enum: [...ACTIONS] }, list: { type: 'string', enum: LISTS }, scene: optionalScene, note: str, why: str },
        required: ['thread', 'action', 'why']
      }
    }
  ]
}

/** propose_scene_card with the point of view, characters present and location by name (without TOOLCHOICE). */
export const SCENE_CARD_WITH_NAMES: ToolSpec = {
  name: 'propose_scene_card',
  description:
    "Propose new values for parts of a scene's card (only the parts given change): goal, conflict, outcome, mood, when, notes, beats, and the point of view, characters present and location by name. The writer decides.",
  parameters: {
    type: 'object',
    properties: {
      scene: optionalScene,
      goal: str,
      conflict: str,
      outcome: str,
      mood: str,
      when: str,
      notes: str,
      beats: { type: 'array', items: str, description: 'The whole list of beats, in order (it replaces the card’s).' },
      ...WHO_WHERE,
      why: str
    },
    required: ['why']
  }
}

// ---------- Answering ----------

const lower = (s: unknown): string => (typeof s === 'string' ? s.trim().toLocaleLowerCase() : '')
const squash = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}\n[… cut short: ${s.length - max} more characters]` : s)
const quoted = (s: string, max = 300): string => `“${s.length > max ? `${s.slice(0, max - 1)}…` : s}”`

/**
 * Answers a story tool's call when it is one (and propose_scene_card, which takes names here): its label and what it
 * found; null for any other tool. Throws through `ctx.fail` for a mistake the model can put right.
 */
export function storyAnswer(ctx: StoryCtx, name: string, a: Record<string, unknown>): [string, string] | null {
  switch (name) {
    case 'list_issues':
      return listIssues(ctx, a)
    case 'chapter_card':
      return readChapterCard(ctx, a)
    case 'list_threads':
      return listThreads(ctx, a)
    case 'propose_issue_fix':
      return proposeIssueFix(ctx, a)
    case 'propose_chapter_card':
      return proposeChapterCard(ctx, a)
    case 'propose_thread':
      return proposeThread(ctx, a)
    case 'propose_scene_card':
      return proposeSceneCard(ctx, a)
    default:
      return null
  }
}

// ---------- Issues ----------

const SEVERITY_WORDS: Record<Issue['severity'], string> = { 'must-fix': 'must fix', warning: 'worth a look', minor: 'minor' }
const ISSUE_KIND_WORDS: Partial<Record<IssueKind, string>> = {
  fact: 'facts',
  knowledge: 'who knows what',
  timeline: 'timeline and place',
  voice: 'voice',
  style: 'style and tone',
  continuity: 'continuity',
  thread: 'plot thread',
  story: 'the story'
}

/** An entry's field in plain words ("eye colour", "summary"). */
function fieldLabel(kind: string, field: string): string {
  if (field === 'summary' || field === 'description') return field
  for (const g of FIELD_GROUPS[kind as EntryKind] ?? []) for (const f of g.fields) if (f.key === field) return f.label.toLowerCase()
  return field
}

const fieldValue = (e: Entry, field: string): string =>
  field === 'summary' ? e.summary : field === 'description' ? e.description : (e.fields?.[field] ?? '')

/** Issue rows as issues, with entries' names and this story's scene labels as they are now (as the Issues tab reads them). */
function readIssues(ctx: StoryCtx, rows: Record<string, unknown>[]): Issue[] {
  const entries = cdb.entryNamesFor(ctx.db, rows)
  let titles: Map<ID, string> | null = null
  const inStory = new Set(ctx.storyId ? ctx.outline().scenes.map((s) => s.id) : [])
  const names: cdb.IssueNames = {
    entry: (id) => {
      const e = entries.get(id)
      if (!e) return null
      return { name: e.name, kind: e.kind, value: e.value, isAdams: (field) => cdb.fieldOriginOf(e.origin, e.fieldOrigins, field) === 'adam' }
    },
    sceneLabel: (id) => (inStory.has(id) ? ctx.sceneLabel(id) : null),
    storyTitle: (id) => (titles ??= cdb.storyTitles(ctx.db)).get(id) ?? null
  }
  return rows.map((r) => cdb.readIssue(r, names))
}

/** An issue names an entry Adam keeps out here (a 'hide' pin): it isn't shown. */
function keptOut(ctx: StoryCtx, i: Issue): boolean {
  const hidden = ctx.view().hidden
  if (!hidden.size) return false
  if (i.memoryFix && hidden.has(i.memoryFix.entryId)) return true
  return i.sources.some((s) => (s.kind === 'entry' || s.kind === 'thread') && hidden.has(s.entryId))
}

/** The open issues of a scene or the story, as list_issues shows them: still open, words still there, none kept out. */
function openIssues(ctx: StoryCtx, rows: Record<string, unknown>[]): Issue[] {
  const open = rows.filter((r) => r.status === 'open')
  const texts = cdb.sceneTexts(
    ctx.db,
    open.flatMap((r) => (r.scene_id ? [r.scene_id as ID] : []))
  )
  const sorted = cdb.sortIssues(open, (id) => texts.get(id) ?? '')
  return readIssues(ctx, sorted).filter((i) => !keptOut(ctx, i) && (!i.sceneId || stillThere(texts.get(i.sceneId) ?? '', i.quote)))
}

function issueLines(ctx: StoryCtx, i: Issue, whole: boolean): string {
  const where = whole ? ` · ${i.sceneId ? ctx.sceneHeading(i.sceneId) : 'the whole story'}` : ''
  const kind = ISSUE_KIND_WORDS[i.kind] ?? i.kind
  const lines = [`- id ${i.id} · ${SEVERITY_WORDS[i.severity]} · ${kind}${where}`, `  ${i.message.trim()}`]
  if (i.quote.trim()) lines.push(`  Words: ${quoted(i.quote.trim())}`)
  if (i.fix && i.fix.trim() !== i.quote.trim()) lines.push(`  Suggested rewrite: ${quoted(i.fix.trim())}`)
  if (i.advice) lines.push(`  Advice: ${i.advice.trim()}`)
  if (i.memoryFix) {
    const e = ctx.view().point.names.get(i.memoryFix.entryId) ?? 'the entry'
    const kind = i.sources.find((s) => s.kind === 'entry' && s.entryId === i.memoryFix!.entryId)
    const label = fieldLabel(entryKind(ctx, i.memoryFix.entryId) ?? (kind ? 'character' : ''), i.memoryFix.field)
    lines.push(`  Memory fix (how: memory): set ${e}’s ${label} to ${quoted(i.memoryFix.value)}`)
  }
  return lines.join('\n')
}

const entryKind = (ctx: StoryCtx, id: ID): string | null => {
  try {
    return repo.getEntry(ctx.db, id).kind
  } catch {
    return null
  }
}

function listIssues(ctx: StoryCtx, a: Record<string, unknown>): [string, string] {
  if (!ctx.storyId) ctx.fail('No story is open, so there are no issues to list.')
  const scope = lower(a.scope) === 'story' ? 'story' : 'scene'
  if (a.scope != null && !['story', 'scene'].includes(lower(a.scope))) ctx.fail('`scope` is scene or story.')
  let issues: Issue[]
  let head: string
  if (scope === 'story') {
    issues = openIssues(ctx, cdb.storyIssueRows(ctx.db, ctx.storyId!))
    head = `Open issues in ${ctx.outline().story.title}:`
    ctx.mark({ summary: 'the story' })
  } else {
    const id = ctx.scene(a.scene)
    issues = openIssues(ctx, cdb.sceneIssueRows(ctx.db, id))
    head = `Open issues in ${ctx.sceneHeading(id)}:`
    ctx.mark({ summary: ctx.sceneLabel(id) })
  }
  ctx.mark({ outcome: issues.length ? counted(issues.length, 'open issue') : 'none open' })
  if (!issues.length) return ['Listing open issues', scope === 'story' ? 'No open issues in this story.' : 'No open issues in this scene.']
  const tail = '\nTo fix one, propose an issue_fix with its id (how: text, or memory where it shows a memory fix).'
  return ['Listing open issues', clip(`${head}\n${issues.map((i) => issueLines(ctx, i, scope === 'story')).join('\n')}${tail}`, ISSUE_CHARS)]
}

/** An issue of this story by its id, or by a unique start of it (at least six characters). */
function findIssue(ctx: StoryCtx, raw: string): Issue {
  let row = cdb.issueRow(ctx.db, raw)
  if (!row && raw.length >= 6 && ctx.storyId) {
    const near = cdb.storyIssueRows(ctx.db, ctx.storyId).filter((r) => String(r.id).startsWith(raw))
    if (near.length === 1) row = near[0]
  }
  if (!row) ctx.fail(`There is no issue “${raw}”. Use list_issues and copy the id it shows.`)
  const [issue] = readIssues(ctx, [row!])
  const here = issue.sceneId ? ctx.outline().scenes.some((s) => s.id === issue.sceneId) : issue.storyId === ctx.storyId
  if (!here || keptOut(ctx, issue)) ctx.fail(`There is no issue “${raw}” in this story. Use list_issues and copy the id it shows.`)
  return issue
}

function proposeIssueFix(ctx: StoryCtx, a: Record<string, unknown>): [string, string] {
  if (!ctx.storyId) ctx.fail('No story is open.')
  const raw = squash(a.issue_id ?? a.issueId ?? a.id)
  if (!raw) ctx.fail('Give `issue_id`: the id list_issues shows.')
  const issue = findIssue(ctx, raw)
  if (issue.status !== 'open') {
    const why = issue.status === 'fixed' ? 'fixed already' : issue.status === 'ignored' ? 'ignored: the writer said it is meant' : 'gone: its words are no longer in the scene'
    ctx.fail(`That issue is ${why}, so there is nothing to fix.`)
  }
  if (issue.sceneId) {
    const text = repo.getScene(ctx.db, issue.sceneId).text
    if (!stillThere(text, issue.quote)) ctx.fail('That issue’s words are no longer in the scene, so there is nothing to fix.')
  }
  const howAsked = lower(a.how)
  if (howAsked && howAsked !== 'text' && howAsked !== 'memory') ctx.fail('`how` is text or memory.')
  const how: 'text' | 'memory' = howAsked === 'memory' ? 'memory' : 'text'
  const already = ctx.proposals().find((p) => p.kind === 'issueFix' && p.issueId === issue.id && p.status === 'pending')
  if (already) ctx.fail(`Change ${already.id} already fixes that issue.`)
  let memory: Extract<Proposal, { kind: 'issueFix' }>['memory']
  if (how === 'memory') {
    const fix = issue.memoryFix
    if (!fix) ctx.fail("That issue has no memory fix: the memory can't be set from the text here. Use how: text, or propose an edit or an entry change.")
    let e: Entry
    try {
      e = repo.getEntry(ctx.db, fix!.entryId)
    } catch {
      return ctx.fail('That issue’s entry is no longer in the world, so the memory can’t be set from it.')
    }
    memory = { entryId: e.id, name: e.name, field: fix!.field, fieldLabel: fieldLabel(e.kind, fix!.field), from: fieldValue(e, fix!.field), to: fix!.value }
  } else if (!issue.sceneId || !issue.quote.trim()) {
    ctx.fail('That issue quotes no words in a scene, so there is no text to fix. Propose an edit to the scene instead, or how: memory where it has a memory fix.')
  }
  const fix = issue.fix && squash(issue.fix) !== squash(issue.quote) ? issue.fix : null
  const label = issue.sceneId ? ctx.sceneLabel(issue.sceneId) : ''
  const why = squash(a.why) || issue.message
  const said = ctx.propose({
    kind: 'issueFix',
    issueId: issue.id,
    how,
    sceneId: issue.sceneId,
    sceneLabel: label,
    message: issue.message,
    severity: issue.severity,
    quote: issue.quote,
    fix,
    ...(issue.occurrence !== undefined ? { occurrence: issue.occurrence } : {}),
    ...(memory ? { memory } : {}),
    why
  })
  const extra =
    how === 'text' && !fix ? ' It has no suggested rewrite: when the writer applies it, the app rewrites the sentence as a change they accept or reject in the page.' : ''
  return [`Proposing ${how === 'memory' ? 'a memory fix' : 'a fix'} for an issue${label ? ` in ${label}` : ''}`, `${said}${extra}`]
}

// ---------- Names on a card ----------

/** An entry of this kind by name, among those the story sees here: exact (even one kept out here), else a near match. */
function named(ctx: StoryCtx, name: string, kind: EntryKind): SeenEntry | null {
  const v = ctx.view()
  const pool = [...v.entries.values()].filter((s) => !s.nameOnly && s.e.kind === kind)
  const want = lower(name)
  const exact = pool.find((s) => [s.e.name, ...(s.e.aliases ?? [])].some((n) => lower(n) === want))
  if (exact) return exact
  const shown = pool.filter((s) => !v.hidden.has(s.e.id))
  const m = matchEntry(name, shown.map((s) => s.e))
  if (!m) return null
  if (lower(m.name) !== want) ctx.note(`Using ${m.name} for “${name}”.`)
  return shown.find((s) => s.e.id === m.id) ?? null
}

const KIND_WORD: Partial<Record<EntryKind, string>> = { character: 'character', place: 'place' }

function needNamed(ctx: StoryCtx, name: string, kind: EntryKind): ID {
  const s = named(ctx, name, kind)
  if (!s) ctx.fail(`There is no ${KIND_WORD[kind] ?? KIND_LABELS[kind].one.toLowerCase()} called “${name}” in this story's memory. Search for it, or propose it as a new entry first.`)
  return s!.e.id
}

/** The point of view, characters present and location a call gives by name, as a card's ids (only those given). */
function whoWhere(ctx: StoryCtx, a: Record<string, unknown>): Pick<CardProposal, 'povId' | 'presentIds' | 'locationId'> {
  const out: Pick<CardProposal, 'povId' | 'presentIds' | 'locationId'> = {}
  if (typeof a.pov === 'string') out.povId = a.pov.trim() ? needNamed(ctx, squash(a.pov), 'character') : null
  if (Array.isArray(a.characters)) {
    const ids: ID[] = []
    for (const n of a.characters) {
      const name = squash(n)
      if (!name) continue
      const id = needNamed(ctx, name, 'character')
      if (!ids.includes(id)) ids.push(id)
    }
    // The point of view is among those present, as a chapter's plan fills it.
    if (out.povId && !ids.includes(out.povId)) ids.unshift(out.povId)
    out.presentIds = ids.slice(0, CHAPTER_CARD_LIMITS.present)
  } else if (typeof a.characters === 'string' && a.characters.trim()) {
    ctx.fail('Give `characters` as a list of names.')
  }
  if (typeof a.location === 'string') out.locationId = a.location.trim() ? needNamed(ctx, squash(a.location), 'place') : null
  return out
}

/** An entry's name as a card shows it ("(an entry kept out here)" for one Adam keeps out). */
function nameOf(ctx: StoryCtx, id: ID | null): string {
  if (!id) return ''
  const v = ctx.view()
  if (v.hidden.has(id)) return '(an entry kept out here)'
  return v.point.names.get(id) ?? '(an entry no longer in the world)'
}

/** A part of a card in words. */
function partWords(ctx: StoryCtx, card: Partial<ChapterCard>, f: CarryField): string {
  switch (f) {
    case 'pov':
      return nameOf(ctx, card.povId ?? null)
    case 'present':
      return (card.presentIds ?? []).map((id) => nameOf(ctx, id)).join(', ')
    case 'location':
      return nameOf(ctx, card.locationId ?? null)
    case 'length': {
      const n = cardLength({ targetWords: card.targetWords ?? 1500, lengthSet: card.lengthSet })
      return n == null ? 'Auto' : `${n.toLocaleString('en-GB')} words`
    }
    default:
      return (card[f] ?? '').trim()
  }
}

// ---------- Chapter cards ----------

/** The chapter meant, or the open scene's chapter when none is named. */
function chapterOf(ctx: StoryCtx, a: Record<string, unknown>): ID {
  if (squash(a.chapter)) return ctx.chapter(a.chapter)
  const open = ctx.sceneId ? ctx.outline().scenes.find((s) => s.id === ctx.sceneId) : undefined
  if (!open) ctx.fail('No scene is open. Name the chapter, as "Ch 2" or by its title.')
  return open!.chapterId
}

function chapterLabelOf(ctx: StoryCtx, id: ID): string {
  const o = ctx.outline()
  const i = o.chapters.findIndex((c) => c.id === id)
  const t = o.chapters[i]?.title.trim()
  return `Ch ${i + 1}${t ? ` “${t}”` : ''}`
}

function readChapterCard(ctx: StoryCtx, a: Record<string, unknown>): [string, string] {
  if (!ctx.storyId) ctx.fail('No story is open, so there are no chapters.')
  const id = chapterOf(ctx, a)
  const label = chapterLabelOf(ctx, id)
  const later = ctx.view().chapters.get(id) === 'later' ? ` (${ctx.later})` : ''
  const card = repo.getChapterCard(ctx.db, id)
  const parts = CARRY_FIELDS.map((f) => `${CARRY_LABELS[f]}: ${partWords(ctx, card, f) || '(empty)'}`)
  const scenes = ctx.outline().scenes.filter((s) => s.chapterId === id)
  const cards = repo.sceneCards(
    ctx.db,
    scenes.map((s) => s.id)
  )
  const sceneLines = scenes.map((s, i) => {
    const c = cards.get(s.id)
    const mark = s.id === ctx.sceneId ? ' (the open scene)' : ctx.sceneHeading(s.id).includes(ctx.later) ? ' (later)' : ''
    if (!c) return `- Sc ${i + 1} ${s.title.trim() || 'Untitled'}${mark}`
    const followsList = CARRY_FIELDS.filter((f) => follows(c, f)).map((f) => CARRY_LABELS[f].toLowerCase())
    const own = CARRY_FIELDS.filter((f) => !follows(c, f) && !isFieldEmpty(c, f)).map((f) => `${CARRY_LABELS[f].toLowerCase()}: ${partWords(ctx, c, f)}`)
    return `- Sc ${i + 1} ${s.title.trim() || 'Untitled'}${mark}: ${followsList.length ? `follows the chapter's ${followsList.join(', ')}` : 'follows none of it'}${own.length ? `; its own ${own.join('; ')}` : ''}`
  })
  const empty = chapterCardEmpty(card)
  ctx.mark({ summary: label, outcome: empty ? 'an empty card' : counted(CARRY_FIELDS.filter((f) => !isFieldEmpty(card, f)).length, 'part') })
  const body = [`Chapter card of ${label}${later}${empty ? ' (empty)' : ''}:`, ...parts, '', scenes.length ? 'Its scenes:' : 'It has no scenes yet.', ...sceneLines]
  return [`Reading the card of ${label}`, clip(body.join('\n'), STORY_CHARS)]
}

/** The chapter card's written parts a call gives (when, mood, notes), cut to the card's limits. */
function writtenParts(a: Record<string, unknown>): Partial<ChapterCard> {
  const out: Partial<ChapterCard> = {}
  if (typeof a.when === 'string') out.when = a.when.trim().slice(0, CHAPTER_CARD_LIMITS.when)
  if (typeof a.mood === 'string') out.mood = a.mood.trim().slice(0, CHAPTER_CARD_LIMITS.mood)
  if (typeof a.notes === 'string') out.notes = a.notes.trim().slice(0, CHAPTER_CARD_LIMITS.notes)
  return out
}

function proposeChapterCard(ctx: StoryCtx, a: Record<string, unknown>): [string, string] {
  if (!ctx.storyId) ctx.fail('No story is open.')
  const id = chapterOf(ctx, a)
  const label = chapterLabelOf(ctx, id)
  const before = repo.getChapterCard(ctx.db, id)
  const given: Partial<ChapterCard> = { ...whoWhere(ctx, a), ...writtenParts(a) }
  if (!Object.keys(given).length) ctx.fail('Give at least one part of the chapter card to change: pov, characters, location, when, mood or notes.')
  const after = cleanChapterCard({ ...before, ...given })
  const changed = changedFields(before, after)
  if (!changed.length) ctx.fail(`The card of ${label} already says that.`)
  const lines: PartChange[] = changed.map((f) => ({ label: CARRY_LABELS[f], from: partWords(ctx, before, f), to: partWords(ctx, after, f) }))
  const patch = Object.fromEntries(Object.entries(given).filter(([k]) => changed.some((f) => KEYS[f] === k))) as Partial<ChapterCard>
  // The scene cards that would take the new values (each part a scene follows, or an empty one with no mark).
  const scenes = ctx.outline().scenes.filter((s) => s.chapterId === id)
  const cards = repo.sceneCards(
    ctx.db,
    scenes.map((s) => s.id)
  )
  let n = 0
  for (const c of cards.values()) if (JSON.stringify(adoptChapter(c, after, 'follow')) !== JSON.stringify(c)) n++
  const said = ctx.propose({ kind: 'chapterCard', chapterId: id, chapterLabel: label, patch, lines, scenes: n, why: squash(a.why) })
  const reach = n ? ` Applied, it updates ${counted(n, 'scene')} that follow the chapter card.` : ' No scene card follows these parts yet, so only the chapter card changes.'
  return [`Proposing a change to the card of ${label}`, `${said}${reach}`]
}

/** Each part's key on a chapter card. */
const KEYS: Record<CarryField, keyof ChapterCard> = {
  pov: 'povId',
  present: 'presentIds',
  location: 'locationId',
  when: 'when',
  mood: 'mood',
  length: 'targetWords',
  notes: 'notes'
}

// ---------- The scene card, with names ----------

function proposeSceneCard(ctx: StoryCtx, a: Record<string, unknown>): [string, string] {
  const id = ctx.scene(a.scene)
  const patch: CardProposal = {}
  for (const k of ['goal', 'conflict', 'outcome', 'mood', 'when', 'notes'] as const) if (typeof a[k] === 'string') patch[k] = (a[k] as string).trim()
  if (Array.isArray(a.beats)) patch.beats = a.beats.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
  const who = whoWhere(ctx, a)
  const card: SceneCard = repo.getScene(ctx.db, id).card
  const names: PartChange[] = []
  for (const [f, key] of [['pov', 'povId'], ['present', 'presentIds'], ['location', 'locationId']] as const) {
    if (!(key in who)) continue
    const next = { ...card, ...who }
    if (changedFields(card, next).includes(f)) {
      Object.assign(patch, { [key]: who[key] })
      names.push({ label: CARRY_LABELS[f], from: partWords(ctx, card, f), to: partWords(ctx, next, f) })
    }
  }
  if (!Object.keys(patch).length) ctx.fail(names.length || Object.keys(who).length ? 'The card already says that.' : 'Give at least one part of the card to change.')
  const label = ctx.sceneLabel(id)
  return [`Proposing a change to the card of ${label}`, ctx.propose({ kind: 'card', sceneId: id, sceneLabel: label, patch, ...(names.length ? { names } : {}), why: squash(a.why) })]
}

// ---------- Plot threads ----------

type ThreadStatus = 'open' | 'resolved' | 'planned'

const statusOf = (t: ThreadState | null): ThreadStatus => (!t || t.planned ? 'planned' : t.status === 'resolved' ? 'resolved' : 'open')
const STATUS_WORDS: Record<ThreadStatus, string> = { open: 'open', resolved: 'paid off', planned: 'planned, not opened in the story yet' }

/** The plot threads the story sees here, with how each stands (null: it first exists later in this story). */
function threadsHere(ctx: StoryCtx): { s: SeenEntry; t: ThreadState | null }[] {
  const v = ctx.view()
  const out: { s: SeenEntry; t: ThreadState | null }[] = []
  for (const t of v.point.threads) {
    const s = v.entries.get(t.entryId)
    if (s && !s.nameOnly && !v.hidden.has(s.e.id)) out.push({ s, t })
  }
  for (const s of v.entries.values()) {
    if (s.e.kind !== 'thread' || s.nameOnly || v.hidden.has(s.e.id) || out.some((x) => x.s.e.id === s.e.id)) continue
    out.push({ s, t: null })
  }
  return out
}

/** The scenes on this story's line (and its later ones) whose cards set up or pay off each thread, in line order. */
function cardLinks(ctx: StoryCtx): Map<ID, { setsUp: string[]; paysOff: string[] }> {
  const v = ctx.view()
  const ids = [...v.scenes.keys()]
  const cards = repo.sceneCards(ctx.db, ids)
  const own = new Set(ctx.outline().scenes.map((s) => s.id))
  const out = new Map<ID, { setsUp: string[]; paysOff: string[] }>()
  for (const id of ids) {
    const c = cards.get(id)
    if (!c) continue
    const place = v.scenes.get(id)!
    const label = own.has(id) ? ctx.sceneLabel(id) : place.label
    const shown = `${label}${place.open ? ' (the open scene)' : place.later ? ' (later)' : ''}`
    for (const t of c.setsUpIds ?? []) {
      const x = out.get(t) ?? { setsUp: [], paysOff: [] }
      x.setsUp.push(shown)
      out.set(t, x)
    }
    for (const t of c.paysOffIds ?? []) {
      const x = out.get(t) ?? { setsUp: [], paysOff: [] }
      x.paysOff.push(shown)
      out.set(t, x)
    }
  }
  return out
}

function listThreads(ctx: StoryCtx, a: Record<string, unknown>): [string, string] {
  if (!ctx.storyId) ctx.fail('No story is open, so there are no plot threads to list.')
  const want = lower(a.status)
  if (want && !['open', 'resolved', 'planned'].includes(want)) ctx.fail('`status` is open, resolved or planned.')
  const v = ctx.view()
  const links = cardLinks(ctx)
  const all = threadsHere(ctx).filter((x) => !want || statusOf(x.t) === want)
  const word = want ? `${want} plot thread` : 'plot thread'
  ctx.mark({ outcome: all.length ? counted(all.length, word) : `no ${word}s` })
  const where = `As of ${v.point.label}${v.point.sceneId ? ' (the open scene)' : ', the end of the story so far'}.`
  if (!all.length) return ['Listing plot threads', `${where} No ${word}s.`]
  const lines = all.map(({ s, t }) => {
    const promise = (s.e.fields?.promise ?? '').trim() || s.e.summary.trim()
    const status = s.label ? s.label : STATUS_WORDS[statusOf(t)]
    const out = [`- ${s.e.name} (${status})${promise ? `: ${promise}` : ''}`]
    const story = [t?.setUp.trim() ? `set up in ${t.setUp.trim()}` : '', t?.status === 'resolved' && t.paidOff.trim() ? `paid off in ${t.paidOff.trim()}` : '']
      .filter(Boolean)
      .join('; ')
    if (story) out.push(`  In the story: ${story}`)
    const l = links.get(s.e.id)
    const cards = [l?.setsUp.length ? `set up in ${l.setsUp.join(', ')}` : '', l?.paysOff.length ? `pays off in ${l.paysOff.join(', ')}` : ''].filter(Boolean).join('; ')
    if (cards) out.push(`  Scene cards: ${cards}`)
    return out.join('\n')
  })
  const key = all.length ? '\nScenes marked (later) come after the open scene: the characters don’t know their events yet.' : ''
  return ['Listing plot threads', clip(`${where}\n${lines.join('\n')}${key}`, STORY_CHARS)]
}

const LIST_KEY: Record<ThreadLinkList, 'setsUpIds' | 'paysOffIds'> = { setsUp: 'setsUpIds', paysOff: 'paysOffIds' }

function listOf(v: unknown): ThreadLinkList | null {
  const k = lower(v).replace(/[\s_-]+/g, '')
  return k === 'setsup' || k === 'setup' ? 'setsUp' : k === 'paysoff' || k === 'payoff' ? 'paysOff' : null
}

function proposeThread(ctx: StoryCtx, a: Record<string, unknown>): [string, string] {
  if (!ctx.storyId) ctx.fail('No story is open.')
  const name = squash(a.thread ?? a.name).slice(0, 200)
  if (!name) ctx.fail('Give `thread`: the plot thread’s name, as list_threads shows it (a new name starts a new one).')
  const action = lower(a.action) as (typeof ACTIONS)[number]
  if (!ACTIONS.includes(action)) ctx.fail('`action` is open (the scene sets it up), resolve (it pays it off) or link (with `list`).')
  const list: ThreadLinkList = action === 'open' ? 'setsUp' : action === 'resolve' ? 'paysOff' : (listOf(a.list) ?? ctx.fail('With action link, give `list`: setsUp or paysOff.'))
  const sceneId = ctx.scene(a.scene)
  const label = ctx.sceneLabel(sceneId)
  const found = named(ctx, name, 'thread')
  if (!found) {
    const same = repo.listEntries(ctx.db).find((e) => lower(e.name) === lower(name) || (e.aliases ?? []).some((x) => lower(x) === lower(name)))
    if (same && same.kind !== 'thread') ctx.fail(`“${name}” is a ${KIND_LABELS[same.kind].one.toLowerCase()}, not a plot thread. Name the plot thread, or give a new name for a new one.`)
    if (same) ctx.fail(`There is a plot thread called “${name}”, but not in this story. Give a new name for a new one.`)
  }
  const verb = list === 'setsUp' ? 'sets up' : 'pays off'
  if (found) {
    const card = repo.sceneCards(ctx.db, [sceneId]).get(sceneId)
    if (card?.[LIST_KEY[list]]?.includes(found.e.id)) ctx.fail(`${label} already ${verb} ${found.e.name} on its card.`)
  }
  const threadName = found?.e.name ?? name
  const twice = ctx
    .proposals()
    .find((p) => p.kind === 'thread' && p.status === 'pending' && p.sceneId === sceneId && p.list === list && lower(p.name) === lower(threadName))
  if (twice) ctx.fail(`Change ${twice.id} already does that.`)
  const note = squash(a.note).slice(0, 1000)
  const said = ctx.propose({ kind: 'thread', threadId: found?.e.id ?? null, name: threadName, action, list, sceneId, sceneLabel: label, note, why: squash(a.why) })
  const extra = found ? '' : ` “${threadName}” is a new plot thread: it is made when the writer applies this.`
  return [`Proposing a plot thread link in ${label}`, `${said}${extra}`]
}
