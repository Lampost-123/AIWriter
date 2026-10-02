import { describe, expect, it } from 'vitest'
import { hasEmphasis, isPreambleLine, isSceneBreakLine, newSplitState, parseEmphasis, splitChunk, splitParagraphs, type StreamOp } from './streamText'

/** Feeds chunks through the splitter and returns the paragraphs it would produce. */
function run(chunks: string[]): { ops: StreamOp[]; paragraphs: string[] } {
  let state = newSplitState()
  const ops: StreamOp[] = []
  for (const c of chunks) {
    const r = splitChunk(state, c)
    state = r.state
    ops.push(...r.ops)
  }
  const paragraphs: string[] = []
  for (const op of ops) {
    if (op.kind === 'paragraph') paragraphs.push('')
    else if (!paragraphs.length) paragraphs.push(op.text)
    else paragraphs[paragraphs.length - 1] += op.text
  }
  return { ops, paragraphs }
}

describe('splitChunk', () => {
  it('keeps one paragraph when there are no newlines', () => {
    expect(run(['The rain ', 'had not ', 'stopped.']).paragraphs).toEqual(['The rain had not stopped.'])
  })

  it('splits on blank lines and on single newlines', () => {
    expect(run(['One.\n\nTwo.\nThree.']).paragraphs).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('handles a blank line split across chunks', () => {
    expect(run(['One.\n', '\nTwo.']).paragraphs).toEqual(['One.', 'Two.'])
    expect(run(['One.', '\n', '\n', 'Two.']).paragraphs).toEqual(['One.', 'Two.'])
  })

  it('only emits a paragraph break when text follows it', () => {
    const r = run(['One.\n\n'])
    expect(r.ops).toEqual([{ kind: 'text', text: 'One.' }])
    expect(run(['One.\n\n', 'Two.']).ops).toEqual([
      { kind: 'text', text: 'One.' },
      { kind: 'paragraph' },
      { kind: 'text', text: 'Two.' }
    ])
  })

  it('ignores newlines and spaces before the first word', () => {
    expect(run(['\n\n  ', '  Mara ', 'waited.']).paragraphs).toEqual(['Mara waited.'])
  })

  it('drops indentation at the start of paragraphs but keeps spaces inside them', () => {
    expect(run(['A.\n    B', ' c.']).paragraphs).toEqual(['A.', 'B c.'])
  })

  it('treats whitespace-only lines as blank lines', () => {
    expect(run(['A.\n   \n\t\nB.']).paragraphs).toEqual(['A.', 'B.'])
  })

  it('normalises Windows line endings', () => {
    expect(run(['A.\r\n\r\nB.\rC.']).paragraphs).toEqual(['A.', 'B.', 'C.'])
  })

  it('merges adjacent text into one operation per chunk', () => {
    expect(splitChunk(newSplitState(), 'a b c').ops).toEqual([{ kind: 'text', text: 'a b c' }])
  })
})

describe('splitParagraphs', () => {
  it('splits a whole text', () => {
    expect(splitParagraphs('  First.  \n\nSecond.\n')).toEqual(['First.', 'Second.'])
    expect(splitParagraphs('')).toEqual([])
  })
})

describe('isPreambleLine', () => {
  it('spots headings and lead-ins, not prose', () => {
    for (const s of ['# The Gilded Eel', '## Scene 3', "Here's the scene:", 'Here is the draft for “The Eel”:', 'Here’s scene three:']) expect(isPreambleLine(s)).toBe(true)
    for (const s of ['#', 'Here is where it ended.', 'Here, she said: wait.', 'Mara waited.', '#hashtag']) expect(isPreambleLine(s)).toBe(false)
  })
})

describe('isSceneBreakLine', () => {
  it('recognises common scene break markers', () => {
    for (const s of ['***', '* * *', ' *** ', '---', '- - -', '#', '⁂', '~~~']) expect(isSceneBreakLine(s)).toBe(true)
    for (const s of ['**', 'Hello', '*emphasis*', '--', '']) expect(isSceneBreakLine(s)).toBe(false)
  })
})

describe('parseEmphasis', () => {
  it('turns complete pairs into italics and bold', () => {
    expect(parseEmphasis('*He knows,* Mara thought.')).toEqual([{ text: 'He knows,', italic: true }, { text: ' Mara thought.' }])
    expect(parseEmphasis('a _favour_ owed')).toEqual([{ text: 'a ' }, { text: 'favour', italic: true }, { text: ' owed' }])
    expect(parseEmphasis('**Day 12, dusk**')).toEqual([{ text: 'Day 12, dusk', bold: true }])
    expect(parseEmphasis('**bold *and* bold**')).toEqual([{ text: 'bold ', bold: true }, { text: 'and', bold: true, italic: true }, { text: ' bold', bold: true }])
  })

  it('leaves alone what is not emphasis', () => {
    for (const t of ['snake_case_name', '5 * 3 * 2', 'f*ck it', '* * *', '***', 'an *unclosed marker', 'a * b*', '__init__ok']) {
      expect(parseEmphasis(t)).toEqual([{ text: t }])
      expect(hasEmphasis(t)).toBe(false)
    }
  })
})
