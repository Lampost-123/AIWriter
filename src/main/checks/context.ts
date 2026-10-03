// What a consistency check of one scene is given (milestone 5, AI checks): the memory as it stands at the
// START of the scene, on the scene's own story's line, so a contradiction with earlier scenes or with Adam's
// notes is caught even though the memory keeper has already followed this scene's text. It is the same
// memory a draft of the scene is briefed with (memory/scene.ts sceneMemory: the line up to just before the
// scene), read the same way.
//
// Each check needs its own part of it:
//   facts      every entry the scene card lists or the text names, with its state (looks, injuries, what
//              has happened to it: "died in the fire"), and the world's absolute rules
//   knowledge  who knows what at this point, and who among those present doesn't
//   timeline   the scenes just before on the line: when and where each was, and who was there; the end of
//              the scene before; this scene's own When and place
//   voice      each speaking character's voice notes and sample lines (in their profile)
//   style      the style guide's point of view and tense, the genre and content levels, and the scene card's mood
// Entries and earlier scenes get short ids (E1, S1) that the reply refers to. No Electron imports.

import type Database from 'better-sqlite3'
import type { CheckKind } from '@shared/contracts/checks'
import type { ContextBlock, EntryState, ID, SceneCard, WritingPrefs } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { effectiveStyle } from '@shared/style'
import { genreLabel, genresOf } from '@shared/genres'
import { intensityLines } from '@shared/intensity'
import type { SceneMemory } from '../memory/types'
import { buildLine, labeler, storyOfScene } from '../memory/line'
import { loadShape, sceneMemory } from '../memory/scene'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import { formatProfile, happenedText, mentions, sceneTail, SHORT_TAIL } from '../ai/context'
import { estimateTokens } from '../keeper/text'

type DB = Database.Database

/** How many scenes before this one the timeline check is told about. */
export const EARLIER_SCENES = 3
/** The most facts listed under "Who knows what". */
const MOST_FACTS = 40
/** The most entries told in full; any more are told in a line each. */
const MOST_FULL = 24

/** One entry the check is told about. */
export interface CheckEntry {
  code: string
  entry: EntryState
  /** Why it is here: "point of view", "present", "where it happens", "named in the scene", "a rule of the world". */
  why: string
  /** For an entry that doesn't exist at this point: "not in the story yet at this point". */
  label: string | null
}

/** One of the scenes just before this one. */
export interface CheckScene {
  code: string
  sceneId: ID
  label: string
  title: string
  when: string
  place: string
  present: string[]
  summary: string
}

export interface SceneCheckContext {
  sceneId: ID
  storyId: ID
  /** "Book 1, Ch 2, Sc 3". */
  where: string
  title: string
  text: string
  card: SceneCard
  memory: SceneMemory
  entries: CheckEntry[]
  earlier: CheckScene[]
  style: { pov: string; tense: string; proseStyle: string; tone: string; genre?: string; content?: string[] }
}

const clean = (s: string | null | undefined): string => (s ?? '').trim()

