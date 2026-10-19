// Instruction packs (overhaul phase 2): a short named pack per job, listed by name and one line, loaded with
// load_instructions only when needed; their words come from the app's own prompts and rules.
import { describe, expect, it } from 'vitest'
import { PLAIN_RULE, SLOP_RULES } from '@shared/slop'
import { craftRules } from '../prompts'
import { CHECK_WHAT } from '../../checks/prompts'
import { LOAD_INSTRUCTIONS, loadInstructions, loadInstructionsTool, PACK_NAMES, packList, packOf, PACKS } from '.'

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length

describe('the packs', () => {
  it('are the six jobs, each with a kebab-case name, one short line and a short text', () => {
    expect(PACK_NAMES).toEqual(['plan-a-scene', 'write-dialogue', 'revise-for-voice', 'fix-a-slip', 'check-continuity', 'explain-memory'])
    for (const p of PACKS) {
      expect(p.name).toMatch(/^[a-z]+(?:-[a-z]+)+$/)
      expect(p.description).not.toContain('\n')
      expect(words(p.description)).toBeLessThanOrEqual(30)
      expect(p.title).toMatch(/^[a-z]/)
      expect(words(p.text)).toBeGreaterThan(60)
      // Short: a pack is the detail of one job, not a whole prompt.
      expect(words(p.text)).toBeLessThanOrEqual(600)
      // Plain words: never the model's jargon.
      expect(p.text).not.toMatch(/\bLLM\b/)
    }
  })

  it('carry the app’s own rules, not new ones', () => {
    const text = (name: string): string => packOf(name)!.text
    for (const k of ['facts', 'knowledge', 'timeline', 'continuity'] as const) expect(text('check-continuity')).toContain(CHECK_WHAT[k])
    // The writer's craft rules with the rules against AI phrasing merged in, each said once.
    for (const r of craftRules({ aiPhrases: true, plain: true, end: false }).slice(0, 4)) expect(text('revise-for-voice')).toContain(r)
    expect(text('revise-for-voice')).toContain(PLAIN_RULE)
    expect(text('revise-for-voice')).toContain(SLOP_RULES.find((r) => r.startsWith('End on'))!)
    expect(text('revise-for-voice')).not.toContain('Keep to the briefing')
    expect(text('write-dialogue')).toContain('Put everything said aloud in quote marks')
    expect(text('write-dialogue')).toContain('people rarely say exactly what they mean')
    expect(text('plan-a-scene')).toContain('The dead stay dead. Things are where they were last left. Time moves forward.')
    expect(text('fix-a-slip')).toContain('Never add events, people or facts')
    expect(text('explain-memory')).toContain('A new draft always waits for the memory to catch up first.')
  })
})

describe('the list every request carries', () => {
  it('names each pack offered with its line, and says how to load one', () => {
    const list = packList()
    expect(list.split('\n')[0]).toBe('Instruction packs')
    expect(list).toContain(LOAD_INSTRUCTIONS)
    for (const p of PACKS) expect(list).toContain(`- ${p.name}: ${p.description}`)
    // The same every time (a provider's cache keeps it), and only what is offered.
    expect(packList()).toBe(list)
    const one = packList(['check-continuity'])
    expect(one).toContain('- check-continuity:')
    expect(one).not.toContain('plan-a-scene')
    expect(packList([])).toBe('')
  })

  it('is much shorter than the packs themselves', () => {
    expect(words(packList())).toBeLessThan(PACKS.reduce((n, p) => n + words(p.text), 0) / 5)
  })
})

describe('load_instructions', () => {
  it('offers the packs by name', () => {
    const tool = loadInstructionsTool(['plan-a-scene', 'fix-a-slip'])
    expect(tool.name).toBe('load_instructions')
    expect(tool.parameters).toMatchObject({ properties: { name: { enum: ['plan-a-scene', 'fix-a-slip'] } }, required: ['name'] })
    expect((loadInstructionsTool().parameters as { properties: { name: { enum: string[] } } }).properties.name.enum).toEqual([...PACK_NAMES])
  })

  it('gives a pack’s text, however its name is written, with what the agent adds', () => {
    const a = loadInstructions('{"name": "Fix_A Slip"}', { extra: (n) => (n === 'fix-a-slip' ? 'In this chat: issue_fix.' : '') })
    expect(a.ok).toBe(true)
    expect(a.pack?.name).toBe('fix-a-slip')
    expect(a.label).toBe('Reading the instructions for fixing a slip')
    expect(a.text.startsWith(packOf('fix-a-slip')!.text)).toBe(true)
    expect(a.text.endsWith('\n\nIn this chat: issue_fix.')).toBe(true)
    expect(loadInstructions({ name: 'write-dialogue' }).text).toBe(packOf('write-dialogue')!.text)
  })

  it('sends a pack once an answer', () => {
    const loaded = new Set<string>()
    expect(loadInstructions({ name: 'plan-a-scene' }, { loaded }).text).toBe(packOf('plan-a-scene')!.text)
    const again = loadInstructions({ name: 'plan-a-scene' }, { loaded })
    expect(again).toMatchObject({ ok: true, text: 'The plan-a-scene pack is already loaded above: follow it.' })
  })

  it('says which packs there are when the name is wrong, missing or not offered', () => {
    expect(loadInstructions({ name: 'write-a-poem' })).toMatchObject({ ok: false, pack: null })
    expect(loadInstructions({ name: 'write-a-poem' }).text).toBe(`There is no pack called “write-a-poem”. The packs are: ${PACK_NAMES.join(', ')}.`)
    expect(loadInstructions('not json').text).toMatch(/^Say which pack: `name`\. The packs are: /)
    const notOffered = loadInstructions({ name: 'plan-a-scene' }, { offered: ['check-continuity'] })
    expect(notOffered.ok).toBe(false)
    expect(notOffered.text).toContain('The packs are: check-continuity.')
  })
})
