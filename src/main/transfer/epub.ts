// The book as an EPUB 3 e-book: the mimetype first and stored uncompressed (readers look for it there),
// META-INF/container.xml, the package (content.opf), the contents page (nav.xhtml, plus toc.ncx for older
// readers), a title page, one XHTML file per chapter and the book's CSS. No Electron imports.

import { randomUUID } from 'node:crypto'
import { strToU8, zipSync, type Zippable } from 'fflate'
import type { Book } from './manuscript'
import { BOOK_CSS, blocksHtml, chapterHeadingHtml, chapterName, esc } from './html'

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n'

const CONTAINER = `${XML}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const CSS = `${BOOK_CSS}
.title-page h1 { margin-top: 0; }
`

const chapterFile = (i: number): string => `chapter-${String(i + 1).padStart(3, '0')}.xhtml`

function page(title: string, body: string, lang: string): string {
  return `${XML}<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`
}

export interface EpubOptions {
  /** The book's language (BCP 47). */
  lang?: string
  at?: Date
  /** The book's identifier; a new one each time by default. */
  id?: string
}

/** The parts of the EPUB, in the order they go in the file (the mimetype first). */
export function epubParts(book: Book, opts: EpubOptions = {}): [string, string][] {
  const lang = opts.lang ?? 'en'
  const id = opts.id ?? `urn:uuid:${randomUUID()}`
  const modified = (opts.at ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const chapters = book.chapters.map((c, i) => ({ file: chapterFile(i), name: chapterName(c), c }))

  const opf = `${XML}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${esc(id)}</dc:identifier>
    <dc:title>${esc(book.title)}</dc:title>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="title-page" href="title.xhtml" media-type="application/xhtml+xml"/>
${chapters.map((c, i) => `    <item id="chapter-${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
    <itemref idref="title-page"/>
${chapters.map((_, i) => `    <itemref idref="chapter-${i + 1}"/>`).join('\n')}
  </spine>
</package>`

  const nav = page(
    'Contents',
    `<nav epub:type="toc" id="toc">
<h1>Contents</h1>
<ol>
${chapters.map((c) => `<li><a href="${c.file}">${esc(c.name)}</a></li>`).join('\n')}
</ol>
</nav>
<nav epub:type="landmarks" hidden="hidden">
<ol>
<li><a epub:type="titlepage" href="title.xhtml">Title page</a></li>
${chapters.length ? `<li><a epub:type="bodymatter" href="${chapters[0].file}">Start of the story</a></li>` : ''}
</ol>
</nav>`,
    lang
  )

  const ncx = `${XML}<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${esc(id)}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${esc(book.title)}</text></docTitle>
<navMap>
${chapters.map((c, i) => `<navPoint id="nav-${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.name)}</text></navLabel><content src="${c.file}"/></navPoint>`).join('\n')}
</navMap>
</ncx>`

  return [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', CONTAINER],
    ['OEBPS/content.opf', opf],
    ['OEBPS/nav.xhtml', nav],
    ['OEBPS/toc.ncx', ncx],
    ['OEBPS/style.css', CSS],
    ['OEBPS/title.xhtml', page(book.title, `<section class="title-page" epub:type="titlepage"><h1>${esc(book.title)}</h1></section>`, lang)],
    ...chapters.map(
      (c): [string, string] => [
        `OEBPS/${c.file}`,
        page(c.name, `<section epub:type="chapter">\n${chapterHeadingHtml(c.c)}\n${blocksHtml(c.c.blocks)}\n</section>`, lang)
      ]
    )
  ]
}

/** The whole .epub file. */
export function writeEpub(book: Book, opts: EpubOptions = {}): Uint8Array {
  const files: Zippable = {}
  for (const [name, text] of epubParts(book, opts)) {
    // The mimetype must be stored as it is (not compressed), and first.
    files[name] = name === 'mimetype' ? [strToU8(text), { level: 0 }] : strToU8(text)
  }
  return zipSync(files, { level: 6, mtime: opts.at ?? new Date() })
}
