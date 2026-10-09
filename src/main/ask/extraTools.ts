// The editor chat's last tools (chat Phase 4, lab switch EXTRATOOLS; off, none of this is offered): what is true at a
// point in a scene, the story so far, how a scene differs from an earlier version, and one kind of change.
//   scene_state      where things stand at a point in a scene (time, light, who is there, what each wears and holds),
//                    from the app's continuity tracking as Recall keeps it; no model is asked
//   story_so_far     the stored summaries in reading order, up to the open scene by default; no model is asked
//   compare_version  a scene against an earlier version History kept, as the paragraphs that changed
// and propose_changes' kind replace_all (or propose_replace_all without TOOLCHOICE): every place some words stand in
// this story (or one scene), through the app's own Find and replace, with a History snapshot and Undo.
// Every read keeps the story-point rule (agent.ts): this story only, as of the open scene, later scenes labelled,
// entries Adam keeps out never shown unless named exactly. Nothing here writes to the world. No Electron imports.

import type Database from 'better-sqlite3'
import type { Proposal } from '@shared/contracts/ask'
import type { SceneHistory, Snapshot } from '@shared/contracts/history'
import { stateText, type SceneState } from '@shared/continuity'
import { hasQuery } from '@shared/findReplace'
import type { ID, Outline, ToolSpec } from '@shared/types'
import { counted, type ToolKind, type ToolStatus } from '@shared/toolActivity'
import * as mem from '../db/memory'
import { keptStateBefore, storedState, storedStateAt } from '../continuity/tracker'
import { findInStory } from '../find/story'
import { numbered, paraRef, type Para } from './anchor'
import type { NewProposal, SceneWords, StoryView } from './agent'

type DB = Database.Database

/** The most any of these tools sends back at once. */
export const EXTRA_CHARS = 3_000
/** The most of either side of a changed paragraph compare_version shows. */
const SIDE_CHARS = 300
/** How many examples a replace_all card shows. */
const EXAMPLES = 3

/** History as the chat may read it (the open world's WorldHistory, passed in by ipc/ask.ts). */
export interface SnapshotSource {
  listSnapshots(sceneId: ID): SceneHistory
  getSnapshot(id: ID): Snapshot
}

