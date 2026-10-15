// Summaries lead with how things stand at the end (2026-10-15): the writer's timeline keeps the opening words of each
// summary, so the ending, what the next scene depends on, has to come first.
import { describe, expect, it } from 'vitest'
import { SUMMARY_SYSTEM, summaryPrompt } from './prompts'
import { firstWords } from '../ai/timeline'

describe('summaries lead with how things stand at the end', () => {
  it('asks every summary to open on the ending, then tell what happened in order', () => {
    expect(SUMMARY_SYSTEM).toContain('Begin with one or two sentences on how things stand at the end, starting "By the end,"')
    expect(SUMMARY_SYSTEM).toContain('who now knows what, who holds what')
    expect(SUMMARY_SYSTEM).toContain('Then say what happens and what changes, in order.')
    const list = [{ label: 'Sc 1', text: 'By the end, Mara is at the inn.' }]
    expect(summaryPrompt({ level: 'chapter', where: 'Book 1, Ch 2', title: '', summaries: list })).toContain(
      'Begin with how things stand at the end of the chapter'
    )
    expect(summaryPrompt({ level: 'story', title: 'Book 1', summaries: list })).toContain('Begin with how things stand at the end of it.')
    expect(summaryPrompt({ level: 'series', name: 'The Salt Road', summaries: list })).toContain('Begin with how things stand at the end of it.')
    // A patched summary keeps its opening true, or gains one.
    expect(summaryPrompt({ level: 'scene-patch', where: 'Book 1, Ch 2, Sc 1', title: '', summary: 'Mara went to the inn.', paragraphs: ['She cut her hand.'] })).toContain(
      'Keep its opening on how things stand at the end true'
    )
  })

  it("so the timeline's opening words keep the ending, which a summary told in order lost first", () => {
    const events = 'Mara rowed across the river at dawn, argued with the ferryman about the fare, walked up through the market and the square, and found Tobin at the inn after dark.'
    const inOrder = `${events} She cut her hand on the latch, and he learned that she had lied about the key.`
    const endFirst = `By the end, Mara has a cut hand and Tobin knows she lied about the key. ${events}`
    expect(firstWords(inOrder, 40)).not.toContain('cut her hand')
    expect(firstWords(endFirst, 40)).toContain('cut hand')
    expect(firstWords(endFirst, 18)).toContain('Tobin knows she lied')
  })
})
