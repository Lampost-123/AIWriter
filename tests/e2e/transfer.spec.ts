// World files and export (milestone 6): a finished story exports to Word and EPUB cleanly (and to PDF), the
// series bible exports, and a world exported as one .aiwrite file comes back on import as a world of its own,
// with its scenes and their History. Make a copy does the same within the library.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type { ElectronApplication, Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const worldButton = (win: Page, name: string) => win.getByRole('banner').getByRole('button', { name, exact: true })
const exportDialog = (win: Page, name = 'Export story') => win.getByRole('dialog', { name })

/** The next save dialog answers with this file. */
async function saveAs(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as typeof dialog.showSaveDialog
  }, file)
}

async function openFile(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog
  }, file)
}

const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const t = (text: string, ...marks: string[]) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}) })

/** A short finished story: two scenes in Chapter 1 (one with italics and bold), and Chapter 2, "The Crossing". */
async function writeStory(win: Page): Promise<{ storyId: string; sceneId: string }> {
  const [story] = await invoke(win, 'listStories')
  const o = await invoke(win, 'getOutline', story.id)
  const [ch1] = o.chapters
  const s1 = o.scenes[0]
  await invoke(win, 'saveSceneText', s1.id, { type: 'doc', content: [p(t('The rain had '), t('not', 'italic'), t(' stopped.')), p(t('Mara waited.', 'bold'))] }, 'The rain had not stopped.\n\nMara waited.')
  const s2 = await invoke(win, 'createScene', ch1.id, { title: 'Second' })
  await invoke(win, 'saveSceneText', s2.id, { type: 'doc', content: [p(t('Tobin came late.'))] }, 'Tobin came late.')
  const ch2 = await invoke(win, 'createChapter', story.id, { title: 'The Crossing' })
  const s3 = await invoke(win, 'createScene', ch2.id, { title: 'Crossing' })
  await invoke(win, 'saveSceneText', s3.id, { type: 'doc', content: [p(t('The ferry left at dawn.'))] }, 'The ferry left at dawn.')
  await invoke(win, 'updateStory', story.id, { title: 'The Ferry' })
  // The window reads the new outline and title.
  await win.reload()
  await expect(binder(win).getByText('The Crossing')).toBeVisible()
  return { storyId: story.id, sceneId: s1.id }
}

test('a finished story exports to Word and EPUB cleanly, and to PDF; the series bible exports too', async ({ launch }) => {
  const { app, win, dataDir } = await launch()
  await createWorldFromWelcome(win, 'Reach')
  await writeStory(win)

  // From the story menu in the binder: the whole story, as Word (the first choice).
  const docx = join(dataDir, 'The Ferry.docx')
  await saveAs(app, docx)
  await binder(win).locator('[data-story-menu]').click()
  await win.getByRole('menuitem', { name: 'Export story…' }).click()
  const dialog = exportDialog(win)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio', { name: 'Whole story' })).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByRole('radio', { name: 'Word' })).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('button', { name: 'Export…' }).click()
  await expect(dialog).toBeHidden()
  await expect(toasts(win).getByText('Exported ‘The Ferry.docx’.')).toBeVisible()
  await expect(toasts(win).getByRole('button', { name: 'Show in folder' })).toBeVisible()

  const word = unzipSync(readFileSync(docx))
  const document = strFromU8(word['word/document.xml'])
  expect(document).toContain('The Ferry</w:t>')
  expect(document).toContain('<w:i/></w:rPr><w:t xml:space="preserve">not</w:t>')
  expect(document).toContain('<w:b/></w:rPr><w:t xml:space="preserve">Mara waited.</w:t>')
  expect(document).toContain('Tobin came late.')
  expect(document).toContain('<w:pStyle w:val="SceneBreak"/>')
  expect(document).toContain('The Crossing</w:t>')
  expect(strFromU8(word['word/styles.xml'])).toContain('Georgia')

  // From the palette: EPUB.
  const epub = join(dataDir, 'The Ferry.epub')
  await saveAs(app, epub)
  await win.keyboard.press('Control+K')
  await win.getByRole('combobox', { name: 'Search, or find an action' }).fill('export story')
  await expect(win.getByRole('dialog', { name: 'Search' }).getByRole('option', { name: 'Export story' })).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: 'EPUB' }).click()
  await dialog.getByRole('button', { name: 'Export…' }).click()
  await expect(toasts(win).getByText('Exported ‘The Ferry.epub’.')).toBeVisible()
  const raw = readFileSync(epub)
  expect(raw.subarray(30, 58).toString('latin1')).toBe('mimetypeapplication/epub+zip')
  const book = unzipSync(raw)
  expect(strFromU8(book['META-INF/container.xml'])).toContain('OEBPS/content.opf')
  expect(strFromU8(book['OEBPS/content.opf'])).toContain('<dc:title>The Ferry</dc:title>')
  expect(strFromU8(book['OEBPS/nav.xhtml'])).toContain('Chapter 2: The Crossing')
  expect(strFromU8(book['OEBPS/chapter-001.xhtml'])).toContain('The rain had <em>not</em> stopped.')
  expect(strFromU8(book['OEBPS/chapter-002.xhtml'])).toContain('The ferry left at dawn.')

  // One chapter, as a PDF (the format picked last time is remembered).
  const pdf = join(dataDir, 'Chapter 2.pdf')
  await saveAs(app, pdf)
  await binder(win).locator('[data-story-menu]').click()
  await win.getByRole('menuitem', { name: 'Export story…' }).click()
  await expect(dialog.getByRole('radio', { name: 'EPUB' })).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('radio', { name: 'One chapter' }).click()
  await dialog.getByLabel('Chapter').click()
  await win.getByRole('option', { name: 'Chapter 2: The Crossing' }).click()
  await dialog.getByRole('radio', { name: 'PDF' }).click()
  await dialog.getByRole('button', { name: 'Export…' }).click()
  await expect(toasts(win).getByText('Exported ‘Chapter 2.pdf’.')).toBeVisible()
  expect(readFileSync(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-')

  // The series bible, as Markdown.
  await invoke(win, 'createEntry', 'character', { name: 'Mara Venn', summary: 'A ferrywoman.', fields: { eyes: 'grey' } })
  const md = join(dataDir, 'bible.md')
  await saveAs(app, md)
  await binder(win).locator('[data-story-menu]').click()
  await win.getByRole('menuitem', { name: 'Export series bible…' }).click()
  const bibleDialog = exportDialog(win, 'Export series bible')
  await bibleDialog.getByRole('radio', { name: 'Markdown' }).click()
  await bibleDialog.getByRole('button', { name: 'Export…' }).click()
  await expect(toasts(win).getByText('Exported ‘bible.md’.')).toBeVisible()
  const bible = readFileSync(md, 'utf8')
  expect(bible).toContain('# Reach: series bible')
  expect(bible).toContain('### Mara Venn')
  expect(bible).toContain('- **Eyes:** grey')
})

