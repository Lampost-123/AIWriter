import { describe, expect, it } from 'vitest'
import type { CommandStep, CommandValues } from '@shared/contracts/commands'
import type { CommandRow } from '../db/commands'
import { cleanValues, commandsAt, wearingByCommand, type CommandsInput } from './commands'

const order = ['s1', 's2', 's3', 's4', 's5', 's6']
const names: Record<string, string> = { tam: 'Tam', mara: 'Mara' }

let n = 0
const cmd = (id: string, subjectId = 'tam', giverId: string | null = 'mara'): CommandRow => ({
  id,
  storyId: 'story',
  subjectId,
  giverId,
  origin: 'ai',
  createdAt: '2026-10-24T10:00:00Z'
})
const step = (commandId: string, sceneId: string, kind: CommandStep['kind'], values: Partial<CommandValues> = {}, more: Partial<CommandStep> = {}): CommandStep => ({
  id: `st${++n}`,
  commandId,
  sceneId,
  kind,
  values,
  quote: '',
  note: '',
  origin: 'ai',
  answer: '',
  unsure: false,
  seq: n,
  createdAt: '2026-10-24T10:00:00Z',
  ...more
})

const at = (commands: CommandRow[], steps: CommandStep[], sceneId: string, o: Partial<CommandsInput> = {}) =>
  commandsAt({ commands, steps, order, point: order.indexOf(sceneId), where: (s) => s.toUpperCase(), nameOf: (id) => names[id] ?? null, ...o })

const socks = { words: 'No socks', does: 'wears no socks', kind: 'clothing' as const, off: ['socks'] }
const bra = { words: 'No bra', does: 'wears no bra', kind: 'clothing' as const, off: ['bra'] }
const naked = { words: 'Be naked', does: 'wears nothing', kind: 'clothing' as const, all: true }

