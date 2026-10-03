// The sample world (milestone 6): fills a brand new world database with Gullhaven (sampleContent.ts) through
// the same SQL helpers a real world uses, so it is exactly like one Adam made: entries he typed are his
// ('adam'), what the memory read from the scenes is 'text' with source links to the exact words, and every
// change and summary has its memory-history version. The memory is already read: each scene is marked as
// read at its current version with the paragraphs the keeper would have stored, and the summaries carry the
// fingerprints the keeper compares, so opening or browsing the sample never starts a paid memory run.
// Pure over a better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
import type { ChangeData, ID, SceneCard } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import { findQuote, hashText, sceneParagraphs } from '../keeper/text'
import { sceneSourceHash } from '../keeper/summaries'
import { spotIn } from '../keeper/track'
import { newId } from '../util'
import {
  LETTER_FACT,
  SAMPLE_CHANGES,
  SAMPLE_CHAPTERS,
  SAMPLE_ENTRIES,
  SAMPLE_NAME,
  SAMPLE_RELATIONSHIPS,
  SAMPLE_STORY,
  SAMPLE_STORY_SUMMARY,
  SAMPLE_WORLD
} from './sampleContent'

type DB = Database.Database

/** The world meta key marking the sample world (its value is the sample's version). */
export const SAMPLE_META_KEY = 'sample_world'
const SAMPLE_VERSION = '1'

export const isSampleWorld = (db: DB): boolean => !!repo.getMeta(db, SAMPLE_META_KEY)

/** The editor document for a scene's paragraphs, each with its stable paragraph id. */
function sceneDoc(paragraphs: string[], pids: string[]): unknown {
  return {
    type: 'doc',
    content: paragraphs.map((text, i) => ({ type: 'paragraph', attrs: { pid: pids[i] }, content: [{ type: 'text', text }] }))
  }
}

/** Short, distinct paragraph ids, as the editor makes them (8 letters and digits). */
const pid = (scene: number, para: number): string => `gh${scene}p${String(para).padStart(2, '0')}xa`.slice(0, 8)

/**
 * Fills a world database that `repo.initWorld` has just set up (its first series, story, chapter and scene are
 * reused) with the sample world. One transaction: a failure leaves the database as it was.
 */
export function fillSampleWorld(db: DB): void {
  db.transaction(() => fill(db))()
}

