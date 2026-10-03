// A story as a book, ready for the format writers (docx.ts, epub.ts, html.ts, plain.ts): its title,
// then its chapters in order, each with its heading and the words of its scenes, kept as paragraphs with
// their italics and bold, and scene breaks where one scene ends and the next begins (or where Adam put a
// break inside a scene). Read from the stored editor documents; a scene saved only as text (no document)
// is read from its text. Chapters and scenes in Recently deleted never come in, and nor do scenes with no
// words. No Electron imports.

import type Database from 'better-sqlite3'
import type { ID, Outline } from '@shared/types'
import type { ManuscriptScope } from '@shared/contracts/transfer'
import * as repo from '../db/repo'
import { UserError } from '../util'

type DB = Database.Database

/** A run of words with the same look. Line breaks inside a paragraph are '\n'. */
export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
}

export type Block =
  /** A paragraph; `quote` for one inside a block quote (a letter, a sign). */
  | { kind: 'para'; runs: Run[]; quote?: boolean }
  /** A scene break: shown as a centred ornament. */
  | { kind: 'break' }

export interface BookChapter {
  /** The chapter's number in the story (counting its live chapters from 1), even in a selection. */
  number: number
  /** "Chapter 3" */
  label: string
  /** Adam's own title when it says more than "Chapter 3"; '' otherwise. */
  title: string
  /** The chapter's words: paragraphs and scene breaks, never a break first or last, never two together. */
  blocks: Block[]
}

export interface Book {
  title: string
  chapters: BookChapter[]
}

// ---------- Reading a scene ----------

type Node = { type?: unknown; text?: unknown; marks?: unknown; content?: unknown; attrs?: unknown }

const kids = (n: Node): Node[] => (Array.isArray(n.content) ? (n.content as Node[]) : [])

function runsOf(p: Node): Run[] {
  const out: Run[] = []
  for (const c of kids(p)) {
    let text = ''
    if (c.type === 'text' && typeof c.text === 'string') text = c.text
    else if (c.type === 'hardBreak') text = '\n'
    else continue
    const marks = Array.isArray(c.marks) ? (c.marks as Node[]).map((m) => m.type) : []
    const run: Run = { text }
    if (marks.includes('bold')) run.bold = true
    if (marks.includes('italic')) run.italic = true
    const last = out[out.length - 1]
    // Neighbours with the same look become one run, so writers make fewer pieces.
    if (last && !!last.bold === !!run.bold && !!last.italic === !!run.italic) last.text += text
    else out.push(run)
  }
  return out
}

const hasWords = (runs: Run[]): boolean => runs.some((r) => r.text.trim())

/** The blocks of a stored editor document (paragraphs, block quotes, scene breaks), or null when it isn't one. */
export function docBlocks(doc: unknown): Block[] | null {
  if (!doc || typeof doc !== 'object' || (doc as Node).type !== 'doc') return null
  const out: Block[] = []
  const visit = (n: Node, quote: boolean): void => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      const runs = runsOf(n)
      if (hasWords(runs)) out.push(quote ? { kind: 'para', runs, quote: true } : { kind: 'para', runs })
    } else if (n.type === 'horizontalRule') {
      out.push({ kind: 'break' })
    } else if (n.type === 'blockquote') {
      for (const c of kids(n)) visit(c, true)
    } else {
      for (const c of kids(n)) visit(c, quote)
    }
  }
  for (const c of kids(doc as Node)) visit(c, false)
  return out
}

/** A line that is only a scene break as the plain text writes it: "* * *", "***", "#". */
const BREAK_LINE = /^\s*(?:\*\s*){3,}$|^\s*#\s*$|^\s*(?:-\s*){3,}$/

/** The blocks of a scene saved only as plain text: paragraphs between blank lines, "* * *" as a break. */
export function textBlocks(text: string): Block[] {
  const out: Block[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const t = raw.trim()
    if (!t) continue
    if (BREAK_LINE.test(t)) out.push({ kind: 'break' })
    else out.push({ kind: 'para', runs: [{ text: t }] })
  }
  return out
}

