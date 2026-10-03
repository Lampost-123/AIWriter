import { describe, expect, it } from 'vitest'
import type { Outline } from '@shared/types'
import { chapterLabel, chapterPicked, exportedText, progressText, scopeOf, toggleChapter, toggleScene } from './transferLogic'

const outline = {
  story: { id: 'b1', title: 'Book 1' },
  chapters: [
    { id: 'c1', title: 'Chapter 1' },
    { id: 'c2', title: 'The Ferry' },
    { id: 'c3', title: '' }
  ],
  scenes: [
    { id: 's1', chapterId: 'c1' },
    { id: 's2', chapterId: 'c1' },
    { id: 's3', chapterId: 'c2' }
  ]
} as unknown as Outline

describe('the export dialog', () => {
  it('names chapters by number, with their own titles', () => {
    expect(chapterLabel(outline, 'c1')).toBe('Chapter 1')
    expect(chapterLabel(outline, 'c2')).toBe('Chapter 2: The Ferry')
    expect(chapterLabel(outline, 'c3')).toBe('Chapter 3')
  })

  it('picks a chapter whole, or none of it, and says when only some is picked', () => {
    let picked = toggleChapter(outline, new Set(), 'c1')
    expect([...picked].sort()).toEqual(['s1', 's2'])
    expect(chapterPicked(outline, picked, 'c1')).toBe('all')
    picked = toggleScene(picked, 's2')
    expect(chapterPicked(outline, picked, 'c1')).toBe('some')
    picked = toggleChapter(outline, picked, 'c1')
    expect(chapterPicked(outline, picked, 'c1')).toBe('all')
    expect(chapterPicked(outline, toggleChapter(outline, picked, 'c1'), 'c1')).toBe('none')
    expect(chapterPicked(outline, picked, 'c3')).toBe('none')
  })

  it('exports what is chosen: every scene picked is the whole story, nothing picked is nothing', () => {
    expect(scopeOf(outline, 'story', null, new Set())).toEqual({ kind: 'story' })
    expect(scopeOf(outline, 'chapter', 'c2', new Set())).toEqual({ kind: 'chapter', chapterId: 'c2' })
    expect(scopeOf(outline, 'chapter', 'gone', new Set())).toBeNull()
    expect(scopeOf(outline, 'selection', null, new Set(['s3', 's1']))).toEqual({ kind: 'selection', sceneIds: ['s1', 's3'] })
    expect(scopeOf(outline, 'selection', null, new Set(['s1', 's2', 's3']))).toEqual({ kind: 'story' })
    expect(scopeOf(outline, 'selection', null, new Set())).toBeNull()
  })

  it('says how far along an export is, and what was saved', () => {
    expect(progressText('Packing the file', 0.456)).toBe('Packing the file… 46%')
    expect(progressText('Making the PDF', null)).toBe('Making the PDF…')
    expect(exportedText('Book 1.docx', null)).toBe('Exported ‘Book 1.docx’.')
    expect(exportedText('W.aiwrite', 'Its history was left out.')).toBe('Exported ‘W.aiwrite’. Its history was left out.')
  })
})
