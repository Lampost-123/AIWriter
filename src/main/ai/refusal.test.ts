// Part C's refusal note: at strong content levels, a draft the writer model refuses (or its content filter cuts
// short, or a reply that is plainly a refusal) suggests another writer model.
import { describe, expect, it } from 'vitest'
import { looksLikeMinPRejected, looksLikeRefusalReply, strongContentRefusal, strongScaleWords } from './errors'

const base = { status: 'error' as const, failure: { type: 'refused' as const }, finishReason: null, text: '' }

describe('the refusal note at strong content levels', () => {
  it('names the scales set above their second step', () => {
    expect(strongScaleWords({})).toBeNull()
    expect(strongScaleWords({ romance: 2, violence: 2, language: 2 })).toBeNull()
    expect(strongScaleWords({ violence: 3 })).toBe('violence')
    expect(strongScaleWords({ romance: 4, violence: 1, language: 3 })).toBe('romance and swearing')
    expect(strongScaleWords({ romance: 3, violence: 4, language: 4 })).toBe('romance, violence and swearing')
  })

  it('suggests another writer model when the model refuses the scene', () => {
    const words = strongContentRefusal({ ...base, intensity: { violence: 4 } })
    expect(words).toBe(
      "The writer model refused this scene. Some models won't write violence at the level your style guide sets, so pick a different writer model in Settings › Models."
    )
    // A provider's moderation error counts as a refusal too.
    const http = strongContentRefusal({
      ...base,
      failure: { type: 'http', status: 403, message: 'Your input was flagged by moderation' },
      intensity: { romance: 3, violence: 3 }
    })
    expect(http).toMatch(/^The writer model refused this scene\. Some models won't write romance and violence at the levels your style guide sets/)
  })

  it('says a content filter cut the scene short, and that the text is kept', () => {
    const words = strongContentRefusal({ ...base, finishReason: 'content_filter', text: 'The door gave way.', intensity: { romance: 4 } })
    expect(words).toMatch(/^The writer model's content filter cut this scene short\. Some models won't write romance/)
    expect(words).toMatch(/Settings › Models\. The text that arrived is kept\.$/)
  })

  it('treats a reply that is plainly a refusal as one', () => {
    const words = strongContentRefusal({
      status: 'complete',
      failure: null,
      finishReason: 'stop',
      text: "I'm sorry, but I can't write that scene as described.",
      intensity: { language: 4 }
    })
    expect(words).toMatch(/^The writer model wouldn't write this scene and sent back a refusal instead\. Some models won't write swearing/)
  })

  it('leaves the usual message alone at milder levels, for other failures and for real scenes', () => {
    expect(strongContentRefusal({ ...base, intensity: { violence: 2 } })).toBeNull()
    expect(strongContentRefusal({ ...base, intensity: undefined })).toBeNull()
    expect(strongContentRefusal({ ...base, failure: { type: 'timeout' }, intensity: { violence: 4 } })).toBeNull()
    expect(
      strongContentRefusal({ ...base, failure: { type: 'http', status: 400, message: 'context length exceeded' }, intensity: { violence: 4 } })
    ).toBeNull()
    expect(strongContentRefusal({ status: 'stopped', failure: null, finishReason: null, text: '', intensity: { violence: 4 } })).toBeNull()
    const scene = `"I can't do that," she said. ${'The rain kept on against the glass while they waited. '.repeat(12)}`
    expect(strongContentRefusal({ status: 'complete', failure: null, finishReason: 'stop', text: scene, intensity: { violence: 4 } })).toBeNull()
  })

  it('tells refusals from scenes', () => {
    expect(looksLikeRefusalReply("I can't help with that request.")).toBe(true)
    expect(looksLikeRefusalReply('I apologise, but I won’t write explicit content.')).toBe(true)
    expect(looksLikeRefusalReply('Sorry, but I must decline this one.')).toBe(true)
    expect(looksLikeRefusalReply('As an AI, I have to keep things suitable for everyone.')).toBe(true)
    expect(looksLikeRefusalReply('The lamp burned low. Mara counted the coins twice.')).toBe(false)
    expect(looksLikeRefusalReply('')).toBe(false)
    expect(looksLikeRefusalReply(`I can't write this letter, I thought. ${'The ink had dried on the nib. '.repeat(20)}`)).toBe(false)
  })
})

describe('min_p turned down', () => {
  it('is noticed only when the message names it', () => {
    expect(looksLikeMinPRejected(400, 'Unrecognized request argument supplied: min_p')).toBe(true)
    expect(looksLikeMinPRejected(422, 'min-p is not supported by this provider')).toBe(true)
    expect(looksLikeMinPRejected(400, 'temperature must be at most 1')).toBe(false)
    expect(looksLikeMinPRejected(500, 'min_p')).toBe(false)
  })
})
