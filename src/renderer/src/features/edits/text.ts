// Text for the AI edits, written against plain ProseMirror documents so it can be tested without a
// browser: the page's words as the AI is sent them, the AI's reply as it should show (without a lead-in
// such as "Here's the rewrite:"), Alternatives' three versions, and where Continue carries on.

import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import { isPreambleLine, isSceneBreakLine, splitParagraphs } from '@/features/editor/streamText'

// ---------- The page's words, as the AI is sent them ----------

/** A run of words with its marker: '' plain, '*' italics, '**' bold (bold and italic together read as bold). */
const markerOf = (marks: readonly { type: { name: string } }[]): string =>
  marks.some((m) => m.type.name === 'bold') ? '**' : marks.some((m) => m.type.name === 'italic') ? '*' : ''

/** Wraps a run in its marker, with spaces at its edges kept outside it ("*He knows,* she said"). */
function wrap(run: string, marker: string): string {
  if (!marker || !run.trim()) return run
  const lead = run.match(/^\s*/)![0]
  const trail = run.match(/\s*$/)![0]
  return `${lead}${marker}${run.slice(lead.length, run.length - trail.length)}${marker}${trail}`
}

/** The words of part of one text block, with *italics* and **bold**; a line break inside the paragraph is a newline. */
function inlineText(block: PMNode, start: number, end: number): string {
  let out = ''
  let run = ''
  let marker = ''
  const flush = (): void => {
    out += wrap(run, marker)
    run = ''
  }
  block.nodesBetween(start, end, (child, pos) => {
    if (child.isText) {
      const text = child.text ?? ''
      const piece = text.slice(Math.max(0, start - pos), Math.min(text.length, end - pos))
      const m = markerOf(child.marks)
      if (m !== marker) {
        flush()
        marker = m
      }
      run += piece
    } else if (child.type.name === 'hardBreak') {
      flush()
      marker = ''
      out += '\n'
    }
    return false
  })
  flush()
  return out
}

/**
 * The text between two positions as the AI is sent it: paragraphs separated by a blank line, *italics*
 * and **bold**, a scene break as "* * *". A paragraph the range only touches counts as an empty one, so
 * the text before words that start a paragraph ends with a blank line.
 */
export function textOf(doc: PMNode, from: number, to: number): string {
  const blocks: string[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'horizontalRule') {
      blocks.push('* * *')
      return false
    }
    if (!node.isTextblock) return true
    blocks.push(inlineText(node, Math.max(0, from - pos - 1), Math.min(node.content.size, to - pos - 1)))
    return false
  })
  return blocks.join('\n\n')
}

// ---------- The selected words ----------

export interface Target {
  from: number
  to: number
}

/** The words between two positions, without the spaces and paragraph ends at their edges; null when there are none. */
export function wordsIn(doc: PMNode, from: number, to: number): Target | null {
  let first = -1
  let last = -1
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true
    const a = Math.max(from, pos)
    const piece = (node.text ?? '').slice(a - pos, Math.min(to, pos + node.nodeSize) - pos)
    const lead = piece.search(/\S/)
    if (lead < 0) return false
    if (first < 0) first = a + lead
    last = a + piece.replace(/\s+$/, '').length
    return false
  })
  return first < 0 ? null : { from: first, to: last }
}

/**
 * The words an AI tool works on: the selection without the spaces and paragraph ends at its edges.
 * A problem in plain words when there are no words in it, or it runs across a scene break.
 */
export function selectedWords(state: EditorState): Target | { problem: string } {
  const { from, to, empty } = state.selection
  const words = empty ? null : wordsIn(state.doc, from, to)
  if (!words) return { problem: 'Select some words first.' }
  if (hasBreakBetween(state.doc, words.from, words.to)) {
    return { problem: 'Select words on one side of the scene break: the AI tools work on one part of a scene at a time.' }
  }
  return words
}

/** True when a scene break lies between two positions. */
function hasBreakBetween(doc: PMNode, from: number, to: number): boolean {
  let found = false
  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'horizontalRule') found = true
    return !found && !node.isTextblock
  })
  return found
}

// ---------- Continue ----------

export interface ContinuePlace {
  /** Where the new words go. */
  at: number
  /**
   * 'inline': they carry on the paragraph at `at` (it stops mid-sentence, has words after the cursor, or
   * is empty). 'paragraph': they are the next paragraphs, after the one at `at` (`at` is its end).
   * 'before': they are new paragraphs ahead of the one at `at` (`at` is its start: the cursor was at the
   * start of a paragraph with words in it).
   */
  mode: 'inline' | 'paragraph' | 'before'
}