test('a world exported to a file and imported again is a world of its own, with its scenes and their History; Make a copy too', async ({
  launch
}) => {
  const { app, win, dataDir } = await launch()
  await createWorldFromWelcome(win, 'Reach')
  const original = (await invoke(win, 'getWorld'))!

  // Writing, then Mark done: History keeps a version.
  await win.locator('.scene-prose').click()
  await win.keyboard.type('The rain had not stopped since dawn.')
  const [story] = await invoke(win, 'listStories')
  const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
  await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text).toBe('The rain had not stopped since dawn.')
  await win.keyboard.press('Control+Enter')
  await expect(toasts(win).getByText('Scene marked done.')).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'listSnapshots', sceneId)).snapshots.map((s) => s.label)).toContain('Marked done')

  // Export world… from the world menu.
  const file = join(dataDir, 'Reach.aiwrite')
  await saveAs(app, file)
  await worldButton(win, 'Reach').click()
  await win.getByRole('menuitem', { name: 'Export world…' }).click()
  await expect(toasts(win).getByText('Exported ‘Reach.aiwrite’.')).toBeVisible()
  expect(Object.keys(unzipSync(readFileSync(file)))).toEqual(['manifest.json', 'world.db', 'history.db'])

  // Import a world file…: it opens straight away, named so it can be told from the one already here.
  await openFile(app, file)
  await worldButton(win, 'Reach').click()
  await win.getByRole('menuitem', { name: 'Import a world file…' }).click()
  await expect(worldButton(win, 'Reach (imported)')).toBeVisible()
  await expect(toasts(win).getByText('Imported ‘Reach (imported)’. It\'s open now.')).toBeVisible()
  const imported = (await invoke(win, 'getWorld'))!
  expect(imported.id).not.toBe(original.id)
  expect(imported.folder).not.toBe(original.folder)
  await expect(win.locator('.scene-prose')).toContainText('The rain had not stopped since dawn.')
  expect((await invoke(win, 'listSnapshots', sceneId)).snapshots.map((s) => s.label)).toContain('Marked done')
  // Its scene has the same id as the one on screen before: the page is loaded from the imported world, so it
  // shows its word count and what is typed is saved there.
  await expect(win.getByRole('banner')).toContainText('7 words')
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+End')
  await win.keyboard.type(' Then it stopped.')
  await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text).toBe('The rain had not stopped since dawn. Then it stopped.')
  // History shows the version it came with.
  await win.locator('main header').getByRole('button', { name: 'History of this scene', exact: true }).click()
  await expect(win.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
  await expect(win.getByRole('navigation', { name: 'Earlier versions' }).getByRole('button', { name: /Marked done/ })).toBeVisible()
  await win.getByRole('button', { name: /^Back to/ }).click()

  // Make a copy: a third world, not opened.
  await worldButton(win, 'Reach (imported)').click()
  await win.getByRole('menuitem', { name: 'Make a copy' }).click()
  await expect(toasts(win).getByText('Made a copy: ‘Reach (imported) (copy)’.')).toBeVisible()
  const worlds = await invoke(win, 'listWorlds')
  expect(worlds.map((w) => w.name).sort()).toEqual(['Reach', 'Reach (imported)', 'Reach (imported) (copy)'])
  expect(new Set(worlds.map((w) => w.id)).size).toBe(3)
  await expect(worldButton(win, 'Reach (imported)')).toBeVisible()

  // A file that isn't a world is refused in plain words.
  const notes = join(dataDir, 'notes.aiwrite')
  writeFileSync(notes, 'just notes')
  await openFile(app, notes)
  await worldButton(win, 'Reach (imported)').click()
  await win.getByRole('menuitem', { name: 'Import a world file…' }).click()
  await expect(toasts(win).getByText(/This file isn't an AI Write world file/)).toBeVisible()
  expect(await invoke(win, 'listWorlds')).toHaveLength(3)
})
