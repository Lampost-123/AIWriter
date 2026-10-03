// The manuscript readers: Word (a .docx built here with fflate), Markdown and plain text, with the messy
// things real files hold.

import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { Manuscript, ManuscriptBlock } from '@shared/contracts/importing'
import { readDocx } from './docx'
import { readMarkdown } from './markdown'
import { decodeText, readText } from './text'
import { headingHint, isBreakMark } from './lines'
import { readManuscriptBytes } from './read'

// ---------- Building a .docx ----------

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A run: plain text, or [text, 'b' | 'i' | 'bi']. */
type R = string | [string, string]
const run = (r: R): string => {
  const [text, look] = typeof r === 'string' ? [r, ''] : r
  const props = `${look.includes('b') ? '<w:b/>' : ''}${look.includes('i') ? '<w:i/>' : ''}`
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
}
/** A paragraph with a style (or none) and runs, or raw inner XML. */
const p = (style: string | null, ...runs: R[]): string =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs.map(run).join('')}</w:p>`

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="MyChapter"><w:name w:val="Novel Chapter"/><w:basedOn w:val="Heading1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Fancy"><w:name w:val="Fancy Opening"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>
  <w:style w:type="character" w:styleId="Emph"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`

function docx(body: string, opts: { styles?: string | null; title?: string } = {}): Uint8Array {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body}<w:sectPr/></w:body></w:document>`
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(document)
  }
  if (opts.styles !== null) files['word/styles.xml'] = strToU8(opts.styles ?? STYLES)
  if (opts.title) files['docProps/core.xml'] = strToU8(`<cp:coreProperties><dc:title>${esc(opts.title)}</dc:title></cp:coreProperties>`)
  return zipSync(files)
}

const kinds = (m: Manuscript): string[] => m.blocks.map((b) => `${b.kind}:${b.text}`)
const paras = (m: Manuscript): ManuscriptBlock[] => m.blocks.filter((b) => b.kind === 'para')

describe('Word files', () => {
  it('reads headings by style, the title, bold and italic', () => {
    const m = readDocx(
      docx(
        [
          p('Title', 'The Ferry'),
          p('Heading1', 'Chapter One'),
          p(null, 'Mara ', ['ran', 'b'], ' to the ', ['dock', 'i'], '.'),
          p('Heading2', 'Dawn'),
          p(null, ['Both', 'bi'], ' at once.')
        ].join('')
      ),
      'ferry.docx'
    )
    expect(m.title).toBe('The Ferry')
    expect(m.format).toBe('docx')
    expect(kinds(m)).toEqual(['title:The Ferry', 'heading:Chapter One', 'para:Mara ran to the dock.', 'heading:Dawn', 'para:Both at once.'])
    expect(m.blocks[1]).toMatchObject({ level: 1, hint: 'chapter' })
    expect(m.blocks[3]).toMatchObject({ level: 2 })
    expect(m.blocks[2].runs).toEqual([{ text: 'Mara ' }, { text: 'ran', bold: true }, { text: ' to the ' }, { text: 'dock', italic: true }, { text: '.' }])
    expect(m.blocks[4].runs).toEqual([{ text: 'Both', bold: true, italic: true }, { text: ' at once.' }])
    expect(m.words).toBe(8)
  })

  it('counts custom heading styles by what they are based on, their outline level and their name', () => {
    const m = readDocx(docx([p('MyChapter', 'The Ferry'), p(null, 'Text.'), p('Fancy', 'Beginnings'), p(null, 'More.')].join('')), 'x.docx')
    expect(m.blocks[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(m.blocks[2]).toMatchObject({ kind: 'heading', level: 1 })
    // A style named for chapters, with no level of its own.
    const named = readDocx(
      docx(p('ChapterTitle', 'The Ferry') + p(null, 'Text.'), {
        styles: STYLES.replace('</w:styles>', '<w:style w:type="paragraph" w:styleId="ChapterTitle"><w:name w:val="Chapter Title"/></w:style></w:styles>')
      }),
      'x.docx'
    )
    expect(named.blocks[0]).toMatchObject({ kind: 'heading', level: null, hint: 'chapter' })
  })

  it("reads a paragraph's own outline level, and character styles' italic", () => {
    const body =
      '<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>Part of it</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:rStyle w:val="Emph"/></w:rPr><w:t>Leaning</w:t></w:r><w:r><w:t> words.</w:t></w:r></w:p>'
    const m = readDocx(docx(body), 'x.docx')
    expect(m.blocks[0]).toMatchObject({ kind: 'heading', level: 2 })
    expect(m.blocks[1].runs).toEqual([{ text: 'Leaning', italic: true }, { text: ' words.' }])
  })

  it('leaves out tracked deletions, comments, footnotes, field codes, hidden text, text boxes and the table of contents', () => {
    const body =
      p('TOC1', 'Chapter One\t3') +
      '<w:p><w:r><w:t>Kept </w:t></w:r><w:del w:id="1"><w:r><w:delText>deleted </w:delText></w:r></w:del>' +
      '<w:ins w:id="2"><w:r><w:t>inserted </w:t></w:r></w:ins>' +
      '<w:commentRangeStart w:id="3"/><w:r><w:t>words</w:t></w:r><w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r>' +
      '<w:r><w:footnoteReference w:id="4"/></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:rPr><w:vanish/></w:rPr><w:t>secret</w:t></w:r>' +
      '<w:r><mc:AlternateContent><mc:Choice><w:drawing><w:txbxContent><w:p><w:r><w:t>In a box</w:t></w:r></w:p></w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:t>again</w:t></w:pict></mc:Fallback></mc:AlternateContent></w:r>' +
      '</w:p>'
    const m = readDocx(docx(body), 'x.docx')
    expect(kinds(m)).toEqual(['para:Kept inserted words.'])
  })

  it('notes page breaks, keeps line breaks, and makes tabs, smart quotes and odd spaces tidy', () => {
    const body =
      p(null, 'First page.') +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">“Second”\u00a0page,</w:t><w:tab/><w:t>then</w:t><w:br/><w:t>a line.\u200b</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Third.</w:t></w:r></w:p>'
    const m = readDocx(docx(body), 'x.docx')
    expect(paras(m).map((b) => b.text)).toEqual(['First page.', '“Second”\u00a0page, then\na line.', 'Third.'])
    expect(paras(m).map((b) => !!b.pageBreak)).toEqual([false, true, true])
  })

  it('recognises chapter lines in ordinary paragraphs, break marks, and a title on the line after "CHAPTER ONE"', () => {
    const m = readDocx(
      docx([p(null, 'CHAPTER ONE'), p(null, 'The Ferry'), p(null, 'Mara waited.'), p(null, '* * *'), p(null, 'Later.')].join('')),
      'x.docx'
    )
    expect(kinds(m)).toEqual(['heading:CHAPTER ONE: The Ferry', 'para:Mara waited.', 'break:* * *', 'para:Later.'])
    expect(m.blocks[0]).toMatchObject({ level: null, hint: 'chapter' })
  })

  it("takes the document's own title, then the file's name, when there is no Title style", () => {
    expect(readDocx(docx(p(null, 'Text.'), { title: 'From Properties' }), 'x.docx').title).toBe('From Properties')
    expect(readDocx(docx(p(null, 'Text.'), { styles: null }), 'C:\\Books\\My_Book.docx').title).toBe('My Book')
  })

  it('says plainly when a file is not a Word document', () => {
    expect(() => readDocx(strToU8('just text'), 'x.docx')).toThrow(/isn't a Word document/)
    expect(() => readDocx(zipSync({ 'a.txt': strToU8('x') }), 'x.docx')).toThrow(/doesn't have a Word document/)
    expect(() => readManuscriptBytes(strToU8('x'), 'old.doc')).toThrow(/\.docx, not the older \.doc/)
    expect(() => readManuscriptBytes(strToU8('x'), 'book.pdf')).toThrow(/PDF/)
    expect(() => readManuscriptBytes(docx(''), 'empty.docx')).toThrow(/no text in it/)
  })

  it('reads a 150,000-word book quickly', () => {
    const para = p(null, 'The rain had not let up since noon, and the gutters of ', ['Lowtown', 'i'], ' ran black with it again.')
    const chapters: string[] = []
    for (let c = 1; c <= 60; c++) {
      chapters.push(p('Heading1', `Chapter ${c}`))
      for (let s = 0; s < 4; s++) {
        if (s) chapters.push(p(null, '#'))
        for (let i = 0; i < 35; i++) chapters.push(para)
      }
    }
    const bytes = docx(chapters.join(''))
    const t = performance.now()
    const m = readDocx(bytes, 'big.docx')
    const ms = performance.now() - t
    expect(m.words).toBeGreaterThan(140_000)
    expect(m.blocks.filter((b) => b.kind === 'heading')).toHaveLength(60)
    expect(m.blocks.filter((b) => b.kind === 'break')).toHaveLength(180)
    expect(ms).toBeLessThan(3000)
  })
})

describe('Markdown files', () => {
  it('reads headings, emphasis, breaks and front matter', () => {
    const m = readMarkdown(
      [
        '---',
        'title: "The Ferry"',
        'author: Someone',
        '---',
        '',
        '# Chapter 1',
        '',
        'Mara **ran** to the *dock*, and _then_ ***both***.',
        'Still the same paragraph.',
        '',
        '***',
        '',
        'A [link](http://x) and ![a picture](p.png) and `code` and snake_case_word.',
        '',
        '* * *',
        '',
        '#',
        '',
        '## A scene title ##',
        '',
        'Escaped \\*stars\\* stay.'
      ].join('\n'),
      'ferry.md'
    )
    expect(m.title).toBe('The Ferry')
    expect(kinds(m)).toEqual([
      'heading:Chapter 1',
      'para:Mara ran to the dock, and then both. Still the same paragraph.',
      'break:***',
      'para:A link and  and code and snake_case_word.',
      'break:* * *',
      'break:#',
      'heading:A scene title',
      'para:Escaped *stars* stay.'
    ])
    expect(m.blocks[1].runs).toEqual([
      { text: 'Mara ' },
      { text: 'ran', bold: true },
      { text: ' to the ' },
      { text: 'dock', italic: true },
      { text: ', and ' },
      { text: 'then', italic: true },
      { text: ' ' },
      { text: 'both', bold: true, italic: true },
      { text: '. Still the same paragraph.' }
    ])
    expect(m.blocks[6]).toMatchObject({ level: 2 })
  })

  it('reads underlined headings, nested emphasis, line breaks and lists', () => {
    const m = readMarkdown(['Part One', '========', '', 'Chapter Two', '-----------', '', '**bold *and italic* bold**  ', 'next line', '', '- an item'].join('\n'), 'x.md')
    expect(kinds(m)).toEqual(['heading:Part One', 'heading:Chapter Two', 'para:bold and italic bold\nnext line', 'para:an item'])
    expect(m.blocks[0]).toMatchObject({ level: 1, hint: 'part' })
    expect(m.blocks[2].runs).toEqual([
      { text: 'bold ', bold: true },
      { text: 'and italic', bold: true, italic: true },
      { text: ' bold', bold: true },
      { text: '\nnext line' }
    ])
  })

  it('takes a lone # heading over ## chapters as the title', () => {
    const m = readMarkdown(['# My Book', '', '## One', '', 'Text.', '', '## Two', '', 'More.'].join('\n'), 'x.md')
    expect(m.title).toBe('My Book')
    expect(m.blocks[0].kind).toBe('title')
  })

  it('reads a file written a paragraph to a line', () => {
    const lines = ['# Chapter 1', ...Array.from({ length: 30 }, (_, i) => `Paragraph ${i} with words in it.`)]
    const m = readMarkdown(lines.join('\n'), 'x.md')
    expect(paras(m)).toHaveLength(30)
  })
})

describe('Plain text files', () => {
  it('recognises chapter lines in their many forms', () => {
    for (const line of [
      'Chapter 1',
      'CHAPTER ONE',
      'Chapter Twelve: The Ferry',
      'Chapter Twenty-One',
      'chapter 12 - Out at sea',
      'Chapter XII.',
      'Ch. 3',
      'Prologue',
      'Epilogue: After',
      'CHAPTER 3 The Ferry'
    ]) {
      expect(headingHint(line), line).toBe('chapter')
    }
    for (const line of ['Part One', 'PART II', 'Book 2: The Return', 'Act Three']) expect(headingHint(line), line).toBe('part')
    for (const line of [
      'Chapter one was the hardest to write.',
      'Prologues are overrated, she said.',
      'Part of me wanted to stay.',
      'Chapter 3 of the manual says otherwise.',
      'The chapter ended.'
    ]) {
      expect(headingHint(line), line).toBeNull()
    }
    expect(isBreakMark('* * *')).toBe(true)
    expect(isBreakMark('\u00a0#\u00a0')).toBe(true)
    expect(isBreakMark('~~~')).toBe(true)
    expect(isBreakMark('—')).toBe(true)
    expect(isBreakMark('Hello *')).toBe(false)
  })

  it('reads blank-line paragraphs, joining hard-wrapped lines', () => {
    const m = readText(
      ['Prologue', '', 'It was a dark', 'and stormy night.', '', 'CHAPTER ONE', 'The rain fell.', '', '* * *', '', 'Morning came.'].join('\r\n'),
      'C:/Books/storm.txt'
    )
    expect(m.title).toBe('storm')
    expect(kinds(m)).toEqual(['heading:Prologue', 'para:It was a dark and stormy night.', 'heading:CHAPTER ONE', 'para:The rain fell.', 'break:* * *', 'para:Morning came.'])
  })

  it('reads a paragraph to a line, and indented paragraphs', () => {
    const long = Array.from({ length: 10 }, (_, i) => `This is paragraph ${i}, long enough to be a paragraph of its own on one line, as many writers leave them.`)
    const m = readText(['Chapter 1', ...long, 'Chapter 2', ...long].join('\n'), 'x.txt')
    expect(paras(m)).toHaveLength(20)
    expect(m.blocks.filter((b) => b.kind === 'heading')).toHaveLength(2)
    const typed = ['Chapter 1', '    It was a dark', 'and stormy night.', '    The rain fell', 'all evening.', '    Then morning.'].join('\n')
    expect(paras(readText(typed, 'x.txt')).map((b) => b.text)).toEqual(['It was a dark and stormy night.', 'The rain fell all evening.', 'Then morning.'])
  })

  it('counts bare chapter numbers only when there are several', () => {
    const m = readText(['1', '', 'Text one.', '', '2', '', 'Text two.'].join('\n'), 'x.txt')
    expect(m.blocks.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual(['1', '2'])
    const one = readText(['1', '', 'Text one.'].join('\n'), 'x.txt')
    expect(one.blocks.filter((b) => b.kind === 'heading')).toHaveLength(0)
  })

  it('decodes UTF-8, UTF-16 and Windows text', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi')
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe('hi')
    expect(decodeText(new Uint8Array([0x93, 0x68, 0x69, 0x94]))).toBe('“hi”')
  })
})
