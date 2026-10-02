// SQL for the story screens (milestone 3): series, making a story with its placement in one go, which
// story leads into a prequel chain's book, a prequel's starting cast, and Adam's "No" to "Should Book 2
// now continue after it?". Built on the tables of migrations 1 and 2; no Electron imports, so it is
// tested against an in-memory world.
import type Database from 'better-sqlite3'
import type { StoryPlacement } from '@shared/api'
import type { AnswerKind, ID, Series, Story } from '@shared/types'
import type { CreatedStory, NewStoryInput, StoryDetails } from '@shared/contracts/stories'
import * as repo from './repo'
import * as mem from './memory'
import { newId, now, UserError } from '../util'
import { leadsGroup, leadsInto, mightFollow, previewStory, placementOf, startingHere } from '../stories/rules'

type Row = Record<string, unknown>
type DB = Database.Database

// ---------- Series ----------

export function getSeries(db: DB, id: ID): Series {
  const found = repo.listSeries(db).find((s) => s.id === id)
  if (!found) throw new UserError('That series no longer exists. Pick another one.')
  return found
}

const cleanName = (name: unknown): string => (typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '')

/** Makes a series (a series with that name already is used instead, so typing an existing name never makes a twin). */
export function createSeries(db: DB, name: string): Series {
  const clean = cleanName(name)
  if (!clean) throw new UserError('Give the new series a name.')
  const same = repo.listSeries(db).find((s) => s.name.trim().toLocaleLowerCase() === clean.toLocaleLowerCase())
  if (same) return same
  const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM series').get() as Row
  const id = newId()
  db.prepare('INSERT INTO series (id, name, position, created_at) VALUES (?, ?, ?, ?)').run(id, clean, (max.p as number) + 1, now())
  return getSeries(db, id)
}

/** Renames a series or changes its themes and tone (they reach the briefing of every story in it). A blank name keeps the old one. */
export function updateSeries(db: DB, id: ID, patch: Partial<Pick<Series, 'name' | 'themes' | 'tone'>>): Series {
  const s = getSeries(db, id)
  const name = cleanName(patch.name) || s.name
  const themes = typeof patch.themes === 'string' ? patch.themes : s.themes
  const tone = typeof patch.tone === 'string' ? patch.tone : s.tone
  db.prepare('UPDATE series SET name = ?, themes = ?, tone = ? WHERE id = ?').run(name, themes, tone, id)
  return getSeries(db, id)
}

// ---------- Making a story ----------

type Made = { story: Story; sceneId: ID; entryIds: ID[]; endedFirst: CreatedStory['endedFirst'] }

/**
 * Makes a story with its placement, its first chapter and scene, and a new series if one is named, all
 * or nothing: a placement the rules refuse leaves no half-made story behind. Side stories it ends first
 * ("End Ash after Ch 1" in the New story dialog) end after their chapter in the same go; one that is no
 * longer there to end is left as it is. Returns the story, its first scene, the entries whose
 * first-exists points changed, and the stories ended first with what each was before.
 */
export function createStoryAs(db: DB, input: NewStoryInput): Made {
  return db.transaction((): Made => {
    const named = cleanName(input.newSeries)
    const seriesId = named ? createSeries(db, named).id : input.seriesId ? getSeries(db, input.seriesId).id : null
    const title = typeof input.title === 'string' ? input.title : ''
    const made = repo.createStory(db, { title, seriesId, startStoryId: null })
    const entryIds = mem.setStoryPlacement(db, made.id, input.placement)
    const endedFirst: Made['endedFirst'] = []
    for (const e of Array.isArray(input.endFirst) ? input.endFirst : []) {
      const shape = mem.loadShape(db)
      const other = shape.stories.find((s) => s.id === e?.storyId && s.kind === 'side' && s.id !== made.id)
      const n = other
        ? (shape.stories.find((s) => s.id === other.startStoryId)?.chapters.findIndex((c) => c.id === e.endRefId) ?? -1) + 1
        : 0
      if (!other || !n) continue
      const was = placementOf(other)
      entryIds.push(...mem.setStoryPlacement(db, other.id, { ...was, endAt: 'chapter', endRefId: e.endRefId }))
      endedFirst.push({ storyId: other.id, title: other.title, chapter: `Ch ${n}`, was })
    }
    const gap = typeof input.timeGap === 'string' ? input.timeGap.trim() : ''
    if (gap) repo.updateStory(db, made.id, { timeGap: gap })
    const chapter = repo.createChapter(db, made.id, {})
    const scene = repo.createScene(db, chapter.id, {})
    return { story: repo.getStory(db, made.id), sceneId: scene.id, entryIds, endedFirst }
  })()
}