/** A paragraph that ends a sentence: its last words end with . ! ? or … (and maybe a closing quotation mark or bracket). */
const endsSentence = (text: string): boolean => /[.!?…]["'”’»)\]]*\s*$/.test(text) || /^\s*(\*\s*){3,}$/.test(text)

/** The rest of a word from a place inside it: letters and digits, and an apostrophe or hyphen inside it ("don’t"). */
const WORD_REST = /^(?:[\p{L}\p{N}]|['’-](?=[\p{L}\p{N}]))+/u

/**
 * Where Continue carries on from a position (the cursor, or the end of the selected words), or a problem
 * in plain words when there's nothing before it to carry on from. From inside a word, it carries on after
 * the whole word.
 */
export function continuePlace(doc: PMNode, pos: number): ContinuePlace | { problem: string } {
  const $pos = doc.resolve(pos)
  if (!$pos.parent.isTextblock) return { problem: 'Put the cursor in the text where the AI should carry on.' }
  if (!doc.textBetween(0, pos, '\n', '\n').trim()) {
    return doc.textBetween(pos, doc.content.size, '\n', '\n').trim()
      ? {
          problem: 'Continue carries on from the words before the cursor. Put the cursor after some words, such as at the end of the scene.'
        }
      : { problem: 'There’s nothing to carry on from yet. Write a line or two first, or press Generate to draft the scene.' }
  }
  const para = $pos.parent
  let offset = $pos.parentOffset
  if (/[\p{L}\p{N}]$/u.test(para.textBetween(0, offset, undefined, '\n'))) {
    offset += WORD_REST.exec(para.textBetween(offset, para.content.size, undefined, '\n'))?.[0].length ?? 0
  }
  const before = para.textBetween(0, offset, undefined, '\n')
  const after = para.textBetween(offset, para.content.size, undefined, '\n')
  // At the start of a paragraph with words: the text before ends with the paragraph (or scene break) before
  // it, so the AI writes new paragraphs, and they go in ahead of this one, which stays as it is.
  if (!before.trim() && after.trim()) return { at: $pos.start(), mode: 'before' }
  if (after.trim() || !before.trim() || !endsSentence(before)) return { at: $pos.start() + offset, mode: 'inline' }
  return { at: $pos.end(), mode: 'paragraph' }
}

/**
 * The space a continuation needs where it joins the words before it, and after it: one between words,
 * none before punctuation, none when there is one already.
 */
export function joinSpaces(before: string, text: string, after: string): { lead: string; trail: string } {
  const startsWord = /^[\p{L}\p{N}“"‘'(«*_]/u.test(text)
  const lead = !before || /\s$/.test(before) ? '' : startsWord ? ' ' : ''
  const endsWord = /[\p{L}\p{N}.,!?;:…”"’')»*_]$/u.test(text)
  const trail = after && /^[\p{L}\p{N}“"‘(«]/u.test(after) && endsWord ? ' ' : ''
  return { lead, trail }
}

// ---------- The AI's reply ----------

/** A first line that introduces the reply instead of being part of it. */
const LEAD_IN = /^(?:here(?:'s|’s| is| are)\b|sure\b|certainly\b|of course\b|okay\b|ok\b|absolutely\b|got it\b)/i
const LABEL =
  /^(?:\*\*)?(?:rewritten|revised|condensed|expanded|edited|updated|new|more vivid|continued|continuation|result|output|text)\b[^\n]{0,40}:(?:\*\*)?\s*$/i

function isLeadIn(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  return isPreambleLine(t) || (LEAD_IN.test(t) && /:\s*$/.test(t)) || LABEL.test(t) || /^\*\*[^*]{1,60}\*\*\s*:?\s*$/.test(t)
}

/** A first line still arriving that might turn out to be a lead-in: it is held back until it ends. */
const mightBeLeadIn = (line: string): boolean => LEAD_IN.test(line.trim()) || /^\s*(#|\*\*|```|""")/.test(line)

const QUOTES = /["“”]/g

/**
 * The reply as it should show in the page: without a lead-in line ("Here's the rewrite:"), a heading, or
 * fences around it, and (for words that weren't in quotation marks) without quotation marks around the
 * whole of it. While it is still arriving (`done` false), a first line that may be a lead-in waits; its
 * quotation marks are only looked at once it has all arrived, so words that start with a line of dialogue
 * never lose and regain their first mark as they come.
 */
export function cleanReply(raw: string, done: boolean, o: { selection?: string } = {}): string {
  let t = raw.replace(/\r\n?/g, '\n').replace(/^\s+/, '')
  for (let i = 0; i < 3; i++) {
    const nl = t.indexOf('\n')
    const first = nl < 0 ? t : t.slice(0, nl)
    if (nl < 0 && !done) {
      // The first few letters, or a line that may become a lead-in, wait until there's more.
      if (mightBeLeadIn(first) || (i === 0 && first.trim().length < 12)) return ''
      break
    }
    if (/^\s*(```|""")\s*\w*\s*$/.test(first) || isLeadIn(first)) {
      t = nl < 0 ? '' : t.slice(nl + 1).replace(/^\s+/, '')
      continue
    }
    break
  }
  // A closing fence.
  t = t.replace(/\n\s*(```|""")\s*$/, '').replace(/(```|""")\s*$/, '')
  if (!done) return t
  // Quotation marks around the whole reply, when the words sent had none at their start.
  const sel = o.selection
  t = t.trim()
  if (sel !== undefined && sel.trim() && !/^\s*["“‘']/.test(sel) && /^["“]/.test(t)) {
    const count = (t.match(QUOTES) ?? []).length
    if (count === 2 && /["”]$/.test(t)) t = t.slice(1, -1).trim()
  }
  return t
}

/** A line that starts one of Alternatives' versions: "=== Version 2 ===", "### Version 2", "**Version 2**", "Version 2:". */
const VERSION_LINE = /^[ \t]*[=#*[(_-]*[ \t]*(?:version|option|alternative)[ \t]+([1-9])[ \t]*[:.)\]]?[ \t]*[=#*\])_-]*[ \t]*$/gim

export interface Versions {
  /** Each version so far (its words as they should show). */
  versions: string[]
  /** How many of them are complete. */
  complete: number
}

const MARKER_WORDS = ['version', 'option', 'alternative']

/** A line still arriving that may become a version's heading ("=== Vers", "Version 2 =="). */
function mightBeMarker(line: string): boolean {
  const t = line.trim()
  const rest = t.replace(/^[=#*[(_-]+[ \t]*/, '')
  if (!rest) return !!t
  const word = /^[a-z]+/i.exec(rest)?.[0] ?? ''
  const full = word ? MARKER_WORDS.find((w) => w.startsWith(word.toLowerCase())) : undefined
  if (!full) return false
  const after = rest.slice(word.length)
  return word.length < full.length ? after === '' : /^[ \t]*[1-9]?[ \t]*[:.)\]]?[ \t]*[=#*\])_-]*$/.test(after)
}

/** Alternatives' reply as its versions (at most three), as far as it has arrived. */
export function parseAlternatives(raw: string, done: boolean): Versions {
  let text = raw.replace(/\r\n?/g, '\n')
  // A heading still arriving isn't shown as the end of the version before it.
  if (!done) {
    const last = text.lastIndexOf('\n') + 1
    if (mightBeMarker(text.slice(last))) text = text.slice(0, last)
  }
  const marks = [...text.matchAll(VERSION_LINE)]
  if (!marks.length) {
    // A reply that ignored the format: all of it is one version, once it's all there.
    const one = done ? cleanReply(text, true) : ''
    return { versions: one ? [one] : [], complete: one ? 1 : 0 }
  }
  const versions: string[] = []
  let complete = 0
  for (let i = 0; i < marks.length && versions.length < 3; i++) {
    const start = (marks[i].index ?? 0) + marks[i][0].length
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? text.length) : text.length
    const finished = i + 1 < marks.length || done
    // One still arriving shows without the blank lines that may come before the next heading.
    const words = cleanReply(text.slice(start, end), finished).trimEnd()
    if (!words && finished) continue
    versions.push(words)
    if (finished) complete++
  }
  return { versions, complete }
}

// ---------- The new words, as paragraphs ----------

/** A scene break among the new words. */
export const BREAK = '\u0000break'

/**
 * Paragraphs separated by blank lines, each keeping its single newlines (line breaks inside it), without
 * spaces at the ends of its lines. A newline still arriving at the end of the text isn't shown yet.
 */
function linesParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n\s*/)
    .map((p) =>
      p
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/, ''))
        .join('\n')
        .replace(/^\s+|\s+$/g, '')
    )
    .filter(Boolean)
}

/**
 * The new words as paragraphs (a scene break line becomes BREAK, but never first or last: the words join
 * the text around them there). With `lineBreaks` (the words sent had a line break inside a paragraph), a
 * single newline is a line break and only a blank line starts a new paragraph; otherwise every line is a
 * paragraph of its own, as in a draft.
 */
export function newParagraphs(text: string, lineBreaks = false): string[] {
  const paras = (lineBreaks ? linesParagraphs(text) : splitParagraphs(text)).map((p) => (isSceneBreakLine(p) ? BREAK : p))
  while (paras.length && paras[0] === BREAK) paras.shift()
  while (paras.length && paras[paras.length - 1] === BREAK) paras.pop()
  // Two breaks in a row are one.
  return paras.filter((p, i) => !(p === BREAK && paras[i - 1] === BREAK))
}
