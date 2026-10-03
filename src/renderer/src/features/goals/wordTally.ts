// Writing by hand: counting the words Adam writes each day, typed and AI apart, as the page changes.
//
// Every change dispatched to the scene editor is sorted by where it came from:
//  - typed: Adam's own typing, pasting and dictation (anything without a mark of its own); the net new words
//  - ai: a draft streaming in (Generate, Beat by beat), an accepted AI edit or Continue, a picked variant
//    (WORDS_META 'ai'); the words the AI put on the page
//  - not counted: undo and redo, changes not meant for the undo history, and anything marked WORDS_META 'none'
//    (a restored version, switching drafts, find and replace)
// Opening a scene swaps the editor's state without a change, so it never counts.
//
// "AI words kept": undoing an AI change (Ctrl+Z, or a message's Undo putting the page back as it was) takes its
// words back off the day it was counted on, and redoing it puts them back.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { isHistoryTransaction } from '@tiptap/pm/history'
import { countWords } from '@shared/defaults'
import { streamKey } from '@/features/editor/streamDoc'
import { suggestionsKey } from '@/features/edits/suggestions'
import { WORDS_META } from './wordsMeta'

export type ChangeKind = 'typed' | 'ai' | 'ai-replace' | 'history' | 'none'

/** Where a change's words came from (see the top of this file). `ai-replace` counts the words put in, not the net. */
export function changeKind(tr: Transaction): ChangeKind {
  const stream = tr.getMeta(streamKey) as { type?: string } | undefined
  if (stream?.type) return stream.type === 'replaced' ? 'ai-replace' : stream.type === 'restored' || stream.type === 'undo-asked' ? 'none' : 'ai'
  if ((tr.getMeta(suggestionsKey) as { type?: string } | undefined)?.type === 'accept') return 'ai-replace'
  const words = tr.getMeta(WORDS_META) as string | undefined
  if (words === 'ai') return 'ai-replace'
  if (words === 'ai-net') return 'ai'
  if (words === 'none') return 'none'
  if (isHistoryTransaction(tr)) return 'history'
  if (tr.getMeta('addToHistory') === false) return 'none'
  return 'typed'
}