describe('commands as of a scene', () => {
  it('holds from the scene it is given in, and not before', () => {
    const steps = [step('c1', 's2', 'given', socks)]
    expect(at([cmd('c1')], steps, 's1')).toEqual([])
    const [tam] = at([cmd('c1')], steps, 's2')
    expect(tam.name).toBe('Tam')
    expect(tam.commands[0]).toMatchObject({ status: 'in-effect', inEffect: true, giverName: 'Mara', givenWhere: 'S2' })
    expect(tam.wearing).toBe('no socks')
    // As the scene it was given in begins, it isn't given yet.
    expect(at([cmd('c1')], steps, 's2', { asItBegins: true })).toEqual([])
  })

  it('stacks clothing commands rather than replacing one with another', () => {
    const steps = [step('c1', 's1', 'given', socks), step('c2', 's2', 'given', bra)]
    const [tam] = at([cmd('c1'), cmd('c2')], steps, 's3')
    expect(tam.commands.map((c) => c.status)).toEqual(['in-effect', 'in-effect'])
    expect(tam.wearing).toBe('no socks, no bra')
  })

  it('lets "be naked" cover the others while it holds, and they hold again once it ends', () => {
    const steps = [step('c1', 's1', 'given', socks), step('c2', 's2', 'given', bra), step('c3', 's3', 'given', naked), step('c3', 's5', 'ended')]
    const cs = [cmd('c1'), cmd('c2'), cmd('c3')]
    const [during] = at(cs, steps, 's4')
    expect(during.wearing).toBe('nothing')
    expect(during.commands.filter((c) => c.coveredBy === 'c3').map((c) => c.id)).toEqual(['c1', 'c2'])
    const [after] = at(cs, steps, 's5')
    expect(after.wearing).toBe('no socks, no bra')
    expect(after.commands.find((c) => c.id === 'c3')?.status).toBe('ended')
    expect(after.commands.every((c) => c.coveredBy === null)).toBe(true)
  })

  it('keeps a planted trigger waiting, changing nothing until it fires', () => {
    const banana = { ...socks, trigger: "hears the word 'banana'" }
    const steps = [step('c1', 's1', 'given', banana), step('c1', 's3', 'fired')]
    const [before] = at([cmd('c1')], steps, 's2')
    expect(before.commands[0]).toMatchObject({ status: 'waiting', waiting: true, inEffect: false })
    expect(before.wearing).toBe('')
    const [fired] = at([cmd('c1')], steps, 's3')
    expect(fired.commands[0]).toMatchObject({ status: 'in-effect', waiting: false, fired: 1 })
    expect(fired.wearing).toBe('no socks')
    // Once fired, the effect carries on (until the story ends it).
    expect(at([cmd('c1')], steps, 's6')[0].wearing).toBe('no socks')
  })

  it('re-arms a trigger meant for every time, and ends a one-scene effect with its scene', () => {
    const bell = { words: 'Sleep at the bell', does: 'falls asleep', kind: 'action' as const, trigger: 'hears the bell', every: true, lasts: 'scene' as const }
    const steps = [step('c1', 's1', 'given', bell), step('c1', 's2', 'fired')]
    const [inScene] = at([cmd('c1')], steps, 's2')
    expect(inScene.commands[0]).toMatchObject({ inEffect: true, waiting: true, status: 'in-effect' })
    const [next] = at([cmd('c1')], steps, 's3')
    expect(next.commands[0]).toMatchObject({ inEffect: false, waiting: true, status: 'waiting' })
  })

  it('lays changes over the command from their scene on, and keeps the earlier scenes as they were', () => {
    const steps = [step('c1', 's1', 'given', { words: 'Feel calm', does: 'feels calm', kind: 'feeling' }), step('c1', 's4', 'stronger', { does: 'feels calm and sleepy' })]
    expect(at([cmd('c1')], steps, 's3')[0].commands[0].values.does).toBe('feels calm')
    const [later] = at([cmd('c1')], steps, 's4')
    expect(later.commands[0].values).toMatchObject({ words: 'Feel calm', does: 'feels calm and sleepy' })
    expect(later.commands[0].steps.map((s) => s.kind)).toEqual(['given', 'stronger'])
    // The whole history shows, later steps marked.
    expect(at([cmd('c1')], steps, 's2')[0].commands[0].steps.map((s) => s.later)).toEqual([false, true])
  })

  it("counts an unsure step only once Adam says yes, and never one he said no to", () => {
    const steps = [step('c1', 's1', 'given', socks, { unsure: true })]
    expect(at([cmd('c1')], steps, 's2')).toEqual([])
    steps[0].answer = 'yes'
    expect(at([cmd('c1')], steps, 's2')[0].commands[0].status).toBe('in-effect')
    const end = step('c1', 's3', 'ended', {}, { answer: 'no' })
    expect(at([cmd('c1')], [...steps, end], 's4')[0].commands[0].status).toBe('in-effect')
  })

  it('leaves out steps in scenes not on the line, and people gone from the world', () => {
    const steps = [step('c1', 'gone', 'given', socks), step('c2', 's1', 'given', bra)]
    expect(at([cmd('c1'), cmd('c2', 'nobody')], steps, 's2')).toEqual([])
  })

  it('makes a trigger added later wait, and one taken away hold at once', () => {
    const steps = [step('c1', 's1', 'given', socks), step('c1', 's2', 'changed', { trigger: 'hears the bell' }), step('c1', 's4', 'changed', { trigger: '' })]
    expect(at([cmd('c1')], steps, 's3')[0].commands[0].status).toBe('waiting')
    expect(at([cmd('c1')], steps, 's4')[0].commands[0].status).toBe('in-effect')
  })
})

describe('cleanValues', () => {
  it('keeps only what it can read, with pieces of clothing as plain words', () => {
    expect(cleanValues({ words: '  No  socks ', off: ['Her Socks', 'the BRA', 3, ''], kind: 'nonsense', every: 'yes', lasts: 'scene' })).toEqual({
      words: 'No socks',
      off: ['socks', 'bra'],
      lasts: 'scene'
    })
    expect(cleanValues(null)).toEqual({})
  })

  it('says nothing of clothing when no clothing command holds', () => {
    expect(wearingByCommand([])).toBe('')
  })
})
