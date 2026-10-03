// Importing a manuscript (milestone 6), end to end: a small Word file read and split into chapters and scenes,
// the split adjusted once, imported into the open world, the import catch-up building the memory with the fake
// AI server (its memory replies read "<Name>'s eyes were <colour>." sentences), and an import undone.
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import type { Entry } from '@shared/types'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test } from './helpers'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const para = (text: string, style?: string): string =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`

/** A small Word manuscript: a title, three chapters (the first with a scene break), names the memory can find. */
function manuscript(): Uint8Array {
  const body = [
    para('The Ferry', 'Title'),
    para('Chapter One', 'Heading1'),
    para("Mara's eyes were green."),
    para('She waited at the dock until the ferry came in.'),
    para('* * *'),
    para("Tobin's eyes were grey."),
    para('Chapter Two', 'Heading1'),
    para('The crossing took all night.'),
    para('Chapter Three', 'Heading1'),
    para("Kell's eyes were brown."),
    para('Morning found them on the far shore.')
  ].join('')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`
  return zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(document), 'word/styles.xml': strToU8(styles) })
}

/** The file dialog answers with this file, as if Adam had picked it. */
async function pickFile(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, path)
}

const main = (win: Page) => win.locator('main')
const chapterCard = (win: Page, title: string) => main(win).getByRole('region', { name: `Chapter: ${title}` })
const entries = (win: Page): Promise<Entry[]> => invoke(win, 'listEntries')

async function openImport(win: Page, storyTitle: string): Promise<void> {
  await binder(win).getByRole('button', { name: storyTitle, exact: true }).click()
  await win.getByRole('menuitem', { name: 'Import a manuscript…' }).click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Import a manuscript' })).toBeVisible()
}

