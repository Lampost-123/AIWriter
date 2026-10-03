import { describe, expect, it } from 'vitest'
import { parseRecipe } from './parse'
import { combineSystem, PART_HEADINGS } from './prompts'

describe('reading the recipe the AI wrote', () => {
  it('reads the name and every part under its heading', () => {
    const text = [
      'Name: A slow-burn mystery in three acts',
      '',
      '## Themes',
      '- Trust: tested at the midpoint.',
      '',
      '## Point of view',
      'Close third person',
      '## Sample passage',
      'The kettle boiled twice.',
      '',
      'Nobody poured it.'
    ].join('\n')
    expect(parseRecipe(text)).toEqual({
      name: 'A slow-burn mystery in three acts',
      parts: { themes: '- Trust: tested at the midpoint.', pov: 'Close third person', sample: 'The kettle boiled twice.\n\nNobody poured it.' }
    })
  })

  it('forgives bold headings, other heading levels, colons and chatter before the first heading', () => {
    const text = 'Here is your recipe!\n**Name:** "Harbour story"\n\n**Writing style:**\nPlain and short.\n### Cast Roles\n- The mentor: kind.\n# Tense:\nPast'
    const r = parseRecipe(text)
    expect(r.name).toBe('Harbour story')
    expect(r.parts).toEqual({ style: 'Plain and short.', cast: '- The mentor: kind.', tense: 'Past' })
  })

  it('keeps a bold line inside a part as text, without its stars', () => {
    expect(parseRecipe('## Beats\n**Chapter 1:** the outsider arrives.').parts.beats).toBe('Chapter 1: the outsider arrives.')
  })

  it('asks for every part under the heading it reads', () => {
    const system = combineSystem()
    for (const h of Object.values(PART_HEADINGS)) expect(system).toContain(`## ${h}`)
  })
})
