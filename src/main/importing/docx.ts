// Reading a Word file (.docx): its paragraphs in order, with bold and italic, from word/document.xml.
// - Headings by style: Word's own heading styles, any style whose outline level makes it a heading (so
//   custom heading styles still count, read from word/styles.xml with the styles they are based on), a
//   paragraph's own outline level, and styles named for chapters, parts or scenes ("Chapter Title").
// - The Title style is the book's title (else the document's own title, else the file's name).
// - Page breaks are noted on the paragraph after them.
// - Comments, footnotes, text boxes, field codes, hidden text, the table of contents and tracked deletions
//   are left out; tracked insertions are kept (the text as it stands with every change accepted).
// Pure (takes the file's bytes), no Electron imports.

import { unzipSync, strFromU8 } from 'fflate'
import type { Manuscript, ManuscriptBlock, ManuscriptRun } from '@shared/contracts/importing'
import { UserError } from '../util'
import { attr, xmlTokens } from './xml'
import { baseName, blockOfLine, finishBlocks, headingHint, plainLine, tidy } from './lines'

// ---------- Styles ----------

interface Style {
  id: string
  type: string
  name: string
  basedOn: string | null
  /** 0 to 8 makes a heading; 9 is body text. */
  outline: number | null
  bold: boolean | null
  italic: boolean | null
}

/** What a paragraph style makes a paragraph. */
interface ParaStyle {
  level: number | null
  hint: ManuscriptBlock['hint']
  title: boolean
  /** Front matter that is never part of the story: the subtitle, table of contents entries. */
  skip: boolean
  /** The style makes it a heading (by level, or a name like "Chapter Title"). */
  heading: boolean
}

/** On unless the value says off ("0", "false", "off", "none"). */
const isOn = (attrs: string): boolean => !/^(0|false|off|none)$/i.test(attr(attrs, 'w:val') ?? '')

function readStyles(xml: string | null): Map<string, Style> {
  const styles = new Map<string, Style>()
  if (!xml) return styles
  let cur: Style | null = null
  let inRPr = false
  for (const t of xmlTokens(xml)) {
    if (t.type === 'text') continue
    if (t.name === 'w:style') {
      if (t.type === 'close') {
        if (cur) styles.set(cur.id, cur)
        cur = null
      } else if (t.type === 'open') {
        cur = { id: attr(t.attrs, 'w:styleId') ?? '', type: attr(t.attrs, 'w:type') ?? '', name: '', basedOn: null, outline: null, bold: null, italic: null }
      }
      continue
    }
    if (!cur) continue
    if (t.name === 'w:rPr') inRPr = t.type === 'open'
    else if (t.type === 'close') continue
    else if (t.name === 'w:name') cur.name = attr(t.attrs, 'w:val') ?? ''
    else if (t.name === 'w:basedOn') cur.basedOn = attr(t.attrs, 'w:val')
    else if (t.name === 'w:outlineLvl') {
      const n = Number(attr(t.attrs, 'w:val'))
      if (Number.isInteger(n)) cur.outline = n
    } else if (inRPr && t.name === 'w:b') cur.bold = isOn(t.attrs)
    else if (inRPr && t.name === 'w:i') cur.italic = isOn(t.attrs)
  }
  return styles
}

/** A style and the styles it is based on, nearest first (at most 12, so a loop in a broken file ends). */
function chain(styles: Map<string, Style>, id: string | null): Style[] {
  const out: Style[] = []
  let s = id ? styles.get(id) : undefined
  while (s && out.length < 12 && !out.includes(s)) {
    out.push(s)
    s = s.basedOn ? styles.get(s.basedOn) : undefined
  }
  return out
}

function paraStyle(styles: Map<string, Style>, id: string | null): ParaStyle {
  const none: ParaStyle = { level: null, hint: null, title: false, skip: false, heading: false }
  const list = chain(styles, id)
  // Word's own names, whatever language the styles are shown in: "heading 1", "Title"; the id when there is no name.
  const names = list.map((s) => (s.name || s.id).trim())
  const own = names[0] ?? id ?? ''
  if (/^(title|titel|titre|título|titolo)$/i.test(own) || /^title$/i.test(id ?? '')) return { ...none, title: true }
  if (/^subtitle$/i.test(own) || /^subtitle$/i.test(id ?? '') || /^toc\s*\d|^toc heading$/i.test(own)) return { ...none, skip: true }
  for (const [i, s] of list.entries()) {
    const name = names[i]
    const heading = /^heading\s*([1-9])$/i.exec(name) ?? /^heading([1-9])$/i.exec(s.id)
    if (heading) return { ...none, level: Number(heading[1]), heading: true }
    if (s.outline != null && s.outline >= 0 && s.outline <= 8) return { ...none, level: s.outline + 1, heading: true }
  }
  // Word's own heading styles used without being written into styles.xml (or with no styles.xml at all).
  const builtIn = list.length ? null : /^heading\s*([1-9])$/i.exec(own)
  if (builtIn) return { ...none, level: Number(builtIn[1]), heading: true }
  // A style of the writer's own, named for what it is.
  if (/chapter/i.test(own)) return { ...none, hint: 'chapter', heading: true }
  if (/\b(part|book|act)\b/i.test(own) && /title|heading|head|name/i.test(own)) return { ...none, hint: 'part', heading: true }
  if (/scene/i.test(own) && /title|heading|head|name/i.test(own)) return { ...none, hint: 'scene', heading: true }
  if (/heading/i.test(own)) return { ...none, level: 1, heading: true }
  return none
}

