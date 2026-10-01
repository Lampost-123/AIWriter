import { describe, expect, it } from 'vitest'
import type { Entry, EntryKind, StyleGuide } from '@shared/types'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import {
  assembleContext,
  buildBlocks,
  computeBudget,
  DEFAULT_CONTEXT_LENGTH,
  finishContext,
  formatProfile,
  mentions,
  parentChain,
  prepareContext,
  sceneTail,
  sentEntryIds,
  type ContextInput
} from './context'
import { countRaw } from './tokens'

let seq = 0
const entry = (kind: EntryKind, name: string, extra: Partial<Entry> = {}): Entry => ({
  id: `e${++seq}`,
  kind,
  name,
  aliases: [],
  summary: '',
  description: '',
  tags: [],
  notes: '',
  fields: {},
  parentId: null,
  hardRule: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...extra
})

const style = (s: Partial<StyleGuide> = {}): StyleGuide => ({ ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK', ...s })

function world() {
  const mara = entry('character', 'Mara Venn', {
    aliases: ['the Heir'],
    summary: 'A disgraced heir turned smuggler.',
    description: 'Lost her left hand in the siege.',
    notes: 'PRIVATE: maybe kill her off in book 4',
    fields: { pronouns: 'she/her', speech: 'Short, dry sentences.', sampleLines: '"Don\'t."\n"I\'ve had worse."', origin: 'Born in the Narrows.' }
  })
  const tobin = entry('character', 'Tobin', { summary: 'A ferryman who owes Mara.', fields: { speech: 'Rambling, warm.' } })
  const duke = entry('character', 'The Duke', { summary: 'Rules Varn.' })
  const varn = entry('place', 'Varn', { summary: 'The river capital.' })
  const lowtown = entry('place', 'Lowtown', { summary: 'The docks district.', parentId: varn.id })
  const eel = entry('place', 'The Gilded Eel', { summary: 'A smoky tavern.', parentId: lowtown.id, fields: { atmosphere: 'Smoke and wet wool.' } })
  const binding = entry('lore', 'The Binding', { summary: 'Oaths bind magically.', hardRule: true, fields: { rules: 'A broken oath burns the breaker.' } })
  const ferry = entry('place', "Tobin's Ferry", { summary: 'A flat-bottomed ferry.', description: 'Moored below the Narrows.' })
  const softLore = entry('lore', 'River songs', { summary: 'Songs of the river folk.' })
  return { mara, tobin, duke, varn, lowtown, eel, binding, ferry, softLore, all: [mara, tobin, duke, varn, lowtown, eel, binding, ferry, softLore] }
}

function input(over: Partial<ContextInput> = {}): ContextInput {
  const w = world()
  return {
    style: style({ samplePassage: 'The river kept its own counsel.', avoidPhrases: ['suddenly'] }),
    scene: {
      title: 'The knock',
      card: {
        ...emptySceneCard(),
        povId: w.mara.id,
        presentIds: [w.mara.id, w.tobin.id],
        locationId: w.eel.id,
        when: 'Day 12, dusk',
        beats: ['Mara arrives at the tavern', "Tobin offers passage on Tobin's Ferry"],
        goal: 'Get passage out of Varn',
        conflict: 'Tobin wants a favour first',
        outcome: 'She agrees, then someone knocks',
        mood: 'Tense',
        targetWords: 1200,
        notes: 'Keep the hand subtle.'
      }
    },
    previousText: 'She left the docks at dusk.',
    entries: w.all,
    world: { themes: 'Debt and loyalty', tone: 'Grim but warm' },
    story: { title: 'Book 1', premise: 'A smuggler must cross the river.', themes: '', tone: '' },
    options: { direction: 'Make it tense, end on the knock at the door', targetWords: 1200, creativity: 'balanced' },
    contextLength: 32000,
    ...over
  }
}

const words = (n: number, word = 'word'): string => Array.from({ length: n }, () => word).join(' ')

describe('budget', () => {
  it('is the context length minus the reply room and a 10% margin', () => {
    const b = computeBudget(32000, 1000)
    expect(b.reserved).toBe(Math.ceil(1000 * 1.35 * 1.4))
    expect(b.available).toBe(32000 - b.reserved - 3200)
  })

  it('uses 16,000 when the context length is unknown', () => {
    expect(computeBudget(null, 1000).contextLength).toBe(DEFAULT_CONTEXT_LENGTH)
    expect(computeBudget(0, 1000).contextLength).toBe(DEFAULT_CONTEXT_LENGTH)
  })
})

describe('buildBlocks', () => {
  it('builds the blocks in the fixed priority order', () => {
    const blocks = buildBlocks(input())
    expect(blocks.map((b) => [b.id, b.priority])).toEqual([
      ['instructions', 1],
      ['scene-card', 2],
      ['previous-scene', 3],
      ['pov', 4],
      ['present', 5],
      ['setting', 7],
      ['mentioned', 9],
      ['themes', 10]
    ])
  })

  it('records which entries each block includes', () => {
    const inp = input()
    const w = inp.entries
    const byName = (n: string): string => w.find((e) => e.name === n)!.id
    const blocks = buildBlocks(inp)
    const get = (id: string) => blocks.find((b) => b.id === id)!
    expect(get('pov').entryIds).toEqual([byName('Mara Venn')])
    expect(get('present').entryIds).toEqual([byName('Tobin')])
    expect(get('setting').entryIds).toEqual([byName('The Gilded Eel'), byName('Lowtown'), byName('Varn'), byName('The Binding')])
    expect(get('mentioned').entryIds).toEqual([byName("Tobin's Ferry")])
    expect(get('instructions').entryIds).toEqual([])
  })

  it('puts the style guide, sample passage and phrases to avoid in the instructions', () => {
    const text = buildBlocks(input())[0].text
    expect(text).toContain('Point of view: Close third person')
    expect(text).toContain('Tense: Past tense')
    expect(text).toContain('UK English')
    expect(text).toContain('The river kept its own counsel.')
    expect(text).toContain('- suddenly')
  })

  it('puts the whole scene card and the direction in block 2', () => {
    const text = buildBlocks(input()).find((b) => b.id === 'scene-card')!.text
    for (const s of [
      'Scene: The knock',
      'When: Day 12, dusk',
      'Point of view: Mara Venn',
      'Also in the scene: Tobin',
      'Where: The Gilded Eel',
      '1. Mara arrives at the tavern',
      "2. Tobin offers passage on Tobin's Ferry",
      'Goal: Get passage out of Varn',
      'Conflict: Tobin wants a favour first',
      'Outcome: She agrees, then someone knocks',
      'Mood: Tense',
      'Length: about 1,200 words',
      'Keep the hand subtle.',
      'Make it tense, end on the knock at the door'
    ]) {
      expect(text).toContain(s)
    }
  })

  it('gives the point-of-view character a full profile, grouped and labelled, without private notes', () => {
    const pov = buildBlocks(input()).find((b) => b.id === 'pov')!
    expect(pov.title).toBe('Point-of-view character: Mara Venn')
    expect(pov.text).toContain('Also called: the Heir')
    expect(pov.text).toContain('In short: A disgraced heir turned smuggler.')
    expect(pov.text).toContain('Lost her left hand in the siege.')
    expect(pov.text).toContain('Basics\n- Pronouns: she/her')
    expect(pov.text).toContain('Backstory\n- Origin: Born in the Narrows.')
    expect(pov.text).toContain('Voice\n- How they speak: Short, dry sentences.')
    expect(pov.text).toContain('- Sample lines of dialogue:\n    "Don\'t."\n    "I\'ve had worse."')
    const all = buildBlocks(input())
      .map((b) => b.text)
      .join('\n')
    expect(all).not.toContain('PRIVATE')
  })

  it('lists the places around the location as one-liners, safely even with a loop', () => {
    const setting = buildBlocks(input()).find((b) => b.id === 'setting')!
    expect(setting.text).toContain('### Where: The Gilded Eel')
    expect(setting.text).toContain('It lies within:\n- Lowtown: The docks district.\n- Varn: The river capital.')
    expect(setting.text).toContain('### World rule: The Binding')
    expect(setting.text).toContain('A broken oath burns the breaker.')

    const a = entry('place', 'A', { parentId: 'b' })
    const b = entry('place', 'B', { id: 'b', parentId: a.id })
    const byId = new Map([a, b].map((e) => [e.id, e]))
    expect(parentChain(a, byId).map((e) => e.name)).toEqual(['B'])
  })

  it('always includes hard-rule lore, but not other lore unless it is mentioned', () => {
    const inp = input({ scene: { title: '', card: { ...emptySceneCard() } }, options: { direction: '', targetWords: 800, creativity: 'steady' } })
    const blocks = buildBlocks(inp)
    const setting = blocks.find((b) => b.id === 'setting')!
    expect(setting.title).toBe('World rules (never break these)')
    expect(setting.text).toContain('The Binding')
    expect(blocks.map((b) => b.text).join('\n')).not.toContain('River songs')
  })

  it('finds mentions by whole name or alias, ignoring case, in beats, notes and direction', () => {
    expect(mentions('he spoke to the duke at dawn', 'The Duke')).toBe(true)
    expect(mentions('the Dukes of old', 'The Duke')).toBe(false)
    expect(mentions('Tobin’s boat', 'Tobin')).toBe(true)
    expect(mentions('Tobinson', 'Tobin')).toBe(false)
    expect(mentions('the  heir', 'the Heir')).toBe(true)
    expect(mentions('a b c', 'a')).toBe(false)
    expect(mentions('cost x2', 'x2)')).toBe(false)
    expect(mentions('cost (x2)', 'x2)')).toBe(true)

    const inp = input({ options: { direction: 'Have her think of the duke.', targetWords: 1000, creativity: 'balanced' } })
    const duke = inp.entries.find((e) => e.name === 'The Duke')!
    const mentioned = buildBlocks(inp).find((b) => b.id === 'mentioned')!
    expect(mentioned.entryIds).toContain(duke.id)
    expect(mentioned.text).toContain('### The Duke (character)\nIn short: Rules Varn.')
  })

  it('does not repeat an entry that is already in an earlier block', () => {
    const inp = input()
    inp.scene.card.beats.push('Mara thinks of Lowtown and the Binding')
    const blocks = buildBlocks(inp)
    const ids = blocks.flatMap((b) => b.entryIds)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('leaves out blocks with nothing in them', () => {
    const inp = input({
      previousText: '   ',
      entries: [],
      world: { themes: '', tone: '' },
      story: { title: 'Book 1', premise: '', themes: '', tone: '' },
      scene: { title: '', card: emptySceneCard() },
      options: { direction: '', targetWords: 1500, creativity: 'balanced' }
    })
    expect(buildBlocks(inp).map((b) => b.id)).toEqual(['instructions', 'scene-card'])
  })

  it('skips characters on the card that have been deleted', () => {
    const inp = input()
    inp.scene.card.presentIds = ['gone', ...inp.scene.card.presentIds]
    inp.scene.card.povId = 'also-gone'
    const blocks = buildBlocks(inp)
    expect(blocks.find((b) => b.id === 'pov')).toBeUndefined()
    expect(blocks.find((b) => b.id === 'present')!.entryIds).toHaveLength(2)
  })
})

describe('sceneTail', () => {
  it('returns short scenes whole', () => {
    expect(sceneTail('  A short scene.  ')).toBe('A short scene.')
  })

  it('cuts long scenes at a paragraph start, between 400 and 800 words, near 600', () => {
    const paras = Array.from({ length: 20 }, (_, i) => `P${i} ${words(99)}.`)
    const text = paras.join('\n\n')
    const tail = sceneTail(text)
    const n = tail.split(/\s+/).length
    expect(n).toBeGreaterThanOrEqual(400)
    expect(n).toBeLessThanOrEqual(800)
    expect(n).toBe(600)
    expect(tail.startsWith('P14 ')).toBe(true)
  })

  it('falls back to a sentence start when paragraphs are too long', () => {
    const sentences = Array.from({ length: 120 }, (_, i) => `S${i} ${words(9)}.`)
    const tail = sceneTail(sentences.join(' '))
    expect(tail).toMatch(/^S\d+ /)
    const n = tail.split(/\s+/).length
    expect(n).toBeGreaterThanOrEqual(400)
    expect(n).toBeLessThanOrEqual(800)
  })

  it('cuts mid-text with an ellipsis when there is no boundary at all', () => {
    const tail = sceneTail(words(2000))
    expect(tail.startsWith('…')).toBe(true)
    expect(tail.split(/\s+/).length).toBe(600)
  })
})

describe('assembleContext', () => {
  it('sends block 1 as the system message and the rest in order under headings', () => {
    const preview = assembleContext(input(), countRaw)
    expect(preview.messages).toHaveLength(2)
    expect(preview.messages[0]).toEqual({ role: 'system', content: preview.blocks[0].text })
    const user = preview.messages[1].content
    const order = ['## Scene card', '## End of the previous scene', '## Point-of-view character: Mara Venn', '## Also in the scene', '## Setting and world rules', '## Also mentioned', '## Themes and tone', 'Write the scene now.']
    let at = -1
    for (const h of order) {
      const i = user.indexOf(h)
      expect(i, h).toBeGreaterThan(at)
      at = i
    }
    expect(user).toContain('Hit every beat on the scene card, in order.')
    expect(user).toContain('Aim for about 1,200 words.')
    expect(user).toContain('Keep to close third person, past tense and UK spelling.')
    expect(user).toContain('Continue seamlessly from where the previous scene ends')
    expect(user).toContain("Follow the author's direction for this draft.")
    expect(user).toContain('Never contradict the facts given above.')
  })

  it('keeps the system message identical between scenes, so providers can cache it', () => {
    const a = assembleContext(input(), countRaw)
    const b = assembleContext(input({ previousText: 'Something else entirely.', options: { direction: '', targetWords: 900, creativity: 'steady' } }), countRaw)
    expect(a.messages[0].content).toBe(b.messages[0].content)
  })

  it('counts tokens with a 10% allowance and adds up what is sent', () => {
    const preview = assembleContext(input(), countRaw)
    for (const b of preview.blocks) expect(b.tokens).toBeGreaterThan(0)
    const sum = preview.blocks.reduce((s, b) => s + b.tokens, 0)
    expect(preview.budget.used).toBeGreaterThan(sum)
    expect(preview.budget.used).toBeLessThan(sum + 200)
    expect(preview.blocks.every((b) => !b.dropped)).toBe(true)
  })

  it('drops whole blocks from priority 10 upward until it fits, never 1 or 2', () => {
    const inp = input()
    const prepared = prepareContext(inp)
    // Make every block cost 1000 tokens: with 8 blocks the briefing needs about 8000.
    const counts = prepared.texts.map(() => 909)
    const fits = (contextLength: number) => finishContext({ ...prepared, contextLength }, counts)

    const roomy = fits(32000)
    expect(roomy.blocks.filter((b) => b.dropped)).toEqual([])

    // Room for 5 blocks and the closing instruction (6008 tokens), not 6.
    const tight = fits(9742)
    expect(tight.budget.available).toBe(6499)
    expect(tight.blocks.filter((b) => b.dropped).map((b) => b.id)).toEqual(['setting', 'mentioned', 'themes'])
    expect(tight.budget.used).toBeLessThanOrEqual(tight.budget.available)
    // Dropped blocks stay in the record but aren't sent.
    expect(tight.blocks).toHaveLength(roomy.blocks.length)
    expect(tight.messages[1].content).not.toContain('## Themes and tone')
    expect(tight.messages[1].content).toContain('## Also in the scene')

    // Far too small: everything droppable goes, blocks 1 and 2 stay.
    const tiny = fits(3000)
    expect(tiny.blocks.filter((b) => !b.dropped).map((b) => b.id)).toEqual(['instructions', 'scene-card'])
    expect(tiny.messages[1].content).not.toContain('Continue seamlessly')
  })

  it('lists only the entries that were actually sent', () => {
    const inp = input()
    const prepared = prepareContext(inp)
    const counts = prepared.texts.map(() => 909)
    const tight = finishContext({ ...prepared, contextLength: 9742 }, counts)
    const sent = sentEntryIds(tight.blocks)
    expect(sent).toHaveLength(2)
  })

  it('formats a profile with its heading by default', () => {
    const w = world()
    expect(formatProfile(w.tobin).startsWith('### Tobin\nIn short: A ferryman who owes Mara.')).toBe(true)
  })
})
