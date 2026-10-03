// Reading a plain text file (.txt): paragraphs, chapter and part headings recognised by their words
// ("Chapter 1", "CHAPTER ONE", "Chapter Twelve: The Ferry", "Prologue", "Epilogue", "Part One"), and scene
// break marks. Handles the three ways text files hold paragraphs: blank lines between them (lines inside
// joined, as in hard-wrapped books), one paragraph to a line, or a new paragraph at each indented line.
// Also decodes the file's bytes (UTF-8, UTF-16 with its mark, else Windows' own Western encoding). Pure.

import type { Manuscript, ManuscriptBlock } from '@shared/contracts/importing'
import { baseName, blockOfLine, finishBlocks, plainPara } from './lines'

/** The text of a file's bytes: UTF-8 (with or without its mark), UTF-16 with its mark, else Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** The text's lines, with Windows and old Mac line ends made plain. */
export const splitLines = (text: string): string[] => text.replace(/\r\n?/g, '\n').split('\n')

/**
 * True when the file is written one paragraph to a line: lines that are long (not wrapped at a width), or
 * hardly any blank lines between them.
 */
export function linesPerParagraph(lines: string[]): boolean {
  const filled = lines.filter((l) => l.trim())
  if (filled.length < 3) return false
  const blank = lines.length - filled.length
  const average = filled.reduce((n, l) => n + l.trim().length, 0) / filled.length
  return average > 100 || blank < filled.length * 0.05
}

/** True when paragraphs are hard-wrapped lines that start with an indent, with few blank lines (an old typescript). */
function indentedParagraphs(lines: string[]): boolean {
  const filled = lines.filter((l) => l.trim())
  const average = filled.reduce((n, l) => n + l.trim().length, 0) / Math.max(1, filled.length)
  const indented = filled.filter((l) => /^(\t| {2,})\S/.test(l)).length
  return average <= 100 && indented >= filled.length * 0.08 && indented < filled.length * 0.9
}

/** True for a line that is a heading by its words or a scene break mark. */
export const standsAlone = (line: string): boolean => blockOfLine(line, () => plainPara('')).kind !== 'para'

/** Reads a plain text file into blocks. */
export function readText(source: string, fileName: string): Manuscript {
  const lines = splitLines(source.replace(/^﻿/, ''))
  const perLine = linesPerParagraph(lines)
  const indented = perLine && indentedParagraphs(lines)
  const blocks: ManuscriptBlock[] = []
  let para: string[] = []
  const flush = (): void => {
    if (!para.length) return
    const text = para.map((l) => l.trim()).join(' ')
    para = []
    if (text.trim()) blocks.push(blockOfLine(text, () => plainPara(text)))
  }
  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    // A heading or a break mark stands alone, even with no blank line around it.
    if (standsAlone(line)) {
      flush()
      para.push(line)
      flush()
      continue
    }
    // Indented: a new paragraph at each indented line.
    if (indented && /^(\t| {2,})\S/.test(line)) flush()
    para.push(line)
    if (perLine && !indented) flush()
  }
  flush()
  return finishBlocks(fileName, 'text', baseName(fileName), blocks)
}
