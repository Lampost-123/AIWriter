// The export dialogs' logic (milestone 6, World files and export): the formats and their words, what a
// choice of chapters and scenes exports, and progress in plain words. Pure, so it is unit-tested.

import type { ID, Outline } from '@shared/types'
import type { BibleFormat, ManuscriptFormat, ManuscriptScope } from '@shared/contracts/transfer'

export const MANUSCRIPT_FORMATS: { value: ManuscriptFormat; label: string; hint: string }[] = [
  { value: 'docx', label: 'Word', hint: 'A Word document (.docx), to edit or send to an editor.' },
  { value: 'epub', label: 'EPUB', hint: 'An e-book (.epub), for e-readers and phones.' },
  { value: 'pdf', label: 'PDF', hint: 'A PDF laid out like a book, to read or print.' },
  { value: 'markdown', label: 'Markdown', hint: 'A Markdown file (.md), with italics and bold kept.' },
  { value: 'text', label: 'Plain text', hint: 'Just the words (.txt), with no formatting.' }
]

export const BIBLE_FORMATS: { value: BibleFormat; label: string; hint: string }[] = [
  { value: 'pdf', label: 'PDF', hint: 'A PDF to read or print.' },
  { value: 'markdown', label: 'Markdown', hint: 'A Markdown file (.md), to edit or paste elsewhere.' }
]

export type ScopeKind = ManuscriptScope['kind']

/** "Chapter 3: The Ferry", or "Chapter 3" when its title only says that. */
export function chapterLabel(outline: Outline, chapterId: ID): string {
  const i = outline.chapters.findIndex((c) => c.id === chapterId)
  if (i < 0) return ''
  const title = outline.chapters[i].title.trim()
  const plain = !title || /^(?:chapter|ch\.?)?\s*\d+\s*[.:]?$/i.test(title)
  return plain ? `Chapter ${i + 1}` : `Chapter ${i + 1}: ${title}`
}

export const scenesOf = (outline: Outline, chapterId: ID): ID[] => outline.scenes.filter((s) => s.chapterId === chapterId).map((s) => s.id)

/** Whether all, some or none of a chapter's scenes are picked. A chapter with no scenes counts as none. */
export function chapterPicked(outline: Outline, picked: ReadonlySet<ID>, chapterId: ID): 'all' | 'some' | 'none' {
  const ids = scenesOf(outline, chapterId)
  const n = ids.filter((id) => picked.has(id)).length
  return n === 0 ? 'none' : n === ids.length ? 'all' : 'some'
}

/** Picks every scene of a chapter, or (when they are all picked already) none of them. */
export function toggleChapter(outline: Outline, picked: ReadonlySet<ID>, chapterId: ID): Set<ID> {
  const next = new Set(picked)
  const ids = scenesOf(outline, chapterId)
  const all = chapterPicked(outline, picked, chapterId) === 'all'
  for (const id of ids) {
    if (all) next.delete(id)
    else next.add(id)
  }
  return next
}

export function toggleScene(picked: ReadonlySet<ID>, sceneId: ID): Set<ID> {
  const next = new Set(picked)
  if (next.has(sceneId)) next.delete(sceneId)
  else next.add(sceneId)
  return next
}

/** What the dialog's choice exports. Picking every scene is the whole story. Null when nothing is picked. */
export function scopeOf(outline: Outline, kind: ScopeKind, chapterId: ID | null, picked: ReadonlySet<ID>): ManuscriptScope | null {
  if (kind === 'story') return { kind: 'story' }
  if (kind === 'chapter') return chapterId && outline.chapters.some((c) => c.id === chapterId) ? { kind: 'chapter', chapterId } : null
  const sceneIds = outline.scenes.filter((s) => picked.has(s.id)).map((s) => s.id)
  if (!sceneIds.length) return null
  return sceneIds.length === outline.scenes.length ? { kind: 'story' } : { kind: 'selection', sceneIds }
}

/** "Packing the file… 45%", or "Making the PDF…" when how far along isn't known. */
export function progressText(step: string, fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return `${step}…`
  return `${step}… ${Math.max(0, Math.min(100, Math.round(fraction * 100)))}%`
}

/** "Exported ‘The Ferry.docx’." with any note after it. */
export function exportedText(fileName: string, note: string | null): string {
  return note ? `Exported ‘${fileName}’. ${note}` : `Exported ‘${fileName}’.`
}