test('a Word manuscript imports, splits correctly and builds the memory; an import can be undone', async ({ launch }) => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'aiwrite-import-'))
  const file = join(dir, 'The Ferry.docx')
  writeFileSync(file, manuscript())
  const fake = await startFake()
  try {
    const { app, win } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    const writer = { providerId: p.id, modelId: 'fake/writer', label: 'Fake writer', contextLength: 32000, promptPrice: 0.000003, completionPrice: 0.000015 }
    await invoke(win, 'updateSettings', { models: { writer } })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await pickFile(app, file)

    // The split as found: three chapters, the first in two scenes.
    await openImport(win, 'Book 1')
    await expect(main(win).getByRole('textbox', { name: 'Story title' })).toHaveValue('The Ferry')
    await expect(main(win).getByText('3 chapters, 4 scenes').first()).toBeVisible()
    await expect(chapterCard(win, 'Chapter One').getByRole('listitem')).toHaveCount(2)
    await expect(chapterCard(win, 'Chapter One').getByText("Mara's eyes were green.", { exact: false })).toBeVisible()

    // Adjusted once: Chapter Three goes into Chapter Two as a scene.
    await chapterCard(win, 'Chapter Three').getByRole('button', { name: 'Merge with the chapter before' }).click()
    await expect(chapterCard(win, 'Chapter Three')).toHaveCount(0)
    await expect(chapterCard(win, 'Chapter Two').getByRole('listitem')).toHaveCount(2)
    await expect(main(win).getByText('2 chapters, 4 scenes').first()).toBeVisible()
    await main(win).getByRole('textbox', { name: 'Story title' }).fill('The Ferry Crossing')

    // One click imports it as a new story; the binder shows its chapters and scenes.
    await main(win).getByRole('button', { name: 'Import', exact: true }).click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'Imported' })).toBeVisible()
    await expect(main(win).getByText('“The Ferry Crossing” is in your world: 2 chapters, 4 scenes', { exact: false })).toBeVisible()
    await expect(win.getByText('Imported “The Ferry Crossing”: 2 chapters, 4 scenes.')).toBeVisible()
    await expect(binder(win).getByRole('button', { name: 'The Ferry Crossing', exact: true })).toBeVisible()
    await expect(binder(win).getByText('Chapter One')).toBeVisible()
    await expect(binder(win).getByText('Chapter Two')).toBeVisible()
    await expect(binder(win).getByText('Chapter Three')).toBeVisible()
    const stories = await invoke(win, 'listStories')
    const story = stories.find((s) => s.title === 'The Ferry Crossing')!
    const outline = await invoke(win, 'getOutline', story.id)
    expect(outline.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two'])
    expect(outline.scenes.map((s) => s.title)).toEqual(['Scene 1', 'Scene 2', 'Scene 1', 'Chapter Three'])
    const first = await invoke(win, 'getScene', outline.scenes[0].id)
    expect(first.text).toBe("Mara's eyes were green.\n\nShe waited at the dock until the ferry came in.")
    // Nothing is read, and nothing costs anything, until Adam asks.
    expect((await entries(win)).map((e) => e.name)).not.toContain('Mara')

    // Build the memory from it: the cost first, then the catch-up in the background.
    await expect(main(win).getByText(/About \$0\.\d\d with Fake writer, for 4 scenes in 2 chapters\.|Less than a cent with Fake writer/)).toBeVisible()
    await main(win).getByRole('button', { name: 'Build the memory' }).click()
    await expect(win.getByText('The memory has read “The Ferry Crossing”.')).toBeVisible({ timeout: 30_000 })
    await expect(main(win).getByText('The memory has read all of it.')).toBeVisible()
    await expect.poll(async () => (await entries(win)).map((e) => e.name).sort()).toEqual(expect.arrayContaining(['Kell', 'Mara', 'Tobin']))
    expect((await entries(win)).find((e) => e.name === 'Mara')?.fields.eyes).toBe('green')

    // Another import, undone from its toast: the story goes, and the split is back to change.
    await main(win).getByRole('button', { name: 'Back to writing' }).click()
    await openImport(win, 'The Ferry Crossing')
    await expect(main(win).getByText('3 chapters, 4 scenes').first()).toBeVisible()
    await main(win).getByRole('button', { name: 'Import', exact: true }).click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'Imported' })).toBeVisible()
    expect((await invoke(win, 'listStories')).map((s) => s.title)).toContain('The Ferry')
    await win.getByText('Imported “The Ferry”: 3 chapters, 4 scenes.').locator('..').getByRole('button', { name: 'Undo' }).click()
    await expect(win.getByText('“The Ferry” was taken out again.', { exact: false })).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'listStories')).map((s) => s.title)).toEqual(['Book 1', 'The Ferry Crossing'])
    await expect(main(win).getByRole('heading', { level: 1, name: 'Import a manuscript' })).toBeVisible()
    await expect(chapterCard(win, 'Chapter Three')).toBeVisible()
  } finally {
    await fake.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('building the memory carries on after a restart, and Stop leaves the rest unread', async ({ launch }) => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'aiwrite-import-'))
  // fake/slow answers each memory request over a few seconds.
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 2, slowDelayMs: 400 })
  try {
    const first = await launch()
    await createWorldFromWelcome(first.win, 'Grey Coast')
    const p = await invoke(first.win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    const model = (id: string) => ({ providerId: p.id, modelId: id, label: id, contextLength: 32000, promptPrice: 0.000001, completionPrice: 0.000002 })
    // A slow memory model, so the catch-up is still going when the app closes.
    await invoke(first.win, 'updateSettings', { models: { writer: model('fake/writer'), memory: model('fake/slow') } })
    const chapters = Array.from({ length: 4 }, (_, c) => ({
      title: `Chapter ${c + 1}`,
      act: null,
      scenes: [{ title: 'Scene 1', paragraphs: [[{ text: `Name${'abcd'[c]}'s eyes were blue.` }], [{ text: 'The tide came in.' }]] }]
    }))
    const r = await invoke(first.win, 'importManuscript', { title: 'Long Book', acts: [], chapters })
    await invoke(first.win, 'startCatchUp', r.storyId)
    await expect(binder(first.win).getByRole('status', { name: 'Building the memory' })).toContainText(/Reading chapter \d of 4|Getting ready/)
    await first.close()

    // The app starts again: it carries on by itself, with a quick model this time, and finishes.
    const second = await launch({ dataDir: first.dataDir })
    await expect(second.win.locator('.scene-prose')).toBeVisible()
    await invoke(second.win, 'updateSettings', { models: { memory: model('fake/writer') } })
    await expect.poll(async () => (await invoke(second.win, 'getCatchUp')).running, { timeout: 60_000 }).toBeNull()
    expect((await invoke(second.win, 'getCatchUp')).unread).toEqual({})
    expect((await entries(second.win)).map((e) => e.name)).toEqual(expect.arrayContaining(['Namea', 'Named']))

    // Stop: a fresh import, stopped while it reads, keeps the rest unread to build later.
    await invoke(second.win, 'updateSettings', { models: { memory: model('fake/slow') } })
    const again = await invoke(second.win, 'importManuscript', { title: 'Second Book', acts: [], chapters })
    await invoke(second.win, 'startCatchUp', again.storyId)
    const line = binder(second.win).getByRole('status', { name: 'Building the memory' })
    await expect(line).toBeVisible()
    await line.getByRole('button', { name: 'Stop building the memory' }).click()
    await expect(line).toHaveCount(0)
    const after = await invoke(second.win, 'getCatchUp')
    expect(after.running).toBeNull()
    expect(after.unread[again.storyId]).toBeGreaterThanOrEqual(3)
    // It is offered again from the story's menu.
    // The window learns of stories made through the API when it loads again.
    await second.win.reload()
    await expect(second.win.locator('.scene-prose')).toBeVisible()
    const storyMenu = second.win.locator('[data-story-menu]')
    await storyMenu.click()
    await second.win.getByRole('menuitem', { name: 'Second Book', exact: true }).click()
    await expect(storyMenu).toHaveText('Second Book')
    await storyMenu.click()
    await expect(second.win.getByRole('menuitem', { name: 'Build the memory from this story' })).toBeVisible()
  } finally {
    await fake.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
