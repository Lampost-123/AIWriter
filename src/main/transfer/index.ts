// World files and export (milestone 6). Owned by the World files and export part; see
// src/shared/contracts/transfer.ts and docs/ARCHITECTURE.md, "Milestone 6".
//   manuscript.ts  a story (or part of it) as a book: chapters, paragraphs with italics and bold, scene breaks
//   docx.ts, epub.ts, html.ts, plain.ts   the book as Word, EPUB, HTML (EPUB pages and the PDF), Markdown, text
//   bible.ts       the series bible (codex, timeline, plot threads) as Markdown or a page to print
//   pdf.ts         printing a page to PDF in a hidden window
//   worldFile.ts   the .aiwrite file (export and import) and Make a copy
// This file asks where with the system's dialogs, writes the files and reports progress to the window.

import { app, BrowserWindow, dialog, shell, type FileFilter } from 'electron'
import { existsSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { ID, WorldSummary } from '@shared/types'
import type { BibleFormat, ExportBibleInput, ExportStoryInput, Exported, ManuscriptFormat } from '@shared/contracts/transfer'
import * as repo from '../db/repo'
import { emit } from '../events'
import { ensureLibraryFolder, getSettings } from '../settings'
import { renameRetry, UserError } from '../util'
import { currentWorld, listWorlds, maybeCurrentWorld } from '../world'
import { readBook } from './manuscript'
import { writeDocx } from './docx'
import { writeEpub } from './epub'
import { printHtml } from './html'
import { bookMarkdown, bookText } from './plain'
import { bibleHtml, bibleMarkdown, readBible } from './bible'
import { bookFontRules, htmlToPdf } from './pdf'
import { copyWorld as copyWorldFiles, exportWorld, importWorld, plainFileError, WORLD_FILE_EXT, type Progress, type WorldSource } from './worldFile'

// ---------- Where files go ----------

/** The folder Adam last saved an export in, this session (the save dialog opens there next time). */
let lastFolder: string | null = null

function startFolder(): string {
  if (lastFolder && existsSync(lastFolder)) return lastFolder
  try {
    return app.getPath('documents')
  } catch {
    return app.getPath('home')
  }
}

/** A file name Windows, macOS and cloud folders all accept, from a title. */
export function fileNameOf(title: string): string {
  const s = title
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '')
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) || !s ? `${s || 'Untitled'} export` : s
}

const owner = (): BrowserWindow | null => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => w.isVisible()) ?? null

async function askWhere(title: string, name: string, filter: FileFilter): Promise<string | null> {
  const win = owner()
  const opts = { title, defaultPath: join(startFolder(), name), filters: [filter] }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  lastFolder = dirname(res.filePath)
  return res.filePath
}

/** Writes a finished file in one step, so a half-written export never takes the old one's place. */
async function saveFile(path: string, data: Uint8Array | string): Promise<void> {
  const partial = `${path}.partial`
  try {
    await writeFile(partial, data)
    await renameRetry(partial, path)
  } catch (e) {
    rmSync(partial, { force: true })
    const code = String((e as { code?: unknown })?.code ?? '')
    if (['EPERM', 'EBUSY', 'EACCES'].includes(code)) {
      throw new UserError(`Couldn't save ${basename(path)}: it may be open in another program. Close it there, then export again.`)
    }
    throw plainFileError(e, `save ${basename(path)}`)
  }
}

/** Sends a job's progress to the window: at once when the step changes, else at most every 120 ms. */
function progressFor(jobId: ID): Progress {
  let lastStep = ''
  let lastAt = 0
  return (step, fraction) => {
    const t = Date.now()
    if (step === lastStep && t - lastAt < 120 && fraction !== 1) return
    lastStep = step
    lastAt = t
    emit('transfer:progress', { jobId, step, fraction })
  }
}

// ---------- Story and series bible ----------

const MANUSCRIPT: Record<ManuscriptFormat, { ext: string; filter: FileFilter }> = {
  docx: { ext: 'docx', filter: { name: 'Word document', extensions: ['docx'] } },
  epub: { ext: 'epub', filter: { name: 'EPUB e-book', extensions: ['epub'] } },
  pdf: { ext: 'pdf', filter: { name: 'PDF', extensions: ['pdf'] } },
  markdown: { ext: 'md', filter: { name: 'Markdown', extensions: ['md'] } },
  text: { ext: 'txt', filter: { name: 'Plain text', extensions: ['txt'] } }
}

const BIBLE: Record<BibleFormat, { ext: string; filter: FileFilter }> = {
  pdf: MANUSCRIPT.pdf,
  markdown: MANUSCRIPT.markdown
}

const exported = (path: string, note: string | null = null): Exported => ({ path, fileName: basename(path), note })

