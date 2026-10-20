// The look-up tools (overhaul, "Plan before writing, done properly"): what an AI job may ask for about the story at one
// scene, answered on this computer with no AI call. The planner (plan/plan.ts) is offered them before it plans a scene,
// for one round. Each is a ToolSpec with a short description, answered in compact plain text (the short form unless
// `full` is asked for); a look-up that finds nothing says what to try next.
// - the story index's look-ups (storyIndex/lookup.ts): state_of, last_seen, who_knows, open_threads, what_happened,
//   who_was_there, timeline; and where_is (storyIndex/placed.ts: where a thing was left, or who has it);
// - get_entry: a codex entry as it stands at this scene (the memory's own view of it, what it knows, its ties);
// - find_in_story: earlier passages found by searching the story so far (retrieval/, passed in as `find`);
// - read_passage: the exact words of part of an earlier scene.
// Only what comes before the point in the story is ever told, never a later scene, and nothing Adam kept out of the
// scene's briefing (a 'hide' pin). No Electron imports.

import type Database from 'better-sqlite3'
import type { AgentStep, ChatMessage, EntryState, FactState, ID, RelationshipState, ToolCall, ToolSpec } from '@shared/types'
import { namedInProse } from '@shared/names'
import { loadShape } from '../../db/memory'
import * as sidx from '../../db/storyIndex'
import { storyOfScene } from '../../memory/line'
import { lastSeen, openThreads, presentAt, sceneGists, stateOf, timeline, whoKnows, withStageNow, type EntryNow } from '../../storyIndex/lookup'
import { clothesOf, pieceKey, sourceKey, type SceneState } from '@shared/continuity'
import { pieceText } from '@shared/stageItems'
import { stageFor } from '../mustStay'
import { whereIs } from '../../storyIndex/placed'
import { clip, entryText, firstLines, passageOf, wholeSentences } from './text'
import { draftStep } from '../steps'

type DB = Database.Database

const str = { type: 'string' } as const
const fullParam = { type: 'boolean', description: 'true for everything, not just the short form.' } as const
const sceneParam = { type: 'string', description: 'An earlier scene: "Ch 2, Sc 3", or its title.' } as const

/** The tools offered, by name. */
export const LOOKUP_TOOLS: ToolSpec[] = [
  {
    name: 'state_of',
    description: 'What is true of a character at this point: where they are, what they wear and carry, injuries, what they know, ties.',
    parameters: { type: 'object', properties: { name: str, full: fullParam }, required: ['name'] }
  },
  {
    name: 'last_seen',
    description: 'The last earlier scene someone was in, where, and what happened there.',
    parameters: { type: 'object', properties: { name: str }, required: ['name'] }
  },
  {
    name: 'where_is',
    description: 'Where a thing is now, or was last: where it was left and since when, or who has it.',
    parameters: { type: 'object', properties: { thing: { type: 'string', description: 'The thing: "the letter", "the brass key".' } }, required: ['thing'] }
  },
  {
    name: 'who_knows',
    description: 'Who knows a fact (or about a plot thread) at this point, and since when.',
    parameters: { type: 'object', properties: { fact: { type: 'string', description: 'A few words of the fact, or a plot thread’s name.' } }, required: ['fact'] }
  },
  {
    name: 'open_threads',
    description: 'The plot threads still open at this point, and how long each has been quiet.',
    parameters: { type: 'object', properties: { full: fullParam } }
  },
  {
    name: 'what_happened',
    description: 'What happens in earlier scenes, a line each (the last few before this one unless you say which).',
    parameters: { type: 'object', properties: { from: sceneParam, to: sceneParam, full: fullParam } }
  },
  {
    name: 'who_was_there',
    description: 'Who was in an earlier scene, who was only named, and where and when it was.',
    parameters: { type: 'object', properties: { scene: sceneParam }, required: ['scene'] }
  },
  {
    name: 'timeline',
    description: 'The story’s dates, scene by scene, up to this one.',
    parameters: { type: 'object', properties: { full: fullParam } }
  },
  {
    name: 'get_entry',
    description: 'A codex entry (character, place, item, lore...) as it stands at this scene: what it is, what has happened to it, what it knows.',
    parameters: { type: 'object', properties: { name: str, full: fullParam }, required: ['name'] }
  },
  {
    name: 'find_in_story',
    description: 'Search the story so far for words or what something is about; gives the best earlier passages, with where each is.',
    parameters: { type: 'object', properties: { query: str, full: fullParam }, required: ['query'] }
  },
  {
    name: 'read_passage',
    description: 'The exact words of part of an earlier scene: around some words in it, or its start or end.',
    parameters: {
      type: 'object',
      properties: {
        scene: sceneParam,
        around: { type: 'string', description: 'A few words from the scene to read around.' },
        part: { type: 'string', enum: ['start', 'end'], description: 'Without `around`: its start or its end (the end by default).' }
      },
      required: ['scene']
    }
  }
]