// ---------- Leads into ----------

/**
 * Marks the story that leads into its prequel chain's book (on), clearing any other mark in the chain,
 * or clears the mark so the last story in the chain leads in again (off).
 */
export function setLeadsIn(db: DB, storyId: ID, on: boolean): void {
  repo.getStory(db, storyId)
  const group = leadsGroup(mem.loadShape(db), storyId)
  if (!group.length) throw new UserError('Only a prequel, or a story that continues after one, leads into a book.')
  db.transaction(() => {
    const clear = db.prepare('UPDATE stories SET leads_in = 0, updated_at = ? WHERE id = ? AND leads_in = 1')
    const t = now()
    for (const s of group) clear.run(t, s.id)
    if (on) db.prepare('UPDATE stories SET leads_in = 1, updated_at = ? WHERE id = ?').run(t, storyId)
  })()
}

// ---------- A prequel's starting cast ----------

/** Entries with a start-of-story description in this story, or a first-exists point at its start: the cast it was given. */
export function storyCast(db: DB, storyId: ID): ID[] {
  const rows = db
    .prepare(
      `SELECT c.entry_id AS id FROM changes c JOIN entries e ON e.id = c.entry_id
         WHERE c.anchor = 'story-start' AND c.kind = 'full' AND c.story_id = ? AND c.deleted_at IS NULL AND e.deleted_at IS NULL
       UNION
       SELECT p.entry_id AS id FROM exists_points p JOIN entries e ON e.id = p.entry_id
         WHERE p.story_id = ? AND p.kind IN ('story-pre', 'story-post') AND e.deleted_at IS NULL`
    )
    .all(storyId, storyId) as Row[]
  return rows.map((r) => r.id as string)
}

// ---------- "Should Book 2 now continue after it?" ----------

// Adam's "No" is kept with the world (so it travels with backups and restores), keyed by the story
// asked about. AnswerKind doesn't list this kind yet (see the report's "Needs from integration"); the
// answers table takes any kind, and the memory only reads the kinds it knows.
const FOLLOW_DECLINED = 'follow-declined' as AnswerKind

/** Adam said No to "Should Book 2 now continue after it?" for this story, so story settings stops asking. */
export function declineFollow(db: DB, storyId: ID): void {
  repo.getStory(db, storyId)
  mem.setAnswer(db, FOLLOW_DECLINED, storyId, true)
}

export const followDeclined = (db: DB, storyId: ID): boolean =>
  !!db.prepare('SELECT 1 FROM answers WHERE kind = ? AND key = ?').get(FOLLOW_DECLINED, storyId)

// ---------- Story settings ----------

/** A story's placement as the memory has it, a start or end at something deleted already moved (loadShape). */
export function storyPlacement(db: DB, storyId: ID): StoryPlacement {
  repo.getStory(db, storyId)
  const node = mem.loadShape(db).stories.find((s) => s.id === storyId)
  if (!node) throw new UserError('That story no longer exists.')
  return placementOf(node)
}

export function storyDetails(db: DB, storyId: ID): StoryDetails {
  const story = repo.getStory(db, storyId)
  const shape = mem.loadShape(db)
  const node = shape.stories.find((s) => s.id === storyId)!
  const placement = placementOf(node)
  return {
    story,
    placement,
    preview: previewStory(shape, { storyId, title: node.title, seriesId: node.seriesId, placement }),
    startingHere: startingHere(shape, storyId),
    mightFollow: followDeclined(db, storyId) ? [] : mightFollow(shape, storyId),
    leadsInto: leadsInto(shape, storyId),
    cast: node.kind === 'prequel' ? storyCast(db, storyId) : []
  }
}
