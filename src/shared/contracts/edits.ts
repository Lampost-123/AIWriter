// The AI tools for selected words (milestone 4, "Editing with AI"): Rewrite with an instruction,
// Expand, Condense, More vivid, Change tone, Fix voice, Alternatives, and Continue from the cursor.
// Owned by the AI edits part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Each call is an 'edit' generation record with `params.tool`, run by the shared task runner (task:*
// events). Its result shows in the page as a tracked change (old words struck through, new words
// highlighted) with Accept and Reject; nothing changes in the scene until Accept, which is one step
// Ctrl+Z takes back.
import type { EditTool, ID } from '../types'

/**
 * One AI edit of selected words, or Continue, as the page shows them now (Adam's unsaved typing
 * included). Texts are as the AI is sent them: paragraphs separated by a blank line, *asterisks*
 * around italics and **pairs** around bold, a scene break as "* * *".
 */
export interface EditInput {
  /** Made by the interface (any unique id), so every task event can be matched to it. */
  taskId: ID
  sceneId: ID
  tool: EditTool
  /** Rewrite: Adam's instruction. Change tone: the tone ("Tense", or his own words). Empty for the other tools. */
  direction?: string
  /** The selected words; empty for Continue from the cursor. */
  selection: string
  /** All of the scene's text before the selected words (or the cursor). The main process keeps what it needs. */
  before: string
  /** All of the scene's text after them. */
  after: string
  /**
   * Continue only: 'inline' carries on the paragraph at the cursor from where it stops (it stops
   * mid-sentence, or has more words after the cursor); 'paragraph' writes the next paragraphs after it.
   */
  continueAs?: 'inline' | 'paragraph'
}

/**
 * How starting an edit went. `ok: false` means it wasn't sent, for a reason in plain words about these
 * words (Fix voice found no speaker, or the selection is too long); `entryId` and `entryName` are the
 * character whose page would fix it. Problems with the model or the world (no writer model, say) are
 * thrown instead.
 */
export type EditStart =
  | {
      ok: true
      generationId: ID
      /** A plain-words note about how it was set up ("Fixing the voices of Mara and Tobin."), or null. */
      note: string | null
    }
  | { ok: false; problem: string; entryId?: ID; entryName?: string }

export interface EditsApi {
  /** Starts an AI edit (or Continue): its words arrive as task events for `taskId`, in an 'edit' record. */
  startEdit(input: EditInput): Promise<EditStart>
}

export interface EditsEvents {
  // The task events (contracts/tasks.ts) carry everything an edit needs.
}

// ---------- Dialogue ----------
// The interface uses these to offer Fix voice only for words with dialogue in them, and the main
// process to work out who says each line, so both read quotation marks the same way.

/** Where a line of dialogue sits in a paragraph: from its opening quotation mark to just after its closing one. */
export interface QuoteSpan {
  start: number
  end: number
}

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c)

/**
 * The lines of dialogue in one paragraph: words between double quotation marks (curly or straight,
 * paired in order, or « »), or, in a paragraph with none of those, between single curly ones (‘ ’),
 * where an apostrophe inside a word never ends a line. A line still open at the end of the paragraph
 * (speech that carries on into the next one) runs to its end.
 */
export function quoteSpans(paragraph: string): QuoteSpan[] {
  const out: QuoteSpan[] = []
  let open = -1
  for (let i = 0; i < paragraph.length; i++) {
    const c = paragraph[i]
    if (c === '“' || c === '„' || c === '«') {
      // A second opening mark ends a line left open by mistake.
      if (open >= 0) out.push({ start: open, end: i })
      open = i
    } else if (c === '”' || c === '»') {
      if (open >= 0) {
        out.push({ start: open, end: i + 1 })
        open = -1
      }
    } else if (c === '"') {
      if (open >= 0) {
        out.push({ start: open, end: i + 1 })
        open = -1
      } else open = i
    }
  }
  if (open >= 0 && open < paragraph.length - 1) out.push({ start: open, end: paragraph.length })
  if (out.length) return out

  // Single quotation marks: ‘ opens after a space, a bracket or a dash; ’ closes unless a letter follows (don’t).
  open = -1
  for (let i = 0; i < paragraph.length; i++) {
    const c = paragraph[i]
    if (c === '‘' && (i === 0 || /[\s([—–-]/.test(paragraph[i - 1]))) {
      if (open < 0) open = i
    } else if (c === '’' && open >= 0 && !isWordChar(paragraph[i + 1])) {
      out.push({ start: open, end: i + 1 })
      open = -1
    }
  }
  if (open >= 0 && open < paragraph.length - 1) out.push({ start: open, end: paragraph.length })
  return out
}

/** True when the text has a line of dialogue in it. */
export const hasDialogue = (text: string): boolean => text.split(/\n/).some((p) => quoteSpans(p).length > 0)

// ---------- Line breaks ----------
// A line break inside a paragraph (in a letter or a verse) is sent as a single newline; paragraphs are
// separated by a blank line. When the words an edit works on have one, the new words keep theirs: the main
// process asks the AI to, and the interface reads a single newline in the reply as a line break, not as a
// new paragraph.

/** True when the words an edit works on (for Continue, the paragraph it carries on from) have a line break inside a paragraph. */
export function keepsLineBreaks(input: Pick<EditInput, 'tool' | 'selection' | 'before' | 'after'>): boolean {
  const words =
    input.tool === 'continue'
      ? `${input.before.split(/\n[ \t]*\n/).pop() ?? ''}${input.after.split(/\n[ \t]*\n/)[0] ?? ''}`
      : input.selection
  return /[^\n]\n[^\n]/.test(words.trim())
}