/** What the Phase 4 tools need of the agent answering the call. */
export interface ExtraCtx {
  db: DB
  storyId: ID | null
  sceneId: ID | null
  /** How a scene after the open one is labelled (agent.ts LATER). */
  later: string
  view(): StoryView
  outline(): Outline
  /** A scene of this story by "Ch 2, Sc 1" or its title (the open one when none is named). */
  scene(name: unknown): ID
  /** A scene's words and paragraphs (agent.ts sceneWords); null when it is gone. */
  words(sceneId: ID): SceneWords | null
  /** "Ch 2, Sc 1 “The Ford”". */
  sceneLabel(id: ID): string
  /** The label with its mark: the open scene, or later. */
  sceneHeading(id: ID): string
  /** History, when this world has one open (null in a world with none, and in the tests that leave it out). */
  history: SnapshotSource | null
  proposals(): Proposal[]
  propose(p: NewProposal): string
  /** The runaway guard (agent.ts checkItemSize): throws when new words are over MAX_ITEM_WORDS. */
  checkSize(words: string, what: string): void
  /** What the call was for and how it went (its row in the Ask panel). */
  mark(m: { summary?: string; outcome?: string; status?: ToolStatus; kind?: ToolKind }): void
  /** A line said with the result. */
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

/** The read tools. */
export function extraReadTools(): ToolSpec[] {
  return [
    {
      name: 'scene_state',
      description:
        "What is true at a point in a scene, as the app's continuity tracking (Recall) keeps it: the time, weather and light, the things in the place, and for each character there where they are, their posture, what they hold and wear, their condition and mood. `at_paragraph`: just after that paragraph (its [n] from read_scene; 0 for as the scene starts); left out, the end of the scene. Only what is already worked out is shown (no model is asked): when nothing is, read the scene. Use it before writing or changing a moment that depends on who holds or wears what. A scene after the open one is marked later.",
      parameters: { type: 'object', properties: { scene: optionalScene, at_paragraph: { type: 'number', description: 'Just after this paragraph (its [n]); 0 for as the scene starts.' } } }
    },
    {
      name: 'story_so_far',
      description:
        "The story so far, from the app's stored summaries (no model is asked): what earlier stories this one follows on from left off with, then each scene's summary in reading order. Left out, `from_scene` is the start of this story and `to_scene` the open scene; scenes after the open one are marked later (the characters don't know their events yet). Use it for recaps, \"what has happened so far\", or to check an earlier event without reading every scene.",
      parameters: { type: 'object', properties: { from_scene: str, to_scene: str } }
    },
    {
      name: 'compare_version',
      description:
        "Compare a scene's words now with an earlier version History kept: `snapshot` 'latest' (the default: the newest kept version that differs from now) or an id from the list it shows. Comes back as the paragraphs that changed, each with its words before and now ([n] is the paragraph's number now), and the other versions kept. Use it for \"what did I change\", \"was it better before\".",
      parameters: { type: 'object', properties: { scene: optionalScene, snapshot: str } }
    }
  ]
}

/** The kinds of change propose_changes takes here, and the separate tool each stands for. */
export const EXTRA_CHANGE_KINDS = { replace_all: 'propose_replace_all' } as const

/** propose_changes' words for the kind, one line. */
export const EXTRA_KIND_LINES = [
  "- replace_all: every place some words stand in this story's scenes, as the app's Find and replace does it: `find` (the words) and `replace` (the new words; '' takes them out); whole words and exact case unless `whole_word` or `match_case` is false; `scope` scene (with `scene`, or the open one) for one scene only, else the whole story. For a name or a word changed all through (a misspelt name, a renamed place); for one place, use edit. The writer sees how many and a few examples before applying, and when the words are an entry's name may rename the entry too."
]

/** propose_changes' item properties for the kind. */
export const EXTRA_ITEM_PROPERTIES = {
  whole_word: { type: 'boolean' },
  match_case: { type: 'boolean' },
  scope: { type: 'string', enum: ['story', 'scene'] }
} as const

/** propose_replace_all, without TOOLCHOICE. */
export function extraProposeTools(): ToolSpec[] {
  return [
    {
      name: 'propose_replace_all',
      description:
        "Propose replacing every place some words stand in this story's scenes (or one scene, with `scope` scene), through the app's Find and replace: `find`, `replace` ('' takes them out); whole words and exact case unless `whole_word` or `match_case` is false. For a name or a word changed all through; for one place, use propose_edit. The writer sees how many and a few examples, and decides.",
      parameters: {
        type: 'object',
        properties: { find: str, replace: str, ...EXTRA_ITEM_PROPERTIES, scene: optionalScene, why: str },
        required: ['find', 'replace', 'why']
      }
    }
  ]
}

// ---------- Answering ----------

const lower = (s: unknown): string => (typeof s === 'string' ? s.trim().toLocaleLowerCase() : '')
const squash = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}\n[… cut short: ${s.length - max} more characters]` : s)
const short = (s: string, max = SIDE_CHARS): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
const flag = (v: unknown, fallback: boolean): boolean => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : fallback)

/** Answers a Phase 4 tool's call when it is one: its label and what it found; null for any other tool. */
export function extraAnswer(ctx: ExtraCtx, name: string, a: Record<string, unknown>): [string, string] | null {
  switch (name) {
    case 'scene_state':
      return sceneState(ctx, a)
    case 'story_so_far':
      return storySoFar(ctx, a)
    case 'compare_version':
      return compareVersion(ctx, a)
    case 'propose_replace_all':
      return proposeReplaceAll(ctx, a)
    default:
      return null
  }
}

/** True when a scene of this story comes after the open one. */
function isLater(ctx: ExtraCtx, id: ID): boolean {
  return ctx.sceneHeading(id).includes(ctx.later)
}

// ---------- scene_state ----------

/** The names of entries Adam keeps out here, lower case (their characters' lines are left out of a state). */
function keptOutNames(ctx: ExtraCtx): string[] {
  const v = ctx.view()
  const out: string[] = []
  for (const id of v.hidden) {
    const s = v.entries.get(id)
    if (s) out.push(...[s.e.name, ...(s.e.aliases ?? [])].map((n) => n.trim().toLocaleLowerCase()).filter(Boolean))
  }
  return out
}

/** A state with the characters Adam keeps out here taken out (by name, or a name they start with). */
function withoutKeptOut(state: SceneState, names: string[]): { state: SceneState; left: number } {
  if (!names.length) return { state, left: 0 }
  const keep = state.characters.filter((c) => {
    const n = c.name.trim().toLocaleLowerCase()
    return !names.some((x) => n === x || n.startsWith(`${x} `) || x.startsWith(`${n} `))
  })
  return { state: { ...state, characters: keep }, left: state.characters.length - keep.length }
}

function sceneState(ctx: ExtraCtx, a: Record<string, unknown>): [string, string] {
  if (!ctx.storyId) ctx.fail('No story is open, so there is no scene to look at.')
  const id = ctx.scene(a.scene)
  const label = ctx.sceneLabel(id)
  const s = ctx.words(id)
  if (!s) ctx.fail('That scene no longer exists.')
  const open = id === ctx.sceneId
  const asked = a.at_paragraph
  const later = isLater(ctx, id) ? ` (${ctx.later})` : open ? ' (the open scene)' : ''
  let state: SceneState | null = null
  let where: string
  let head: string
  if (asked == null || asked === '') {
    const end = storedState(ctx.db, id)
    // Only a state read from the words as they are now (no ghosts: tracker.ts).
    state = end?.current ? end.state : null
    where = `the end of ${label}`
    head = `Where things stand at the end of ${label}${later}:`
    ctx.mark({ summary: `the end of ${label}` })
  } else if (asked === 0 || asked === '0' || asked === '[0]') {
    state = keptStateBefore(ctx.db, id)
    where = `the start of ${label}`
    head = `Where things stand as ${label} starts${later}:`
    ctx.mark({ summary: `the start of ${label}` })
  } else {
    const count = numbered(s!.paras).length
    const p: Para | null = paraRef(s!.paras, asked)
    if (!p) ctx.fail(`There is no paragraph ${JSON.stringify(asked)}: the scene's paragraphs are [1] to [${count}]. Read the scene for the numbers.`)
    const at = storedStateAt(ctx.db, id, s!.plain.slice(0, p!.to))
    state = at?.current ? at.state : null
    where = `paragraph [${p!.n}] of ${label}`
    head = `Where things stand just after paragraph [${p!.n}] of ${label}${later}${at?.exact ? '' : ' (as worked out at the nearest point before it)'}:`
    ctx.mark({ summary: open ? `[${p!.n}]` : `[${p!.n}] of ${label}` })
  }
  if (!state) {
    ctx.mark({ outcome: 'nothing worked out yet' })
    return [
      'Checking what’s true',
      `Nothing is worked out for ${where}${later} yet (Recall in the scene panel works it out when the writer asks; this tool never asks a model). Read the scene with read_scene instead.`
    ]
  }
  const { state: shown, left } = withoutKeptOut(state, keptOutNames(ctx))
  const text = stateText(shown).trim()
  const people = shown.characters.length
  ctx.mark({ outcome: people ? counted(people, 'person', 'people') : text ? 'the scene only' : 'nothing said' })
  const key = left ? '\n(Someone the writer keeps out here is left out.)' : ''
  return ['Checking what’s true', clip(`${head}\n${text || '(Nothing said yet.)'}${key}`, EXTRA_CHARS)]
}

