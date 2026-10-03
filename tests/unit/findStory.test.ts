// Find and replace across a story (Writing by hand): finding by scene, replacing the ticked matches in the stored
// documents (formatting and paragraph ids kept, a History snapshot first, saved the way a normal save is), the
// open scene's change handed back for the editor, renaming an entry, and one Undo for all of it.
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { DocNode } from '@shared/findReplace'
import type { PageForFind, StoryFindInput } from '@shared/contracts/find'
import type { ID } from '@shared/types'
import * as repo from '../../src/main/db/repo'
import { markSceneDone } from '../../src/main/db/keeper'
import { findInStory, replaceInStory, undoReplaceInStory, type StoryFindDeps } from '../../src/main/find/story'
import { memoryWorld } from './helpers'

const t = (text: string, ...marks: string[]): DocNode => (marks.length ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text })
const p = (pid: string, ...content: DocNode[]): DocNode => ({ type: 'paragraph', attrs: { pid }, content })
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content })
const plain = (d: DocNode): string => (d.content ?? []).map((x) => (x.content ?? []).map((c) => c.text ?? '').join('')).join('\n\n')

interface World {
  db: Database.Database
  storyId: ID
  scenes: ID[]
  snapshots: { sceneId: ID; text: string }[]
  saves: ID[]
  drafting: Set<ID>
  deps: StoryFindDeps
}

/** A story of two chapters: Ch 1 with two scenes, Ch 2 with one. Invented text throughout. */
function makeWorld(): World {
  const db = memoryWorld()
  const storyId = repo.listStories(db)[0].id
  const outline = repo.getOutline(db, storyId)
  const ch1 = outline.chapters[0].id
  const s1 = outline.scenes[0].id
  repo.updateScene(db, s1, { title: 'The ford' })
  const s2 = repo.createScene(db, ch1, { title: 'Night camp' }).id
  const ch2 = repo.createChapter(db, storyId, { title: 'The hills' }).id
  const s3 = repo.createScene(db, ch2, { title: 'Morning' }).id
  const save = (id: ID, d: DocNode): void => void repo.saveSceneText(db, id, d, plain(d))
  save(s1, doc(p('a1', t('Mara crossed the ford. '), t('Ma', 'bold'), t('ra', 'italic'), t(' did not look back.')), p('a2', t('The water was cold.'))))
  save(s2, doc(p('b1', t('At night Mara’s fire burned low. Tamara slept.'))))
  save(s3, doc(p('c1', t('No one spoke at dawn.'))))
  const w: World = { db, storyId, scenes: [s1, s2, s3], snapshots: [], saves: [], drafting: new Set(), deps: null as unknown as StoryFindDeps }
  w.deps = {
    snapshot: (sceneId, _doc, text) => void w.snapshots.push({ sceneId, text }),
    save: (sceneId, d, text) => {
      w.saves.push(sceneId)
      repo.saveSceneText(db, sceneId, d, text)
    },
    updateEntry: (id, patch) => void repo.updateEntry(db, id, patch),
    drafting: (id) => w.drafting.has(id)
  }
  return w
}

const find = (w: World, query: string, extra: Partial<StoryFindInput> = {}): StoryFindInput => ({
  storyId: w.storyId,
  query,
  matchCase: false,
  wholeWord: true,
  page: null,
  ...extra
})

/** Every listed match ticked. */
function allPicks(w: World, input: StoryFindInput): { sceneId: ID; matchIds: string[] }[] {
  return findInStory(w.db, input).scenes.map((s) => ({ sceneId: s.sceneId, matchIds: s.matches.map((m) => m.id) }))
}

let w: World
beforeEach(() => {
  w = makeWorld()
})

