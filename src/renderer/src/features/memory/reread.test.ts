import { describe, expect, it } from 'vitest'
import type { RereadEstimate } from '@shared/types'
import { rereadCostWords, rereadIntro, rereadProgress, rereadStarted } from './reread'

const est = (e: Partial<RereadEstimate>): RereadEstimate => ({ scenes: 12, words: 24_600, cost: 0.04, free: false, model: 'DeepSeek Flash', problem: null, ...e })

describe('the re-read’s words (World Memory Overhaul B8)', () => {
  it('says roughly what it costs, before anything is asked of the model', () => {
    expect(rereadCostWords(est({}))).toBe('About $0.04 with DeepSeek Flash, for 12 scenes (about 25,000 words).')
    expect(rereadCostWords(est({ scenes: 1, words: 800, cost: 0.002 }))).toBe('Less than a cent with DeepSeek Flash, for 1 scene.')
    expect(rereadCostWords(est({ free: true, cost: 0, model: 'llama3' }))).toBe('Free with your local model, llama3. It reads 12 scenes (about 25,000 words).')
    expect(rereadCostWords(est({ cost: null }))).toBe('The cost isn’t known for DeepSeek Flash. It reads 12 scenes (about 25,000 words).')
    expect(rereadCostWords(est({ scenes: 0, words: 0 }))).toBe('')
  })

  it('says what it does, and how far it has got', () => {
    expect(rereadIntro({ sceneId: 's1' }, 'The ferry')).toContain('The memory reads “The ferry” again from the start')
    expect(rereadIntro({ storyId: 'b1' }, 'Kestrel Point')).toContain('every scene of “Kestrel Point”')
    expect(rereadStarted({ storyId: 'b1' }, 12)).toBe('Re-reading 12 scenes in the background. You can stop it from the top bar.')
    expect(rereadStarted({ sceneId: 's1' }, 1)).toBe('Re-reading the scene. What the memory finds shows in What changed.')
    expect(rereadProgress({ left: 10, total: 12 })).toBe('Re-reading 3 of 12…')
    expect(rereadProgress({ left: 1, total: 1 })).toBe('Re-reading the scene…')
  })
})