// ---------- story_so_far ----------

function storySoFar(ctx: ExtraCtx, a: Record<string, unknown>): [string, string] {
  if (!ctx.storyId) ctx.fail('No story is open, so there is no story so far.')
  const o = ctx.outline()
  const ids = o.scenes.map((s) => s.id)
  const openAt = ctx.sceneId ? ids.indexOf(ctx.sceneId) : -1
  const fromAsked = squash(a.from_scene)
  const toAsked = squash(a.to_scene)
  const from = fromAsked ? ids.indexOf(ctx.scene(fromAsked)) : 0
  const to = toAsked ? ids.indexOf(ctx.scene(toAsked)) : openAt >= 0 ? openAt : ids.length - 1
  if (from > to) ctx.fail('`from_scene` comes after `to_scene`: give the earlier scene first.')
  const out: string[] = []
  const v = ctx.view()
  // What the earlier stories on this story's line left off with (as drafting's briefing has them), from the start only.
  if (!fromAsked) {
    for (const st of v.point.storySoFar?.stories ?? []) {
      if (!st.text.trim()) continue
      out.push(`Before this story, ${st.title}${st.meanwhile ? ' (meanwhile)' : ''}${st.cut ? ' (up to where this story leaves it)' : ''}: ${short(st.text, 600)}`)
    }
  }
  let n = 0
  let missing = 0
  let stale = 0
  let chapter = ''
  for (let i = Math.max(0, from); i <= to && i < ids.length; i++) {
    const id = ids[i]
    const sc = o.scenes[i]
    const ch = o.chapters.findIndex((c) => c.id === sc.chapterId)
    if (sc.chapterId !== chapter) {
      chapter = sc.chapterId
      out.push('', `Ch ${ch + 1}${o.chapters[ch]?.title.trim() ? ` “${o.chapters[ch].title.trim()}”` : ''}`)
    }
    const sum = mem.getSummary(ctx.db, 'scene', id)
    const text = sum?.text.trim() ?? ''
    const mark = id === ctx.sceneId ? ' (the open scene)' : openAt >= 0 && i > openAt ? ` (${ctx.later})` : ''
    if (!text) missing++
    else {
      n++
      if (sum!.stale) stale++
    }
    out.push(`- ${ctx.sceneLabel(id)}${mark}: ${text ? short(text, 700) : '(no summary yet)'}${text && sum!.stale ? ' (may be out of date: the scene changed since)' : ''}`)
  }
  const range = fromAsked || toAsked ? `${ctx.sceneLabel(ids[Math.max(0, from)])} to ${ctx.sceneLabel(ids[to])}` : openAt >= 0 ? 'up to the open scene' : 'the whole story'
  ctx.mark({ summary: range, outcome: n ? counted(n, 'summary', 'summaries') : 'no summaries yet' })
  const tail = missing ? `\n${counted(missing, 'scene')} with no summary yet: read_scene reads one.` : ''
  const head = `The story so far in ${o.story.title}, ${range}, from the stored summaries${stale ? ` (${stale} may be out of date)` : ''}:`
  return ['Reading the story so far', clip(`${head}\n${out.join('\n').trim()}${tail}`, EXTRA_CHARS)]
}

