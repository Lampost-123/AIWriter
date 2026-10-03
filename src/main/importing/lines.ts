// Reading a manuscript's lines by their words, the same for every kind of file: chapter and part headings
// ("Chapter 12", "CHAPTER ONE", "Chapter Twelve: The Ferry", "Prologue", "Part One"), scene break marks
// ("* * *", "#", "---"), and the tidying every reader does (non-breaking spaces, invisible characters). Then
// `finishBlocks`, which every reader ends with: bare chapter numbers ("12" on a line of its own) count when
// the file has several, and a chapter heading's title on the line after it ("CHAPTER ONE" then "The Ferry")
// joins it. Pure, no Electron imports.

import type { Manuscript, ManuscriptBlock, ManuscriptFormat } from '@shared/contracts/importing'
import { countWords } from '@shared/defaults'

// ---------- Tidying ----------

/** Invisible characters a file can carry (byte order marks, zero-width spaces and joiners, soft hyphens). */
const INVISIBLE = /[\u200b\u200c\u200d\u2060\ufeff\u00ad]/g
/** Spaces that look like spaces: non-breaking, narrow and figure spaces. */
const ODD_SPACES = /[\u00a0\u2007\u202f\u2000-\u200a\u3000]/g
/** Control characters other than tab and new line. */
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** Text as it goes into the story: invisible and control characters gone, tabs as spaces (non-breaking spaces stay). */
export const tidy = (s: string): string => s.replace(INVISIBLE, '').replace(CONTROLS, '').replace(/\t/g, ' ')

/** For recognising a line by its words: plain spaces, one at a time, trimmed. */
export const plainLine = (s: string): string => tidy(s).replace(ODD_SPACES, ' ').replace(/\s+/g, ' ').trim()

// ---------- Numbers ----------

const UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'
]
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
// Longest first, so "seventeen" is never read as "seven".
const byLength = (a: string, b: string): number => b.length - a.length
const UNIT_WORDS = [...UNITS].sort(byLength).join('|')
const WORD_NUMBER = `(?:(?:${TENS.join('|')})(?:[\\s-]+(?:${UNITS.slice(1, 10).sort(byLength).join('|')}))?|one hundred|a hundred|${UNIT_WORDS})`
/** A number as a chapter is numbered: 12, XII (or xii), Twelve, Twenty-One. */
const NUMBER = `(?:\\d{1,4}|[ivxlcdm]{1,8}|${WORD_NUMBER})`

/** What may come after a heading's number: a title after a colon, full stop or dash, or (with no mark) a short title. */
const REST = `(?:\\s*[:.\\-–—]\\s*(?<marked>.*)|\\s+(?<bare>.+))?`

const CHAPTER = new RegExp(`^(?:chapter|chap\\.|ch\\.)\\s*${NUMBER}(?![\\p{L}\\d])${REST}$`, 'iu')
const PART = new RegExp(`^(?:part|book|act|volume)\\s+${NUMBER}(?![\\p{L}\\d])${REST}$`, 'iu')
const NAMED = /^(?:prologue|epilogue|interlude|introduction|preface|foreword|afterword|coda)(?![\p{L}\d])(?<rest>.*)$/iu
const BARE_NUMBER = /^(?:\d{1,3}|[IVXLCDM]{1,7})\.?$/u

