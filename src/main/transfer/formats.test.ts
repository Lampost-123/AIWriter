import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as repo from '../db/repo'
import { memoryWorld } from '../../../tests/unit/helpers'
import { UserError } from '../util'
import { chapterHeading, docBlocks, readBook, textBlocks, tidyBreaks, type Book } from './manuscript'
import { writeDocx } from './docx'
import { epubParts, writeEpub } from './epub'
import { printHtml } from './html'
import { bookMarkdown, bookText } from './plain'
import { bibleMarkdown, readBible } from './bible'

const p = (...content: unknown[]) => ({ type: 'paragraph', attrs: { pid: 'x' }, content })
const t = (text: string, ...marks: string[]) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}) })
const doc = (...content: unknown[]) => ({ type: 'doc', content })

/** A story of two chapters (the second titled), one scene deleted, one empty, one chapter deleted. */
function storyWorld() {
  const db = memoryWorld('Reach')
  const [story] = repo.listStories(db)
  repo.updateStory(db, story.id, { title: 'The Ferry & the Flood' })
  const o = repo.getOutline(db, story.id)
  const ch1 = o.chapters[0]
  const s1 = o.scenes[0]
  repo.saveSceneText(
    db,
    s1.id,
    doc(p(t('The rain had '), t('not', 'italic'), t(' stopped.')), p(t('Mara waited.', 'bold')), { type: 'horizontalRule' }, p(t('Later, the ferry.'))),
    'The rain had not stopped.\n\nMara waited.\n\n* * *\n\nLater, the ferry.'
  )
  const s2 = repo.createScene(db, ch1.id, { title: 'Second' })
  repo.saveSceneText(db, s2.id, null, 'Tobin came late.\n\n***\n\nHe said <nothing> & left.')
  const gone = repo.createScene(db, ch1.id, { title: 'Deleted' })
  repo.saveSceneText(db, gone.id, null, 'Never exported.')
  repo.deleteScene(db, gone.id)
  repo.createScene(db, ch1.id, { title: 'Empty' })
  const ch2 = repo.createChapter(db, story.id, { title: 'The Crossing' })
  const s3 = repo.createScene(db, ch2.id, { title: 'Crossing' })
  repo.saveSceneText(db, s3.id, doc({ type: 'blockquote', content: [p(t('A letter.'))] }, p(t('Line one'), { type: 'hardBreak' }, t('line two'))), '')
  const ch3 = repo.createChapter(db, story.id, { title: 'Deleted chapter' })
  const s4 = repo.createScene(db, ch3.id, {})
  repo.saveSceneText(db, s4.id, null, 'Also never exported.')
  repo.deleteChapter(db, ch3.id)
  return { db, storyId: story.id, ch1, ch2, s1, s2, s3 }
}

describe('reading a story as a book', () => {
  it('keeps italics and bold, turns scene changes and breaks into one break each, and leaves out deleted and empty scenes', () => {
    const { db, storyId } = storyWorld()
    const book = readBook(db, storyId, { kind: 'story' })
    expect(book.title).toBe('The Ferry & the Flood')
    expect(book.chapters.map((c) => [c.number, c.label, c.title])).toEqual([
      [1, 'Chapter 1', ''],
      [2, 'Chapter 2', 'The Crossing']
    ])
    expect(book.chapters[0].blocks).toEqual([
      { kind: 'para', runs: [{ text: 'The rain had ' }, { text: 'not', italic: true }, { text: ' stopped.' }] },
      { kind: 'para', runs: [{ text: 'Mara waited.', bold: true }] },
      { kind: 'break' },
      { kind: 'para', runs: [{ text: 'Later, the ferry.' }] },
      { kind: 'break' },
      { kind: 'para', runs: [{ text: 'Tobin came late.' }] },
      { kind: 'break' },
      { kind: 'para', runs: [{ text: 'He said <nothing> & left.' }] }
    ])
    expect(book.chapters[1].blocks).toEqual([
      { kind: 'para', runs: [{ text: 'A letter.' }], quote: true },
      { kind: 'para', runs: [{ text: 'Line one\nline two' }] }
    ])
    expect(JSON.stringify(book)).not.toMatch(/never exported/i)
  })

  it('exports one chapter, or a selection with its chapter headings and numbers', () => {
    const { db, storyId, ch2, s2, s3 } = storyWorld()
    expect(readBook(db, storyId, { kind: 'chapter', chapterId: ch2.id }).chapters.map((c) => c.label)).toEqual(['Chapter 2'])
    const some = readBook(db, storyId, { kind: 'selection', sceneIds: [s3.id, s2.id] })
    expect(some.chapters.map((c) => c.number)).toEqual([1, 2])
    expect(some.chapters[0].blocks[0]).toEqual({ kind: 'para', runs: [{ text: 'Tobin came late.' }] })
    expect(() => readBook(db, storyId, { kind: 'selection', sceneIds: [] })).toThrow(UserError)
  })

  it('says so when there is nothing to export', () => {
    const db = memoryWorld()
    const [story] = repo.listStories(db)
    expect(() => readBook(db, story.id, { kind: 'story' })).toThrow(/no words to export yet/)
  })

  it('reads documents, plain text, breaks and headings', () => {
    expect(docBlocks(null)).toBeNull()
    expect(docBlocks({ type: 'doc', content: [p()] })).toEqual([])
    expect(textBlocks('One.\n\n* * *\n\nTwo.\r\n\r\nThree.')).toEqual([
      { kind: 'para', runs: [{ text: 'One.' }] },
      { kind: 'break' },
      { kind: 'para', runs: [{ text: 'Two.' }] },
      { kind: 'para', runs: [{ text: 'Three.' }] }
    ])
    expect(tidyBreaks([{ kind: 'break' }, { kind: 'para', runs: [{ text: 'a' }] }, { kind: 'break' }, { kind: 'break' }])).toEqual([
      { kind: 'para', runs: [{ text: 'a' }] }
    ])
    expect(chapterHeading(3, 'Chapter 3')).toEqual({ label: 'Chapter 3', title: '' })
    expect(chapterHeading(3, '')).toEqual({ label: 'Chapter 3', title: '' })
    expect(chapterHeading(3, 'The Ferry')).toEqual({ label: 'Chapter 3', title: 'The Ferry' })
  })
})

