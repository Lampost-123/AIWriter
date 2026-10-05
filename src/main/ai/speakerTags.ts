// Who says each line of a draft, from the writer itself (Adam, 2026-10-04: the writer knows who is speaking, so it
// should say so). The writer puts the speaker in curly braces just before a line's opening quote mark, with how it is
// said after a bar when that matters: {Mara|coldly, barely above a whisper}“Get out,” she said. The tags are taken
// out as the draft streams in, so they never reach the page, a record or the word count; what they said is kept for
// reading aloud (readAloud/index.ts, noteWriterSpeakers). Works across chunk boundaries: a tag split between two
// chunks is held back until it is complete. No Electron imports.

import { NARRATION, QUOTE, quoteKey, SENTENCE } from '../readAloud/speakers'

/** The longest a tag may be; a brace with no close within it is ordinary text. */
const MAX_TAG = 200
/** Speech in italics, as the writer writes it: between asterisks, within a line. */
const ITALIC_SPEECH = /\*[^*\n]+\*/.source
const TAG = /^\{([^{}|\n]{1,60})(?:\|([^{}\n]*))?\}$/

/** A tag as found: where it was in the text as the page has it, who it names, and how the line is said. */
interface FoundTag {
  at: number
  who: string
  tone: string
}

/**
 * A line of dialogue in a draft, the speaker the writer gave it, and how it is said ('' when not said); or a sentence
 * of narration and how the narrator reads it (its key starts with NARRATION, and `who` is '').
 */
export interface WriterSpeaker {
  /** The quote's key, or the narration sentence's, as read aloud keeps its marks (speakers.ts quoteKey). */
  key: string
  who: string
  tone: string
}

export class SpeakerTagFilter {
  private tags: FoundTag[] = []
  private held = ''
  /** Characters given out so far. */
  private out = 0
  private last = '\n'
  /** After a tag that stood between spaces: the space after it goes too, so the words keep one space. */
  private eat = false

  /** The text of a chunk with any tags taken out (some may be held back until the next chunk). */
  push(chunk: string): string {
    const s = this.held + chunk
    this.held = ''
    let res = ''
    let i = 0
    while (i < s.length) {
      const ch = s[i]
      if (this.eat && (ch === ' ' || ch === '\t')) {
        i++
        continue
      }
      this.eat = false
      if (ch === '{') {
        const close = s.indexOf('}', i)
        const nl = s.indexOf('\n', i)
        if (close === -1 && nl === -1 && s.length - i <= MAX_TAG) {
          // Perhaps a tag still arriving: wait for the rest.
          this.held = s.slice(i)
          break
        }
        if (close !== -1 && (nl === -1 || nl > close) && close - i <= MAX_TAG) {
          const m = TAG.exec(s.slice(i, close + 1))
          if (m) {
            this.tags.push({ at: this.out + res.length, who: m[1].trim(), tone: (m[2] ?? '').trim() })
            const before = res ? res[res.length - 1] : this.last
            this.eat = /\s/.test(before)
            i = close + 1
            continue
          }
        }
      }
      res += ch
      i++
    }
    if (res) {
      this.out += res.length
      this.last = res[res.length - 1]
    }
    return res
  }

  /** What is still held back at the end: a tag that never closed is dropped, anything else given out. */
  flush(): string {
    const h = this.held
    this.held = ''
    if (!h || /^\{[^{}\n]*$/.test(h)) return ''
    return this.push(h)
  }

  /**
   * The speakers of the lines in `text` (the draft as given out), by the tags before their quotes. A tag goes with
   * the quote (or italic speech) it stands just before, as asked; a writer that put it elsewhere is still followed:
   * inside the quote after its opening mark, right after the quote, before the narration that leads to the quote in
   * the same paragraph, or at the end of the paragraph after its last quote. Each line takes one tag. A tag that
   * only says "she" or "he" names nobody: the rules, or the AI, say who that is.
   */
  speakers(text: string): WriterSpeaker[] {
    const out: WriterSpeaker[] = []
    const lines = [...text.matchAll(new RegExp(`${QUOTE.source}|${ITALIC_SPEECH}`, 'g'))].map((m) => ({
      at: m.index!,
      end: m.index! + m[0].length,
      key: quoteKey(m[0])
    }))
    const taken = new Set<number>()
    const claim = (pick: (l: (typeof lines)[number]) => boolean): (typeof lines)[number] | undefined => {
      const i = lines.findIndex((l, k) => !taken.has(k) && l.key && pick(l))
      if (i < 0) return undefined
      taken.add(i)
      return lines[i]
    }
    this.tags.forEach((t, n) => {
      if (!t.who) return
      const from = t.at + (/^\s{0,3}/.exec(text.slice(t.at))?.[0].length ?? 0)
      // {~hushed, dread building}: how the narrator reads the sentence it starts (up to any quote in it).
      if (t.who.startsWith('~')) {
        const tone = [t.who.slice(1).trim(), t.tone].filter(Boolean).join(', ')
        const rest = text.slice(from).split(/["“\n]/)[0]
        const sentence = new RegExp(SENTENCE.source, 'y').exec(rest)?.[0] ?? ''
        const key = quoteKey(sentence)
        if (key && tone) out.push({ key: NARRATION + key, who: '', tone })
        return
      }
      if (PRONOUN_TAG.test(t.who)) return
      // How far along the paragraph the tag reaches: to the next tag, or the paragraph's end.
      const lineEnd = text.indexOf('\n', t.at)
      const reach = Math.min(this.tags[n + 1]?.at ?? text.length, lineEnd === -1 ? text.length : lineEnd)
      const lineStart = text.lastIndexOf('\n', t.at - 1) + 1
      const line =
        claim((l) => l.at === from) ??
        claim((l) => l.at < t.at && t.at <= l.end) ??
        claim((l) => l.end <= t.at && /^\s*$/.test(text.slice(l.end, t.at))) ??
        claim((l) => l.at >= from && l.at < reach) ??
        claim((l) => l.at >= lineStart && l.end <= t.at && !lines.some((m) => m.at > l.at && m.end <= t.at))
      if (line) out.push({ key: line.key, who: t.who, tone: t.tone })
    })
    return out
  }
}

/** A tag that names nobody: "she", "he", "they" are whoever the rules or the AI say they are. */
const PRONOUN_TAG = /^(?:he|she|they|it|i|we|you|him|her|them)$/i

/** The closing instruction's line asking the writer to note how the narration is read too (Mark who says what). */
export const NARRATION_TAG_LINE =
  '- At the start of each paragraph of narration, and where its mood turns, put how the narrator reads it in curly braces after a tilde: {~hushed, dread building}The stairs went on. A few words, for an audiobook narrator: the feeling and how it sounds.'

/** The closing instruction's line asking the writer to tag each line of dialogue with its speaker. */
export const SPEAKER_TAG_LINE =
  "- Just before the opening quote mark of every line of dialogue (or the opening asterisk of speech in italics), put who says it in curly braces, with how it is said after a bar: {Mara|coldly, barely above a whisper}“Get out,” she said. Use the character's name exactly as given above (a thing or creature that talks too, by its page's name: {Ring|sly}); for someone unnamed, a few plain words: {the guard|bored}, never just he or she. Give each quote its own tag, a line that carries on after a dialogue tag too. The tags are taken out before the author reads the scene, so never mention them."
