// The plan's notes said again before the prose are taken off the start of a draft as it streams, in pieces of any size;
// prose that only looks like them for a moment goes through untouched. Invented test text only.
import { describe, expect, it } from 'vitest'
import { carriesPlan, PLAN_GO, PLAN_HEAD, PlanEchoFilter } from './echo'

const NOTES = `${PLAN_HEAD}\nWhat the scene rests on, as things stand:\n- Wren: left arm in a sling\nWhat happens on the page, in order:\n1. Osric climbs up.\n${PLAN_GO.start}`
const PROSE = 'The ladder creaked under him.\n\n"You came," she said.'

/** The text in pieces of `size` characters, through a filter, as a draft streams. */
function stream(text: string, size: number, on = true): string {
  const f = new PlanEchoFilter(on)
  let out = ''
  for (let i = 0; i < text.length; i += size) out += f.push(text.slice(i, i + size))
  return out + f.flush()
}

describe('notes said again before the prose', () => {
  it('are taken off, whatever size the pieces come in', () => {
    for (const size of [1, 3, 7, 40, 10_000]) {
      expect(stream(`${NOTES}\n\n${PROSE}`, size), `pieces of ${size}`).toBe(PROSE)
      expect(stream(`\n${NOTES}\n${PROSE}`, size)).toBe(PROSE)
      // Carrying on from the scene so far, and just the last line.
      expect(stream(`${PLAN_GO.here}\n${PROSE}`, size)).toBe(PROSE)
    }
  })

  it('without their last line, end at the first line that is prose; notes alone leave nothing', () => {
    expect(stream(`${PLAN_HEAD}\n- Wren: left arm in a sling\n\n${PROSE}`, 5)).toBe(PROSE)
    expect(stream(NOTES, 4)).toBe('')
  })

  it('leave prose alone, even prose that starts like them for a moment', () => {
    for (const text of [PROSE, 'Now the rain came, and the wheel turned.', 'My hands were cold.', '- a list in the prose\n1. kept']) {
      expect(stream(text, 2)).toBe(text)
    }
    // No plan in the briefing: nothing is held or taken.
    expect(stream(`${NOTES}\n${PROSE}`, 3, false)).toBe(`${NOTES}\n${PROSE}`)
  })

  it('are looked for only when the briefing carries a plan', () => {
    expect(carriesPlan([{ content: 'system' }, { content: `Write the scene now.\n\n${NOTES}` }])).toBe(true)
    expect(carriesPlan([{ content: 'system' }, { content: 'Write the scene now.' }])).toBe(false)
  })
})
