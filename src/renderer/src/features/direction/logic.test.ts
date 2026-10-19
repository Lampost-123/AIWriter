import { describe, expect, it } from 'vitest'
import type { RecentDirection } from '@shared/contracts/direction'
import { FAVOURITES_MAX, FAVOURITE_MAX_CHARS } from '@shared/contracts/direction'
import { beatDirections, cleanFavourites, directionKey, tidyDirection, withFavourite } from '@shared/directions'
import { CHIPS, CHIPS_SHOWN, NO_HISTORY, addAsk, chipById, hasAsk, historyStep, mergeRecents, removeAsk, searchDirections, toggleChip } from './logic'
import { changedSpan } from './typeInto'

const recent = (text: string, at: string, uses = 1): RecentDirection => ({ text, at, source: 'draft', uses })

describe('the same direction', () => {
  it('is the same words whatever the case, spacing, quotes or closing full stops', () => {
    expect(directionKey('Make it tense.')).toBe(directionKey('  make  it\ntense'))
    expect(directionKey('End on “the knock”…')).toBe(directionKey('end on "the knock"'))
    expect(directionKey('She won’t go')).toBe(directionKey("she won't go"))
    expect(directionKey('Make it tense!')).not.toBe(directionKey('Make it tense'))
    expect(tidyDirection('  two\n\nlines  ')).toBe('two lines')
  })

  it("reads a beat's record as the scene's direction and the beat's own note", () => {
    expect(beatDirections('Make it tense. For this beat: She opens the door')).toEqual(['Make it tense.', 'She opens the door'])
    expect(beatDirections('For this beat: She opens the door')).toEqual(['She opens the door'])
    expect(beatDirections('Make it tense')).toEqual(['Make it tense'])
    expect(beatDirections('  ')).toEqual([])
  })
})

describe('quick asks', () => {
  const shorter = chipById('shorter')
  const longer = chipById('longer')
  const dialogue = chipById('dialogue')

  it('are nine, the first few shown on the row and the rest behind More', () => {
    expect(CHIPS.map((c) => c.label)).toEqual([
      'Shorter',
      'Longer',
      'More dialogue',
      'Less description',
      'Slower',
      'Faster',
      'Inner thoughts',
      'Tenser',
      'End on a hook'
    ])
    expect(CHIPS_SHOWN).toBe(4)
    // Every pair of opposites points both ways.
    for (const c of CHIPS) if (c.opposite) expect(chipById(c.opposite).opposite).toBe(c.id)
  })

  it('add a short ask as a sentence of its own', () => {
    expect(addAsk('', 'More dialogue.')).toBe('More dialogue.')
    expect(addAsk('Make it tense', 'More dialogue.')).toBe('Make it tense. More dialogue.')
    expect(addAsk('Make it tense.  ', 'More dialogue.')).toBe('Make it tense. More dialogue.')
    expect(addAsk('Is she lying?', 'More dialogue.')).toBe('Is she lying? More dialogue.')
    expect(addAsk('“Go,” she says.”', 'Tenser.')).toBe('“Go,” she says.” Tenser.')
    expect(addAsk('Slowly, then', 'End on a hook.')).toBe('Slowly, then. End on a hook.')
    expect(addAsk('Slowly,', 'End on a hook.')).toBe('Slowly, End on a hook.')
  })

  it('know when the box already asks it, whatever the case or spacing', () => {
    expect(hasAsk('Make it tense. Keep it shorter.', shorter)).toBe(true)
    expect(hasAsk('make it tense, keep  it\nshorter', shorter)).toBe(true)
    expect(hasAsk('Make it tense', shorter)).toBe(false)
    // Words inside other words don't count.
    expect(hasAsk('Much more dialogues please', dialogue)).toBe(false)
  })

  it('take their ask out again, leaving the rest as it was', () => {
    expect(removeAsk('Make it tense. Keep it shorter. End on a hook.', shorter.ask)).toBe('Make it tense. End on a hook.')
    expect(removeAsk('Keep it shorter.', shorter.ask)).toBe('')
    expect(removeAsk('Keep it shorter. Make it tense', shorter.ask)).toBe('Make it tense')
    expect(removeAsk('Make it tense. Keep it shorter.', shorter.ask)).toBe('Make it tense.')
    expect(removeAsk('First line\nKeep it shorter.\nLast line', shorter.ask)).toBe('First line\nLast line')
    expect(removeAsk('Nothing to take out', shorter.ask)).toBe('Nothing to take out')
  })

  it('toggle: pressed once it asks, again it takes the ask out, and an opposite takes the other’s place', () => {
    let box = 'Make it tense'
    box = toggleChip(box, shorter)
    expect(box).toBe('Make it tense. Keep it shorter.')
    box = toggleChip(box, dialogue)
    expect(box).toBe('Make it tense. Keep it shorter. More dialogue.')
    box = toggleChip(box, longer)
    expect(box).toBe('Make it tense. More dialogue. Make it longer.')
    expect(hasAsk(box, shorter)).toBe(false)
    box = toggleChip(box, longer)
    expect(box).toBe('Make it tense. More dialogue.')
    box = toggleChip(toggleChip(box, dialogue), chipById('hook'))
    expect(box).toBe('Make it tense. End on a hook.')
    expect(toggleChip('', chipById('slower'))).toBe('Slow the pace down.')
    expect(toggleChip('Slow the pace down.', chipById('faster'))).toBe('Pick up the pace.')
  })
})