export async function exportStory(input: ExportStoryInput): Promise<Exported | null> {
  const format = MANUSCRIPT[input.format]
  if (!format) throw new UserError('Pick a format to export to.')
  const db = currentWorld().db
  const progress = progressFor(input.jobId)
  // Read first, so "nothing to export" is said before the save dialog asks where.
  const book = readBook(db, input.storyId, input.scope)
  let name = book.title
  if (input.scope.kind === 'chapter' && book.chapters.length === 1) {
    const c = book.chapters[0]
    name = `${book.title} - ${c.title ? `${c.label} ${c.title}` : c.label}`
  }
  const path = await askWhere('Export story', `${fileNameOf(name)}.${format.ext}`, format.filter)
  if (!path) return null
  progress('Writing the file', null)
  let data: Uint8Array | string
  if (input.format === 'docx') data = writeDocx(book)
  else if (input.format === 'epub') data = writeEpub(book, { lang: 'en' })
  else if (input.format === 'markdown') data = bookMarkdown(book)
  else if (input.format === 'text') data = bookText(book)
  else {
    progress('Making the PDF', null)
    data = await htmlToPdf(printHtml(book, bookFontRules()))
  }
  await saveFile(path, data)
  progress('Done', 1)
  return exported(path)
}

export async function exportBible(input: ExportBibleInput): Promise<Exported | null> {
  const format = BIBLE[input.format]
  if (!format) throw new UserError('Pick a format to export to.')
  const db = currentWorld().db
  const progress = progressFor(input.jobId)
  progress('Gathering the series bible', null)
  const bible = readBible(db, input.storyId)
  const path = await askWhere('Export series bible', `${fileNameOf(`${bible.worldName} - series bible`)}.${format.ext}`, format.filter)
  if (!path) return null
  progress(input.format === 'pdf' ? 'Making the PDF' : 'Writing the file', null)
  const data = input.format === 'pdf' ? await htmlToPdf(bibleHtml(bible, bookFontRules())) : bibleMarkdown(bible)
  await saveFile(path, data)
  progress('Done', 1)
  return exported(path)
}

// ---------- Whole worlds ----------

/** A world in the library (the open one when `worldId` is null), with its connection when it is the open one. */
function sourceOf(worldId: ID | null): { source: WorldSource; name: string } {
  const open = maybeCurrentWorld()
  if (!worldId || worldId === open?.id) {
    const w = currentWorld()
    return { source: { folder: w.folder, db: w.db }, name: repo.getMeta(w.db, 'name') ?? 'Untitled world' }
  }
  const found = listWorlds().find((w) => w.id === worldId)
  if (!found) throw new UserError('That world could not be found in your library folder.')
  return { source: { folder: found.folder, db: null }, name: found.name }
}

const WORLD_FILTER: FileFilter = { name: 'AI Write world', extensions: [WORLD_FILE_EXT] }

const HISTORY_LEFT_OUT = "Its scenes' earlier versions couldn't be read, so they were left out. Everything else is in the file."

export async function exportWorldFile(jobId: ID, worldId: ID | null): Promise<Exported | null> {
  const { source, name } = sourceOf(worldId)
  const path = await askWhere('Export world', `${fileNameOf(name)}.${WORLD_FILE_EXT}`, WORLD_FILTER)
  if (!path) return null
  // The world may have been closed (or another opened) while the dialog was up.
  if (source.db && !source.db.open) throw new UserError('The world was closed before it could be exported. Open it again, then try once more.')
  const { history } = await exportWorld({ source, out: path, appVersion: app.getVersion(), progress: progressFor(jobId) })
  return exported(path, history === 'left-out' ? HISTORY_LEFT_OUT : null)
}

const summaryOf = (folder: string, id: ID, name: string): WorldSummary => ({ id, name, folder, updatedAt: new Date().toISOString() })

function library(): string {
  if (!ensureLibraryFolder()) {
    throw new UserError(`AI Write can't reach your library folder (${getSettings().libraryPath}). Check the drive is connected, then try again.`)
  }
  return getSettings().libraryPath
}

export async function importWorldFile(jobId: ID): Promise<WorldSummary | null> {
  const lib = library()
  const win = owner()
  const opts = {
    title: 'Import a world file',
    defaultPath: startFolder(),
    filters: [WORLD_FILTER],
    properties: ['openFile'] as 'openFile'[]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const file = res.canceled ? null : res.filePaths[0]
  if (!file) return null
  lastFolder = dirname(file)
  const made = await importWorld({
    file,
    library: lib,
    appVersion: app.getVersion(),
    takenNames: listWorlds().map((w) => w.name),
    progress: progressFor(jobId)
  })
  return summaryOf(made.folder, made.id, made.name)
}

export async function copyWorld(jobId: ID, worldId: ID): Promise<WorldSummary> {
  const lib = library()
  const { source, name } = sourceOf(worldId)
  const copyName = `${name} (copy)`
  const made = await copyWorldFiles({ source, library: lib, name: copyName, progress: progressFor(jobId) })
  return summaryOf(made.folder, made.id, copyName)
}

export function showExported(path: string): void {
  if (typeof path !== 'string' || !existsSync(path)) throw new UserError('That file has been moved or deleted since it was exported.')
  shell.showItemInFolder(path)
}
