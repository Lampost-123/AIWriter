// Adam's own writing for a scene's briefing (2026-10-19): the scenes before it on its story's line, nearest first (then
// this story's later scenes), read for which paragraphs he wrote or rewrote himself (ownWords.ts); a sample of them for
// the writer's voice, and how each character's lines read (voiceMarks.ts), his own lines first. The scene being written
// is left out: its words are in the briefing already, and the sample (in the system message) stays the same while he
// works on it, so a provider can keep reusing the prompt. Each scene's reading is kept until its words or the AI's
// replies for it change. No Electron imports.

import type Database from 'better-sqlite3'
import type { EntryState, ID } from '@shared/types'
import { calledFor } from '@shared/names'
import { calledIn } from '../db/called'
import { chatTexts, proseMarks, proseTexts } from '../db/ownWords'
import { loadShapeSafe } from '../keeper/places'
import * as line from '../memory/line'
import { isSampleWorld } from '../setup/sampleWorld'
import { quoteSpans, spokenLines } from '../checks/speakers'
import { pickOwnSample, readParagraphs, type OwnSample, type OwnScene, type ParaRead } from './ownWords'
import { spokenWords, voiceMarksFor, type SpokenBy, type VoiceMark } from './voiceMarks'

type DB = Database.Database

/** The most scenes read for one briefing, and the most words. */
export const MOST_SCENES = 40
export const MOST_WORDS = 80_000

/** What a briefing gets: the sample (null: too little of his own, or not asked for) and each character's marks, by id. */
export interface OwnWriting {
  sample: OwnSample | null
  voices: Record<ID, VoiceMark>
}

interface Kept {
  key: string
  paragraphs: ParaRead[]
}

/** Each world's scene readings, by scene id (most recently used last). */
const kept = new WeakMap<DB, Map<ID, Kept>>()
const MOST_KEPT = 400

function keptFor(db: DB): Map<ID, Kept> {
  let m = kept.get(db)
  if (!m) kept.set(db, (m = new Map()))
  return m
}