// ---------- compare_version ----------

/** Paragraphs of a scene's plain text (as docText writes it: a blank line between them), scene breaks kept. */
const parasOf = (text: string): string[] => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** One changed stretch: paragraphs as they were, and as they are now (with the first one's [n] now). */
export interface ParaHunk {
  before: string[]
  after: string[]
  /** The number of the first paragraph now (scene breaks not counted), or of the one it comes after when none is left. */
  at: number
}

/** The paragraphs that changed between two versions of a scene, in order (longest common run of paragraphs kept). */
export function paragraphDiff(beforeText: string, afterText: string): ParaHunk[] {
  const a = parasOf(beforeText)
  const b = parasOf(afterText)
  const n = a.length
  const m = b.length
  // The common start and end first, so a long scene with one change stays quick.
  let s = 0
  while (s < n && s < m && norm(a[s]) === norm(b[s])) s++
  let e = 0
  while (e < n - s && e < m - s && norm(a[n - 1 - e]) === norm(b[m - 1 - e])) e++
  const A = a.slice(s, n - e).map(norm)
  const B = b.slice(s, m - e).map(norm)
  // Longest common run of the middle (small, or cut to a plain before/after when too big to compare).
  const keep: [number, number][] = []
  if (A.length * B.length <= 250_000) {
    const L = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0))
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    let i = 0
    let j = 0
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) {
        keep.push([i, j])
        i++
        j++
      } else if (L[i + 1][j] >= L[i][j + 1]) i++
      else j++
    }
  }
  const numberNow = (k: number): number => b.slice(0, k).filter((p) => p !== '* * *').length + 1
  const hunks: ParaHunk[] = []
  let pi = 0
  let pj = 0
  for (const [ki, kj] of [...keep, [A.length, B.length] as [number, number]]) {
    if (ki > pi || kj > pj) {
      hunks.push({ before: a.slice(s + pi, s + ki), after: b.slice(s + pj, s + kj), at: numberNow(s + pj) })
    }
    pi = ki + 1
    pj = kj + 1
  }
  return hunks
}

