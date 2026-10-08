// The AI writer's use of the story memory (Adam, 2026-10-08): Add below's own instructions, the order blocks are sent
// in (the cache), a cleaner briefing, and (since 0.6.35) no list of phrases not to say again. On an invented scene
// (writerWorld.ts).
import { describe, expect, it } from 'vitest'
import { finishContext, keptOrder, MENTIONED_TITLE, MUST_BLOCK, prepareContext, SEND_ORDER, sentOrderOf, type ContextInput } from '../../src/main/ai/context'
import { RECALL_ENTRIES } from '../../src/main/retrieval/briefing'
import { soFarBlock } from '../../src/main/beats/instructions'
import { countRaw } from '../../src/main/ai/tokens'
import { finalInstruction, writerInstructions } from '../../src/main/ai/prompts'
import { defaultStyleGuide } from '@shared/defaults'
import { addBelowStep } from './writerWorld'

const briefing = (inp: ContextInput) => {
  const p = prepareContext(inp, inp.soFar ? { extraBlocks: [soFarBlock(inp.soFar, 64_000)!] } : {})
  return finishContext(p, p.texts.map(countRaw))
}
const whole = (inp: ContextInput): string => briefing(inp).messages.map((m) => m.content).join('\n\n')
const block = (inp: ContextInput, id: string) => briefing(inp).blocks.find((b) => b.id === id && !b.dropped)

describe('Add below gets its own instructions', () => {
  it('carries the scene on rather than writing a complete scene; Generate keeps its own', () => {
    const add = writerInstructions('', true)
    expect(add).not.toContain('complete, polished scene')
    expect(add).not.toContain("End on the scene's final beat")
    expect(add).toContain('The length given is a ceiling, not a target')
    expect(add).toContain('Invent no new events of your own')
    expect(add).toContain('Beats on the scene card that are already on the page are done: never write them again.')
    expect(add).toContain('Once that has happened, stop')
    const gen = writerInstructions('')
    expect(gen).toContain('write a complete, polished scene')
    expect(gen).toContain("End on the scene's final beat.")
    // The system message of an Add below briefing is Add below's.
    expect(briefing(addBelowStep(0)).messages[0].content).toContain('Write only the next stretch')
    expect(briefing({ ...addBelowStep(0), options: { ...addBelowStep(0).options, addBelow: false }, soFar: undefined }).messages[0].content).toContain(
      'complete, polished scene'
    )
  })

  it("says Adam's direction last of all, right before the writer starts, and not in the scene card", () => {
    const inp = addBelowStep(0)
    const text = whole(inp)
    expect(text.trimEnd().endsWith('What happens now, as the author directs (write this, and nothing beyond it):\nWren wonders which way the coast road runs')).toBe(true)
    expect(block(inp, 'scene-card')!.text).not.toContain('Wren wonders')
    expect(text.split('Wren wonders which way the coast road runs')).toHaveLength(2)
    // Generate keeps the direction on the scene card.
    const gen = { ...inp, options: { ...inp.options, addBelow: false }, soFar: undefined, continuityAtSoFar: false }
    expect(block(gen, 'scene-card')!.text).toContain("The author's direction for this draft:\nWren wonders")
  })

  it('marks the beats already on the page done, and with no direction asks for the next beat only', () => {
    const inp = addBelowStep(0)
    const final = whole(inp)
    expect(final).toContain('- Beat 1 on the scene card is already on the page: done. Never write it again, in any words.')
    expect(final).toContain('- Write at most about 350 words. That is a ceiling, not a target')
    expect(final).toContain('Invent no events of your own.')
    const none = whole({ ...inp, options: { ...inp.options, direction: '' } })
    expect(none.trimEnd().endsWith('What happens now: the next beat on the scene card, beat 2 of 2 (write this one only, and nothing beyond it):\nThey talk about what comes next')).toBe(true)
  })

  it('names no phrase not to use (since 0.6.35: naming one can prime it; stock phrases are said afresh after writing)', () => {
    const final = finalInstruction({
      targetWords: 300,
      style: defaultStyleGuide(),
      hasBeats: false,
      hasPrevious: false,
      hasDirection: true,
      addBelow: true,
      direction: 'Ash comes back'
    })
    expect(final).not.toContain('This scene has used these already')
    const step = whole(addBelowStep(1))
    expect(step).not.toContain('This scene has used these already')
    expect(step).not.toContain('“the rain went on”')
    expect(step).not.toContain('“neither of them said”')
  })
})

