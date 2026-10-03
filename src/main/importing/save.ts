// Importing a plan into the open world: one transaction makes the story (after the last story on the shelf),
// its acts, chapters and scenes through the usual repo functions, saves each scene's text as the editor
// would (doc.ts), and leaves the scenes unread by the memory (db/importing.ts) until Adam asks for the
// import catch-up. Nothing is half made: anything that fails takes the whole import back. No Electron imports.

import type Database from 'better-sqlite3'
import type { ImportPlan, ImportResult, ManuscriptRun } from '@shared/contracts/importing'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as acts from '../db/acts'
import * as idb from '../db/importing'
import { refreshDefaultExistsPoints } from '../db/memory'
import { UserError } from '../util'
import { sceneDoc } from './doc'

type DB = Database.Database

/** Longest title kept for a story, act, chapter or scene; a heading longer than this was really a paragraph. */
const TITLE_MAX = 200
/** More than any book has: a plan bigger than this was not made by the import page. */
const MOST_SCENES = 20_000

const cleanTitle = (t: unknown, fallback: string): string => {
  const s = typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : ''
  return (s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1).trimEnd()}…` : s) || fallback
}

/** The plan as sent, checked: only text runs with bold and italic, nothing else. */
function cleanParagraphs(ps: unknown): ManuscriptRun[][] {
  if (!Array.isArray(ps)) return []
  return ps.map((p) =>
    Array.isArray(p)
      ? p
          .filter((r): r is ManuscriptRun => !!r && typeof r === 'object' && typeof (r as ManuscriptRun).text === 'string')
          .map((r) => ({ text: r.text, ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}) }))
      : []
  )
}

/** Makes the story from the plan, all or nothing. */
export function importPlan(db: DB, plan: ImportPlan): ImportResult {
  const chapters = Array.isArray(plan?.chapters) ? plan.chapters : []
  if (!chapters.length) throw new UserError('There is nothing to import. Pick the file again.')
  const sceneTotal = chapters.reduce((n, c) => n + (Array.isArray(c?.scenes) ? c.scenes.length : 0), 0)
  if (sceneTotal > MOST_SCENES) throw new UserError('That is far more scenes than any book has. Check the split and try again.')
  const actPlans = Array.isArray(plan.acts) ? plan.acts : []

  return db.transaction((): ImportResult => {
    const replaced = plan.newWorld ? idb.clearEmptyFirstStory(db) : false
    const story = repo.createStory(db, { title: cleanTitle(plan.title, 'Imported story') })
    let firstSceneId: ID | null = null
    let words = 0
    let scenes = 0
    const chaptersOfAct = new Map<number, ID[]>()
    for (const [ci, c] of chapters.entries()) {
      const chapter = repo.createChapter(db, story.id, { title: cleanTitle(c?.title, `Chapter ${ci + 1}`) })
      const act = typeof c?.act === 'number' && Number.isInteger(c.act) && c.act >= 0 && c.act < actPlans.length ? c.act : null
      if (act != null) chaptersOfAct.set(act, [...(chaptersOfAct.get(act) ?? []), chapter.id])
      const list = Array.isArray(c?.scenes) && c.scenes.length ? c.scenes : [{ title: 'Scene 1', paragraphs: [] }]
      for (const [si, s] of list.entries()) {
        const scene = repo.createScene(db, chapter.id, { title: cleanTitle(s?.title, `Scene ${si + 1}`) })
        firstSceneId ??= scene.id
        scenes++
        const { doc, text } = sceneDoc(cleanParagraphs(s?.paragraphs))
        if (!text) continue
        words += repo.saveSceneText(db, scene.id, doc, text).wordCount
        idb.markImported(db, scene.id)
      }
    }
    // Acts, in order, each holding its chapters (chapters before the first act have none, and come first).
    let actCount = 0
    actPlans.forEach((a, i) => {
      const ids = chaptersOfAct.get(i)
      if (!ids?.length) return
      const made = acts.createAct(db, story.id, { title: cleanTitle(a?.title, `Act ${actCount + 1}`) })
      idb.setChapterAct(db, ids, made.id)
      actCount++
    })
    if (actCount) acts.keepActsTogether(db, story.id)
    // The world's first story may have changed: entries that exist from its start follow it.
    if (replaced || repo.listStories(db).length === 1) refreshDefaultExistsPoints(db)
    repo.touchWorld(db)
    return { storyId: story.id, sceneId: firstSceneId!, acts: actCount, chapters: chapters.length, scenes, words }
  })()
}
