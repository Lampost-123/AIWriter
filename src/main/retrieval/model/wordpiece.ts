// The search model's tokenizer: BERT's own (lower-cased WordPiece, as bge-small-en-v1.5 uses), written fresh so the
// search model needs no new package. Text is cleaned, split on spaces and punctuation, lower-cased with accents taken
// off, then each word is cut into the longest pieces the vocabulary has ("unwanted" -> "un", "##want", "##ed").
// Pure.

/** The longest a word may be before it is unknown, as BERT has it. */
const MAX_WORD_CHARS = 100

const isWhitespace = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || /\p{Zs}/u.test(ch)
const isControl = (ch: string): boolean => {
  if (ch === '\t' || ch === '\n' || ch === '\r') return false
  return /[\p{Cc}\p{Cf}]/u.test(ch)
}
/** BERT counts every ASCII non-letter, non-digit symbol as punctuation, and anything Unicode calls punctuation. */
const isPunctuation = (ch: string): boolean => {
  const cp = ch.codePointAt(0)!
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true
  return /\p{P}/u.test(ch)
}
/** The CJK ideographs BERT splits into single characters. */
const isCjk = (cp: number): boolean =>
  (cp >= 0x4e00 && cp <= 0x9fff) ||
  (cp >= 0x3400 && cp <= 0x4dbf) ||
  (cp >= 0x20000 && cp <= 0x2a6df) ||
  (cp >= 0x2a700 && cp <= 0x2b73f) ||
  (cp >= 0x2b740 && cp <= 0x2b81f) ||
  (cp >= 0x2b820 && cp <= 0x2ceaf) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0x2f800 && cp <= 0x2fa1f)

/** Lower-cased, accents off (as BERT's uncased tokenizer does). */
const lowerPlain = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '')

/** BERT's basic tokenizer: the words and punctuation marks of a text, lower-cased, accents off. */
export function basicTokens(text: string): string[] {
  let cleaned = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0 || cp === 0xfffd || isControl(ch)) continue
    if (isWhitespace(ch)) cleaned += ' '
    else if (isCjk(cp)) cleaned += ` ${ch} `
    else cleaned += ch
  }
  const out: string[] = []
  for (const word of cleaned.split(' ')) {
    if (!word) continue
    let cur = ''
    for (const ch of lowerPlain(word)) {
      if (isPunctuation(ch)) {
        if (cur) out.push(cur)
        out.push(ch)
        cur = ''
      } else cur += ch
    }
    if (cur) out.push(cur)
  }
  return out
}

/** A WordPiece vocabulary (vocab.txt: one piece a line, its id the line number). */
export class WordPiece {
  readonly ids: Map<string, number>
  readonly cls: number
  readonly sep: number
  readonly unk: number

  constructor(vocabText: string) {
    this.ids = new Map()
    vocabText.split(/\r?\n/).forEach((piece, i) => {
      if (piece !== '' && !this.ids.has(piece)) this.ids.set(piece, i)
    })
    const must = (p: string): number => {
      const id = this.ids.get(p)
      if (id === undefined) throw new Error(`The search model's vocabulary has no ${p}`)
      return id
    }
    this.cls = must('[CLS]')
    this.sep = must('[SEP]')
    this.unk = must('[UNK]')
  }

  /** One word's pieces, longest first from the start; [UNK] when it can't be cut. */
  wordPieces(word: string): number[] {
    const chars = [...word]
    if (chars.length > MAX_WORD_CHARS) return [this.unk]
    const out: number[] = []
    let start = 0
    while (start < chars.length) {
      let end = chars.length
      let found: number | undefined
      while (start < end) {
        const piece = (start > 0 ? '##' : '') + chars.slice(start, end).join('')
        found = this.ids.get(piece)
        if (found !== undefined) break
        end--
      }
      if (found === undefined) return [this.unk]
      out.push(found)
      start = end
    }
    return out
  }

  /** A text as the model reads it: [CLS], its pieces (at most `maxLength` - 2), [SEP]. */
  encode(text: string, maxLength = 512): number[] {
    const pieces: number[] = []
    for (const w of basicTokens(text)) {
      pieces.push(...this.wordPieces(w))
      if (pieces.length >= maxLength - 2) break
    }
    return [this.cls, ...pieces.slice(0, maxLength - 2), this.sep]
  }
}
