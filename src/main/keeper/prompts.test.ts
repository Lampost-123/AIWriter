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

describe('roll-ups are made from the level below and the story record (long story memory fix 15)', () => {
  const list = [
    { label: 'Scene 1', text: 'By the end, Mara is at the inn.' },
    { label: 'Scene 2', text: 'By the end, Mara has the key.' }
  ]

  it('gives a chapter what the record says changed in it, as facts that win over the summaries', () => {
    const p = summaryPrompt({
      level: 'chapter',
      where: 'Book 1, Ch 2',
      title: 'The Ferry',
      summaries: list,
      record: ['Mara: lost her knife (scene 2)', 'Plot thread set up: The toll (scene 1)']
    })
    expect(p).toContain('Begin with how things stand at the end of the chapter, which its last scenes and the story record say.')
    expect(p).toContain('The story record below is fact: where a summary says otherwise, follow the record.')
    expect(p).toContain('Point to the scene where each big change happens, as (scene 2).')
    expect(p).toContain('What the story record says changed in this chapter:\n- Mara: lost her knife (scene 2)\n- Plot thread set up: The toll (scene 1)')
    // How things stand at its end is the snapshot's, shown in the writer's timeline with no AI (review, 2026-10-16).
    expect(p).not.toContain('How things stand')
    // The summaries come first, right after the ask, and the record after them.
    expect(p.indexOf('Scene 1: By the end')).toBeLessThan(p.indexOf('What the story record says'))
    expect(p.split('\n\n')[1]).toBe('Scene 1: By the end, Mara is at the inn.')
  })

  it('says nothing of a record it has none of', () => {
    const p = summaryPrompt({ level: 'chapter', where: 'Book 1, Ch 2', title: '', summaries: list })
    expect(p).not.toMatch(/story record/)
    expect(summaryPrompt({ level: 'story', title: 'Book 1', summaries: list, end: [] })).not.toMatch(/story record/)
  })

  it('gives a story and a series how things stand at the end, by the record, never an older summary of themselves', () => {
    const story = summaryPrompt({ level: 'story', title: 'Book 1', summaries: list, end: ['Edric: dead', 'Plot threads still open: The toll'] })
    expect(story).toContain('Begin with how things stand at the end of it.')
    expect(story).toContain('How things stand at the end, by the story record:\n- Edric: dead\n- Plot threads still open: The toll')
    const series = summaryPrompt({ level: 'series', name: 'The Salt Road', summaries: list, end: ['Edric: dead'] })
    expect(series).toContain('How things stand at the end of the last book, by the story record:\n- Edric: dead')
    expect(series).toContain('follow the record')
  })
})