// ---------- The document ----------

/** Elements whose content is never part of the text. */
const SKIP = new Set([
  'w:del', // tracked deletions
  'w:moveFrom',
  'w:delText',
  'w:delInstrText',
  'w:instrText', // field codes ("PAGE", "TOC \o")
  'w:fldData',
  'w:txbxContent', // text boxes
  'mc:Fallback', // a second copy of drawings and text boxes for older Word
  'w:drawing',
  'w:pict',
  'w:object',
  'w:pPrChange', // formatting before a tracked change
  'w:rPrChange',
  'w:sectPrChange',
  'w:footnotePr',
  'w:endnotePr'
])

interface Para {
  styleId: string | null
  outline: number | null
  pageBreak: boolean
  /** A break after this paragraph (a page break or a new section): the next paragraph starts a page. */
  breakAfter: boolean
  runs: ManuscriptRun[]
}

interface Run {
  bold: boolean | null
  italic: boolean | null
  hidden: boolean
  styleId: string | null
}

function addText(p: Para, text: string, bold: boolean, italic: boolean): void {
  if (!text) return
  const last = p.runs[p.runs.length - 1]
  if (last && !!last.bold === bold && !!last.italic === italic) last.text += text
  else p.runs.push({ text, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) })
}

/** The paragraph's runs without spaces at either end, and with none left empty. */
function trimRuns(runs: ManuscriptRun[]): ManuscriptRun[] {
  const out = runs.map((r) => ({ ...r, text: tidy(r.text) }))
  while (out.length && !out[0].text.replace(/^[ \n]+/, '')) out.shift()
  while (out.length && !out[out.length - 1].text.replace(/[ \n]+$/, '')) out.pop()
  if (!out.length) return out
  out[0].text = out[0].text.replace(/^[ \n]+/, '')
  out[out.length - 1].text = out[out.length - 1].text.replace(/[ \n]+$/, '')
  return out.filter((r) => r.text)
}

/** The parts of a .docx this needs, or a plain-words error when it isn't one. */
function unzipDocx(bytes: Uint8Array): { document: string; styles: string | null; core: string | null } {
  const unzip = (names: Set<string>): Record<string, Uint8Array> => {
    try {
      return unzipSync(bytes, { filter: (f) => names.has(f.name) })
    } catch {
      throw new UserError(
        "That file isn't a Word document AI Write can read. If it opens in Word, save it again as a Word Document (.docx) and import that.",
        'not-docx'
      )
    }
  }
  // The main part is usually word/document.xml, but some programs name it otherwise (word/document2.xml); the
  // package's own list of parts (_rels/.rels) says which it is.
  const rels = unzip(new Set(['_rels/.rels']))['_rels/.rels']
  const target = rels ? /<Relationship\b[^>]*\bType="[^"]*\/officeDocument"[^>]*>/.exec(strFromU8(rels))?.[0] : undefined
  const named = target ? /\bTarget="\/?([^"]+)"/.exec(target)?.[1] : undefined
  const main = named && /\.xml$/i.test(named) ? named : 'word/document.xml'
  const folder = main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : ''
  const files = unzip(new Set([main, 'word/document.xml', `${folder}styles.xml`, 'docProps/core.xml']))
  const doc = files[main] ?? files['word/document.xml']
  if (!doc) throw new UserError("That file doesn't have a Word document inside it. Save it again from Word as a .docx and import that.", 'not-docx')
  const text = (f: Uint8Array | undefined): string | null => (f ? strFromU8(f) : null)
  return { document: strFromU8(doc), styles: text(files[`${folder}styles.xml`]), core: text(files['docProps/core.xml']) }
}

/** The document's own title (File › Properties), if it has one. */
function coreTitle(xml: string | null): string {
  const m = xml ? /<dc:title>([\s\S]*?)<\/dc:title>/.exec(xml) : null
  return m ? plainLine(m[1].replace(/<[^>]+>/g, '')) : ''
}

