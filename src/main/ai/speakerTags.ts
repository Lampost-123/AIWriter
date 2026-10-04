// Who says each line of a draft, from the writer itself (Adam, 2026-10-04: the writer knows who is speaking, so it
// should say so). The writer puts the speaker in curly braces just before a line's opening quote mark, with how it is
// said after a bar when that matters: {Mara|coldly, barely above a whisper}“Get out,” she said. The tags are taken
// out as the draft streams in, so they never reach the page, a record or the word count; what they said is kept for
// reading aloud (readAloud/index.ts, noteWriterSpeakers). Works across chunk boundaries: a tag split between two
// chunks is held back until it is complete. No Electron imports.

import type { GenerationRecord } from '@shared/types'
import { HOW_NOTE, MOOD_NOTE, NARRATION, QUOTE, quoteKey, readMark, SENTENCE } from '../readAloud/speakers'

/** The longest a tag may be; a brace with no close within it is ordinary text. */
const MAX_TAG = 260
/** Speech in italics, as the writer writes it: between asterisks, within a line. */
const ITALIC_SPEECH = /\*[^*\n]+\*/.source
/** A tag: a name (or a tilde and the narration's mood, which may run long), then its fields after bars. */
const TAG = /^\{(~[^{}\n]{1,240}|[^{}|\n]{1,120})(?:\|([^{}\n]*))?\}$/

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
  pace?: 'slow' | 'fast'
  /** A Breeze sound tag at the line's start ("(sigh)"). */
  sound?: string
}

/** A tag's fields read as the marker's notes are (readMark): the tone, and a pace and sound when given. */
function fieldsOf(raw: string): Pick<WriterSpeaker, 'tone' | 'pace' | 'sound'> {
  const how = readMark(`x | ${raw}`).how ?? {}
  return { tone: how.tone ?? '', ...(how.pace ? { pace: how.pace } : {}), ...(how.sound ? { sound: how.sound } : {}) }
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

  /** How well the writer tagged `text` (the draft as given out): kept with its record, to compare models. */
  coverage(text: string): NonNullable<GenerationRecord['params']['speakerTags']> {
    const said = this.speakers(text)
    const lines = said.filter((s) => !s.key.startsWith(NARRATION))
    const quotes = [...text.matchAll(new RegExp(QUOTE.source, 'g'))].filter((m) => quoteKey(m[0])).length
    return {
      quotes,
      tagged: lines.length,
      toned: lines.filter((s) => s.tone).length,
      moods: said.length - lines.length,
      dropped: this.tags.filter((t) => t.who).length - said.length
    }
  }

  /**
   * The speakers of the lines in `text` (the draft as given out). A tag belongs to the line it sits inside (just
   * after the opening quote mark), else to the next line in its paragraph before the next speaker's tag, so a tag
   * a little early ("{Mara|cold} Mara turned. “Get out.”") still finds its line.
   */
  speakers(text: string): WriterSpeaker[] {
    const out: WriterSpeaker[] = []
    const tags = this.tags.filter((t) => t.who)
    const line = `${QUOTE.source}|${ITALIC_SPEECH}`
    for (const [i, t] of tags.entries()) {
      const from = t.at + (/^\s{0,3}/.exec(text.slice(t.at))?.[0].length ?? 0)
      // {~hushed, dread building}: how the narrator reads the sentence it starts (up to any quote in it).
      if (t.who.startsWith('~')) {
        const fields = fieldsOf([t.who.slice(1).trim(), t.tone].filter(Boolean).join('|'))
        const rest = text.slice(from).split(/["“\n]/)[0]
        const sentence = new RegExp(SENTENCE.source, 'y').exec(rest)?.[0] ?? ''
        const key = quoteKey(sentence)
        if (key && (fields.tone || fields.pace || fields.sound)) out.push({ key: NARRATION + key, who: '', ...fields })
        continue
      }
      const inside = new RegExp(line, 'y')
      inside.lastIndex = t.at - 1
      let q = /["“]/.test(text[t.at - 1] ?? '') ? inside.exec(text) : null
      if (!q || !quoteKey(q[0])) {
        const nl = text.indexOf('\n', from)
        const next = tags.slice(i + 1).find((x) => x.at > t.at && !x.who.startsWith('~'))?.at ?? Infinity
        const end = Math.min(nl < 0 ? text.length : nl, next)
        const ahead = new RegExp(line, 'g')
        ahead.lastIndex = from
        q = ahead.exec(text)
        if (q && q.index >= end) q = null
      }
      const key = q ? quoteKey(q[0]) : ''
      if (key) out.push({ key, who: t.who, ...fieldsOf(t.tone) })
    }
    return out
  }
}

/** True when these messages ask the writer to tag who says each line (the closing instruction has SPEAKER_TAG_LINE). */
export const asksForTags = (messages: readonly { content: unknown }[]): boolean =>
  messages.some((m) => typeof m.content === 'string' && m.content.includes(SPEAKER_TAG_LINE))

/** The closing instruction's line asking the writer to note how the narration is read too (Mark who says what). */
export const NARRATION_TAG_LINE = `- Where the narration starts, and wherever its mood turns, put how the narrator reads it in curly braces after a tilde: {~hushed, dread building}The stairs went on. The mood carries on until the next tilde tag, through the dialogue too, so tag only where it changes. A few words: ${MOOD_NOTE}`

/** The closing instruction's line asking the writer to tag each line of dialogue with its speaker. */
export const SPEAKER_TAG_LINE = `- Just before the opening quote mark of every line of dialogue (or the opening asterisk of speech in italics), put who says it and how it is said in curly braces: {Mara|coldly, barely above a whisper}“Get out,” she said. After the name, split by bars: how it is said (always), then a pace (slow or fast) and a sound the speaker makes as the line starts (sigh, gasp, laugh, sob) only when they apply: {Tobin|thick with tears, barely holding together|slow|sob}. How it is said is ${HOW_NOTE} Use the character's name exactly as given above; for someone unnamed, a few plain words: {the guard|bored, waving them on}. Give each quote its own tag, a line that carries on after a dialogue tag too. The tags are taken out before the author reads the scene, so never mention them.`