const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ')
}

function compareVersion(ctx: ExtraCtx, a: Record<string, unknown>): [string, string] {
  if (!ctx.storyId) ctx.fail('No story is open, so there is no scene to compare.')
  const id = ctx.scene(a.scene)
  const label = ctx.sceneLabel(id)
  ctx.mark({ summary: label })
  const h = ctx.history
  if (!h) ctx.fail('History isn’t open in this world, so there are no earlier versions to compare with.')
  const list = h!.listSnapshots(id)
  if (!list.available) ctx.fail(`History can’t be read just now${list.problem ? `: ${list.problem}` : ''}.`)
  if (!list.snapshots.length) {
    ctx.mark({ outcome: 'no earlier versions' })
    return ['Comparing with an earlier version', `History has kept no earlier versions of ${label} yet.`]
  }
  const asked = squash(a.snapshot)
  const same = new Set(list.sameAsNow)
  const info =
    !asked || lower(asked) === 'latest'
      ? (list.snapshots.find((x) => !same.has(x.id)) ?? null)
      : (list.snapshots.find((x) => x.id === asked) ?? list.snapshots.find((x) => asked.length >= 6 && x.id.startsWith(asked)) ?? null)
  if (asked && lower(asked) !== 'latest' && !info) ctx.fail(`${label} has no kept version “${asked}”. Leave \`snapshot\` out for the latest, or use an id from the list.`)
  const others = list.snapshots
    .slice(0, 6)
    .map((x) => `- id ${x.id} · ${x.label} · ${when(x.createdAt)} · ${counted(x.words, 'word')}${same.has(x.id) ? ' · the same as now' : ''}`)
  const later = isLater(ctx, id) ? ` (${ctx.later})` : ''
  if (!info) {
    ctx.mark({ outcome: 'the same as now' })
    return ['Comparing with an earlier version', `Every version History kept of ${label}${later} reads the same as the scene now.\nKept versions:\n${others.join('\n')}`]
  }
  const snap = h!.getSnapshot(info.id)
  if (snap.sceneId !== id) ctx.fail(`That version is of another scene. Use an id from ${label}’s list.`)
  const now = ctx.words(id)?.plain ?? ''
  const hunks = paragraphDiff(snap.text, now)
  const lines: string[] = []
  for (const k of hunks) {
    const span = k.after.length > 1 ? `[${k.at}]–[${k.at + k.after.filter((p) => p !== '* * *').length - 1}]` : `[${k.at}]`
    if (!k.after.length) lines.push(`- Taken out just before [${k.at}]:`, ...k.before.map((p) => `  was: ${short(p)}`))
    else if (!k.before.length) lines.push(`- Added at ${span}:`, ...k.after.map((p) => `  now: ${short(p)}`))
    else lines.push(`- Changed at ${span}:`, ...k.before.map((p) => `  was: ${short(p)}`), ...k.after.map((p) => `  now: ${short(p)}`))
  }
  const changed = hunks.reduce((sum, k) => sum + Math.max(k.before.length, k.after.length), 0)
  ctx.mark({ summary: `${label} with “${info.label}”`, outcome: changed ? counted(changed, 'changed paragraph') : 'the same words' })
  const head = `${label}${later} now, against “${info.label}” (id ${info.id}, ${when(info.createdAt)}, ${counted(info.words, 'word')}):`
  const body = changed ? lines.join('\n') : 'The words are the same (only formatting may differ).'
  return ['Comparing with an earlier version', clip(`${head}\n${body}\n\nKept versions (newest first):\n${others.join('\n')}`, EXTRA_CHARS)]
}

