// Change it… in the page (2026-10-19, "Keep this, change that"): the revised passage shown as a tracked change of only
// what moved (the words kept as they are, the words cut struck through, the words added marked), worked out word by word
// with Ask's wordDiff (features/ask/wordDiff.ts), paragraph by paragraph, with italics and bold. While the revision is
// still being written, the old words it hasn't reached yet are "pending" (shown faint, not struck), so the passage reads
// whole as it changes. Pure, so it is unit-tested (reviseDiff.test.ts).
import { parseEmphasis } from '@shared/emphasis'
import { wordDiff, type DiffPart } from '@/features/ask/wordDiff'

export type DiffKind = 'same' | 'del' | 'ins' | 'pending'

/** A run of one paragraph's words, with how it changed and how it is marked. */
export interface DiffPiece {
  kind: DiffKind
  text: string
  italic?: boolean
  bold?: boolean
}

/** One paragraph of the change, or a scene break. */
export type DiffPara = DiffPiece[] | 'break'

// Each word carries its marks into the diff as a private-use letter after it, so "*the end*" and "the end" differ.
const ITALIC = ''
const BOLD = ''
const BOTH = ''
const SCENE_BREAK = ''
const MARK = /[]$/

const PARA_SPLIT = /\n[ \t]*\n/
const BREAK_LINE = /^\s*(?:\*\s*){3,}\s*$|^\s*#\s*$/

/** The passage as the diff reads it: paragraphs between blank lines, each word with its marks, a scene break as one word. */
export function encode(text: string): string {
  return text
    .trim()
    .split(PARA_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (BREAK_LINE.test(p)) return SCENE_BREAK
      return parseEmphasis(p)
        .map((piece) => {
          const mark = piece.bold && piece.italic ? BOTH : piece.bold ? BOLD : piece.italic ? ITALIC : ''
          return mark ? piece.text.replace(/\S+/g, (w) => w + mark) : piece.text
        })
        .join('')
    })
    .join('\n\n')
}

const wordCount = (s: string): number => (s.match(/\S+/g) ?? []).length

/** While writing, the old words diffed against what has come: this many words past it, at least (the rest is pending). */
const AHEAD = { times: 2, plus: 60 }

/**
 * The change from `old` to `now`, word by word, as paragraphs to show. `done`: the revision is complete; until then the
 * old words after the last one it has reached are pending rather than cut.
 */
export function revisionParas(old: string, now: string, done: boolean): DiffPara[] {
  const a = encode(old)
  const b = encode(now)
  if (done) return decode(wordDiff(a, b), a)
  // Only the start of the old words is compared while the new ones arrive (a long passage stays quick to redraw).
  const tokens = a.match(/\S+\s*|\s+/g) ?? []
  const reach = Math.min(tokens.length, wordCount(b) * AHEAD.times + AHEAD.plus)
  const rest = tokens.slice(reach).join('')
  const parts: Part[] = wordDiff(tokens.slice(0, reach).join(''), b)
  let last = -1
  parts.forEach((p, i) => {
    if (p.kind === 'same' || p.kind === 'ins') last = i
  })
  const shown: Part[] = parts.map((p, i) => (i > last && p.kind === 'del' ? { kind: 'pending', text: p.text } : p))
  if (rest) shown.push({ kind: 'pending', text: rest })
  return decode(shown, a)
}

type Part = DiffPart | { kind: 'pending'; text: string }

/** The diff's parts as paragraphs of marked pieces. */
function decode(parts: Part[], old: string): DiffPara[] {
  // The old words in order, each with the space after it: where the old paragraphs ended (the kept words show the new
  // spacing, so this is the only place that says it).
  const oldWords = old.match(/\S+\s*/g) ?? []
  let used = 0
  /** True when the old words had a paragraph end straight after the last one used so far. */
  const oldBreak = (): boolean => used > 0 && PARA_SPLIT.test(oldWords[used - 1] ?? '')
  const out: DiffPara[] = []
  let para: DiffPiece[] = []
  const close = (): void => {
    if (para.length) out.push(para)
    para = []
  }
  const add = (kind: DiffKind, text: string, italic: boolean, bold: boolean): void => {
    const last = para[para.length - 1]
    if (last && last.kind === kind && !!last.italic === italic && !!last.bold === bold) last.text += text
    else para.push({ kind, text, ...(italic ? { italic } : {}), ...(bold ? { bold } : {}) })
  }
  /**
   * A paragraph's end held back until the cut words after it have shown: words cut from the end of a paragraph stay at its
   * end, not in a paragraph of their own (the new words' paragraph ends where the kept ones do).
   */
  let heldBreak = false
  parts.forEach((p, i) => {
    if (p.kind === 'gap') return
    const kind = p.kind as DiffKind
    const tokens = p.text.match(/\S+|\s+/g) ?? []
    const next = parts[i + 1]?.kind
    tokens.forEach((token, t) => {
      if (/^\s+$/.test(token)) {
        const last = t === tokens.length - 1
        if (PARA_SPLIT.test(token) && last && kind === 'same' && (next === 'del' || next === 'pending') && para.length && !oldBreak()) {
          heldBreak = true
          add('same', ' ', false, false)
        } else if (PARA_SPLIT.test(token)) {
          heldBreak = false
          close()
        }
        // A space between words of the same paragraph (never at its start): one ending a cut or an addition is no part
        // of it, so neither strike nor mark runs on past its last word.
        else if (para.length) add(t === tokens.length - 1 ? 'same' : kind, token, false, false)
        return
      }
      // An old word used (kept or cut; a scene break is one too).
      if (kind !== 'ins') used++
      if (token === SCENE_BREAK) {
        close()
        // A scene break kept or added shows; one cut shows only as gone (nothing).
        if (kind !== 'del' && kind !== 'pending') out.push('break')
        return
      }
      // Two words never run together (a cut loses its last space before an addition; the newest word has none yet).
      const last = para[para.length - 1]
      if (last && /\S$/.test(last.text)) add('same', ' ', false, false)
      const m = token.match(MARK)?.[0]
      const word = m ? token.slice(0, -1) : token
      add(kind, word, m === ITALIC || m === BOTH, m === BOLD || m === BOTH)
    })
    // The cut words shown, the paragraph held open for them ends.
    if (heldBreak && (kind === 'del' || kind === 'pending')) {
      heldBreak = false
      close()
    }
  })
  close()
  // Spaces at the ends of a paragraph show as nothing.
  return out.map((p) => (p === 'break' ? p : trimEnds(p)))
}

function trimEnds(p: DiffPiece[]): DiffPiece[] {
  const out = p.map((x) => ({ ...x }))
  while (out.length && !out[out.length - 1].text.trim()) out.pop()
  if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '')
  while (out.length && !out[0].text.trim()) out.shift()
  if (out.length) out[0].text = out[0].text.replace(/^\s+/, '')
  return out
}

/** How much moved: words cut and added (pending words count as neither). */
export function movedWords(paras: DiffPara[]): { cut: number; added: number } {
  let cut = 0
  let added = 0
  for (const p of paras) {
    if (p === 'break') continue
    for (const x of p) {
      if (x.kind === 'del') cut += wordCount(x.text)
      if (x.kind === 'ins') added += wordCount(x.text)
    }
  }
  return { cut, added }
}