export const LOOKUP_NAMES: readonly string[] = LOOKUP_TOOLS.map((t) => t.name)

/** An earlier passage found by searching (find_in_story). */
export interface FoundPassage {
  /** Where it is, in plain words ("Ch 2, Sc 3"). */
  where: string
  text: string
}

/** What the look-ups are answered from: the scene being written and what is known there. */
export interface LookupContext {
  db: DB
  /** The scene being written, and its story. */
  sceneId: ID
  storyId: ID
  /**
   * As the scene begins (a whole scene about to be written), or as its words so far end (carrying on: Add below, a later
   * beat). Earlier scenes are always as they ended.
   */
  asItBegins: boolean
  /** Every entry that exists at this scene, as the memory has it here. */
  entries: readonly EntryState[]
  facts?: readonly FactState[]
  relationships?: readonly RelationshipState[]
  /** The people in the scene, by name, for what to try next. */
  people: readonly string[]
  /** What Adam kept out of the scene's briefing: never looked up, never named. */
  hidden: ReadonlySet<ID>
  /** Searches the story so far (retrieval); left out: find_in_story isn't available. */
  find?: (query: string, most: number) => Promise<FoundPassage[] | null>
  /**
   * Fills in a scene's physical details (what people wear, carry and suffer: storyIndex/fill.ts fillSceneForLookup) when
   * that can be done quickly, for state_of; true once they are in the index. Never waits long. Left out: not tried.
   */
  fill?: (sceneId: ID) => Promise<boolean>
  /**
   * Where things stand at the point of writing, as the writer is told it, when it is read from the scene's words so far
   * (carrying on): what it says of someone is newer than the story index, and state_of answers with it (2026-10-19: the
   * planner was told "not recorded yet" of clothes and injuries the scene had just set up). Left out: the index alone.
   */
  stand?: SceneState | null
}

/** One look-up's answer. */
export interface LookupAnswer {
  tool: string
  /** In plain words, for "What the AI saw" ("Looking up Mara Venn"). */
  label: string
  /** What the model is told. */
  text: string
  /** It found something. */
  ok: boolean
  /** Lines worth giving the writer too (facts as they stand, what happened). */
  facts: string[]
  /** Passages worth giving the writer too (exact words). */
  passages: FoundPassage[]
  /** The entry it read (get_entry), for the briefing. */
  entryId?: ID
}

/** The longest answer, in characters (the model is told the rest was left out). */
export const ANSWER_MOST = 2_400
/** How many words a passage gives: short, and with `full`. */
export const PASSAGE_WORDS = { short: 180, full: 350 }
/** The most look-ups answered in one round. */
export const LOOKUPS_MOST = 8

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')

class Miss extends Error {}

/** The arguments of a call, read; a plain-words Miss when they can't be. */
function argsOf(call: ToolCall): Record<string, unknown> {
  if (!clean(call.arguments)) return {}
  try {
    const v = JSON.parse(call.arguments) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    // below
  }
  throw new Miss(`The arguments for ${call.name} weren't a JSON object. Call it again with them as one, such as {"name": "…"}.`)
}