// ---------- replace_all ----------

function proposeReplaceAll(ctx: ExtraCtx, a: Record<string, unknown>): [string, string] {
  if (!ctx.storyId) ctx.fail('No story is open, so there is nothing to replace in.')
  const find = typeof a.find === 'string' ? a.find.trim() : ''
  if (!find || !hasQuery(find)) ctx.fail('Give `find`: the words to replace everywhere.')
  if (find.length > 200) ctx.fail('Keep `find` short: a word, a name or a phrase.')
  if (/\n/.test(find)) ctx.fail('`find` is words within one paragraph: no line breaks.')
  const replace = typeof a.replace === 'string' ? a.replace.trim() : ''
  if (/\n/.test(replace)) ctx.fail('`replace` is words within one paragraph: no line breaks. For new paragraphs, use an insert or a rewrite.')
  ctx.checkSize(replace, 'replacement')
  if (replace.length > 400) ctx.fail('Keep `replace` short: a word, a name or a phrase.')
  if (replace === find) ctx.fail('The new words are the same as the old.')
  const wholeWord = flag(a.whole_word ?? a.wholeWord, true)
  const matchCase = flag(a.match_case ?? a.matchCase, true)
  const scoped = lower(a.scope)
  if (scoped && scoped !== 'story' && scoped !== 'scene') ctx.fail('`scope` is story or scene.')
  const one = scoped === 'scene' || (!scoped && !!squash(a.scene))
  const sceneId = one ? ctx.scene(a.scene) : null
  const found = findInStory(ctx.db, { storyId: ctx.storyId!, query: find, matchCase, wholeWord, page: null })
  const scenes = found.scenes.filter((s) => !sceneId || s.sceneId === sceneId)
  const count = scenes.reduce((n, s) => n + s.matches.length, 0)
  const how = `${wholeWord ? 'whole words' : 'inside words too'}, ${matchCase ? 'exact case' : 'any case'}`
  const where = sceneId ? ctx.sceneLabel(sceneId) : 'this story'
  if (!count) ctx.fail(`“${find}” isn't in ${where} (${how}). Use find_mentions to see where words stand, or try whole_word or match_case false.`)
  const twice = ctx
    .proposals()
    .find((p) => p.kind === 'replaceAll' && p.status === 'pending' && lower(p.find) === lower(find) && (p.sceneId === null || sceneId === null || p.sceneId === sceneId))
  if (twice) ctx.fail(`Change ${twice.id} already replaces “${find}”. Revise that one by asking the writer, or leave it to them.`)
  const examples = scenes
    .flatMap((s) => s.matches.map((m) => ({ sceneLabel: ctx.sceneLabel(s.sceneId), before: m.before, text: m.text, after: m.after })))
    .slice(0, EXAMPLES)
  // The entry rename offered only for an entry this story sees (never one from another story's events alone).
  const v = ctx.view()
  const seen = found.rename ? v.entries.get(found.rename.entryId) : undefined
  const rename = found.rename && seen && !seen.nameOnly && replace ? found.rename : null
  const laterScenes = scenes.filter((s) => isLater(ctx, s.sceneId)).length
  const said = ctx.propose({
    kind: 'replaceAll',
    storyId: ctx.storyId!,
    find,
    replace,
    wholeWord,
    matchCase,
    sceneId,
    sceneLabel: sceneId ? ctx.sceneLabel(sceneId) : '',
    count,
    scenes: scenes.length,
    examples,
    rename,
    why: squash(a.why)
  })
  ctx.note(`It finds “${find}” ${counted(count, 'time')} in ${counted(scenes.length, 'scene')} (${how})${laterScenes ? `, ${laterScenes} of them after the open scene` : ''}.`)
  if (found.total > found.listed) ctx.note(`Only the first ${found.listed.toLocaleString('en-GB')} are replaced at once.`)
  if (rename) ctx.note(`“${find}” is the name of ${rename.name}: the writer can rename the entry too when applying.`)
  return [`Proposing a replace of “${short(find, 60)}” in ${sceneId ? ctx.sceneLabel(sceneId) : 'the story'}`, said]
}
