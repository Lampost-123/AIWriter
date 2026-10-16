// The latest critique of each scene and each chapter (contracts/critique.ts), kept in the world's `meta` under
// `critique:scene:<id>` and `critique:chapter:<id>` (one key each, like the chapter cards), so it goes with the world
// and reopening the tab costs no AI call. Each keeps a fingerprint of the words it read, so the tab can say when they
// have changed since, and what Adam did about each note (done, not needed, not for this story; memory.ts keeps what
// is told to the critic). They go with their scene or chapter in purgeTrash. No Electron imports.

import type Database from 'better-sqlite3'
import type { Critique, CritiqueNote, CritiqueNoteChange, CritiqueNoteStatus, CritiqueTarget, CritiqueWant, SavedCritique } from '@shared/contracts/critique'
import { CRITIQUE_CATEGORIES } from '@shared/contracts/critique'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import { hashText } from '../keeper/text'
import { findSceneQuote } from '../checks/quote'
import { newId, now } from '../util'
import { addWant, loadWants, saveWants, storyOfTarget, withoutNote } from './memory'
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

const STATUSES: readonly CritiqueNoteStatus[] = ['done', 'dismissed', 'unwanted']

/** A kept note made safe: a known kind (else 'other'), and only a known status. */
function cleanNote(n: CritiqueNote): CritiqueNote {
  const { status, newWords, repeated, ...rest } = n
  return {
    ...rest,
    category: CRITIQUE_CATEGORIES.includes(n.category) ? n.category : 'other',
    ...(status && STATUSES.includes(status) ? { status } : {}),
    ...(typeof newWords === 'string' && newWords.trim() ? { newWords } : {}),
    ...(repeated === true ? { repeated } : {})
  }
}

const isNote = (n: unknown): n is CritiqueNote => {
  const x = n as CritiqueNote
  return !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.quote === 'string' && typeof x.suggestion === 'string'
}

/** The critique kept for the target, or null (none, or one that can't be read). Notes of an unknown kind read as 'other'. */
export function loadCritique(db: DB, target: CritiqueTarget): Critique | null {
  try {
    const v = JSON.parse(repo.getMeta(db, critiqueKey(target)) ?? 'null') as unknown
    if (!isCritique(v)) return null
    const { earlier, settledSince, ...rest } = v
    return {
      ...rest,
      notes: v.notes.filter(isNote).map(cleanNote),
      ...(Array.isArray(earlier) && earlier.some(isNote) ? { earlier: earlier.filter(isNote).map(cleanNote) } : {}),
      ...(typeof settledSince === 'number' && settledSince > 0 ? { settledSince } : {})
    }
  } catch {
    return null
  }
}

/** Keeps the critique as the target's latest (replacing the one before). */
export function saveCritique(db: DB, critique: Critique): void {
  repo.setMeta(db, critiqueKey({ scope: critique.scope, id: critique.targetId }), JSON.stringify(critique))
}

/** The notes still to do whose words are no longer in their scene (one of the target's scenes), by id. */
export function goneNotes(notes: CritiqueNote[], texts: CritiqueText[]): string[] {
  const byScene = new Map(texts.map((t) => [t.sceneId, t.text]))
  return notes
    .filter((n) => !n.status && n.quote.trim() && n.sceneId)
    .filter((n) => {
      const text = byScene.get(n.sceneId as ID)
      return text === undefined || !findSceneQuote(text, n.quote)
    })
    .map((n) => n.id)
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
  const storyId = storyOfTarget(db, target)
  return {
    critique,
    changed: textsHash(texts) !== critique.textHash,
    gone: goneNotes(critique.notes, texts),
    wants: storyId ? loadWants(db, storyId) : []
  }
}

/**
 * Adam acting on a note: done (an accepted rewrite, with the words it put in), not needed, or not for this story (which
 * the story keeps too, for every later critique of it); null brings it back as still to do, and takes back what was said
 * for the story on it. Returns the critique as kept now; null when it (or the note) has gone.
 */
export function settleNote(db: DB, change: CritiqueNoteChange): SavedCritique | null {
  const critique = loadCritique(db, change.target)
  const note = critique?.notes.find((n) => n.id === change.noteId)
  if (!critique || !note) return null
  // A note of a critique written again since (a rewrite accepted after Critique again): that one is left as it is.
  if (change.at && change.at !== critique.at) return savedCritique(db, change.target)
  const status = change.status && STATUSES.includes(change.status) ? change.status : null
  const storyId = storyOfTarget(db, change.target)
  const from = { scope: change.target.scope, targetId: change.target.id, noteId: note.id }
  if (storyId && (note.status === 'unwanted' || status === 'unwanted')) {
    let wants = withoutNote(loadWants(db, storyId), from)
    if (status === 'unwanted') wants = addWant(wants, note, from, now(), newId())
    saveWants(db, storyId, wants)
  }
  const words = typeof change.newWords === 'string' ? change.newWords.replace(/\s+/g, ' ').trim().slice(0, 1200) : ''
  const { status: _was, newWords: _words, ...rest } = note
  const next: CritiqueNote = { ...rest, ...(status ? { status } : {}), ...(status === 'done' && words ? { newWords: words } : {}) }
  saveCritique(db, { ...critique, notes: critique.notes.map((n) => (n.id === note.id ? next : n)) })
  return savedCritique(db, change.target)
}

/**
 * Lets the critic raise a kind of note again that Adam said isn't for this story; the note it was said on, if its
 * critique still holds it, is still to do again. Returns what is left for the story.
 */
export function dropWant(db: DB, target: CritiqueTarget, wantId: string): CritiqueWant[] {
  const storyId = storyOfTarget(db, target)
  if (!storyId) return []
  const wants = loadWants(db, storyId)
  const want = wants.find((w) => w.id === wantId)
  const left = wants.filter((w) => w.id !== wantId)
  saveWants(db, storyId, left)
  if (want?.from) {
    const at: CritiqueTarget = { scope: want.from.scope, id: want.from.targetId }
    const critique = loadCritique(db, at)
    const note = critique?.notes.find((n) => n.id === want.from?.noteId && n.status === 'unwanted')
    if (critique && note) {
      const { status: _was, ...rest } = note
      saveCritique(db, { ...critique, notes: critique.notes.map((n) => (n.id === note.id ? rest : n)) })
    }
  }
  return left
}

/** For tests and the window: the target's id, checked. */
export function cleanTarget(v: unknown): CritiqueTarget | null {
  const t = v as { scope?: unknown; id?: unknown } | null
  if (!t || (t.scope !== 'scene' && t.scope !== 'chapter') || typeof t.id !== 'string' || !t.id) return null
  return { scope: t.scope, id: t.id as ID }
}
