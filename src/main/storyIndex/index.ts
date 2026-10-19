// The story index (overhaul phase 1, items 2 and 3): a look-up table that says, scene by scene, who is where, with what,
// and what changed, kept as dated facts in the world (migration 5; SQL in db/storyIndex.ts). Built here with no AI call
// from what the world already holds (storyIndex/build.ts says what from), read by the look-ups (lookup.ts) and the free
// checks (checks.ts).
// - `buildStoryIndex` brings a whole story's index up to date: scenes gone are dropped, every scene's place in the story
//   is set, and a scene is built again only when what it is built from has changed (its source hash: the words, the card,
//   what the words call people, the memory's changes there and the words behind them, where things stand there and just
//   before, the summary, and the world's names). Then where each fact stops is worked out again (link.ts).
// - `refreshSceneIndex` does the same for one scene (and the next scene with a stage, whose facts are told against it),
//   plus any scene of its story not in the index yet.
// Kept current by storyIndex/upkeep.ts (wired in keeper/indexing.ts); the physical details filled in by fill.ts. No
// Electron imports.

import type Database from 'better-sqlite3'
import type { ID, SceneCard } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as sidx from '../db/storyIndex'
import { factHealth, linksInScene, type FactHealth } from '../db/history'
import { calledIn } from '../db/called'
import { keptStates } from '../continuity/tracker'
import type { SceneState } from '@shared/continuity'
import { hashText } from '../keeper/text'
import { buildScene, indexWorld, type IndexWorld, type SceneSource } from './build'
import { factEnds } from './link'

export * from './lookup'
export * from './checks'
export type * from './types'

type DB = Database.Database

/** Goes up whenever the build's rules change, so every scene is built again by them (2: a row says when its details are in). */
export const INDEX_RULES = 2

export interface IndexBuild {
  storyId: ID
  /** The story's scenes now in the index. */
  scenes: number
  /** How many were built (again). */
  built: number
  /** How many were taken out (gone from the story). */
  dropped: number
  ms: number
}

/** A story's live scenes in order, each with its place: 1, 2, 3... and "Ch 2, Sc 1" (live chapters and scenes from 1). */
function storyPlaces(db: DB, storyId: ID): { sceneId: ID; position: number; label: string }[] | null {
  const story = mem.loadShape(db).stories.find((s) => s.id === storyId)
  if (!story) return null
  const out: { sceneId: ID; position: number; label: string }[] = []
  story.chapters.forEach((c, ci) =>
    c.scenes.forEach((s, si) => out.push({ sceneId: s.id, position: out.length + 1, label: `Ch ${ci + 1}, Sc ${si + 1}` }))
  )
  return out
}

/** What a story's builds read once: the world's names, the facts' health, the cards and where things stand. */
interface Reading {
  world: IndexWorld
  names: string
  health: FactHealth
  cards: Map<ID, SceneCard>
  order: ID[]
  inStory: Set<ID>
  /** Where things stand as each scene ends, read from its words as they are now. */
  stages: Map<ID, { state: SceneState; edited: boolean }>
}

function readStory(db: DB, order: ID[]): Reading {
  const entries = repo.listEntries(db)
  const world = indexWorld(entries)
  const stages = new Map<ID, { state: SceneState; edited: boolean }>()
  for (const [id, k] of keptStates(db, order)) if (k.fresh) stages.set(id, { state: k.state, edited: k.edited })
  return {
    world,
    names: hashText(JSON.stringify(entries.map((e) => [e.id, e.kind, e.name, e.aliases, world.people.has(e.id)]))),
    health: factHealth(db),
    cards: repo.sceneCards(db, order),
    order,
    inStory: new Set(order),
    stages
  }
}

/** The last scene before this one in the story with where things stand. */
function stageBefore(r: Reading, sceneId: ID): { id: ID; state: SceneState } | null {
  for (let i = r.order.indexOf(sceneId) - 1; i >= 0; i--) {
    const s = r.stages.get(r.order[i])
    if (s) return { id: r.order[i], state: s.state }
  }
  return null
}