/** A quick fingerprint of a scene's words. */
function hashOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${text.length}:${h.toString(36)}`
}

/** The scenes to read for this one, nearest first: those before it on its line, then its own story's later scenes. */
export function scenesToRead(db: DB, sceneId: ID): { ids: ID[]; where: (id: ID) => string } {
  const shape = loadShapeSafe(db)
  if (!shape) return { ids: [], where: () => '' }
  const label = line.labeler(shape)
  const story = line.storyOfScene(shape, sceneId)
  let before: ID[] = []
  try {
    before = line.scenesBefore(shape, sceneId)
  } catch (e) {
    console.warn('Could not work out the scenes before this one for your own writing', e)
  }
  const later: ID[] = []
  if (story) {
    const all = story.chapters.flatMap((c) => c.scenes.map((s) => s.id))
    const at = all.indexOf(sceneId)
    if (at >= 0) later.push(...all.slice(at + 1))
  }
  const ids = [...new Set([...before.reverse(), ...later])].filter((id) => id !== sceneId).slice(0, MOST_SCENES)
  const title = story?.title.trim() ?? ''
  // "Ch 3, Sc 2" within this story; another story's scenes keep its title.
  const where = (id: ID): string => {
    const w = label({ storyId: null, sceneId: id })
    return title && w.startsWith(`${title}, `) ? w.slice(title.length + 2) : w
  }
  return { ids, where }
}

/** The scenes' words, by id (deleted scenes left out). */
function sceneTexts(db: DB, ids: readonly ID[]): Map<ID, string> {
  if (!ids.length) return new Map()
  const rows = db
    .prepare('SELECT id, text FROM scenes WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL')
    .all(JSON.stringify(ids)) as { id: ID; text: string | null }[]
  return new Map(rows.map((r) => [r.id, r.text ?? '']))
}

/**
 * Reads the scenes for this one: each scene's paragraphs with which are Adam's own, nearest first, kept until the
 * scene's words or the AI's replies for it change.
 */
export function readScenes(db: DB, sceneId: ID): (OwnScene & { text: string })[] {
  const { ids, where } = scenesToRead(db, sceneId)
  if (!ids.length) return []
  const texts = sceneTexts(db, ids)
  const marks = proseMarks(db, ids)
  let chat: ReturnType<typeof chatTexts> | null = null
  const chats = (): ReturnType<typeof chatTexts> => (chat ??= chatTexts(db))
  const cache = keptFor(db)
  const out: (OwnScene & { text: string })[] = []
  let words = 0
  for (const id of ids) {
    const text = texts.get(id)
    if (text == null || !text.trim()) continue
    const fromChat = chats().get(id)
    const key = `${hashOf(text)}|${marks.get(id) ?? ''}|${fromChat?.mark ?? ''}`
    let k = cache.get(id)
    if (!k || k.key !== key) {
      const ai = marks.has(id) ? proseTexts(db, id) : []
      k = { key, paragraphs: readParagraphs(text, [...ai, ...(fromChat?.texts ?? [])]) }
    }
    // Most recently used last, so the oldest go first.
    cache.delete(id)
    cache.set(id, k)
    out.push({ sceneId: id, where: where(id), paragraphs: k.paragraphs, text })
    words += k.paragraphs.reduce((n, p) => n + p.words, 0)
    if (words >= MOST_WORDS) break
  }
  for (const old of [...cache.keys()].slice(0, Math.max(0, cache.size - MOST_KEPT))) cache.delete(old)
  return out
}

/** The paragraph a place in a scene's text is in. */
function paragraphAt(paragraphs: readonly ParaRead[], at: number): ParaRead | null {
  let found: ParaRead | null = null
  for (const p of paragraphs) {
    if (p.start > at) break
    found = p
  }
  return found
}

/**
 * The lines of dialogue given to each of these characters in the scenes read (with whether Adam wrote them), and every
 * line of dialogue read; then the sample lines the memory keeper kept for them that the scenes read don't have.
 */
export function linesIn(
  db: DB,
  scenes: readonly (OwnScene & { text: string })[],
  people: readonly Pick<EntryState, 'id' | 'name' | 'aliases' | 'fields' | 'fieldOrigins'>[]
): { lines: SpokenBy[]; dialogue: string[] } {
  const lines: SpokenBy[] = []
  const dialogue: string[] = []
  if (!people.length) return { lines, dialogue }
  for (const s of scenes) {
    for (const p of s.paragraphs) if (p.dialogue) dialogue.push(...spokenWords(p.text))
    if (!s.paragraphs.some((p) => p.dialogue)) continue
    const called = calledIn(db, s.sceneId)
    const names = people.map((e) => ({ id: e.id, names: [e.name, ...(e.aliases ?? []), ...calledFor(called, e.id)] }))
    const spoken = spokenLines(s.text, names)
    spoken.forEach((l, i) => {
      const para = paragraphAt(s.paragraphs, l.start)
      const own = !!para?.own
      for (const text of spokenWords(l.quote)) lines.push({ entryId: l.entryId, text, own })
      // More of the same speech in the same paragraph, up to the next line given to someone: “Get the lamp,” Bryn said.
      // “The one that works.”
      if (!para) return
      const from = l.start + l.quote.length
      const paraEnd = para.start + para.text.length
      const next = spoken[i + 1]?.start ?? Infinity
      for (const q of quoteSpans(para.text)) {
        const at = para.start + q.start
        if (at < from || at >= Math.min(next, paraEnd)) continue
        for (const text of spokenWords(para.text.slice(q.start, q.end))) lines.push({ entryId: l.entryId, text, own })
      }
    })
  }
  // The sample lines the memory keeper kept (Adam's own when he set them) that the scenes read don't have: lines from
  // further back than the scenes read.
  const plain = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const have = new Set(lines.map((l) => `${l.entryId}|${plain(l.text)}`))
  for (const e of people) {
    const own = e.fieldOrigins?.sampleLines === 'adam'
    for (const raw of (e.fields?.sampleLines ?? '').split(/\r?\n/).filter((x) => x.trim())) {
      for (const text of spokenWords(raw)) {
        const k = `${e.id}|${plain(text)}`
        if (have.has(k)) continue
        have.add(k)
        lines.push({ entryId: e.id, text, own })
        dialogue.push(text)
      }
    }
  }
  return { lines, dialogue }
}

/**
 * Adam's own writing for a scene's briefing: the sample when `sample` (Settings: "Use my own writing as the sample";
 * never in the sample world, whose scenes the app wrote) and he has written enough, and the marks for how each of
 * `people` sounds. Nothing, rather than stopping a draft, when the world can't be read.
 */
export function ownWritingFor(
  db: DB,
  sceneId: ID,
  o: { sample: boolean; people: readonly Pick<EntryState, 'id' | 'name' | 'aliases' | 'fields' | 'fieldOrigins' | 'kind'>[] }
): OwnWriting {
  try {
    const scenes = readScenes(db, sceneId)
    const sample = o.sample && !isSampleWorld(db) ? pickOwnSample(scenes) : null
    const people = o.people.filter((e) => e.kind === 'character')
    const { lines, dialogue } = linesIn(db, scenes, people)
    const voices: Record<ID, VoiceMark> = {}
    for (const [id, mark] of voiceMarksFor(lines, people, dialogue)) voices[id] = mark
    return { sample, voices }
  } catch (e) {
    console.warn('Could not read your own writing for the briefing; the AI writes without it', e)
    return { sample: null, voices: {} }
  }
}