const WORD_CHAR = /[\p{L}\p{N}'’-]/u

/** The character just before (or after) a position, inside its paragraph; '' at a paragraph's edge. */
function charBeside(doc: PMNode, pos: number, side: -1 | 1): string {
  if (pos < 0 || pos > doc.content.size) return ''
  const $p = doc.resolve(pos)
  if (!$p.parent.isTextblock) return ''
  const off = $p.parentOffset
  if (side < 0 ? off === 0 : off >= $p.parent.content.size) return ''
  return side < 0 ? $p.parent.textBetween(off - 1, off, undefined, ' ') : $p.parent.textBetween(off, off + 1, undefined, ' ')
}

/** A range widened to whole words, so a letter typed inside a word counts that word once, before and after. */
function wholeWords(doc: PMNode, from: number, to: number): [number, number] {
  let a = from
  let b = to
  for (let i = 0; i < 200 && WORD_CHAR.test(charBeside(doc, a, -1)); i++) a--
  for (let i = 0; i < 200 && WORD_CHAR.test(charBeside(doc, b, 1)); i++) b++
  return [a, b]
}

/** The words a change took out and put in: those of the part of the page that differs, before and after. */
export function changedWords(before: PMNode, after: PMNode): { removed: number; added: number } {
  if (before === after) return { removed: 0, added: 0 }
  const start = before.content.findDiffStart(after.content)
  if (start == null) return { removed: 0, added: 0 }
  const end = before.content.findDiffEnd(after.content)
  let endA = end?.a ?? before.content.size
  let endB = end?.b ?? after.content.size
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  const [fa, ta] = wholeWords(before, start, Math.max(start, endA))
  const [fb, tb] = wholeWords(after, start, Math.max(start, endB))
  return {
    removed: countWords(before.textBetween(fa, ta, ' ', ' ')),
    added: countWords(after.textBetween(fb, tb, ' ', ' '))
  }
}

/** Words to add to a day: typed and AI. `day` is set when they belong to another day than today (an undo). */
export interface WordDelta {
  typed: number
  ai: number
  day?: string
}

interface Landing {
  /** The page just before the AI's words went in. */
  before: PMNode
  words: number
  day: string
  undone: boolean
}

/** The same words on the page (paragraph ids and the like aside). */
const sameText = (a: PMNode, b: PMNode): boolean => a === b || (a.content.size === b.content.size && a.textContent === b.textContent)

/** How many AI changes are remembered for undo. */
const LANDINGS = 8

/**
 * The running count for one editor: what each change adds to the day, and the AI changes made lately, so undoing
 * one takes its words back off. Pure, apart from the day it is told.
 */
export class Tally {
  private landings: Landing[] = []
  private open: Landing | null = null
  private newStream = false

  take(kind: ChangeKind, before: PMNode, after: PMNode, today: string, opts: { streamStart?: boolean; stream?: boolean } = {}): WordDelta {
    if (opts.streamStart) this.newStream = true
    if (before === after) return { typed: 0, ai: 0 }
    if (kind === 'typed') {
      const { removed, added } = changedWords(before, after)
      return { typed: added - removed, ai: 0 }
    }
    if (kind === 'ai' || kind === 'ai-replace') {
      const { removed, added } = changedWords(before, after)
      const n = kind === 'ai' ? added - removed : added
      if (opts.stream) {
        if (this.newStream || !this.open) {
          this.open = this.remember({ before, words: 0, day: today, undone: false })
          this.newStream = false
        }
        this.open.words += n
      } else {
        this.open = null
        this.remember({ before, words: n, day: today, undone: false })
      }
      return { typed: 0, ai: n }
    }
    // Undo, redo, or a page put back as it was: an AI change undone (or redone) changes the AI words kept.
    for (const l of this.landings) {
      if (!l.undone && sameText(after, l.before)) {
        l.undone = true
        if (this.open === l) this.open = null
        return { typed: 0, ai: -l.words, ...(l.day !== today ? { day: l.day } : {}) }
      }
      if (kind === 'history' && l.undone && sameText(before, l.before)) {
        l.undone = false
        return { typed: 0, ai: l.words, ...(l.day !== today ? { day: l.day } : {}) }
      }
    }
    return { typed: 0, ai: 0 }
  }

  /** A new scene is on the page: what was remembered was about the old one. */
  reset(): void {
    this.landings = []
    this.open = null
    this.newStream = false
  }

  private remember(l: Landing): Landing {
    this.landings.unshift(l)
    this.landings.length = Math.min(this.landings.length, LANDINGS)
    return l
  }
}

/** Where the counted words go (the goal store); set once at start. */
let sink: ((d: WordDelta) => void) | null = null
let today: () => string = () => ''
export function setWordSink(fn: ((d: WordDelta) => void) | null, day: () => string): void {
  sink = fn
  today = day
}

/** Counts the words of every change made to the page (see the top of this file). */
export const WordTally = Extension.create<Record<string, never>, { tally: Tally; lastDoc: PMNode | null }>({
  name: 'aiwriteWordTally',
  addStorage: () => ({ tally: new Tally(), lastDoc: null }),
  onTransaction({ transaction }) {
    const after = this.editor.state.doc
    const before = transaction.before
    const store = this.storage
    // Opening another scene swaps the page without a change: what was remembered about the old one goes.
    if (store.lastDoc && before !== store.lastDoc && !before.eq(store.lastDoc)) store.tally.reset()
    store.lastDoc = after
    if (!sink) return
    const stream = transaction.getMeta(streamKey) as { type?: string } | undefined
    const streamStart = stream?.type === 'start'
    if (before === after && !streamStart) return
    const kind = changeKind(transaction)
    // A change another plugin made on top of this one (appended to it) is counted with it: `after` has both.
    const d = store.tally.take(kind, before, after, today(), { streamStart, stream: !!stream })
    if (d.typed || d.ai) sink(d)
  }
})