const BOOK: Book = {
  title: 'The Ferry & the Flood',
  chapters: [
    {
      number: 1,
      label: 'Chapter 1',
      title: '',
      blocks: [
        { kind: 'para', runs: [{ text: 'The rain had ' }, { text: 'not', italic: true }, { text: ' stopped.' }] },
        { kind: 'break' },
        { kind: 'para', runs: [{ text: 'Mara ' }, { text: 'waited', bold: true }, { text: ' <here>.' }] }
      ]
    },
    { number: 2, label: 'Chapter 2', title: 'The Crossing', blocks: [{ kind: 'para', runs: [{ text: 'A letter.' }], quote: true }] }
  ]
}

describe('Word', () => {
  it('writes a .docx Word can open: its parts, styles with a book serif, headings, page breaks and the text with its look', () => {
    const files = unzipSync(writeDocx(BOOK))
    expect(Object.keys(files).sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'docProps/app.xml',
        'docProps/core.xml',
        'word/_rels/document.xml.rels',
        'word/document.xml',
        'word/settings.xml',
        'word/styles.xml'
      ].sort()
    )
    const document = strFromU8(files['word/document.xml'])
    expect(document).toContain('<w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">The Ferry &amp; the Flood</w:t>')
    expect(document).toContain('<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">not</w:t></w:r>')
    expect(document).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">waited</w:t></w:r>')
    expect(document).toContain(' &lt;here&gt;.')
    expect(document).toContain('<w:pStyle w:val="SceneBreak"/>')
    // A chapter without its own title: its number is the heading, on a new page; with one, the title is.
    expect(document).toMatch(/<w:pStyle w:val="Heading1"\/><w:pageBreakBefore\/>.*?Chapter 1</)
    expect(document).toMatch(/<w:pStyle w:val="ChapterLabel"\/><\/w:pPr><w:r><w:t xml:space="preserve">Chapter 2<.*?<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">The Crossing</)
    expect(document).toContain('<w:pStyle w:val="Quote"/>')
    const styles = strFromU8(files['word/styles.xml'])
    expect(styles).toContain('w:ascii="Georgia"')
    expect(styles).toContain('<w:pageBreakBefore/>')
    expect(styles).toContain('<w:outlineLvl w:val="0"/>')
    expect(strFromU8(files['docProps/core.xml'])).toContain('<dc:title>The Ferry &amp; the Flood</dc:title>')
    expect(strFromU8(files['[Content_Types].xml'])).toContain('wordprocessingml.document.main+xml')
  })

  it('never writes characters XML forbids', () => {
    const document = strFromU8(unzipSync(writeDocx({ title: 'Bad\u0001title', chapters: [] }))['word/document.xml'])
    expect(document).toContain('Badtitle')
  })
})