describe('blocks go in an order a provider can reuse from one step to the next', () => {
  it('sends what stays the same first, and the scene card, the scene so far, the stage and what must stay true last', () => {
    const ids = briefing(addBelowStep(1))
      .blocks.filter((b) => !b.dropped)
      .map((b) => b.id)
    expect(ids.slice(0, 4)).toEqual(['instructions', 'themes', 'setting', 'story-so-far'].filter((id) => ids.includes(id)).slice(0, 4))
    expect(ids.indexOf('story-so-far')).toBeLessThan(ids.indexOf('pov'))
    expect(ids.indexOf('previous-scene')).toBeLessThan(ids.indexOf(RECALL_ENTRIES.id))
    expect(ids.slice(-4)).toEqual(['scene-card', 'scene-so-far', 'continuity', MUST_BLOCK])
    expect(SEND_ORDER.indexOf('story-so-far')).toBeLessThan(SEND_ORDER.indexOf('mentioned'))
  })

  it('two Add below steps in a row send the same opening, word for word, through the story so far and the previous scene', () => {
    const a = briefing(addBelowStep(0))
    const b = briefing(addBelowStep(1))
    expect(b.messages[0].content).toBe(a.messages[0].content)
    const upTo = (m: string): string => m.slice(0, m.indexOf('## Point-of-view character'))
    expect(upTo(b.messages[1].content).length).toBeGreaterThan(1000)
    expect(upTo(b.messages[1].content)).toBe(upTo(a.messages[1].content))
    // Most of the second step was sent by the first already.
    const x = whole(addBelowStep(0))
    const y = whole(addBelowStep(1))
    let i = 0
    while (i < x.length && x[i] === y[i]) i++
    expect(countRaw(y.slice(0, i)) / countRaw(y)).toBeGreaterThan(0.6)
  })

  it('recalled entries come in a steady order under a fixed title, whatever order the search found them in', () => {
    const a = block(addBelowStep(0), RECALL_ENTRIES.id)!
    const b = block(addBelowStep(1), RECALL_ENTRIES.id)!
    expect(a.title).toBe(b.title)
    const names = (t: string): string[] => [...t.matchAll(/^### ([^(]+) \(/gm)].map((m) => m[1])
    expect(names(b.text).filter((n) => names(a.text).includes(n))).toEqual(names(a.text).filter((n) => names(b.text).includes(n)))
    expect(MENTIONED_TITLE).toBe('Also relevant')
  })

  it('within a scene, entries keep the order they were sent in last time and new ones go after, never sorted in', () => {
    const e = (id: string, kind: 'item' | 'place', name: string) => ({ id, kind, name })
    expect(keptOrder([e('b', 'item', 'B'), e('a', 'item', 'A'), e('p', 'place', 'P')], ['b', 'x', 'a']).map((x) => x.id)).toEqual(['b', 'a', 'p'])
    expect(keptOrder([e('b', 'item', 'B'), e('a', 'item', 'A')]).map((x) => x.id)).toEqual(['a', 'b'])
    const named = (direction: string, sentOrder?: Record<string, string[]>): ContextInput => {
      const inp = addBelowStep(1)
      return { ...inp, options: { ...inp.options, direction }, sentOrder }
    }
    const three = 'Ash shows Wren the brass compass, the survey case and the Linn ferry'
    const cards = (inp: ContextInput): string[] => [...block(inp, 'mentioned')!.text.matchAll(/^### ([^(]+) \(/gm)].map((m) => m[1].trim())
    expect(cards(named(three))).toEqual(['The Linn ferry', 'The brass compass', 'The survey case'])
    const [ferry, compass, survey] = prepareContext(named(three)).blocks.find((b) => b.id === 'mentioned')!.entryIds
    // Last time the survey case and the compass were sent, in that order: they stay first, the ferry goes after.
    const kept = named(three, { mentioned: [survey, compass] })
    expect(cards(kept)).toEqual(['The survey case', 'The brass compass', 'The Linn ferry'])
    expect(sentOrderOf(prepareContext(kept).blocks).mentioned).toEqual([survey, compass, ferry])
    // The same cards, word for word: only their order changes.
    const sorted = (t: string): string => t.split(/\n\n(?=### )/).sort().join('|')
    expect(sorted(block(kept, 'mentioned')!.text)).toBe(sorted(block(named(three), 'mentioned')!.text))
    // So a step that names one more thing matches the step before for longer.
    const prefix = (x: string, y: string): number => {
      let i = 0
      while (i < x.length && x[i] === y[i]) i++
      return i
    }
    const two = 'Ash shows Wren the survey case and the brass compass'
    const first = prepareContext(named(two))
    const thenKept = whole(named(three, sentOrderOf(first.blocks)))
    expect(prefix(thenKept, whole(named(two)))).toBeGreaterThan(prefix(whole(named(three)), whole(named(two))))
  })
})

describe('a cleaner briefing', () => {
  it('"does not know" only for real secrets: never about the person themselves, the same fact once, at most three', () => {
    const rel = block(addBelowStep(0), 'relationships')!.text
    expect(rel).not.toContain('Wren Hollis does not know: Wren will go up to the abbey')
    const lines = rel.split('\n').filter((l) => l.includes(' does not know: '))
    expect(lines.length).toBeLessThanOrEqual(3)
    expect(lines.length).toBeGreaterThan(0)
    expect(rel.match(/must be laid before the Assize/g) ?? []).toHaveLength(1)
  })

  it('what the point of view knows: once each, no plan long past or already done', () => {
    const pov = block(addBelowStep(0), 'pov')!.text
    expect(pov.match(/must be laid before the Assize/g)).toHaveLength(1)
    expect(pov).not.toContain('Gale will ask again in the morning')
    expect(pov).not.toContain('Wren will give Pell the brass compass')
    expect(pov).toContain('A man in grey has been asking at every inn for the survey')
  })

  it('the dead are past: no "this afternoon" days later, never "burning in his chair" on the stage', () => {
    const inp = addBelowStep(1)
    expect(block(inp, 'scene-card')!.text).toContain('Edric Rone (died in his chair in the survey room; Ch 1, Sc 1)')
    const text = whole(inp)
    expect(text).not.toContain('died this afternoon')
    expect(block(inp, 'continuity')!.text).not.toContain('burning')
    expect(block(inp, 'continuity')!.text).not.toContain('Edric')
  })

  it('stale values from older scenes stay off the stage: the ferryman in the flood, a hat from days before', () => {
    const stage = block(addBelowStep(1), 'continuity')!.text
    expect(stage).not.toContain('Oskar')
    expect(stage).not.toContain('hat on')
    expect(stage).toContain('boots off, on the hearth')
    expect(stage).toContain('the survey case: on the windowsill')
  })

  it('what must stay true does not repeat the stage block, and says nothing twice', () => {
    const must = block(addBelowStep(1), MUST_BLOCK)!.text
    expect(must).not.toContain('windowsill')
    expect(must).not.toContain('boots')
    expect(must).toContain('Wren Hollis: a burn on her left arm, wrapped in linen')
    const lines = must.split('\n').filter((l) => l.startsWith('- '))
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('sample lines are speech only, never narration', () => {
    const pov = block(addBelowStep(0), 'pov')!.text
    expect(pov).toContain('"Bearings first. Then talk."')
    expect(pov).toContain('"I’ll lay it before the Assize."')
    expect(pov).not.toContain('She looked at the map for a long time')
  })
})
