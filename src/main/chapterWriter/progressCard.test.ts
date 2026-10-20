// The top bar's progress card (2026-10-20): a chapter draft's events heard for it (chapterWriter.test.ts has what a run
// says of itself as it goes) (draftEvents: its words so far, a retake's words taken back, a retry).
import { describe, expect, it } from 'vitest'
import { draftEvents } from './progress'

describe('a chapter draft heard for the progress card', () => {
  it('counts its words now and then and at its end, takes a retake’s words back, and passes on a retry until words come again', () => {
    let t = 0
    const words: number[] = []
    const retries: (string | null)[] = []
    const emit = draftEvents({ onWords: (w) => words.push(w), onRetry: (r) => retries.push(r) }, () => t)
    const send = emit as unknown as (e: string, p: unknown) => void
    send('generation:retrying', { generationId: 'g', attempt: 1, waitMs: 1000, reason: 'OpenRouter is busy' })
    expect(retries).toEqual(['OpenRouter is busy'])
    t = 1000
    send('generation:chunk', { generationId: 'g', sceneId: 's', text: 'The ferry came ' })
    expect(words).toEqual([3])
    expect(retries.at(-1)).toBeNull()
    t = 1100
    send('generation:chunk', { generationId: 'g', sceneId: 's', text: 'in late. ' })
    // Not counted again so soon.
    expect(words).toEqual([3])
    send('generation:takeBack', { generationId: 'g', sceneId: 's', text: 'in late. ' })
    expect(words.at(-1)).toBe(3)
    send('generation:chunk', { generationId: 'g', sceneId: 's', text: 'in early, under a low sky.' })
    send('generation:done', { generationId: 'g', sceneId: 's', status: 'complete', error: null, promptTokens: null, completionTokens: null, cost: null })
    // "The ferry came in early, under a low sky."
    expect(words.at(-1)).toBe(9)
  })
})