/** The scenes of the story before the point, in order, with their "Ch N, Sc M" and title. */
function scenesBefore(ctx: LookupContext): { id: ID; label: string; title: string }[] {
  const story = storyOfScene(loadShape(ctx.db), ctx.sceneId)
  if (!story) return []
  const all = story.chapters.flatMap((c, ci) => c.scenes.map((s, si) => ({ id: s.id, label: `Ch ${ci + 1}, Sc ${si + 1}`, title: clean(s.title) })))
  const at = all.findIndex((s) => s.id === ctx.sceneId)
  return at < 0 ? [] : all.slice(0, at)
}

/** "Ch 2, Sc 3" however it is written ("chapter 2 scene 3", "Ch2 Sc3", "2.3"), or null. */
export function sceneLabel(text: string): string | null {
  const t = clean(text).toLowerCase()
  const m = /\bch(?:apter|\.)?\s*(\d+)\D{0,8}?\bsc(?:ene|\.)?\s*(\d+)\b/.exec(t) ?? /^(\d+)\s*[.,:/-]\s*(\d+)$/.exec(t)
  return m ? `Ch ${Number(m[1])}, Sc ${Number(m[2])}` : null
}

/** An earlier scene named by `text`; a Miss saying what to try when there is none. */
function earlierScene(ctx: LookupContext, text: unknown): { id: ID; label: string; title: string } {
  const before = scenesBefore(ctx)
  const asked = clean(text)
  const span = before.length ? `Scenes before this one run from ${before[0].label} to ${before[before.length - 1].label}` : 'This is the first scene'
  if (!asked) throw new Miss(`Say which scene, as "Ch 2, Sc 1". ${span}.`)
  if (!before.length) throw new Miss('This is the story’s first scene: there are no earlier scenes to look at. Try find_in_story for earlier stories.')
  if (/^(?:the )?(?:previous|last|scene before)(?: scene)?$/i.test(asked)) return before[before.length - 1]
  const label = sceneLabel(asked)
  const lower = asked.toLowerCase().replace(/^["“]|["”]$/g, '')
  const found =
    (label ? before.find((s) => s.label === label) : undefined) ??
    before.find((s) => s.title.toLowerCase() === lower) ??
    (lower.length >= 4 ? before.find((s) => s.title.toLowerCase().includes(lower)) : undefined)
  if (found) return found
  if (label) throw new Miss(`There's no ${label} before this scene (only earlier scenes can be read). ${span}.`)
  throw new Miss(`No earlier scene is called “${asked}”. ${span}; name one as "Ch 2, Sc 1".`)
}

/** The entry `name` names here (its name or other name, a first name no one else has), never one kept out. */
function entryNamed(ctx: LookupContext, name: unknown, kind?: EntryState['kind']): EntryState {
  const asked = clean(name)
  const tryNext = ctx.people.length
    ? ` People in this scene: ${ctx.people.join(', ')}. Use a name as the briefing gives it, or find_in_story to search the words.`
    : ' Use a name as the briefing gives it, or find_in_story to search the words.'
  if (!asked) throw new Miss(`Say whose${kind === 'character' ? '' : ' or what'}: a name.${tryNext}`)
  const lower = asked.toLowerCase().replace(/^the\s+/, '')
  const pool = ctx.entries.filter((e) => !kind || e.kind === kind)
  const names = (e: EntryState): string[] => [e.name, ...(e.aliases ?? [])].map((n) => clean(n).toLowerCase().replace(/^the\s+/, ''))
  const exact = pool.filter((e) => names(e).includes(lower))
  const first = exact.length ? exact : pool.filter((e) => e.kind === 'character' && names(e).some((n) => n.split(' ')[0] === lower))
  const e = first.length === 1 ? first[0] : exact[0]
  if (!e) throw new Miss(`No one${kind === 'character' ? '' : ' or nothing'} called “${asked}” is known at this point.${tryNext}`)
  if (ctx.hidden.has(e.id)) throw new Miss(`Nothing can be looked up about “${asked}” for this scene.`)
  return e
}