/** Everything a scene's rows are built from, and its hash. */
function sourceOf(db: DB, r: Reading, storyId: ID, sceneId: ID): { src: SceneSource; hash: string } {
  const words = sidx.sceneWords(db, [sceneId]).get(sceneId) ?? { title: '', text: '' }
  const card = r.cards.get(sceneId) ?? repo.getScene(db, sceneId).card
  // As the writer is given them: a change read from words since edited, and not confirmed, is left out (memory/scene.ts writerData).
  const changes = mem
    .changesInScene(db, sceneId)
    .filter((c) => c.anchor === 'scene' && (c.origin === 'adam' || r.health.change(c.id) !== 'unsure'))
  const quotes = new Map<ID, string>()
  for (const l of linksInScene(db, sceneId))
    if (l.factKind === 'change' && l.state === 'ok' && !quotes.has(l.factId)) quotes.set(l.factId, l.quote)
  const before = stageBefore(r, sceneId)
  const src: SceneSource = {
    sceneId,
    storyId,
    text: words.text,
    card,
    called: calledIn(db, sceneId),
    changes,
    quotes,
    summary: mem.getSummary(db, 'scene', sceneId)?.text ?? '',
    stage: r.stages.get(sceneId) ?? null,
    stageBefore: before?.state ?? null,
    inStory: (id) => r.inStory.has(id)
  }
  const hash = hashText(
    JSON.stringify([
      INDEX_RULES,
      storyId,
      src.text,
      [card.povId, card.presentIds, card.locationId, card.when, card.setsUpIds, card.paysOffIds],
      src.called,
      changes.map((c) => [c.id, c.kind, c.payload, c.origin, c.until ?? null, c.until ? src.inStory(c.until.sceneId) : null]),
      [...quotes],
      src.summary,
      src.stage,
      before,
      r.names
    ])
  )
  return { src, hash }
}

/** Builds again those of `check` (scenes of this story) whose source changed; how many were. */
function buildScenes(db: DB, r: Reading, storyId: ID, places: Map<ID, { position: number; label: string }>, check: Iterable<ID>): number {
  const indexed = sidx.indexedScenes(db, storyId)
  let built = 0
  for (const sceneId of check) {
    const place = places.get(sceneId)
    if (!place) continue
    const { src, hash } = sourceOf(db, r, storyId, sceneId)
    if (indexed.get(sceneId)?.hash === hash) continue
    const b = buildScene(src, r.world)
    sidx.writeSceneIndex(
      db,
      {
        sceneId,
        storyId,
        position: place.position,
        label: place.label,
        gist: b.gist,
        present: b.present,
        mentioned: b.mentioned,
        placeEntryId: b.placeEntryId,
        whenText: b.whenText,
        sourceHash: hash,
        // With where things stand read from the scene's words, its physical details are in (the AI's part: fill.ts).
        filled: src.stage ? 'ai' : 'free'
      },
      b.facts,
      b.threads
    )
    built++
  }
  return built
}

/** Works out again where each of a story's facts stops. */
function linkStory(db: DB, storyId: ID): void {
  const ends = factEnds(sidx.storyFactsInOrder(db, storyId))
  if (ends.length) sidx.setFactEnds(db, ends)
}

/**
 * Brings a story's index in step: scenes gone dropped, every scene's place set, `check` (all by default) built again
 * where its source changed, scenes not in the index yet built, and the ends worked out again when anything moved.
 */
function syncStory(db: DB, storyId: ID, check?: (r: Reading) => ID[]): IndexBuild {
  const started = performance.now()
  const list = storyPlaces(db, storyId)
  if (!list) {
    const dropped = sidx.indexScenes(db, storyId).length
    sidx.dropStoryIndex(db, storyId)
    return { storyId, scenes: 0, built: 0, dropped, ms: performance.now() - started }
  }
  return db.transaction((): IndexBuild => {
    const order = list.map((p) => p.sceneId)
    const places = new Map(list.map((p) => [p.sceneId, { position: p.position, label: p.label }]))
    const indexed = sidx.indexedScenes(db, storyId)
    const gone = [...indexed.keys()].filter((id) => !places.has(id))
    sidx.dropSceneIndex(db, gone)
    const moved = sidx.placeIndexScenes(db, list)
    const r = readStory(db, order)
    const wanted = new Set(check ? check(r) : order)
    for (const id of order) if (!indexed.has(id)) wanted.add(id)
    const built = buildScenes(
      db,
      r,
      storyId,
      places,
      order.filter((id) => wanted.has(id))
    )
    if (built || gone.length || moved) linkStory(db, storyId)
    return { storyId, scenes: order.length, built, dropped: gone.length, ms: performance.now() - started }
  })()
}

/** Brings a whole story's index up to date (a scene is built again only when what it is built from changed). */
export function buildStoryIndex(db: DB, storyId: ID): IndexBuild {
  return syncStory(db, storyId)
}

/**
 * Brings one scene's rows up to date: the scene itself, and the next scene of its story with where things stand (its
 * facts are told against this one's), plus any scene of the story not in the index yet. A scene gone (deleted, or its
 * story deleted) is taken out. Null when the scene was never in the index and isn't in a live story now.
 */
export function refreshSceneIndex(db: DB, sceneId: ID): IndexBuild | null {
  const storyId = sidx.storyOfIndexScene(db, sceneId)
  const was = sidx.indexStoryOf(db, sceneId)
  // Moved to another story, or gone: the story it was in loses it.
  const left = was && was !== storyId ? syncStory(db, was) : null
  if (!storyId) return left
  return syncStory(db, storyId, (r) => {
    const at = r.order.indexOf(sceneId)
    if (at < 0) return []
    const next = r.order.slice(at + 1).find((id) => r.stages.has(id))
    return next ? [sceneId, next] : [sceneId]
  })
}
