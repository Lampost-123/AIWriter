import { describe, expect, it } from 'vitest'
import type { GenerationRecord } from '@shared/types'
import { editRecordWords } from './record'

const rec = (job: GenerationRecord['job'], params: Partial<GenerationRecord['params']>): Pick<GenerationRecord, 'job' | 'params'> => ({
  job,
  params: { temperature: 0.8, top_p: 1, max_tokens: 4000, ...params }
})

describe('What the AI saw, for an AI edit', () => {
  it('says nothing different for a draft', () => {
    expect(editRecordWords(rec('draft', {}), 'The Drowned Lantern')).toBeNull()
  })

  it('calls an edit a change, names its tool, and says a stopped one changed the scene only if accepted', () => {
    const words = editRecordWords(rec('edit', { tool: 'expand' }), 'The Drowned Lantern')!
    expect(words.intro).toBe('The exact briefing for this change (Expand) to “The Drowned Lantern”')
    expect(words.streaming).toBe('This change is still being written. Its words appear below as they arrive.')
    expect(words.stopped).toBe(
      'This change was stopped before it finished. The words that came were offered to accept or reject; the scene changes only if you accepted them.'
    )
    expect(words.since).toBe('this change')
    expect(words.direction).toBe('Your instruction')
    expect(editRecordWords(rec('edit', { tool: 'alternatives' }), null)!.intro).toBe('The exact briefing for this change (Alternatives)')
  })

  it('heads the tone as the tone asked for, and gives advice that fits Continue when the words were cut off', () => {
    expect(editRecordWords(rec('edit', { tool: 'tone' }), 'One')!.direction).toBe('The tone you asked for')
    expect(editRecordWords(rec('edit', { tool: 'rewrite' }), 'One')!.direction).toBe('Your instruction')
    const goOn = editRecordWords(rec('edit', { tool: 'continue' }), 'One')!.cutOff
    expect(goOn).toContain('Try again')
    expect(goOn).not.toContain('fewer words')
    expect(editRecordWords(rec('edit', { tool: 'condense' }), 'One')!.cutOff).toContain('fewer words')
    for (const w of Object.values(editRecordWords(rec('edit', { tool: 'voice' }), 'One')!)) {
      expect(w).not.toMatch(/draft|token|generation|prompt|LLM|API/i)
    }
  })
})