/** Gathers what a check of this scene is told. Throws (plain words) when the scene has gone. */
export function gatherSceneCheck(db: DB, sceneId: ID, prefs: WritingPrefs): SceneCheckContext {
  const scene = repo.getScene(db, sceneId)
  const { story } = repo.sceneLocation(db, sceneId)
  const memory = sceneMemory(db, sceneId)
  const shape = loadShape(db)
  const label = labeler(shape)
  const card = scene.card
  const text = scene.text ?? ''

  const here = new Map(memory.entries.map((e) => [e.id, e]))
  const away = new Map(memory.elsewhere.map((x) => [x.entry.id, x]))
  const firstHere = new Set(memory.firstHere)
  const entries: CheckEntry[] = []
  const taken = new Set<ID>()
  const take = (id: ID | null | undefined, why: string): void => {
    if (!id || taken.has(id)) return
    const e = here.get(id) ?? away.get(id)?.entry
    if (!e) return
    taken.add(id)
    const lbl = away.get(id)?.label ?? (firstHere.has(id) ? 'first appears in this scene' : null)
    entries.push({ code: `E${entries.length + 1}`, entry: e, why, label: lbl })
  }
  take(card.povId, 'point of view')
  for (const id of card.presentIds ?? []) take(id, 'present')
  take(card.locationId, 'where it happens')
  // Everything the text names, in the order it first does (those that don't exist here too: a dead or
  // not-yet-met character named in the scene is just what the checks are for).
  const named = [...here.values(), ...[...away.values()].map((x) => x.entry)]
    .map((e) => ({ e, at: firstMention(text, [e.name, ...(e.aliases ?? [])]) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
  for (const { e } of named) take(e.id, 'named in the scene')
  for (const e of memory.entries) if (e.kind === 'lore' && e.hardRule) take(e.id, 'a rule of the world')

  // The scenes just before this one on the line (in any story the line goes through).
  const line = storyOfScene(shape, sceneId) ? buildLine(shape, { storyId: story.id, before: sceneId }) : null
  const steps = (line?.steps ?? []).filter((s): s is Extract<typeof s, { type: 'scene' }> => s.type === 'scene' && s.via === 'line')
  const nameOf = (id: ID | null | undefined): string => (id ? (here.get(id)?.name ?? away.get(id)?.entry.name ?? '') : '')
  const earlier: CheckScene[] = []
  for (const step of steps.slice(-EARLIER_SCENES)) {
    try {
      const s = repo.getScene(db, step.sceneId)
      earlier.push({
        code: `S${earlier.length + 1}`,
        sceneId: s.id,
        label: label({ storyId: step.storyId, sceneId: s.id }),
        title: s.title,
        when: clean(s.card.when),
        place: nameOf(s.card.locationId),
        present: [s.card.povId, ...(s.card.presentIds ?? [])].filter((x, i, all) => x && all.indexOf(x) === i).map(nameOf).filter(Boolean),
        summary: clean(kdb.summaryRow(db, 'scene', s.id)?.text)
      })
    } catch {
      /* deleted meanwhile: left out */
    }
  }

  const style = effectiveStyle(prefs, repo.getWorldStyle(db), story.style)
  return {
    sceneId,
    storyId: story.id,
    where: label({ storyId: story.id, sceneId }),
    title: scene.title,
    text,
    card,
    memory,
    entries,
    earlier,
    style: {
      pov: clean(style.pov),
      tense: clean(style.tense),
      proseStyle: clean(style.proseStyle),
      tone: clean(story.tone),
      genre: genreText(style.genres),
      content: intensityLines(style.intensity)
    }
  }
}

/** Where any of the names first appears in the text as a whole word (as the briefing reads names), or -1. */
function firstMention(text: string, names: string[]): number {
  let best = -1
  for (const n of names) {
    const name = n.trim()
    if (name.length < 2 || !mentions(text, name)) continue
    const at = text.search(new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}`, 'iu'))
    if (at >= 0 && (best < 0 || at < best)) best = at
  }
  return best
}

// ---------- The request ----------

/** One section of a request, as "What the AI saw" lists it. */
interface Section {
  id: string
  title: string
  text: string
  entryIds: ID[]
}

const kindWord = (e: EntryState): string => KIND_LABELS[e.kind]?.one.toLowerCase() ?? 'entry'

/** An entry as the check sees it: its profile and what has happened to it so far ("short": a line and its looks). */
export function entryText(c: CheckEntry, short = false): string {
  const e = c.entry
  const notes = [kindWord(e), c.why, c.label].filter(Boolean).join('; ')
  const heading = `### ${c.code} ${e.name} (${notes})`
  if (short) {
    const looks = formatProfile(e, null, ['looks']).split('\n').filter((l) => l.startsWith('- '))
    return [heading, clean(e.summary), ...looks, happenedText(e, 3)].filter(Boolean).join('\n')
  }
  return [formatProfile(e, heading, undefined, true), happenedText(e, 8)].filter(Boolean).join('\n\n')
}

/** The sections a request about these checks needs (everything but the scene's text). */
export function checkSections(ctx: SceneCheckContext, checks: CheckKind[], short = false): Section[] {
  const out: Section[] = []
  const has = (c: CheckKind): boolean => checks.includes(c)
  const byId = new Map(ctx.entries.map((c) => [c.entry.id, c]))
  const ref = (id: ID | null | undefined): string => {
    const c = id ? byId.get(id) : undefined
    return c ? `${c.code} ${c.entry.name}` : ''
  }

  const card = ctx.card
  const cardLines = [
    `Scene: ${ctx.where}${ctx.title ? ` "${ctx.title}"` : ''}`,
    card.when.trim() ? `When: ${card.when.trim()}` : '',
    ref(card.locationId) ? `Where: ${ref(card.locationId)}` : '',
    ref(card.povId) ? `Point of view: ${ref(card.povId)}` : '',
    card.presentIds?.length ? `Present: ${card.presentIds.map(ref).filter(Boolean).join(', ')}` : '',
    card.mood.trim() && (has('style') || has('voice')) ? `Mood: ${card.mood.trim()}` : ''
  ].filter(Boolean)
  out.push({ id: 'scene-card', title: 'The scene card', text: cardLines.join('\n'), entryIds: [] })

  if (has('style')) {
    const s = ctx.style
    const lines = [
      s.pov ? `Point of view: ${s.pov}` : '',
      s.tense ? `Tense: ${s.tense}` : '',
      s.proseStyle ? `Prose style: ${s.proseStyle}` : '',
      s.tone ? `The story's tone: ${s.tone}` : '',
      s.genre ? `Genre: ${s.genre}` : '',
      ...(s.content ?? [])
    ].filter(Boolean)
    if (lines.length) out.push({ id: 'style', title: 'The style guide', text: lines.join('\n'), entryIds: [] })
  }

  const full = short ? [] : ctx.entries.slice(0, MOST_FULL)
  const brief = ctx.entries.filter((c) => !full.includes(c))
  const entryLines = [...full.map((c) => entryText(c)), ...brief.map((c) => entryText(c, true))]
  out.push({
    id: 'memory',
    title: 'The memory as of the start of this scene',
    text: entryLines.length ? entryLines.join('\n\n') : 'Nothing in the memory is named in this scene.',
    entryIds: ctx.entries.map((c) => c.entry.id)
  })

  if (has('facts') || has('knowledge') || has('timeline')) {
    const rels = ctx.memory.relationships.filter((r) => byId.has(r.aId) && byId.has(r.bId))
    if (rels.length) {
      const name = (id: ID): string => byId.get(id)!.entry.name
      out.push({
        id: 'relationships',
        title: 'Relationships',
        text: rels
          .map((r) =>
            [
              `${name(r.aId)} and ${name(r.bId)}: ${clean(r.type) || 'linked'}.`,
              clean(r.aFeels) ? `${name(r.aId)} feels: ${clean(r.aFeels)}.` : '',
              clean(r.bFeels) ? `${name(r.bId)} feels: ${clean(r.bFeels)}.` : ''
            ]
              .filter(Boolean)
              .join(' ')
          )
          .join('\n'),
        entryIds: []
      })
    }
  }

  if (has('knowledge')) {
    const people = ctx.entries.filter((c) => c.entry.kind === 'character' && !c.label)
    const ids = new Set(people.map((c) => c.entry.id))
    const facts = ctx.memory.facts.filter((f) => f.knownBy.some((id) => ids.has(id)) || people.some((c) => mentions(f.fact, c.entry.name)))
    const lines = facts.slice(0, MOST_FACTS).map((f) => {
      const knows = people.filter((c) => f.knownBy.includes(c.entry.id)).map((c) => c.entry.name)
      const not = people.filter((c) => !f.knownBy.includes(c.entry.id)).map((c) => c.entry.name)
      return `- ${clean(f.fact)} Known by: ${knows.join(', ') || 'none of them'}.${not.length ? ` Not known by: ${not.join(', ')}.` : ''}`
    })
    out.push({
      id: 'knowledge',
      title: 'Who knows what at the start of this scene',
      text: lines.length ? lines.join('\n') : 'The memory lists nothing that these characters know.',
      entryIds: []
    })
  }

  if (has('timeline')) {
    if (ctx.earlier.length) {
      out.push({
        id: 'earlier',
        title: 'The scenes just before this one',
        text: ctx.earlier
          .map((s) =>
            [
              `${s.code} ${s.label}${s.title ? ` "${s.title}"` : ''}`,
              s.when ? `When: ${s.when}` : '',
              s.place ? `Where: ${s.place}` : '',
              s.present.length ? `Present: ${s.present.join(', ')}` : '',
              s.summary && !short ? `What happens: ${s.summary}` : ''
            ]
              .filter(Boolean)
              .join('\n')
          )
          .join('\n\n'),
        entryIds: []
      })
    }
    const prev = ctx.memory.previous
    if (prev?.text.trim() && !short) {
      out.push({ id: 'previous-scene', title: 'How the scene before ends', text: sceneTail(prev.text, SHORT_TAIL), entryIds: [] })
    }
  }
  return out
}

/** One request: its messages, and its blocks for "What the AI saw". */
export interface CheckRequest {
  user: string
  blocks: ContextBlock[]
  entryIds: ID[]
}

/** The request for a part of the scene ("part" is 1-based; parts is how many there are). */
export function checkRequest(sections: Section[], part: string, n: { part: number; parts: number }): CheckRequest {
  const title = n.parts > 1 ? `The scene (part ${n.part} of ${n.parts})` : 'The scene'
  const all = [...sections, { id: 'scene-text', title, text: part, entryIds: [] }]
  const user = all.map((s) => `## ${s.title}\n${s.text}`).join('\n\n')
  const blocks: ContextBlock[] = all.map((s, i) => ({
    id: s.id,
    priority: Math.min(10, i + 1),
    title: s.title,
    text: s.text,
    tokens: estimateTokens(s.text),
    entryIds: s.entryIds,
    dropped: false
  }))
  return { user, blocks, entryIds: [...new Set(sections.flatMap((s) => s.entryIds))] }
}

/**
 * The scene's text in parts that fit `tokens` each, cut between paragraphs (a paragraph too long on its
 * own is cut between sentences). One part when it all fits.
 */
export function splitScene(text: string, tokens: number): string[] {
  if (estimateTokens(text) <= tokens) return [text]
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  let cur: string[] = []
  let used = 0
  const flush = (): void => {
    if (cur.length) out.push(cur.join('\n\n'))
    cur = []
    used = 0
  }
  for (const p of paras) {
    const size = estimateTokens(p)
    if (size > tokens) {
      flush()
      out.push(...splitLongPara(p, tokens))
      continue
    }
    if (used + size > tokens) flush()
    cur.push(p)
    used += size
  }
  flush()
  return out.length ? out : [text]
}

function splitLongPara(p: string, tokens: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const s of p.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/gu) ?? [p]) {
    if (cur && estimateTokens(cur + s) > tokens) {
      out.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** The genre picks for the style check: "Horror (slow-building dread)", or "" when none is picked. */
function genreText(ids: string[]): string {
  const label = genreLabel(ids)
  return label ? `${label} (${genresOf(ids).map((g) => g.feel).join('; ')})` : ''
}