/** Takes away breaks at the ends and breaks next to each other. */
export function tidyBreaks(blocks: Block[]): Block[] {
  const out: Block[] = []
  for (const b of blocks) {
    if (b.kind === 'break' && (!out.length || out[out.length - 1].kind === 'break')) continue
    out.push(b)
  }
  while (out.length && out[out.length - 1].kind === 'break') out.pop()
  return out
}

// ---------- Chapter headings ----------

/** True for a title that only says the chapter's number ("Chapter 3", "Ch. 3", "3", ''). */
const PLAIN_TITLE = /^\s*(?:(?:chapter|ch\.?)\s*)?(?:\d+|[ivxlcdm]+)?\s*[.:]?\s*$/i

export function chapterHeading(number: number, title: string): { label: string; title: string } {
  const t = title.trim()
  return { label: `Chapter ${number}`, title: PLAIN_TITLE.test(t) ? '' : t }
}

// ---------- The book ----------

/** Which scenes of the outline go out, in order, by chapter. Throws in plain words when there are none. */
export function pickScenes(outline: Outline, scope: ManuscriptScope): { chapterId: ID; sceneIds: ID[] }[] {
  const chosen = scope.kind === 'selection' ? new Set(scope.sceneIds) : null
  if (scope.kind === 'chapter' && !outline.chapters.some((c) => c.id === scope.chapterId)) {
    throw new UserError('That chapter no longer exists. Pick another one, or export the whole story.')
  }
  const out: { chapterId: ID; sceneIds: ID[] }[] = []
  for (const c of outline.chapters) {
    if (scope.kind === 'chapter' && c.id !== scope.chapterId) continue
    const sceneIds = outline.scenes.filter((s) => s.chapterId === c.id && (!chosen || chosen.has(s.id))).map((s) => s.id)
    if (sceneIds.length || scope.kind !== 'selection') out.push({ chapterId: c.id, sceneIds })
  }
  return out
}

/**
 * The story (or the part of it asked for) as a book. Scenes follow one another with a scene break between
 * them; a chapter or scene with no words is left out. Throws in plain words when nothing has words.
 */
export function readBook(db: DB, storyId: ID, scope: ManuscriptScope, onScene?: (done: number, total: number) => void): Book {
  const outline = repo.getOutline(db, storyId)
  const picked = pickScenes(outline, scope)
  const numberOf = new Map(outline.chapters.map((c, i) => [c.id, i + 1]))
  const total = picked.reduce((n, p) => n + p.sceneIds.length, 0)
  const sceneRow = db.prepare('SELECT doc_json, text FROM scenes WHERE id = ? AND deleted_at IS NULL')
  let done = 0
  const chapters: BookChapter[] = []
  for (const p of picked) {
    const chapter = outline.chapters.find((c) => c.id === p.chapterId)!
    const blocks: Block[] = []
    for (const id of p.sceneIds) {
      const r = sceneRow.get(id) as { doc_json: string | null; text: string } | undefined
      onScene?.(++done, total)
      if (!r) continue
      let doc: unknown = null
      try {
        doc = r.doc_json ? JSON.parse(r.doc_json) : null
      } catch {
        doc = null
      }
      const scene = tidyBreaks(docBlocks(doc) ?? textBlocks(r.text ?? ''))
      if (!scene.length) continue
      if (blocks.length) blocks.push({ kind: 'break' })
      blocks.push(...scene)
    }
    if (!blocks.length) continue
    const number = numberOf.get(chapter.id) ?? chapters.length + 1
    chapters.push({ number, ...chapterHeading(number, chapter.title), blocks })
  }
  if (!chapters.length) {
    throw new UserError(
      scope.kind === 'story'
        ? 'This story has no words to export yet. Write a scene first, then export it.'
        : 'There are no words in what you picked. Pick chapters or scenes with writing in them.'
    )
  }
  return { title: outline.story.title.trim() || 'Untitled story', chapters }
}

/** The plain words of a paragraph's runs. */
export const runsText = (runs: Run[]): string => runs.map((r) => r.text).join('')