function fill(db: DB): void {
  const ids = new Map<string, ID>()
  const id = (key: string): ID => {
    const v = ids.get(key)
    if (!v) throw new Error(`The sample world has no "${key}"`)
    return v
  }

  repo.setMeta(db, SAMPLE_META_KEY, SAMPLE_VERSION)
  repo.setMeta(db, 'name', SAMPLE_NAME)
  repo.setMeta(db, 'themes', SAMPLE_WORLD.themes)
  repo.setMeta(db, 'tone', SAMPLE_WORLD.tone)
  repo.setMeta(db, 'style', JSON.stringify({ ...repo.getWorldStyle(db), ...SAMPLE_WORLD.style }))

  // The story, chapters and scenes: the world's own first ones, then the rest.
  const [story] = repo.listStories(db)
  repo.updateStory(db, story.id, { title: SAMPLE_STORY.title, premise: SAMPLE_STORY.premise })
  const first = repo.getOutline(db, story.id)
  const chapterIds: ID[] = []
  SAMPLE_CHAPTERS.forEach((c, ci) => {
    const chapter = ci === 0 ? first.chapters[0] : repo.createChapter(db, story.id, { title: c.title })
    repo.updateChapter(db, chapter.id, { title: c.title, goal: c.goal })
    chapterIds.push(chapter.id)
    c.scenes.forEach((s, si) => {
      const scene = ci === 0 && si === 0 ? first.scenes[0] : repo.createScene(db, chapter.id, { title: s.title })
      repo.updateScene(db, scene.id, { title: s.title })
      ids.set(s.key, scene.id)
    })
  })

  // Entries. Adam's are his from the beginning of the world; the memory's were found in a scene.
  for (const e of SAMPLE_ENTRIES) {
    const made = e.made
    const entry = repo.createEntry(
      db,
      e.kind,
      {
        name: e.name,
        aliases: e.aliases ?? [],
        summary: e.summary,
        description: e.description ?? '',
        fields: e.fields ?? {},
        hardRule: !!e.hardRule,
        parentId: e.parent ? id(e.parent) : null
      },
      made.by === 'adam' ? { origin: 'adam' } : { origin: 'text', originStoryId: story.id, originSceneId: id(made.scene) }
    )
    ids.set(e.key, entry.id)
  }

  // The scenes' words and cards. Each save moves the scene's text version on, as the editor's do.
  const scenes = SAMPLE_CHAPTERS.flatMap((c) => c.scenes)
  scenes.forEach((s, si) => {
    const sceneId = id(s.key)
    const pids = s.paragraphs.map((_, pi) => pid(si + 1, pi + 1))
    repo.saveSceneText(db, sceneId, sceneDoc(s.paragraphs, pids), s.paragraphs.join('\n\n'))
    kdb.noteSceneSaved(db, sceneId)
    const card: SceneCard = {
      ...emptySceneCard(),
      povId: id(s.card.pov),
      presentIds: s.card.present.map(id),
      locationId: id(s.card.location),
      when: s.card.when,
      goal: s.card.goal,
      conflict: s.card.conflict,
      outcome: s.card.outcome,
      mood: s.card.mood,
      targetWords: 600,
      setsUpIds: (s.card.setsUp ?? []).map(id),
      paysOffIds: (s.card.paysOff ?? []).map(id)
    }
    repo.updateSceneCard(db, sceneId, card)
  })

  /** Where some words are in a scene now, as a source link records them (paragraph id and range). */
  const linkTo = (factKind: 'entry' | 'field' | 'change', factId: ID, field: string | null, sceneKey: string, quote: string): void => {
    const scene = repo.getScene(db, id(sceneKey))
    for (const p of sceneParagraphs(scene.doc, scene.text)) {
      const r = findQuote(p.text, quote)
      if (!r) continue
      const spot = spotIn(p, r)
      hist.addLink(db, { factKind, factId, field, sceneId: scene.id, sceneVersion: 1, ...spot })
      return
    }
    throw new Error(`The sample world's words "${quote}" aren't in its scene ${sceneKey}`)
  }

  for (const e of SAMPLE_ENTRIES) {
    if (e.made.by !== 'text') continue
    linkTo('entry', id(e.key), null, e.made.scene, e.made.quote)
    for (const [field, q] of Object.entries(e.made.fieldQuotes ?? {})) {
      if (typeof q === 'string') linkTo('field', id(e.key), field, e.made.scene, q)
      else linkTo('field', id(e.key), field, q.scene, q.quote)
    }
  }

  // Relationships Adam set on the pages, before the story.
  for (const r of SAMPLE_RELATIONSHIPS) {
    mem.insertChange(db, {
      entryId: id(r.entry),
      anchor: 'baseline',
      kind: 'relationship',
      payload: { otherId: id(r.otherId), type: r.type, feels: r.feels, otherFeels: r.otherFeels },
      origin: 'adam'
    })
  }

  // What the memory read from each scene, linked to its words.
  const factId = newId()
  for (const c of SAMPLE_CHANGES) {
    const data: ChangeData =
      c.kind === 'update'
        ? { kind: 'update', payload: c.fields ? { note: c.note, fields: c.fields } : { note: c.note } }
        : c.kind === 'knowledge'
          ? { kind: 'knowledge', payload: { factId, fact: LETTER_FACT } }
          : c.kind === 'thread'
            ? { kind: 'thread', payload: { status: c.status, note: c.note } }
            : { kind: 'relationship', payload: { otherId: id(c.otherId), type: c.type, feels: c.feels, otherFeels: c.otherFeels } }
    const change = mem.insertChange(db, { ...data, entryId: id(c.entry), anchor: 'scene', sceneId: id(c.scene), origin: 'text' })
    linkTo('change', change.id, null, c.scene, c.quote)
  }

  // Marked done (with the text it was marked done with), as Ctrl+Enter does.
  for (const s of scenes) if (s.status === 'done') kdb.markSceneDone(db, id(s.key))

  // The memory has read every scene at its current version: the paragraphs it read, as the keeper stores them.
  for (const s of scenes) {
    const scene = kdb.keeperScene(db, id(s.key))!
    const read = sceneParagraphs(scene.doc, scene.text).map((p) => ({ id: p.id, hash: p.hash, text: p.text }))
    kdb.markProcessed(db, scene.sceneId, scene.textVersion, read)
  }

  // Summaries at every level, from the text, with the fingerprints the keeper compares (so none is written again).
  for (const s of scenes) {
    const scene = repo.getScene(db, id(s.key))
    mem.putSummary(db, { level: 'scene', targetId: scene.id, text: s.summary, origin: 'text', sourceHash: sceneSourceHash(scene.text) })
  }
  SAMPLE_CHAPTERS.forEach((c, ci) => {
    const hash = hashText(c.scenes.map((s) => s.summary.trim()).join('\n'))
    mem.putSummary(db, { level: 'chapter', targetId: chapterIds[ci], text: c.summary, origin: 'text', sourceHash: hash })
  })
  const storyHash = hashText(SAMPLE_CHAPTERS.map((c) => c.summary.trim()).join('\n'))
  mem.putSummary(db, { level: 'story', targetId: story.id, text: SAMPLE_STORY_SUMMARY, origin: 'text', sourceHash: storyHash })
  if (story.seriesId) {
    const seriesHash = hashText(`${SAMPLE_STORY.title}\n${SAMPLE_STORY_SUMMARY.trim()}`)
    mem.putSummary(db, { level: 'series', targetId: story.seriesId, text: SAMPLE_STORY_SUMMARY, origin: 'text', sourceHash: seriesHash })
  }
  repo.touchWorld(db)
}
