import { describe, expect, it } from 'vitest'
import { answerLine, interviewNote, tidyAnswer, withAnswer, withoutAnswer } from './interviewLogic'

const SUMMARY = 'Mara Venn is a smuggler captain who owes the Salt Guild a fortune.'

describe('an answer in the summary', () => {
  it('goes at the end, after a blank line, in his own words under the topic', () => {
    const { summary, added } = withAnswer(`${SUMMARY}\n`, 'Setting', '  The Grey Coast, cold and foggy.  ')
    expect(summary).toBe(`${SUMMARY}\n\nSetting: The Grey Coast, cold and foggy.`)
    expect(added).toBe('\n\nSetting: The Grey Coast, cold and foggy.')
  })

  it('is the whole summary when there was none, and nothing is added for an empty answer', () => {
    expect(withAnswer('', 'Premise', 'A debt comes due.').summary).toBe('Premise: A debt comes due.')
    expect(withAnswer(SUMMARY, 'Premise', ' \n ')).toEqual({ summary: SUMMARY, added: '' })
  })

  it('keeps his words and lines, with no more than one blank line, and no label twice', () => {
    expect(tidyAnswer('One.\r\n\r\n\r\n\r\nTwo.  \n')).toBe('One.\n\nTwo.')
    expect(answerLine('Tone', 'tone: dry and wary')).toBe('tone: dry and wary')
    expect(answerLine('  ', 'Something')).toBe('More: Something')
  })
})

describe('Undo', () => {
  const before = SUMMARY
  const { summary: after, added } = withAnswer(before, 'Setting', 'The Grey Coast.')

  it('puts the summary back as it was when nothing changed since', () => {
    expect(withoutAnswer(after, { before, after, added })).toBe(before)
  })

  it('takes out only the answer when he has edited elsewhere since', () => {
    const edited = after.replace('a fortune', 'everything') + '\n\nTone: Wary.'
    expect(withoutAnswer(edited, { before, after, added })).toBe(`${SUMMARY.replace('a fortune', 'everything')}\n\nTone: Wary.`)
    // The blank line before it went: the answer's own line still comes out.
    const joined = `${SUMMARY}\nSetting: The Grey Coast.`
    expect(withoutAnswer(joined, { before, after, added })).toBe(SUMMARY)
  })

  it('does nothing when the answer is no longer there as it was', () => {
    expect(withoutAnswer(`${SUMMARY}\n\nSetting: The Grey Coast, rewritten.`, { before, after, added })).toBeNull()
  })
})

describe('the note', () => {
  it('says how answers are used, then how many are in', () => {
    expect(interviewNote(0)).toBe('Each answer is added to the end of your summary, in your own words.')
    expect(interviewNote(1)).toBe('1 answer added to your summary.')
    expect(interviewNote(3)).toBe('3 answers added to your summary.')
  })
})