/** Reads a Word file's text into blocks. Throws a plain-words error for a file that isn't a .docx. */
export function readDocx(bytes: Uint8Array, fileName: string): Manuscript {
  const parts = unzipDocx(bytes)
  const styles = readStyles(parts.styles)
  const blocks: ManuscriptBlock[] = []
  let title = ''
  let skipping: string[] = []
  let para: Para | null = null
  let run: Run | null = null
  let inPPr = false
  let inRPr = false
  let inText = false
  /** A page break waiting for the next paragraph with words. */
  let pageBreakNext = false

  const runLook = (r: Run): { bold: boolean; italic: boolean } => {
    const charStyle = chain(styles, r.styleId)
    const from = (k: 'bold' | 'italic'): boolean => r[k] ?? charStyle.find((s) => s[k] != null)?.[k] ?? false
    return { bold: from('bold'), italic: from('italic') }
  }

  const endPara = (p: Para): void => {
    const runs = trimRuns(p.runs)
    const text = runs.map((r) => r.text).join('')
    const pageBreak = p.pageBreak || pageBreakNext
    if (!plainLine(text)) {
      // An empty paragraph carrying a page break passes it on to the next one with words.
      pageBreakNext = pageBreak || p.breakAfter
      return
    }
    pageBreakNext = p.breakAfter
    const style = paraStyle(styles, p.styleId)
    const extra = pageBreak ? { pageBreak } : {}
    // The Title style once the story has begun is a heading (some writers head every chapter with it), so its
    // words stay in the story and can start a chapter.
    if (style.title && blocks.some((b) => b.kind !== 'title')) {
      blocks.push({ kind: 'heading', text: plainLine(text), level: null, hint: headingHint(text) ?? 'chapter', ...extra })
      return
    }
    if (style.title) {
      if (!title) title = plainLine(text)
      blocks.push({ kind: 'title', text: plainLine(text) })
      return
    }
    if (style.skip) return
    const level = p.outline != null && p.outline >= 0 && p.outline <= 8 ? p.outline + 1 : style.level
    if (level != null || style.heading) {
      blocks.push({ kind: 'heading', text: plainLine(text), level, hint: style.hint ?? headingHint(text), ...extra })
      return
    }
    blocks.push(blockOfLine(text, () => ({ kind: 'para', text, runs, ...extra }), pageBreak))
  }

  for (const t of xmlTokens(parts.document)) {
    if (skipping.length) {
      if (t.type === 'open' && t.name === skipping[skipping.length - 1]) skipping.push(t.name)
      else if (t.type === 'close' && t.name === skipping[skipping.length - 1]) skipping.pop()
      continue
    }
    if (t.type === 'text') {
      if (inText && para && run && !run.hidden) {
        const look = runLook(run)
        addText(para, t.text, look.bold, look.italic)
      }
      continue
    }
    if (SKIP.has(t.name)) {
      if (t.type === 'open') skipping = [t.name]
      continue
    }
    const open = t.type !== 'close'
    switch (t.name) {
      case 'w:p':
        // <w:p/> is an empty paragraph: nothing to keep.
        if (t.type === 'open') para = { styleId: null, outline: null, pageBreak: false, breakAfter: false, runs: [] }
        else if (t.type === 'close' && para) {
          endPara(para)
          para = null
        }
        break
      case 'w:pPr':
        inPPr = t.type === 'open'
        break
      case 'w:r':
        run = t.type === 'open' ? { bold: null, italic: null, hidden: false, styleId: null } : null
        inRPr = false
        break
      case 'w:rPr':
        // Run properties; inside a paragraph's own properties they are the paragraph mark's, which show nothing.
        inRPr = t.type === 'open' && !!run && !inPPr
        break
      case 'w:t':
        inText = t.type === 'open'
        break
      default:
        if (!open || !para) break
        if (inPPr) {
          if (t.name === 'w:pStyle') para.styleId = attr(t.attrs, 'w:val')
          else if (t.name === 'w:outlineLvl') {
            const n = Number(attr(t.attrs, 'w:val'))
            if (Number.isInteger(n)) para.outline = n
          } else if (t.name === 'w:pageBreakBefore' && isOn(t.attrs)) para.pageBreak = true
          // A section break in the paragraph's properties ends the section (and, usually, the page) after it.
          else if (t.name === 'w:sectPr') para.breakAfter = true
          break
        }
        if (inRPr && run) {
          if (t.name === 'w:b') run.bold = isOn(t.attrs)
          else if (t.name === 'w:i') run.italic = isOn(t.attrs)
          else if (t.name === 'w:rStyle') run.styleId = attr(t.attrs, 'w:val')
          else if ((t.name === 'w:vanish' || t.name === 'w:webHidden') && isOn(t.attrs)) run.hidden = true
          break
        }
        if (!run || run.hidden) break
        if (t.name === 'w:tab' || t.name === 'w:ptab') addText(para, ' ', false, false)
        else if (t.name === 'w:br' || t.name === 'w:cr') {
          const type = attr(t.attrs, 'w:type')
          if (type === 'page') {
            if (para.runs.some((r) => r.text.trim())) para.breakAfter = true
            else para.pageBreak = true
          } else if (type !== 'column') {
            const look = runLook(run)
            addText(para, '\n', look.bold, look.italic)
          }
        } else if (t.name === 'w:noBreakHyphen') {
          const look = runLook(run)
          addText(para, '-', look.bold, look.italic)
        }
    }
  }
  return finishBlocks(fileName, 'docx', title || coreTitle(parts.core) || baseName(fileName), blocks)
}
