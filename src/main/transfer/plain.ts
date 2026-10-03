// The book as Markdown and as plain text. Markdown keeps italics (*words*) and bold (**words**) and marks
// scene breaks with "* * *"; plain text keeps only the words. No Electron imports.

import type { Block, Book, Run } from './manuscript'

/** Characters Markdown would read as formatting inside a paragraph. */
const MD_SPECIAL = /([\\`*_[\]<>])/g
/** Things Markdown would read as a heading, quote, list or rule at the start of a line. */
const MD_LINE_START = /^(\s*)(#|>|[-+=]|\d+[.)])/

function mdText(s: string): string {
  return s
    .split('\n')
    .map((line) => line.replace(MD_SPECIAL, '\\$1').replace(MD_LINE_START, '$1\\$2'))
    .join('  \n')
}

function mdRun(r: Run): string {
  const mark = r.bold && r.italic ? '***' : r.bold ? '**' : r.italic ? '*' : ''
  if (!mark || !r.text.trim()) return mdText(r.text)
  // Spaces stay outside the marks, or Markdown wouldn't see them as marks.
  const [, lead, inner, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text)!
  return `${lead}${mark}${mdText(inner)}${mark}${trail}`
}

function mdBlocks(blocks: Block[]): string[] {
  return blocks.map((b) => {
    if (b.kind === 'break') return '* * *'
    const text = b.runs.map(mdRun).join('')
    return b.quote
      ? text
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n')
      : text
  })
}

/** "# Title", then "## Chapter 3: The Ferry" and its paragraphs, with "* * *" between scenes. */
export function bookMarkdown(book: Book): string {
  const out: string[] = [`# ${mdText(book.title)}`]
  for (const c of book.chapters) {
    out.push(`## ${mdText(c.title ? `${c.label}: ${c.title}` : c.label)}`)
    out.push(...mdBlocks(c.blocks))
  }
  return `${out.join('\n\n')}\n`
}

/** The title, then each chapter's heading ("CHAPTER 3" over its title) and its paragraphs between blank lines. */
export function bookText(book: Book): string {
  const out: string[] = [book.title]
  for (const c of book.chapters) {
    out.push('', c.title ? `${c.label.toUpperCase()}\n${c.title}` : c.label.toUpperCase())
    for (const b of c.blocks) out.push(b.kind === 'break' ? '* * *' : b.runs.map((r) => r.text).join(''))
  }
  return `${out.join('\n\n')}\n`
}
