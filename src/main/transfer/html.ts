// The book as HTML: one chapter's body for EPUB (XHTML, so every tag is closed), and the whole book as a
// page to print to PDF. Both share the look: a book serif, paragraphs indented after the first, chapter
// headings with their number above Adam's own title, and scene breaks as a centred ornament. No Electron
// imports.

import type { Block, Book, BookChapter, Run } from './manuscript'

/** Characters XML never allows (they would stop Word, an e-reader or a browser reading the file). */
// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

/** Text made safe inside XML and HTML elements and attributes. */
export const esc = (s: string): string =>
  s.replace(NOT_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The scene break's ornament. Plain asterisks: every font and reader has them. */
export const ORNAMENT = '* * *'

function runHtml(r: Run): string {
  let h = r.text.split('\n').map(esc).join('<br/>')
  if (r.italic) h = `<em>${h}</em>`
  if (r.bold) h = `<strong>${h}</strong>`
  return h
}

/** A chapter's words: paragraphs (the first after a heading or a break unindented) and scene breaks. */
export function blocksHtml(blocks: Block[]): string {
  const out: string[] = []
  let first = true
  let inQuote = false
  for (const b of blocks) {
    const quote = b.kind === 'para' && !!b.quote
    if (inQuote && !quote) out.push('</blockquote>')
    if (!inQuote && quote) out.push('<blockquote>')
    inQuote = quote
    if (b.kind === 'break') {
      out.push(`<p class="scene-break" role="separator" aria-label="Scene break">${ORNAMENT}</p>`)
      first = true
      continue
    }
    out.push(`<p${first && !quote ? ' class="first"' : ''}>${b.runs.map(runHtml).join('')}</p>`)
    if (!quote) first = false
  }
  if (inQuote) out.push('</blockquote>')
  return out.join('\n')
}

/** "Chapter 3: The Ferry", or "Chapter 3". */
export const chapterName = (c: BookChapter): string => (c.title ? `${c.label}: ${c.title}` : c.label)

export function chapterHeadingHtml(c: BookChapter): string {
  return c.title
    ? `<h1 class="chapter"><span class="chapter-label">${esc(c.label)}</span><span class="chapter-title">${esc(c.title)}</span></h1>`
    : `<h1 class="chapter"><span class="chapter-title">${esc(c.label)}</span></h1>`
}

/** The look shared by the EPUB and the PDF. */
export const BOOK_CSS = `
body { font-family: Literata, Georgia, "Times New Roman", serif; line-height: 1.5; margin: 0; }
p { margin: 0; text-indent: 1.5em; text-align: justify; hyphens: auto; -webkit-hyphens: auto; orphans: 2; widows: 2; }
p.first { text-indent: 0; }
p.scene-break { text-indent: 0; text-align: center; margin: 1.2em 0; letter-spacing: 0.1em; }
blockquote { margin: 0.8em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
blockquote em { font-style: normal; }
h1.chapter { font-weight: normal; text-align: center; margin: 3em 0 2.2em; line-height: 1.3; }
h1.chapter span { display: block; }
.chapter-label { font-size: 0.8em; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 0.6em; }
.chapter-title { font-size: 1.5em; }
.title-page { text-align: center; padding-top: 30%; }
.title-page h1 { font-weight: normal; font-size: 2.2em; line-height: 1.25; margin: 0; }
`.trim()

/**
 * The whole book as one page for printing to PDF: a title page, then each chapter on a new page. `fonts`
 * holds @font-face rules for the app's own book font, when it can be found.
 */
export function printHtml(book: Book, fonts = ''): string {
  const chapters = book.chapters
    .map((c) => `<section class="chapter-page">\n${chapterHeadingHtml(c)}\n${blocksHtml(c.blocks)}\n</section>`)
    .join('\n')
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${esc(book.title)}</title>
<style>
${fonts}
@page { size: A5; margin: 20mm 17mm 22mm; }
${BOOK_CSS}
body { font-size: 10.5pt; color: #1a1a1a; }
.title-page { height: 150mm; padding-top: 45mm; box-sizing: border-box; }
.chapter-page { break-before: page; }
h1.chapter { margin-top: 18mm; }
</style></head>
<body>
<section class="title-page"><h1>${esc(book.title)}</h1></section>
${chapters}
</body></html>`
}