/** Lines that name nothing Adam kept out. */
function withoutHidden(ctx: LookupContext, lines: string[]): string[] {
  const hidden = ctx.entries.filter((e) => ctx.hidden.has(e.id)).flatMap((e) => [e.name, ...(e.aliases ?? [])].map(clean).filter((n) => n.length >= 2))
  return hidden.length ? lines.filter((l) => !hidden.some((n) => namedInProse(l, n))) : lines
}

/** Where the scene being written is in the story index, or a Miss saying the index can't answer yet. */
function indexed(ctx: LookupContext): void {
  if (!sidx.indexScene(ctx.db, ctx.sceneId)) {
    throw new Miss('The story index has nothing for this scene yet. Try get_entry, find_in_story or read_passage instead.')
  }
}

const said = (tool: string, label: string, text: string, more: Partial<LookupAnswer> = {}): LookupAnswer => ({
  tool,
  label,
  text: text.length > ANSWER_MOST ? `${text.slice(0, ANSWER_MOST)}\n[… the rest left out to save room]` : text,
  ok: true,
  facts: [],
  passages: [],
  ...more
})

const at = (ctx: LookupContext): { asItBegins: boolean } => ({ asItBegins: ctx.asItBegins })

/** The most ties and facts known state_of gives in its short form. */
export const STATE_MOST = 5
/** The longest gist what_happened gives a scene in its short form, in characters (whole sentences). */
export const GIST_MOST = 300

/**
 * The scene whose words what people wear, carry and suffer here comes from: this one carrying on (its words so far), or
 * the last earlier scene with words. Null when there is none.
 */
function detailsFrom(ctx: LookupContext): ID | null {
  if (!ctx.asItBegins) return ctx.sceneId
  const before = scenesBefore(ctx)
  for (let i = before.length - 1; i >= 0; i--) {
    if (clean(sidx.sceneWords(ctx.db, [before[i].id]).get(before[i].id)?.text)) return before[i].id
  }
  return null
}

/**
 * Someone as things stand at the point of writing: where things stand there (ctx.stand, read from the scene's words so
 * far) put over the story index, field by field (storyIndex/lookup.ts withStageNow). As the index has them otherwise.
 */
function asNow(ctx: LookupContext, e: EntryState, now: EntryNow): EntryNow {
  const c = stageFor(e, ctx.stand)
  if (!c) return now
  const said = ctx.stand?.said ?? {}
  const quote = (key: string): string => said[key]?.quote ?? ''
  const label = sidx.indexScene(ctx.db, ctx.sceneId)?.label
  const pieces = clothesOf(c)
  return withStageNow(
    now,
    {
      where: c.where ?? '',
      posture: c.posture ?? '',
      holding: c.holding ?? '',
      condition: c.condition ?? '',
      wearing: pieces.map((p) => ({ piece: p.name, text: pieceText(p) })),
      quotes: Object.fromEntries([
        ...(['where', 'posture', 'holding', 'condition'] as const).map((f) => [f, quote(sourceKey(c.name, f))]),
        ...pieces.map((p) => [p.name, quote(pieceKey(c.name, p.name))])
      ])
    },
    label ? `${label}, in its words so far` : 'the scene so far'
  )
}

/** Answers one look-up. Never throws: a look-up that can't be answered says why, and what to try next. */
export async function runLookup(call: ToolCall, ctx: LookupContext): Promise<LookupAnswer> {
  try {
    return await answer(call, ctx)
  } catch (e) {
    const text =
      e instanceof Miss ? e.message : `That look-up didn't work (${e instanceof Error ? e.message : String(e)}). Try another, or plan without it.`
    return { tool: call.name, label: `Looking up with ${call.name}`, text, ok: false, facts: [], passages: [] }
  }
}

