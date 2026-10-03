// The book as a Word document (.docx), written by hand: the few parts Word needs (content types, the
// document, its styles and settings, the title in its properties), zipped with fflate. The styles use a
// book serif (Georgia, on every Windows computer): a title page, each chapter starting on a new page with
// its number above Adam's own title (that title is Heading 1, so it is in Word's navigation pane),
// paragraphs indented after the first, and scene breaks as a centred ornament. No Electron imports.

import { strToU8, zipSync } from 'fflate'
import type { Block, Book, BookChapter, Run } from './manuscript'
import { esc, ORNAMENT } from './html'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

function runXml(r: Run): string {
  const props = `${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}`
  const parts = r.text.split('\n').map((t) => (t ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : ''))
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${parts.join('<w:br/>')}</w:r>`
}

const para = (style: string, inner: string, extra = ''): string =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${inner}</w:p>`

const plainRun = (text: string): string => `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`

function chapterXml(c: BookChapter): string {
  const out: string[] = []
  if (c.title) {
    out.push(para('ChapterLabel', plainRun(c.label)))
    out.push(para('Heading1', plainRun(c.title)))
  } else {
    out.push(para('Heading1', plainRun(c.label), '<w:pageBreakBefore/><w:spacing w:before="1680"/>'))
  }
  out.push(...blocksXml(c.blocks))
  return out.join('')
}

function blocksXml(blocks: Block[]): string[] {
  const out: string[] = []
  let first = true
  for (const b of blocks) {
    if (b.kind === 'break') {
      out.push(para('SceneBreak', plainRun(ORNAMENT)))
      first = true
      continue
    }
    const style = b.quote ? 'Quote' : first ? 'FirstParagraph' : 'BodyText'
    out.push(para(style, b.runs.map(runXml).join('')))
    if (!b.quote) first = false
  }
  return out
}

/** document.xml: the title page, then the chapters; A4 pages with one-inch margins. */
export function documentXml(book: Book): string {
  const body = [para('Title', plainRun(book.title)), ...book.chapters.map(chapterXml)].join('')
  return `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
}

const font = '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia" w:cs="Georgia"/>'

const style = (id: string, name: string, pPr: string, rPr = '', next = 'BodyText'): string =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="${next}"/><w:qFormat/><w:pPr>${pPr}</w:pPr>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:style>`

export const STYLES_XML = `${XML}<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="336" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/></w:pPr></w:style>
${style('BodyText', 'Body Text', '<w:ind w:firstLine="425"/><w:jc w:val="both"/>')}
${style('FirstParagraph', 'First Paragraph', '<w:jc w:val="both"/>')}
${style('Quote', 'Quote', '<w:spacing w:before="160" w:after="160"/><w:ind w:left="720" w:right="720"/>', '<w:i/>')}
${style('SceneBreak', 'Scene Break', '<w:keepNext/><w:spacing w:before="240" w:after="240"/><w:jc w:val="center"/>', '', 'FirstParagraph')}
${style('ChapterLabel', 'Chapter Number', '<w:keepNext/><w:pageBreakBefore/><w:spacing w:before="1440" w:after="240"/><w:jc w:val="center"/>', '<w:caps/><w:spacing w:val="40"/><w:sz w:val="20"/><w:szCs w:val="20"/>', 'Heading1')}
${style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="240" w:after="720" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>', '<w:sz w:val="40"/><w:szCs w:val="40"/>', 'FirstParagraph')}
${style('Title', 'Title', '<w:spacing w:before="4320" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/>', '<w:sz w:val="56"/><w:szCs w:val="56"/>')}
</w:styles>`

export const SETTINGS_XML = `${XML}<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`

const CONTENT_TYPES = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`

const ROOT_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`

const DOC_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`

const APP_XML = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>AI Write</Application></Properties>`

/** W3C date and time without milliseconds, as the core properties want it. */
const w3cdtf = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

function coreXml(title: string, at: Date): string {
  return `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${w3cdtf(at)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${w3cdtf(at)}</dcterms:modified></cp:coreProperties>`
}

/** The whole .docx file. */
export function writeDocx(book: Book, at: Date = new Date()): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'word/document.xml': strToU8(documentXml(book)),
      'word/styles.xml': strToU8(STYLES_XML),
      'word/settings.xml': strToU8(SETTINGS_XML),
      'word/_rels/document.xml.rels': strToU8(DOC_RELS),
      'docProps/core.xml': strToU8(coreXml(book.title, at)),
      'docProps/app.xml': strToU8(APP_XML)
    },
    { level: 6, mtime: at }
  )
}