/** Text after a heading's number that reads like a title, not like the rest of a sentence. */
function titleLike(rest: string, marked: boolean): boolean {
  const r = rest.trim()
  if (!r) return true
  if (r.length > 80) return false
  if (marked) return true
  // "Chapter One The Ferry", but never "Chapter one was the hardest to write."
  return /^[\p{Lu}"“'‘(]/u.test(r) && r.split(' ').length <= 8 && !/[.,;:!?…]$/u.test(r)
}

/** What a line looks like by its words: a chapter's heading, a part's (an act), or neither. */
export function headingHint(text: string): 'chapter' | 'part' | null {
  const t = plainLine(text)
  if (!t || t.length > 90) return null
  for (const [re, hint] of [
    [CHAPTER, 'chapter'],
    [PART, 'part']
  ] as const) {
    const m = re.exec(t)
    if (m) {
      const marked = m.groups?.marked
      return titleLike(marked ?? m.groups?.bare ?? '', marked !== undefined) ? hint : null
    }
  }
  const named = NAMED.exec(t)
  if (named) {
    const rest = named.groups?.rest ?? ''
    if (!rest.trim() || /^\s*[:.\-–—]/.test(rest)) return titleLike(rest.replace(/^\s*[:.\-–—]\s*/, ''), true) ? 'chapter' : null
  }
  return null
}

/** True for a chapter number on a line of its own ("12", "XII"). Counted as a heading only when the file has several. */
export const isBareNumber = (text: string): boolean => BARE_NUMBER.test(plainLine(text))

/** Scene break marks: "* * *", "***", "#", "---", "~~~", "§", "⁂" and the like, on a line of their own. */
const BREAK_MARKS = /^[*#~•·∙◇◆♦❖✱✲✻✽⁂§=_+\-–—]+$/u

export function isBreakMark(text: string): boolean {
  const t = plainLine(text).replace(/ /g, '')
  return t.length > 0 && t.length <= 15 && BREAK_MARKS.test(t)
}

// ---------- Finishing ----------

/** A chapter heading with no title of its own ("CHAPTER ONE", "Chapter 12."), so the line after it may be its title. */
const NUMBER_ONLY = new RegExp(`^(?:chapter|chap\\.|ch\\.)\\s*${NUMBER}\\.?$|^${NUMBER}\\.?$`, 'iu')

/** A short line that reads as a chapter's title: a few words, a capital first, no sentence's end. */
function titleLine(b: ManuscriptBlock | undefined): boolean {
  if (!b || b.kind !== 'para') return false
  const t = plainLine(b.text)
  return !!t && t.length <= 60 && !t.includes('\n') && t.split(' ').length <= 8 && /^[\p{Lu}"“'‘]/u.test(t) && !/[.,;:!?…"”'’)]$/u.test(t)
}

/** At least this many bare numbers ("1", "2", ...) on lines of their own make them chapter headings. */
const BARE_NUMBERS_NEEDED = 2

/**
 * Every reader's last step: bare chapter numbers count when there are enough of them, a title on the line
 * after a heading that is only a number joins it ("Chapter One: The Ferry"), and the book's words are counted.
 */
export function finishBlocks(fileName: string, format: ManuscriptFormat, title: string, input: ManuscriptBlock[]): Manuscript {
  let blocks = input
  // Chapters numbered with nothing but a number, when the file has no chapter headings in words.
  const hasChapters = blocks.some((b) => b.kind === 'heading' && (b.hint === 'chapter' || b.level != null))
  const bare = blocks.filter((b) => b.kind === 'para' && isBareNumber(b.text))
  if (!hasChapters && bare.length >= BARE_NUMBERS_NEEDED) {
    const set = new Set(bare)
    blocks = blocks.map((b) => (set.has(b) ? { kind: 'heading', text: plainLine(b.text), level: null, hint: 'chapter', pageBreak: b.pageBreak } : b))
  }
  // "CHAPTER ONE" then "The Ferry" on the next line: one heading.
  const out: ManuscriptBlock[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const next = blocks[i + 1]
    if (b.kind === 'heading' && b.hint === 'chapter' && NUMBER_ONLY.test(plainLine(b.text)) && titleLine(next) && blocks[i + 2]) {
      out.push({ ...b, text: `${plainLine(b.text).replace(/\.$/, '')}: ${plainLine(next.text)}` })
      i++
      continue
    }
    out.push(b)
  }
  const words = out.reduce((n, b) => n + (b.kind === 'para' ? countWords(b.text) : 0), 0)
  return { fileName, format, title: plainLine(title) || 'Imported story', blocks: out, words }
}

/** A file's name without its folder or extension: "The Ferry" from "C:\Books\The Ferry.docx". */
export function baseName(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? fileName
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || name
}

/** A paragraph block from plain text (no bold or italic). */
export function plainPara(text: string, pageBreak = false): ManuscriptBlock {
  const t = tidy(text).trim()
  return pageBreak ? { kind: 'para', text: t, runs: [{ text: t }], pageBreak } : { kind: 'para', text: t, runs: [{ text: t }] }
}

/**
 * A line on its own, as a block: a scene break mark, a heading recognised by its words, or a paragraph.
 * `para` makes the paragraph (with its bold and italic) when it is one.
 */
export function blockOfLine(text: string, para: () => ManuscriptBlock, pageBreak = false): ManuscriptBlock {
  const extra = pageBreak ? { pageBreak } : {}
  if (isBreakMark(text)) return { kind: 'break', text: plainLine(text), ...extra }
  const hint = headingHint(text)
  if (hint) return { kind: 'heading', text: plainLine(text), level: null, hint, ...extra }
  return para()
}