async function answer(call: ToolCall, ctx: LookupContext): Promise<LookupAnswer> {
  const a = argsOf(call)
  const full = a.full === true
  switch (call.name) {
    case 'state_of': {
      const e = entryNamed(ctx, a.name)
      indexed(ctx)
      let now = stateOf(ctx.db, ctx.storyId, e.id, ctx.sceneId, at(ctx))
      // Nothing of what they wear, carry or suffer: the scene it would come from filled in first, when that is quick.
      if (now && !now.wearing.length && !now.carrying && !now.condition && ctx.fill) {
        const from = detailsFrom(ctx)
        if (from && (await ctx.fill(from).catch(() => false))) now = stateOf(ctx.db, ctx.storyId, e.id, ctx.sceneId, at(ctx)) ?? now
      }
      if (now) now = asNow(ctx, e, now)
      const all = withoutHidden(ctx, now?.lines ?? [])
      const knows = all.filter((l) => l.startsWith(`${e.name} knows:`))
      const ties = all.filter((l) => l.startsWith(`${e.name} and `))
      const rest = all.filter((l) => !knows.includes(l) && !ties.includes(l))
      const most = full ? Infinity : STATE_MOST
      const lines = full ? all : [...rest, ...firstLines(ties, most), ...firstLines(knows, most)]
      if (!lines.length) {
        return said(call.name, `Looking up ${e.name}`, `Nothing is recorded yet of where ${e.name} is, what they wear or carry, how they are, what they know or their ties at this point. Try last_seen or get_entry.`, {
          ok: false
        })
      }
      // Everything the index has, and what it has nothing on yet, kind by kind (2026-10-19: only the place came back).
      const missing = [
        !now?.place ? 'where they are' : '',
        !now?.wearing.length ? 'what they wear' : '',
        !now?.carrying ? 'what they carry' : '',
        !now?.condition ? 'how they are (injuries and the like)' : '',
        !knows.length ? 'what they know' : '',
        !ties.length ? 'their ties to others' : ''
      ].filter(Boolean)
      const note = missing.length ? [`Not recorded yet for ${e.name}: ${missing.join(', ')}.`] : []
      const facts = rest.concat(full ? [...ties, ...knows] : [...ties.slice(0, STATE_MOST), ...knows.slice(0, STATE_MOST)]).map((l) => clip(l, 240))
      return said(call.name, `Looking up ${e.name}`, [...lines.map((l) => clip(l, 240)), ...note].join('\n'), { facts })
    }
    case 'last_seen': {
      const e = entryNamed(ctx, a.name)
      indexed(ctx)
      const seen = lastSeen(ctx.db, ctx.storyId, e.id, ctx.sceneId)
      if (!seen) return said(call.name, `Where ${e.name} was last`, `${e.name} isn't in any scene of this story before this one. Try get_entry.`, { ok: false })
      const line = seen.gist ? seen.line.replace(seen.gist, wholeSentences(seen.gist, 300)) : seen.line
      return said(call.name, `Where ${e.name} was last`, line, { facts: withoutHidden(ctx, [line]) })
    }
    case 'where_is': {
      const thing = clean(a.thing ?? a.name)
      if (!thing) throw new Miss('Say what thing: a few words, such as "the letter".')
      indexed(ctx)
      const lines = withoutHidden(ctx, whereIs(ctx.db, ctx.storyId, thing, ctx.sceneId, at(ctx)).lines).map((l) => clip(l, 300))
      const label = `Where “${clip(thing, 60)}” is`
      if (!lines.length) {
        return said(call.name, label, `Nothing in the story so far says where “${clip(thing, 80)}” is. Try find_in_story, or state_of for whoever had it last.`, {
          ok: false
        })
      }
      return said(call.name, label, lines.join('\n'), { facts: lines })
    }
    case 'who_knows': {
      const fact = clean(a.fact)
      if (!fact) throw new Miss('Say what fact: a few of its words, or a plot thread’s name.')
      indexed(ctx)
      const lines = withoutHidden(ctx, whoKnows(ctx.db, ctx.storyId, fact, ctx.sceneId, at(ctx)).lines).map((l) => clip(l, 300))
      if (!lines.length) {
        return said(call.name, `Who knows “${clip(fact, 60)}”`, `No one is known to know that at this point. Try fewer words (the thing it is about), or open_threads.`, { ok: false })
      }
      return said(call.name, `Who knows “${clip(fact, 60)}”`, firstLines(lines, full ? 20 : 6).join('\n'), { facts: lines.slice(0, 6) })
    }
    case 'open_threads': {
      indexed(ctx)
      const lines = withoutHidden(ctx, openThreads(ctx.db, ctx.storyId, ctx.sceneId, at(ctx)).lines).map((l) => clip(l, 240))
      if (!lines.length) return said(call.name, 'The open plot threads', 'No plot threads are open at this point.')
      return said(call.name, 'The open plot threads', firstLines(lines, full ? 30 : 8).join('\n'), { facts: lines.slice(0, 8) })
    }
    case 'what_happened': {
      indexed(ctx)
      const before = scenesBefore(ctx)
      if (!before.length) return said(call.name, 'What happened before', 'This is the story’s first scene: nothing has happened in it before.', { ok: false })
      const from = clean(a.from) ? earlierScene(ctx, a.from) : before[Math.max(0, before.length - (full ? 30 : 6))]
      const to = clean(a.to) ? earlierScene(ctx, a.to) : before[before.length - 1]
      // Each scene's gist from its summary in whole sentences (2026-10-19: never its first sentence cut part-way), and
      // "no summary yet" for a scene the memory hasn't summed up.
      const scenes = sceneGists(ctx.db, ctx.storyId, from.id, to.id).scenes
      const told = scenes.map((s) => ({ ...s, line: `${s.label}: ${s.gist ? wholeSentences(s.gist, full ? 600 : GIST_MOST) : 'no summary yet'}` }))
      const kept = new Set(withoutHidden(ctx, told.map((s) => s.line)))
      const shown = told.filter((s) => kept.has(s.line))
      const label = `What happened, ${from.label} to ${to.label}`
      if (!shown.some((s) => s.gist)) return said(call.name, label, `Nothing is kept yet of what happens from ${from.label} to ${to.label}. Try read_passage.`, { ok: false })
      const lines = shown.map((s) => s.line)
      return said(call.name, label, firstLines(lines, full ? 40 : 12).join('\n'), { facts: shown.filter((s) => s.gist).map((s) => s.line).slice(-8) })
    }
    case 'who_was_there': {
      const s = earlierScene(ctx, a.scene)
      const there = presentAt(ctx.db, s.id)
      if (!there) return said(call.name, `Who was in ${s.label}`, `The story index has nothing for ${s.label} yet. Try read_passage.`, { ok: false })
      const lines = withoutHidden(ctx, there.lines)
      return said(call.name, `Who was in ${s.label}`, lines.join('\n'), { facts: lines })
    }
    case 'timeline': {
      const before = scenesBefore(ctx)
      const lines = timeline(ctx.db, ctx.storyId, ctx.sceneId).lines.map((l) => clip(l, 200))
      if (!lines.length) return said(call.name, 'The story’s dates', 'No dates are known for the scenes so far.', { ok: false })
      const most = full ? 40 : 8
      const shown = lines.length > most ? [`(${lines.length - most} earlier scenes left out)`, ...lines.slice(-most)] : lines
      return said(call.name, 'The story’s dates', shown.join('\n'), { facts: before.length ? lines.slice(-4) : lines })
    }
    case 'get_entry': {
      const e = entryNamed(ctx, a.name)
      const names = new Map(ctx.entries.filter((x) => !ctx.hidden.has(x.id)).map((x) => [x.id, x.name]))
      const text = entryText(e, { facts: ctx.facts ?? [], relationships: ctx.relationships ?? [], names }, full)
      return said(call.name, `Reading ${e.name}`, text, { entryId: e.id })
    }
    case 'find_in_story': {
      const query = clean(a.query)
      if (!query) throw new Miss('Say what to search for: a few words, or what it is about.')
      if (!ctx.find) return said(call.name, `Searching for “${clip(query, 60)}”`, 'Searching isn’t available just now. Try read_passage or what_happened.', { ok: false })
      const found = ((await ctx.find(query, full ? 6 : 3)) ?? []).filter((p) => clean(p.text))
      const shown = withoutHiddenPassages(ctx, found).slice(0, full ? 6 : 3)
      if (!shown.length) {
        return said(call.name, `Searching for “${clip(query, 60)}”`, `Nothing earlier in the story matches “${clip(query, 80)}”. Try other words, or what_happened.`, { ok: false })
      }
      const most = full ? PASSAGE_WORDS.full : PASSAGE_WORDS.short
      const passages = shown.map((p) => ({ where: p.where, text: wordsUpTo(p.text, most) }))
      return said(call.name, `Searching for “${clip(query, 60)}”`, passages.map((p) => `### ${p.where}\n${p.text}`).join('\n\n'), { passages })
    }
    case 'read_passage': {
      const s = earlierScene(ctx, a.scene)
      const text = sidx.sceneWords(ctx.db, [s.id]).get(s.id)?.text ?? ''
      if (!clean(text)) return said(call.name, `Reading ${s.label}`, `${s.label} has no words yet.`, { ok: false })
      const part = a.part === 'start' ? 'start' : 'end'
      const near = clean(a.around)
      const words = PASSAGE_WORDS.full
      const passage = passageOf(text, { near, part, most: words })
      if (passage === null) {
        return said(call.name, `Reading ${s.label}`, `Those words aren't in ${s.label}. Try fewer of them, or "part": "start" or "end".`, { ok: false })
      }
      const where = near ? `${s.label}, around “${clip(near, 60)}”` : `${s.label}, its ${part}`
      return said(call.name, `Reading ${where}`, `### ${where}\n${passage}`, { passages: [{ where, text: passage }] })
    }
    default:
      throw new Miss(`There is no look-up called “${call.name}”. The look-ups are: ${LOOKUP_NAMES.join(', ')}.`)
  }
}