describe('finding across the story', () => {
  it('lists matches by scene in reading order, with chapter and scene numbers and words around them', () => {
    const r = findInStory(w.db, find(w, 'mara'))
    expect(r.total).toBe(3)
    expect(r.scenes.map((s) => [s.sceneTitle, s.chapterNumber, s.sceneNumber, s.matches.length])).toEqual([
      ['The ford', 1, 1, 2],
      ['Night camp', 1, 2, 1]
    ])
    expect(r.scenes[1].matches[0]).toMatchObject({ before: 'At night ', text: 'Mara', after: '’s fire burned low. Tamara slept.' })
    // Whole word off: Tamara counts too.
    expect(findInStory(w.db, find(w, 'mara', { wholeWord: false })).total).toBe(4)
    expect(findInStory(w.db, find(w, '  ')).total).toBe(0)
  })

  it('reads the open scene as the page shows it, and leaves out matches inside an AI suggestion there', () => {
    const page: PageForFind = { sceneId: w.scenes[2], doc: doc(p('c1', t('Mara spoke at dawn, and Mara laughed.'))), text: 'x', keep: [{ from: 1, to: 6 }] }
    const r = findInStory(w.db, find(w, 'mara', { page }))
    expect(r.total).toBe(4)
    expect(r.heldBack).toBe(1)
    expect(r.scenes[2].matches).toHaveLength(1)
  })

  it('offers to rename an entry whose name is the words found', () => {
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara', aliases: ['Little Mara'] })
    expect(findInStory(w.db, find(w, ' MARA ')).rename).toEqual({ entryId: mara.id, kind: 'character', name: 'Mara' })
    expect(findInStory(w.db, find(w, 'Mar')).rename).toBeNull()
  })
})

