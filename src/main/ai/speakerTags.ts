// Who says each line of a draft, from the writer itself (Adam, 2026-10-04: the writer knows who is speaking, so it
// should say so). The writer puts the speaker in curly braces just before a line's opening quote mark, with how it is
// said after a bar when that matters: {Mara|coldly, barely above a whisper}“Get out,” she said. The tags are taken
// out as the draft streams in, so they never reach the page, a record or the word count; what they said is kept for
// reading aloud (readAloud/index.ts, noteWriterSpeakers). Works across chunk boundaries: a tag split between two
// chunks is held back until it is complete. No Electron imports.

import { QUOTE, quoteKey } from '../readAloud/speakers'

/** The longest a tag may be; a brace with no close within it is ordinary text. */
const MAX_TAG = 200
const TAG = /^\{([^{}|\n]{1,60})(?:\|([^{}\n]*))?\}$/

/** A tag as found: where it was in the text as the page has it, who it names, and how the line is said. */
interface FoundTag {
  at: number
  who: string
  tone: string
}

/** A line of dialogue in a draft, the speaker the writer gave it, and how it is said ('' when not said). */
export interface WriterSpeaker {
  /** The quote's key, as read aloud keeps its marks (speakers.ts quoteKey). */
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

  /** The speakers of the lines in `text` (the draft as given out), by the tags just before their quotes. */
  speakers(text: string): WriterSpeaker[] {
    const out: WriterSpeaker[] = []
    for (const t of this.tags) {
      if (!t.who) continue
      const from = t.at + (/^\s{0,3}/.exec(text.slice(t.at))?.[0].length ?? 0)
      const m = new RegExp(QUOTE.source, 'y')
      m.lastIndex = from
      const q = m.exec(text)
      const key = q ? quoteKey(q[0]) : ''
      if (key) out.push({ key, who: t.who, tone: t.tone })
    }
    return out
  }
}

/** The closing instruction's line asking the writer to tag each line of dialogue with its speaker. */
export const SPEAKER_TAG_LINE =
  "- Just before the opening quote mark of every line of dialogue, put who says it in curly braces, with how it is said after a bar: {Mara|coldly, barely above a whisper}“Get out,” she said. Use the character's name exactly as given above; for someone unnamed, a few plain words: {the guard|bored}. Give each quote its own tag, a line that carries on after a dialogue tag too. The tags are taken out before the author reads the scene, so never mention them."