/** Passages that name nothing Adam kept out. */
function withoutHiddenPassages(ctx: LookupContext, list: FoundPassage[]): FoundPassage[] {
  const keep = new Set(withoutHidden(ctx, list.map((p) => p.text)))
  return list.filter((p) => keep.has(p.text))
}

/** The first `most` words of a passage (with an ellipsis when cut). */
function wordsUpTo(text: string, most: number): string {
  const w = text.trim().split(/\s+/)
  return w.length <= most ? text.trim() : `${w.slice(0, most).join(' ')} …`
}

/**
 * Answers a round of look-ups, in order, as the agent loop (ai/tasks.ts) takes them: a tool message for each call, a step
 * for "What the AI saw", and the answers themselves. Calls past LOOKUPS_MOST are told they weren't looked up.
 */
export async function answerLookups(
  calls: readonly ToolCall[],
  ctx: LookupContext
): Promise<{ results: ChatMessage[]; steps: AgentStep[]; answers: LookupAnswer[] }> {
  const answers: LookupAnswer[] = []
  // The calm overhaul: the window says "Looking up 3 things…" while they are answered, then planning again (ai/steps.ts).
  draftStep(ctx.sceneId, 'lookups', Math.min(calls.length, LOOKUPS_MOST))
  try {
    for (const [i, c] of calls.entries()) {
      answers.push(
        i < LOOKUPS_MOST
          ? await runLookup(c, ctx)
          : { tool: c.name, label: 'Not looked up', text: `Not looked up: at most ${LOOKUPS_MOST} look-ups at once.`, ok: false, facts: [], passages: [] }
      )
    }
  } finally {
    draftStep(ctx.sceneId, 'plan')
  }
  return {
    answers,
    results: calls.map((c, i) => ({ role: 'tool', toolCallId: c.id, content: answers[i].text })),
    steps: calls.map((c, i) => ({ label: answers[i].label, tool: c.name, arguments: c.arguments, result: answers[i].text }))
  }
}
