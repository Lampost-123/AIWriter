// The latest critique of each scene and each chapter (contracts/critique.ts), kept in the world's `meta` under
// `critique:scene:<id>` and `critique:chapter:<id>` (one key each, like the chapter cards), so it goes with the world
// and reopening the tab costs no AI call. Each keeps a fingerprint of the words it read, so the tab can say when they
// have changed since. No Electron imports.

import type Database from 'better-sqlite3'
import type { Critique, CritiqueTarget, SavedCritique } from '@shared/contracts/critique'
import { CRITIQUE_CATEGORIES } from '@shared/contracts/critique'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import { hashText } from '../keeper/text'
import type { CritiqueText } from './parse'

type DB = Database.Database

export const critiqueKey = (t: CritiqueTarget): string => `critique:${t.scope}:${t.id}`

/**
 * The words a critique of the target reads, in reading order: the scene's, or each of the chapter's scenes' (with
 * their titles). Throws (plain words) when the scene or chapter no longer exists.
 */
export function targetTexts(db: DB, target: CritiqueTarget): (CritiqueText & { title: string })[] {
  if (target.scope === 'scene') {
    const scene = repo.getScene(db, target.id)
    return [{ sceneId: scene.id, title: scene.title, text: scene.text ?? '' }]
  }
  const chapter = repo.getChapter(db, target.id)
  return repo
    .getOutline(db, chapter.storyId)
    .scenes.filter((s) => s.chapterId === chapter.id)
    .map((s) => ({ sceneId: s.id, title: s.title, text: repo.getScene(db, s.id).text ?? '' }))
}

/** A fingerprint of the words: which scenes, in which order, and their text. */
export const textsHash = (texts: CritiqueText[]): string => hashText(JSON.stringify(texts.map((t) => [t.sceneId, t.text])))

const isCritique = (v: unknown): v is Critique => {
  const c = v as Critique
  return (
    !!c &&
    typeof c === 'object' &&
    (c.scope === 'scene' || c.scope === 'chapter') &&
    typeof c.summary === 'string' &&
    Array.isArray(c.strengths) &&
    Array.isArray(c.notes) &&
    typeof c.textHash === 'string'
  )
}

/** The critique kept for the target, or null (none, or one that can't be read). Notes of an unknown kind read as 'other'. */
export function loadCritique(db: DB, target: CritiqueTarget): Critique | null {
  try {
    const v = JSON.parse(repo.getMeta(db, critiqueKey(target)) ?? 'null') as unknown
    if (!isCritique(v)) return null
    return {
      ...v,
      notes: v.notes.map((n) => ({ ...n, category: CRITIQUE_CATEGORIES.includes(n.category) ? n.category : 'other' }))
    }
  } catch {
    return null
  }
}

/** Keeps the critique as the target's latest (replacing the one before). */
export function saveCritique(db: DB, critique: Critique): void {
  repo.setMeta(db, critiqueKey({ scope: critique.scope, id: critique.targetId }), JSON.stringify(critique))
}

/** The critique kept for the target and whether its words have changed since; null when there is none or it has gone. */
export function savedCritique(db: DB, target: CritiqueTarget): SavedCritique | null {
  const critique = loadCritique(db, target)
  if (!critique) return null
  let texts: CritiqueText[]
  try {
    texts = targetTexts(db, target)
  } catch {
    // The scene or chapter has been deleted.
    return null
  }
  return { critique, changed: textsHash(texts) !== critique.textHash }
}

/** For tests and the window: the target's id, checked. */
export function cleanTarget(v: unknown): CritiqueTarget | null {
  const t = v as { scope?: unknown; id?: unknown } | null
  if (!t || (t.scope !== 'scene' && t.scope !== 'chapter') || typeof t.id !== 'string' || !t.id) return null
  return { scope: t.scope, id: t.id as ID }
}
