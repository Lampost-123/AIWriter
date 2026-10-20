// Directed writing's setting and job: whether a draft is directed (the draft options, else Settings, with the app tests'
// switch), the director model (its own, else the memory model, else the writer model), the director built from a draft's
// briefing, and the fake provider's director (tests/fake-provider/director.mjs).
import { describe, expect, it } from 'vitest'
import type { ModelChoice, ProviderConfig } from '@shared/types'
import { defaultSettings } from '@shared/defaults'
import { MODEL_NAMES, type ModelSources } from '../ai/jobModel'
import { directedWanted, directorModel } from '.'
import { directorReply, stretchProse } from '../../../tests/fake-provider/director.mjs'
import { DIRECTOR_SYSTEM } from './prompts'

const choice = (modelId: string): ModelChoice => ({ providerId: 'p1', modelId, label: modelId, contextLength: 32_000, promptPrice: null, completionPrice: null })
const provider: ProviderConfig = { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:1/v1', hasKey: true }
const sources = (models: Partial<ReturnType<typeof defaultSettings>['models']>): ModelSources => ({
  settings: { models: { ...defaultSettings('lib').models, ...models }, thinking: { ...defaultSettings('lib').thinking, director: 'low' } },
  getProvider: (id) => (id === 'p1' ? provider : null),
  providerTarget: (p) => ({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, apiKey: 'k' })
})

describe('whether a draft is directed', () => {
  it('off by default; on with the switch; a draft’s own choice wins', () => {
    expect(defaultSettings('lib').directedWriting).toBe(false)
    expect(directedWanted(undefined, {}, {})).toBe(false)
    expect(directedWanted(undefined, { directedWriting: true }, {})).toBe(true)
    expect(directedWanted({ directed: false }, { directedWriting: true }, {})).toBe(false)
    expect(directedWanted({ directed: true }, { directedWriting: false }, {})).toBe(true)
  })

  it('app tests and the trap harness set it with AIWRITE_DIRECTED, in place of the switch', () => {
    expect(directedWanted(undefined, { directedWriting: false }, { AIWRITE_DIRECTED: 'on' })).toBe(true)
    expect(directedWanted(undefined, { directedWriting: true }, { AIWRITE_DIRECTED: 'off' })).toBe(false)
    expect(directedWanted({ directed: true }, {}, { AIWRITE_DIRECTED: 'off' })).toBe(true)
  })
})

describe('the director model', () => {
  it('its own, else the memory model, else the writer model, with its own Thinking', () => {
    expect(directorModel(sources({ writer: choice('w'), memory: choice('m'), director: choice('d') }))?.choice.modelId).toBe('d')
    expect(directorModel(sources({ writer: choice('w'), memory: choice('m') }))?.choice.modelId).toBe('m')
    const m = directorModel(sources({ writer: choice('w') }))
    expect(m?.choice.modelId).toBe('w')
    expect(m?.job).toBe('director')
    expect(m?.thinking).toBe('low')
    expect(MODEL_NAMES.director).toBe('director model')
  })

  it('none at all: drafts are directed for free', () => {
    expect(directorModel(sources({}))).toBeNull()
  })
})

describe('the fake provider’s director', () => {
  const ask = (user: string) => directorReply(DIRECTOR_SYSTEM, [{ role: 'system', content: DIRECTOR_SYSTEM }, { role: 'user', content: user }])

  it('answers only the director', () => {
    expect(directorReply('You are a novelist.', [])).toBeNull()
  })

  it('carries on with the next beat; done once the planned stretches are written', () => {
    expect(JSON.parse(ask('## Why you are asked\n- x\nThe next stretch, as planned: Tobin knocks.')!)).toEqual({ verdict: 'continue', note: 'Next, Tobin knocks. Keep the pace even.', reason: '' })
    expect(JSON.parse(ask('The planned stretches are all written.')!).verdict).toBe('done')
  })

  it('a retake, once: for its marker on the first stretch, a finding in the last paragraph, or Adam saying someone wouldn’t', () => {
    const first = '## The latest stretch (stretch 1 of 2)\n…\n## Retakes of its last paragraph so far: 0 of 2'
    expect(JSON.parse(ask(`[[fake: director retake]]\n${first}`)!).verdict).toBe('retake')
    expect(JSON.parse(ask(`[[fake: director retake]]\n${first.replace('so far: 0', 'so far: 1')}`)!).verdict).toBe('continue')
    expect(JSON.parse(ask(`- Mara’s coat is off. [its last paragraph]\nRetakes of its last paragraph so far: 0 of 2`)!)).toMatchObject({ verdict: 'retake', reason: 'Mara’s coat is off.' })
    expect(JSON.parse(ask('- The author’s note: “she wouldn’t say that”\nRetakes of its last paragraph so far: 0 of 2')!).verdict).toBe('retake')
    expect(ask('[[fake: director junk]]')).toBe('Well, it reads nicely so far, I think.')
  })

  it('the writer’s stretch opens with its beat; a paragraph taken again is new words', () => {
    const prose = (n: number, s: string[]) => s.slice(0, 2).join(' ')
    expect(stretchProse('Write stretch 2 of 3, about 200 words: “Tobin knocks.”', 50, ['A.', 'B.', 'C.', 'D.'], prose)).toBe('Tobin knocks. D. A.')
    expect(stretchProse('Take your last paragraph again.', 50, ['A.'], prose)).toContain('Mara stood very still')
    expect(stretchProse('Write the scene now.', 50, ['A.'], prose)).toBeNull()
  })
})