describe('EPUB', () => {
  it('puts the mimetype first, stored as it is, then a valid package with a contents page and one page per chapter', () => {
    const data = writeEpub(BOOK, { id: 'urn:uuid:test', at: new Date('2026-10-03T10:00:00.123Z') })
    // The first entry's local header: "PK\x03\x04", stored (method 0), named "mimetype", holding the type.
    expect(Buffer.from(data.subarray(0, 4)).toString('latin1')).toBe('PK\u0003\u0004')
    expect(data[8] | (data[9] << 8)).toBe(0)
    expect(Buffer.from(data.subarray(30, 38)).toString('latin1')).toBe('mimetype')
    expect(Buffer.from(data.subarray(38, 58)).toString('latin1')).toBe('application/epub+zip')

    const files = unzipSync(data)
    expect(Object.keys(files)).toEqual([
      'mimetype',
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/toc.ncx',
      'OEBPS/style.css',
      'OEBPS/title.xhtml',
      'OEBPS/chapter-001.xhtml',
      'OEBPS/chapter-002.xhtml'
    ])
    const opf = strFromU8(files['OEBPS/content.opf'])
    expect(opf).toContain('<dc:title>The Ferry &amp; the Flood</dc:title>')
    expect(opf).toContain('<meta property="dcterms:modified">2026-10-03T10:00:00Z</meta>')
    expect(opf).toContain('properties="nav"')
    expect(opf).toMatch(/<itemref idref="title-page"\/>\s*<itemref idref="chapter-1"\/>\s*<itemref idref="chapter-2"\/>/)
    expect(strFromU8(files['OEBPS/nav.xhtml'])).toContain('<a href="chapter-002.xhtml">Chapter 2: The Crossing</a>')
    const ch1 = strFromU8(files['OEBPS/chapter-001.xhtml'])
    expect(ch1).toContain('<p class="first">The rain had <em>not</em> stopped.</p>')
    expect(ch1).toContain('class="scene-break"')
    expect(ch1).toContain('<p class="first">Mara <strong>waited</strong> &lt;here&gt;.</p>')
    expect(strFromU8(files['OEBPS/chapter-002.xhtml'])).toContain('<blockquote>\n<p>A letter.</p>\n</blockquote>')
  })

  it('writes well-formed pages', () => {
    for (const [name, text] of epubParts(BOOK)) {
      if (!name.endsWith('.xhtml')) continue
      // Every element opened is closed (a rough check: no bare <br> or <meta ...> without a slash).
      expect(text).not.toMatch(/<(br|meta|link|hr)(\s[^>]*[^/])?>/)
    }
  })
})

describe('Markdown, plain text and the page printed to PDF', () => {
  it('writes Markdown with headings, emphasis and scene breaks', () => {
    expect(bookMarkdown(BOOK)).toBe(
      [
        '# The Ferry & the Flood',
        '## Chapter 1',
        'The rain had *not* stopped.',
        '* * *',
        'Mara **waited** \\<here\\>.',
        '## Chapter 2: The Crossing',
        '> A letter.'
      ].join('\n\n') + '\n'
    )
  })

  it('writes plain text with only the words', () => {
    const text = bookText(BOOK)
    expect(text).toContain('The Ferry & the Flood\n\n\n\nCHAPTER 1\n\nThe rain had not stopped.\n\n* * *\n\nMara waited <here>.')
    expect(text).toContain('CHAPTER 2\nThe Crossing\n\nA letter.')
  })

  it('prints a title page and each chapter on a new page', () => {
    const html = printHtml(BOOK)
    expect(html).toContain('<section class="title-page"><h1>The Ferry &amp; the Flood</h1></section>')
    expect(html.match(/class="chapter-page"/g)).toHaveLength(2)
    expect(html).toContain('.chapter-page { break-before: page; }')
    expect(html).toContain('@page { size: A5;')
  })
})

describe('the series bible', () => {
  it('lists entries by kind with their fields, relationships and the plot threads, without ids', () => {
    const { db, storyId } = storyWorld()
    const mara = repo.createEntry(db, 'character', { name: 'Mara Venn', summary: 'A ferrywoman.', fields: { pronouns: 'she/her', eyes: 'grey' }, aliases: ['Mar'] })
    repo.createEntry(db, 'place', { name: 'Ashford', description: 'A river town.' })
    repo.createEntry(db, 'lore', { name: 'The Tide Law', hardRule: true, fields: { rules: 'No crossing at night.' } })
    repo.createEntry(db, 'thread', { name: 'Who sank the ferry?', fields: { promise: 'Someone sank it on purpose.' } })
    const bible = readBible(db, storyId)
    expect(bible.asOf).toBe('As of the end of The Ferry & the Flood.')
    expect(bible.sections.map((s) => s.title)).toEqual(['Characters', 'Places', 'Lore'])
    expect(bible.sections[0].entries[0]).toMatchObject({
      name: 'Mara Venn',
      aliases: ['Mar'],
      summary: 'A ferrywoman.',
      fields: [
        { label: 'Pronouns', value: 'she/her' },
        { label: 'Eyes', value: 'grey' }
      ]
    })
    const md = bibleMarkdown(bible)
    expect(md).toContain('# Reach: series bible')
    expect(md).toContain('### Mara Venn')
    expect(md).toContain('- **Pronouns:** she/her')
    expect(md).toContain('**A rule never to break.**')
    expect(md).toContain('## Timeline')
    expect(md).toContain('## Plot threads')
    expect(md).toContain('### Who sank the ferry?')
    expect(md).toContain('Someone sank it on purpose.')
    expect(md).not.toContain(mara.id)
    expect(md).not.toContain(storyId)
  })
})