describe('directions given before', () => {
  it('merge the records with those given this session: newest first, the same words once', () => {
    const fromRecords = [recent('Make it tense', '2026-10-19T10:00:00.000Z', 3), recent('End on the knock', '2026-10-18T10:00:00.000Z')]
    const used = [
      { text: 'make it  tense.', at: '2026-10-19T11:00:00.000Z', source: 'continue' as const },
      { text: 'A storm comes in', at: '2026-10-19T09:00:00.000Z', source: 'beat' as const }
    ]
    const out = mergeRecents(fromRecords, used)
    expect(out.map((d) => d.text)).toEqual(['make it tense.', 'A storm comes in', 'End on the knock'])
    // The newest words are kept, with the most uses known.
    expect(out[0]).toMatchObject({ text: 'make it tense.', source: 'continue', uses: 3 })
    expect(mergeRecents(fromRecords, used, 1)).toHaveLength(1)
    expect(mergeRecents([recent('   ', '2026-10-19T10:00:00.000Z')], [])).toEqual([])
  })

  it('are searched by every word, in any order and case', () => {
    const list = [{ text: 'Make it tense, end on the knock' }, { text: 'More dialogue' }, { text: 'The knock comes early' }]
    expect(searchDirections(list, 'KNOCK').map((d) => d.text)).toEqual(['Make it tense, end on the knock', 'The knock comes early'])
    expect(searchDirections(list, 'knock tense').map((d) => d.text)).toEqual(['Make it tense, end on the knock'])
    expect(searchDirections(list, '  ')).toEqual(list)
    expect(searchDirections(list, 'storm')).toEqual([])
  })
})

describe('↑ and ↓ in the box', () => {
  const list = ['Newest', 'Older', 'Oldest']

  it('↑ in an empty box brings back the last direction, ↑ again the one before, and stays at the oldest', () => {
    let step = historyStep(NO_HISTORY, '', 'older', list)!
    expect(step.value).toBe('Newest')
    step = historyStep(step.state, step.value, 'older', list)!
    expect(step.value).toBe('Older')
    step = historyStep(step.state, step.value, 'older', list)!
    expect(step.value).toBe('Oldest')
    step = historyStep(step.state, step.value, 'older', list)!
    expect(step.value).toBe('Oldest')
  })

  it('↓ comes back towards the newest, then to what the box held', () => {
    let step = historyStep(NO_HISTORY, '', 'older', list)!
    step = historyStep(step.state, step.value, 'older', list)!
    step = historyStep(step.state, step.value, 'newer', list)!
    expect(step.value).toBe('Newest')
    step = historyStep(step.state, step.value, 'newer', list)!
    expect(step.value).toBe('')
    expect(step.state).toEqual(NO_HISTORY)
    // Not stepping: ↓ is the box's own (or the menu's).
    expect(historyStep(step.state, '', 'newer', list)).toBeNull()
  })

  it('leaves the keys alone when the box has words of its own, or there is nothing to bring back', () => {
    expect(historyStep(NO_HISTORY, 'My own words', 'older', list)).toBeNull()
    expect(historyStep(NO_HISTORY, '', 'older', [])).toBeNull()
    // Edited after it was brought back: the words are Adam's now.
    const step = historyStep(NO_HISTORY, '', 'older', list)!
    expect(historyStep(step.state, 'Newest, but tenser', 'older', list)).toBeNull()
    expect(historyStep(step.state, 'Newest, but tenser', 'newer', list)).toBeNull()
  })
})

describe('favourites', () => {
  it('star to the front, the same words once, and the star comes off', () => {
    let f = withFavourite([], 'Make it tense', true)
    f = withFavourite(f, 'More dialogue', true)
    expect(f).toEqual(['More dialogue', 'Make it tense'])
    f = withFavourite(f, ' make it  TENSE. ', true)
    expect(f).toEqual(['make it TENSE.', 'More dialogue'])
    f = withFavourite(f, 'Make it tense', false)
    expect(f).toEqual(['More dialogue'])
    expect(withFavourite(f, '   ', true)).toEqual(['More dialogue'])
  })

  it('keep a quick ask short, and only so many', () => {
    const long = `${'word '.repeat(200)}end`
    const [kept] = withFavourite([], long, true)
    expect(kept.length).toBeLessThanOrEqual(FAVOURITE_MAX_CHARS)
    expect(kept.endsWith('word')).toBe(true)
    let f: string[] = []
    for (let i = 0; i < FAVOURITES_MAX + 5; i++) f = withFavourite(f, `Direction ${i}`, true)
    expect(f).toHaveLength(FAVOURITES_MAX)
    expect(f[0]).toBe(`Direction ${FAVOURITES_MAX + 4}`)
  })

  it('read from the file: strings only, the same words once, in their order', () => {
    expect(cleanFavourites(['B', 'A', 'b.', 3, null, '  '])).toEqual(['B', 'A'])
    expect(cleanFavourites('not a list')).toEqual([])
    expect(cleanFavourites(undefined)).toEqual([])
  })
})

describe('typing a change into the box', () => {
  it('replaces only the part that changed', () => {
    expect(changedSpan('Make it tense', 'Make it tense. More dialogue.')).toEqual({ from: 13, to: 13, text: '. More dialogue.' })
    expect(changedSpan('Make it tense. Keep it shorter.', 'Make it tense.')).toEqual({ from: 14, to: 31, text: '' })
    expect(changedSpan('', 'Shorter.')).toEqual({ from: 0, to: 0, text: 'Shorter.' })
    expect(changedSpan('aaa', 'aaaa')).toEqual({ from: 3, to: 3, text: 'a' })
  })
})
