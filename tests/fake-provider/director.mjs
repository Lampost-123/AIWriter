// Directed writing's fake replies (src/main/director): the director ("[AIWRITE-DIRECTOR v1]") and the writer's stretches.
//
// The director answers JSON {"verdict", "note", "reason"}:
//   - "[[fake: director junk]]" anywhere in the request: a reply that can't be read (the app decides for free);
//   - "[[fake: director done]]": done at once;
//   - "[[fake: director retake]]" (say, in the author's direction): the last paragraph again, once (while "Retakes of its
//     last paragraph so far: 0"), for the first stretch it reads;
//   - a free check's finding in the stretch's last paragraph ("[its last paragraph]"), with no retake yet: that paragraph
//     again, with the finding as the reason;
//   - an author's note saying someone "wouldn't" say or do something, with no retake yet: the paragraph again;
//   - the planned stretches all written: done;
//   - otherwise carry on, with a note naming the next stretch's beat (or the author's note, said again).
//
// The writer's stretches (any writer model, asked "Write only stretch 1 of 3 now" or "Write stretch 2 of 3"): each
// stretch opens with the beat it was asked for, as a writer that lands its beats would, then the usual sentences from a
// place of their own, so stretches don't repeat each other; a paragraph taken again ("Take your last paragraph again")
// is one new paragraph.

const MARKER = '[AIWRITE-DIRECTOR v1]'

export function directorReply(system, messages) {
  if (!String(system).includes(MARKER)) return null
  const text = (messages ?? []).map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
  const reply = (verdict, note = '', reason = '') => JSON.stringify({ verdict, note, reason })
  if (text.includes('[[fake: director junk]]')) return 'Well, it reads nicely so far, I think.'
  if (text.includes('[[fake: director done]]')) return reply('done')
  const none = /Retakes of its last paragraph so far: 0 of/.test(text)
  const first = /## The latest stretch \(stretch 1 of/.test(text)
  if (text.includes('[[fake: director retake]]') && none && first) {
    return reply('retake', 'Make it quieter, and keep Mara still.', 'The fake director wants the last paragraph again.')
  }
  const slip = /^- (.+?)(?: \(“[^\n]*”\))? \[its last paragraph\]$/m.exec(text)
  if (slip && none) return reply('retake', 'Write it without that slip.', slip[1])
  const adam = /The author’s note: “([^”]*)”/.exec(text)?.[1]
  if (adam && /\bwouldn['’]?t\b/i.test(adam) && none) return reply('retake', `As the author says: ${adam}`, `The author says: ${adam}`)
  if (/The planned stretches are all written\./.test(text)) return reply('done', '', 'Every beat has landed.')
  const next = /^The next stretch, as planned: (.+)$/m.exec(text)?.[1]?.trim()
  const note = adam ? `As the author asks: ${adam}.` : next && next !== 'what comes next.' ? `Next, ${next.replace(/\.$/, '')}. Keep the pace even.` : 'Keep the pace even.'
  return reply('continue', note, '')
}

/** Sentences for a paragraph written again: none of the usual ones, so a test can tell it from the one it replaced. */
export const RETAKE_SENTENCES = [
  'Mara stood very still by the door and let the room come to her.',
  'Nobody spoke; the fire said what little there was to say.',
  'She waited until the quiet had settled, and only then looked up.'
]

/**
 * The writer's stretch, or null for any other request: the beat it was asked for first (its words in “…”), then the usual
 * sentences from the stretch's own place. `prose(words, sentences)` makes the fake's prose.
 */
export function stretchProse(lastUser, words, sentences, prose) {
  const text = String(lastUser)
  if (/Take your last paragraph again\./.test(text)) return RETAKE_SENTENCES.join(' ')
  const m = [...text.matchAll(/(?:Write only stretch|Write stretch) (\d+) of (\d+)(?: now)?, about \d+ words: (.+)$/gm)].at(-1)
  if (!m) return null
  const n = Number(m[1])
  const beat = /“([^”]+)”/.exec(m[3])?.[1]?.trim()
  const offset = ((n - 1) * 3) % sentences.length
  const rotated = [...sentences.slice(offset), ...sentences.slice(0, offset)]
  const body = prose(Math.max(10, words - (beat ? beat.split(/\s+/).length : 0)), rotated)
  return beat ? `${beat} ${body}` : body
}
