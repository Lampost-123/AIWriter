// Reading a manuscript file for importing: picks the reader by the file's kind (.docx, .md, .txt) and says
// in plain words what to do with a file it can't read (an old .doc, a PDF, something empty or huge).
// No Electron imports.

import { readFile, stat } from 'node:fs/promises'
import type { Manuscript } from '@shared/contracts/importing'
import { UserError } from '../util'
import { readDocx } from './docx'
import { readMarkdown } from './markdown'
import { decodeText, readText } from './text'

/** Bigger than any book (a 150,000-word .docx is a few megabytes): refused before it is read. */
export const MAX_BYTES = 200 * 1024 * 1024

export const MANUSCRIPT_EXTENSIONS = ['docx', 'md', 'markdown', 'txt', 'text']

const extensionOf = (path: string): string => /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''

/** Reads a manuscript from its bytes, by the kind its name says. */
export function readManuscriptBytes(bytes: Uint8Array, fileName: string): Manuscript {
  const ext = extensionOf(fileName)
  const name = fileName.split(/[\\/]/).pop() ?? fileName
  let m: Manuscript
  if (ext === 'docx' || ext === 'docm') m = readDocx(bytes, name)
  else if (ext === 'md' || ext === 'markdown') m = readMarkdown(decodeText(bytes), name)
  else if (ext === 'txt' || ext === 'text' || ext === '') m = readText(decodeText(bytes), name)
  else if (ext === 'doc') {
    throw new UserError(
      'AI Write can read Word files saved as .docx, not the older .doc kind. Open it in Word, choose File › Save As › Word Document (.docx), then import that.',
      'old-doc'
    )
  } else if (ext === 'pdf') {
    throw new UserError('AI Write can’t read the text of a PDF. Import the Word, Markdown or text file it was made from instead.', 'pdf')
  } else if (ext === 'rtf' || ext === 'odt' || ext === 'pages') {
    throw new UserError(
      `AI Write can’t read .${ext} files yet. Save it as a Word Document (.docx) or plain text (.txt) and import that.`,
      'other-kind'
    )
  } else {
    throw new UserError('AI Write can import Word (.docx), Markdown (.md) and plain text (.txt) files. Pick one of those.', 'other-kind')
  }
  if (!m.blocks.some((b) => b.kind === 'para' || b.kind === 'heading')) {
    throw new UserError(`“${name}” has no text in it to import. Check it is the right file.`, 'empty')
  }
  return m
}

/** Reads the manuscript file at `path`. */
export async function readManuscriptFile(path: string): Promise<Manuscript> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    throw new UserError('That file couldn’t be found. It may have been moved or renamed; pick it again.', 'missing')
  }
  if (size > MAX_BYTES) throw new UserError('That file is far bigger than any book. Check it is the right file.', 'too-big')
  let bytes: Uint8Array
  try {
    const buf = await readFile(path)
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  } catch {
    throw new UserError(
      'That file couldn’t be opened. If it is open in Word or another program, or still downloading from the cloud, close it or wait a moment, then try again.',
      'unreadable'
    )
  }
  return readManuscriptBytes(bytes, path)
}