describe('replacing across the story, and Undo', () => {
  it('changes the stored scenes with a snapshot first, keeping formatting and paragraph ids, and Undo puts them back', () => {
    const before = w.scenes.map((id) => repo.getScene(w.db, id))
    const input = find(w, 'mara')
    const res = replaceInStory(w.db, { ...input, replacement: 'Maren', picks: allPicks(w, input), rename: null }, w.deps)
    expect(res).toMatchObject({ replaced: 3, scenes: 2, skipped: [], page: null, renamed: null })
    expect(w.snapshots.map((s) => s.sceneId)).toEqual([w.scenes[0], w.scenes[1]])
    expect(w.snapshots[0].text).toBe(before[0].text)
    const s1 = repo.getScene(w.db, w.scenes[0])
    expect(s1.text).toBe('Maren crossed the ford. Maren did not look back.\n\nThe water was cold.')
    expect(s1.doc).toEqual(doc(p('a1', t('Maren crossed the ford. '), t('Maren', 'bold'), t(' did not look back.')), p('a2', t('The water was cold.'))))
    expect(repo.getScene(w.db, w.scenes[1]).text).toBe('At night Maren’s fire burned low. Tamara slept.')
    expect(s1.wordCount).toBe(before[0].wordCount)

    const undone = undoReplaceInStory(w.db, res.token!, null, w.deps)
    expect(undone).toMatchObject({ scenes: 2, skipped: [], page: null, rename: null })
    for (const [i, id] of w.scenes.entries()) {
      const now = repo.getScene(w.db, id)
      expect(now.text).toBe(before[i].text)
      expect(now.doc).toEqual(before[i].doc)
    }
    // An Undo is used once.
    expect(() => undoReplaceInStory(w.db, res.token!, null, w.deps)).toThrow(/can’t be undone/)
  })

  it('replaces only the ticked matches', () => {
    const input = find(w, 'mara')
    const r = findInStory(w.db, input)
    const picks = [{ sceneId: r.scenes[0].sceneId, matchIds: [r.scenes[0].matches[1].id] }]
    const res = replaceInStory(w.db, { ...input, replacement: 'she', picks, rename: null }, w.deps)
    expect(res.replaced).toBe(1)
    expect(repo.getScene(w.db, w.scenes[0]).text).toBe('Mara crossed the ford. she did not look back.\n\nThe water was cold.')
    expect(repo.getScene(w.db, w.scenes[1]).text).toContain('Mara’s')
  })

  it('keeps a scene marked done as done', () => {
    markSceneDone(w.db, w.scenes[1])
    const input = find(w, 'mara')
    replaceInStory(w.db, { ...input, replacement: 'Maren', picks: allPicks(w, input), rename: null }, w.deps)
    expect(repo.getSceneMeta(w.db, w.scenes[1]).status).toBe('done')
  })

  it('leaves a scene a draft is being written into, and says so', () => {
    w.drafting.add(w.scenes[1])
    const input = find(w, 'mara')
    const res = replaceInStory(w.db, { ...input, replacement: 'Maren', picks: allPicks(w, input), rename: null }, w.deps)
    expect(res.skipped).toEqual([{ sceneId: w.scenes[1], title: 'Night camp' }])
    expect(res.scenes).toBe(1)
  })

  it('Undo skips a scene changed again since, and says which', () => {
    const input = find(w, 'mara')
    const res = replaceInStory(w.db, { ...input, replacement: 'Maren', picks: allPicks(w, input), rename: null }, w.deps)
    repo.saveSceneText(w.db, w.scenes[1], doc(p('b1', t('Rewritten by hand.'))), 'Rewritten by hand.')
    const undone = undoReplaceInStory(w.db, res.token!, null, w.deps)
    expect(undone.scenes).toBe(1)
    expect(undone.skipped).toEqual([{ sceneId: w.scenes[1], title: 'Night camp' }])
    expect(repo.getScene(w.db, w.scenes[1]).text).toBe('Rewritten by hand.')
    expect(repo.getScene(w.db, w.scenes[0]).text.startsWith('Mara crossed')).toBe(true)
  })

  it('hands the open scene’s change back for the editor, never writing it, and Undo does the same', () => {
    const shown = doc(p('a1', t('Mara crossed the ford, typing not yet saved.')))
    const page: PageForFind = { sceneId: w.scenes[0], doc: shown, text: 'Mara crossed the ford, typing not yet saved.' }
    const input = find(w, 'mara', { page })
    const res = replaceInStory(w.db, { ...input, replacement: 'Maren', picks: allPicks(w, input), rename: null }, w.deps)
    expect(res.replaced).toBe(2)
    expect(w.saves).toEqual([w.scenes[1]])
    expect(w.snapshots[0]).toEqual({ sceneId: w.scenes[0], text: page.text })
    expect(res.page).toEqual({
      sceneId: w.scenes[0],
      doc: doc(p('a1', t('Maren crossed the ford, typing not yet saved.'))),
      ranges: [{ from: 1, to: 5, newFrom: 1, newTo: 6 }]
    })
    // The page now shows the change (written down a little differently): Undo hands back the way to put it back.
    const after: PageForFind = { sceneId: w.scenes[0], doc: doc(p('a1', t('Maren crossed the ford, '), t('typing not yet saved.'))), text: 'Maren crossed the ford, typing not yet saved.' }
    const undone = undoReplaceInStory(w.db, res.token!, after, w.deps)
    expect(undone.scenes).toBe(2)
    expect(undone.page).toEqual({ sceneId: w.scenes[0], doc: shown, ranges: [{ from: 1, to: 6, newFrom: 1, newTo: 5 }] })
    expect(repo.getScene(w.db, w.scenes[1]).text).toContain('Mara’s')
  })

  it('Undo leaves the open scene when an empty paragraph went in since, so no words land in the wrong place', () => {
    const shown = doc(p('a1', t('Mara walked.')))
    const page: PageForFind = { sceneId: w.scenes[0], doc: shown, text: 'Mara walked.' }
    const input = find(w, 'mara', { page })
    const res = replaceInStory(w.db, { ...input, replacement: 'Kell', picks: allPicks(w, input), rename: null }, w.deps)
    expect(res.page?.ranges).toEqual([{ from: 1, to: 5, newFrom: 1, newTo: 5 }])
    // Enter at the very start of the scene: the same words, one empty paragraph ahead of them.
    const moved: PageForFind = { sceneId: w.scenes[0], doc: doc(p('n1'), p('a1', t('Kell walked.'))), text: 'Kell walked.' }
    const undone = undoReplaceInStory(w.db, res.token!, moved, w.deps)
    expect(undone.page).toBeNull()
    expect(undone.skipped).toEqual([{ sceneId: w.scenes[0], title: 'The ford' }])
    expect(undone.scenes).toBe(1)
  })

  it('Undo never takes away an empty paragraph added to a stored scene since', () => {
    const input = find(w, 'mara')
    const res = replaceInStory(w.db, { ...input, replacement: 'Maren', picks: allPicks(w, input), rename: null }, w.deps)
    const s2 = repo.getScene(w.db, w.scenes[1])
    const withGap = { ...(s2.doc as DocNode), content: [p('gap'), ...((s2.doc as DocNode).content ?? [])] }
    repo.saveSceneText(w.db, w.scenes[1], withGap, s2.text)
    const undone = undoReplaceInStory(w.db, res.token!, null, w.deps)
    expect(undone.skipped).toEqual([{ sceneId: w.scenes[1], title: 'Night camp' }])
    expect(repo.getScene(w.db, w.scenes[1]).doc).toEqual(withGap)
    // The scene left alone goes back.
    expect(repo.getScene(w.db, w.scenes[0]).text.startsWith('Mara crossed')).toBe(true)
  })

  it('renames the entry, keeping the old name as another name, and Undo puts the name and other names back', () => {
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara', aliases: ['Maren', 'Little Mara'] })
    const input = find(w, 'mara')
    const res = replaceInStory(
      w.db,
      { ...input, replacement: ' Maren ', picks: allPicks(w, input), rename: { entryId: mara.id, name: 'Mara' } },
      w.deps
    )
    expect(res.renamed).toEqual({ entryId: mara.id, from: 'Mara', to: 'Maren' })
    expect(repo.getEntry(w.db, mara.id)).toMatchObject({ name: 'Maren', aliases: ['Little Mara', 'Mara'] })
    const undone = undoReplaceInStory(w.db, res.token!, null, w.deps)
    expect(undone.rename).toBe('undone')
    expect(repo.getEntry(w.db, mara.id)).toMatchObject({ name: 'Mara', aliases: ['Maren', 'Little Mara'] })
  })

  it('leaves the name when the entry was changed again since', () => {
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara' })
    const input = find(w, 'mara')
    const res = replaceInStory(w.db, { ...input, replacement: 'Maren', picks: [], rename: { entryId: mara.id, name: 'Mara' } }, w.deps)
    expect(res.replaced).toBe(0)
    repo.updateEntry(w.db, mara.id, { name: 'Marenka' })
    expect(undoReplaceInStory(w.db, res.token!, null, w.deps).rename).toBe('changed')
    expect(repo.getEntry(w.db, mara.id).name).toBe('Marenka')
  })

  it('changes a scene kept only as text in its text', () => {
    w.db.prepare('UPDATE scenes SET doc_json = NULL, text = ? WHERE id = ?').run('Mara waited.\n\nThen Mara left.', w.scenes[2])
    const input = find(w, 'mara')
    const res = replaceInStory(w.db, { ...input, replacement: 'Maren', picks: allPicks(w, input), rename: null }, w.deps)
    expect(res.replaced).toBe(5)
    expect(repo.getScene(w.db, w.scenes[2])).toMatchObject({ doc: null, text: 'Maren waited.\n\nThen Maren left.' })
    undoReplaceInStory(w.db, res.token!, null, w.deps)
    expect(repo.getScene(w.db, w.scenes[2]).text).toBe('Mara waited.\n\nThen Mara left.')
  })
})
